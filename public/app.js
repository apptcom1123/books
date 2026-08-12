const PAGE_SIZE = 30;

const state = {
  books: [],
  filters: { q: "", category: "", source: "", sort: "popular", favoritesOnly: false },
  loading: false,
  requestId: 0,
  pagination: { total: 0, hasMore: false },
  reviewBook: null,
  reviews: [],
  reviewRating: 0,
  apiWarningShown: false,
  notificationRealtimeStop: null,
  notificationRealtimeUserId: null,
  reviewRealtimeStop: null,
  reviewRealtimeBookId: null,
  reviewRefreshTimer: null,
};

const elements = {
  grid: document.getElementById("book-grid"),
  empty: document.getElementById("empty-state"),
  summary: document.getElementById("result-summary"),
  search: document.getElementById("search-input"),
  searchForm: document.getElementById("hero-search"),
  categories: document.getElementById("category-list"),
  source: document.getElementById("source-select"),
  sort: document.getElementById("sort-select"),
  activeFilter: document.getElementById("active-filter"),
  favoriteFilter: document.getElementById("favorites-filter"),
  loadMoreWrap: document.getElementById("load-more-wrap"),
  loadMoreButton: document.getElementById("load-more-button"),
  reviewDialog: document.getElementById("review-dialog"),
  reviewForm: document.getElementById("review-form"),
  reviewList: document.getElementById("review-list"),
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  document.getElementById("toast-region").append(node);
  setTimeout(() => node.remove(), 3600);
}

function requireLogin() {
  if (window.libraryAuth.user) return true;
  toast("請先登入，才能評分、收藏、標注或留言。", "error");
  window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error"));
  return false;
}

function renderSkeletons() {
  elements.grid.innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");
}

function bookCard(book) {
  const sourceCode = book.source === "Standard Ebooks" ? "SE" : "PG";
  const stars = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    const active = value <= (book.viewer.rating || 0) ? " active" : "";
    return `<button class="star${active}" type="button" data-action="rate" data-book-id="${book.id}" data-rating="${value}" aria-label="給 ${value} 顆星">★</button>`;
  }).join("");
  const progress = book.viewer.progress?.percentage > 0
    ? `<span class="continue-badge">讀到 ${Math.round(book.viewer.progress.percentage)}%</span>`
    : "";
  return `
    <article class="book-card" data-book-id="${book.id}">
      <a class="cover-link" href="/reader.html?id=${encodeURIComponent(book.id)}" aria-label="閱讀《${escapeHtml(book.title_zh)}》">
        <span class="source-badge">${sourceCode}</span>
        <img class="book-cover" src="${encodeURI(book.cover_url)}" alt="《${escapeHtml(book.title_zh)}》封面" loading="lazy" decoding="async">
      </a>
      <button class="favorite-button${book.viewer.isFavorite ? " active" : ""}" type="button" data-action="favorite" data-book-id="${book.id}" aria-label="${book.viewer.isFavorite ? "取消收藏" : "收藏"}">${book.viewer.isFavorite ? "♥" : "♡"}</button>
      <div class="book-meta">
        <h3><a href="/reader.html?id=${encodeURIComponent(book.id)}">${escapeHtml(book.title_zh)}</a></h3>
        <p class="book-original-title" title="${escapeHtml(book.title_original)}">${escapeHtml(book.title_original)}</p>
        <p class="book-author">${escapeHtml(book.author)}</p>
        <p class="book-description">${escapeHtml(book.description_zh)}</p>
        ${progress}
        <div class="book-rating-summary" aria-label="平均評分 ${Number(book.metrics.averageRating || 0).toFixed(1)}，共 ${book.metrics.ratingCount || 0} 份評分"><b>★ ${Number(book.metrics.averageRating || 0).toFixed(1)}</b><span>${book.metrics.ratingCount || 0} 份評分</span></div>
        <div class="book-stats">
          <div class="rating" aria-label="我的評分">${stars}</div>
          <button class="review-button" type="button" data-action="reviews" data-book-id="${book.id}">${book.metrics.reviewCount || 0} 則評論</button>
          <span title="不重複讀者人數">◉ ${book.metrics.readerCount.toLocaleString("zh-TW")} 人閱讀</span>
        </div>
      </div>
    </article>`;
}

function renderBooks() {
  const visible = state.filters.favoritesOnly ? state.books.filter((book) => book.viewer.isFavorite) : state.books;
  elements.grid.innerHTML = visible.map(bookCard).join("");
  elements.empty.hidden = visible.length > 0;
  elements.grid.hidden = visible.length === 0;
  const label = state.filters.favoritesOnly ? "收藏中" : "館藏中";
  elements.summary.textContent = `${label}顯示 ${visible.length} 本${state.filters.favoritesOnly ? "已載入作品" : `／共 ${state.pagination.total} 本`}`;
  elements.loadMoreWrap.hidden = !state.pagination.hasMore;
  elements.loadMoreButton.disabled = state.loading;
  elements.loadMoreButton.textContent = state.loading ? "正在整理下一批…" : state.filters.favoritesOnly ? "載入更多以尋找收藏" : `再顯示 ${Math.min(PAGE_SIZE, Math.max(0, state.pagination.total - state.books.length))} 本`;
  elements.activeFilter.hidden = !(state.filters.q || state.filters.favoritesOnly);
  elements.activeFilter.textContent = state.filters.favoritesOnly
    ? "目前只顯示你的收藏"
    : state.filters.q ? `搜尋：「${state.filters.q}」` : "";
}

function renderCategories(categories) {
  const all = ["", ...categories];
  elements.categories.innerHTML = all.map((category) => `<button class="category-chip${state.filters.category === category ? " active" : ""}" type="button" data-category="${escapeHtml(category)}">${category || "全部"}</button>`).join("");
}

async function loadStaticCatalog({ limit, offset }) {
  const response = await fetch("/data/catalog.json");
  if (!response.ok) throw new Error("無法載入離線館藏");
  const query = state.filters.q.toLocaleLowerCase("zh-Hant");
  const catalog = await response.json();
  let books = catalog.filter((book) => {
    if (book.rights_status !== "reviewed" || book.enabled === false) return false;
    if (state.filters.category && book.category !== state.filters.category) return false;
    if (state.filters.source && book.source !== state.filters.source) return false;
    const haystack = [book.title_zh, book.title_original, book.author, book.description_zh, ...(book.subjects || [])].join(" ").toLocaleLowerCase("zh-Hant");
    return !query || query.split(/\s+/).every((term) => haystack.includes(term));
  }).map((book) => ({ ...book, metrics: { readerCount: 0, ratingCount: 0, averageRating: 0, favoriteCount: 0, annotationCount: 0, reviewCount: 0 }, viewer: { rating: 0, isFavorite: false, progress: JSON.parse(localStorage.getItem(`mystery-library:progress:${book.id}`) || "null") } }));
  if (state.filters.sort === "title") books.sort((a, b) => a.title_zh.localeCompare(b.title_zh, "zh-Hant"));
  else if (state.filters.sort === "newest") books.sort((a, b) => String(b.edition_release_date).localeCompare(String(a.edition_release_date)));
  const total = books.length;
  return { books: books.slice(offset, offset + limit), pagination: { total, limit, offset, hasMore: offset + limit < total }, filters: { categories: ["Literature", "Science & Technology", "History", "Social Sciences & Society", "Arts & Culture", "Religion & Philosophy", "Lifestyle & Hobbies", "Health & Medicine"] } };
}

async function loadBooks({ append = false } = {}) {
  if (append && (state.loading || !state.pagination.hasMore)) return;
  const requestId = ++state.requestId;
  const offset = append ? state.books.length : 0;
  state.loading = true;
  if (append) renderBooks();
  else {
    state.books = [];
    state.pagination = { total: 0, hasMore: false };
    elements.loadMoreWrap.hidden = true;
    renderSkeletons();
  }
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort: state.filters.sort });
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.category) params.set("category", state.filters.category);
  if (state.filters.source) params.set("source", state.filters.source);
  try {
    let result;
    try {
      result = await window.libraryApi.get(`/books?${params}`);
    } catch (apiError) {
      result = await loadStaticCatalog({ limit: PAGE_SIZE, offset });
      console.warn("API unavailable; showing the read-only static catalog.", apiError);
      if (!state.apiWarningShown) {
        state.apiWarningShown = true;
        toast("互動資料庫尚未連線；目前可瀏覽與閱讀，但收藏、評論與標注暫不可用。", "error");
      }
    }
    if (requestId !== state.requestId) return;
    state.books = append
      ? [...state.books, ...result.books.filter((book) => !state.books.some((current) => current.id === book.id))]
      : result.books;
    state.pagination = {
      total: result.pagination.total,
      hasMore: result.pagination.hasMore ?? state.books.length < result.pagination.total,
    };
    document.getElementById("catalog-total").textContent = result.pagination.total;
    renderCategories(result.filters.categories);
    renderBooks();
  } catch (error) {
    if (requestId !== state.requestId) return;
    elements.grid.innerHTML = "";
    elements.empty.hidden = false;
    toast(error.message, "error");
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      renderBooks();
    }
  }
}

async function rateBook(bookId, rating) {
  if (!requireLogin()) return;
  const book = state.books.find((item) => item.id === bookId);
  const nextRating = book?.viewer.rating === rating ? 0 : rating;
  try {
    const result = await window.libraryApi.put(`/books/${encodeURIComponent(bookId)}/rating`, { rating: nextRating });
    Object.assign(book.metrics, result.metrics);
    Object.assign(book.viewer, result.viewer);
    renderBooks();
    toast(nextRating ? `已給《${book.title_zh}》${nextRating} 顆星` : "已取消評分");
  } catch (error) { toast(error.message, "error"); }
}

async function toggleFavorite(bookId) {
  if (!requireLogin()) return;
  const book = state.books.find((item) => item.id === bookId);
  try {
    const result = await window.libraryApi.post(`/books/${encodeURIComponent(bookId)}/favorite`);
    Object.assign(book.metrics, result.metrics);
    Object.assign(book.viewer, result.viewer);
    renderBooks();
    toast(result.viewer.isFavorite ? `已收藏《${book.title_zh}》` : "已取消收藏");
  } catch (error) { toast(error.message, "error"); }
}

function avatarFor(user) {
  if (user.avatar_url) {
    try {
      const url = new URL(user.avatar_url);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch {}
  }
  const initial = escapeHtml((user.public_display_name || "讀")[0]);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#dbe2d8"/><text x="32" y="40" text-anchor="middle" font-size="27" fill="#233d32">${initial}</text></svg>`)}`;
}

function renderReviewRating() {
  document.getElementById("review-rating").innerHTML = Array.from({ length: 5 }, (_, index) => `<button class="${index < state.reviewRating ? "active" : ""}" type="button" data-review-rating="${index + 1}" aria-label="${index + 1} 顆星">★</button>`).join("");
}

function renderReviews() {
  const book = state.reviewBook;
  if (!book) return;
  document.getElementById("review-dialog-title").textContent = `《${book.title_zh}》讀者評論`;
  document.getElementById("review-summary").innerHTML = `<strong>${Number(book.metrics.averageRating || 0).toFixed(1)}</strong><span>${book.metrics.ratingCount || 0} 份評分 ・ ${state.reviews.length} 則文字評論</span>`;
  const own = state.reviews.find((review) => review.isOwner);
  state.reviewRating = own ? (book.viewer.rating || 0) : (book.viewer.rating || state.reviewRating || 0);
  if (own && !document.getElementById("review-content").value) document.getElementById("review-content").value = own.content;
  document.getElementById("review-submit").textContent = own ? "更新評論" : "發表評論";
  renderReviewRating();
  elements.reviewList.innerHTML = state.reviews.length ? state.reviews.map((review) => `<article class="review-card">
    <div class="review-head"><img src="${escapeHtml(avatarFor(review.author || {}))}" alt=""><strong>${escapeHtml(review.author?.public_display_name || "讀者")}</strong>${["admin", "moderator"].includes(review.author?.role) ? '<span class="role-badge">館員</span>' : ""}<time>${new Date(review.updated_at).toLocaleDateString("zh-TW")}</time></div>
    <p>${escapeHtml(review.content)}</p>
    <div class="review-actions"><button class="review-like${review.viewerLiked ? " active" : ""}" type="button" data-review-like="${review.id}">${review.viewerLiked ? "♥" : "♡"} ${review.likeCount} 人讚賞</button><button class="review-favorite${review.viewerFavorite ? " active" : ""}" type="button" data-review-favorite="${review.id}">${review.viewerFavorite ? "★ 已收藏" : "☆ 收藏評論"} ${review.favoriteCount || 0}</button></div>
  </article>`).join("") : '<p class="muted">還沒有文字評論，分享第一則無劇透心得吧。</p>';
}

async function openReviews(bookId) {
  try {
    state.reviewBook = state.books.find((book) => book.id === bookId) || (await window.libraryApi.get(`/books/${encodeURIComponent(bookId)}`)).book;
    state.reviewRating = state.reviewBook.viewer.rating || 0;
    document.getElementById("review-content").value = "";
    elements.reviewList.innerHTML = '<p class="muted">正在取回評論…</p>';
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    syncReviewRealtime(bookId);
    await refreshReviews(bookId);
  } catch (error) { toast(error.message, "error"); }
}

async function refreshReviews(bookId) {
  if (!state.reviewBook || state.reviewBook.id !== bookId || !elements.reviewDialog.open) return;
  const [bookResult, reviewResult] = await Promise.all([
    window.libraryApi.get(`/books/${encodeURIComponent(bookId)}`),
    window.libraryApi.get(`/books/${encodeURIComponent(bookId)}/reviews`),
  ]);
  if (!state.reviewBook || state.reviewBook.id !== bookId || !elements.reviewDialog.open) return;
  state.reviewBook = bookResult.book;
  state.reviews = reviewResult.reviews;
  const cardBook = state.books.find((book) => book.id === bookId);
  if (cardBook) {
    Object.assign(cardBook.metrics, bookResult.book.metrics);
    Object.assign(cardBook.viewer, bookResult.book.viewer);
  }
  renderBooks();
  renderReviews();
}

function syncReviewRealtime(bookId = null) {
  if (state.reviewRealtimeBookId === bookId && state.reviewRealtimeStop) return;
  state.reviewRealtimeStop?.();
  state.reviewRealtimeStop = null;
  state.reviewRealtimeBookId = null;
  if (!bookId || !window.libraryRealtime) return;
  state.reviewRealtimeBookId = bookId;
  state.reviewRealtimeStop = window.libraryRealtime.subscribeBook(bookId, ({ events }) => {
    if (events.length && !events.some((event) => ["review", "review_like", "review_favorite"].includes(event.resource))) return;
    clearTimeout(state.reviewRefreshTimer);
    state.reviewRefreshTimer = setTimeout(() => refreshReviews(bookId).catch(() => {}), 320);
  });
}

async function submitReview(event) {
  event.preventDefault();
  if (!requireLogin() || !state.reviewBook) return;
  if (!state.reviewRating) return toast("請先選擇 1 到 5 顆星。", "error");
  const submit = document.getElementById("review-submit");
  submit.disabled = true;
  try {
    const result = await window.libraryApi.put(`/books/${encodeURIComponent(state.reviewBook.id)}/review`, {
      rating: state.reviewRating,
      content: document.getElementById("review-content").value,
    });
    Object.assign(state.reviewBook.metrics, result.metrics);
    Object.assign(state.reviewBook.viewer, result.viewer);
    const index = state.reviews.findIndex((review) => review.id === result.review.id);
    if (index >= 0) state.reviews[index] = result.review; else state.reviews.unshift(result.review);
    const cardBook = state.books.find((book) => book.id === state.reviewBook.id);
    if (cardBook && cardBook !== state.reviewBook) { Object.assign(cardBook.metrics, result.metrics); Object.assign(cardBook.viewer, result.viewer); }
    renderBooks();
    renderReviews();
    toast("評論已儲存");
  } catch (error) { toast(error.message, "error"); }
  finally { submit.disabled = false; }
}

async function toggleReviewLike(reviewId) {
  if (!requireLogin()) return;
  try {
    const result = await window.libraryApi.post(`/reviews/${encodeURIComponent(reviewId)}/like`);
    const index = state.reviews.findIndex((review) => review.id === reviewId);
    if (index >= 0) state.reviews[index] = result.review;
    renderReviews();
  } catch (error) { toast(error.message, "error"); }
}

async function toggleReviewFavorite(reviewId) {
  if (!requireLogin()) return;
  try {
    const result = await window.libraryApi.post(`/reviews/${encodeURIComponent(reviewId)}/favorite`);
    const index = state.reviews.findIndex((review) => review.id === reviewId);
    if (index >= 0) state.reviews[index] = result.review;
    renderReviews();
  } catch (error) { toast(error.message, "error"); }
}

function renderAuth(user) {
  document.getElementById("login-button").hidden = Boolean(user);
  const menu = document.getElementById("user-menu");
  menu.hidden = !user;
  if (!user) { document.getElementById("header-notification-count").hidden = true; return; }
  document.getElementById("user-name").textContent = user.publicDisplayName || user.displayName;
  document.getElementById("user-email").textContent = user.email;
  const avatar = document.getElementById("user-avatar");
  avatar.src = user.avatarUrl || avatarFor({ public_display_name: user.publicDisplayName || user.displayName });
  loadNotificationSummary();
}

function loadNotificationSummary() {
  if (!window.libraryAuth.user) return;
  window.libraryApi.get("/me/summary").then((summary) => {
    const badge = document.getElementById("header-notification-count");
    badge.hidden = !summary.unread;
    badge.textContent = summary.unread || "";
  }).catch(() => {});
}

function syncNotificationRealtime(user) {
  if (state.notificationRealtimeUserId === user?.id && state.notificationRealtimeStop) return;
  state.notificationRealtimeStop?.();
  state.notificationRealtimeStop = null;
  state.notificationRealtimeUserId = null;
  if (user && window.libraryRealtime) {
    state.notificationRealtimeUserId = user.id;
    state.notificationRealtimeStop = window.libraryRealtime.subscribeNotifications(() => loadNotificationSummary());
  }
}

function wireEvents() {
  let searchTimer;
  elements.searchForm.addEventListener("submit", (event) => { event.preventDefault(); state.filters.q = elements.search.value.trim(); loadBooks(); document.getElementById("collection").scrollIntoView(); });
  elements.search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.filters.q = elements.search.value.trim(); loadBooks(); }, 320); });
  elements.categories.addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.filters.category = button.dataset.category; loadBooks(); });
  elements.source.addEventListener("change", () => { state.filters.source = elements.source.value; loadBooks(); });
  elements.sort.addEventListener("change", () => { state.filters.sort = elements.sort.value; loadBooks(); });
  elements.favoriteFilter.addEventListener("click", () => { if (!requireLogin()) return; state.filters.favoritesOnly = !state.filters.favoritesOnly; elements.favoriteFilter.classList.toggle("active", state.filters.favoritesOnly); renderBooks(); document.getElementById("collection").scrollIntoView(); });
  elements.loadMoreButton.addEventListener("click", () => loadBooks({ append: true }));
  elements.grid.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    if (target.dataset.action === "rate") rateBook(target.dataset.bookId, Number(target.dataset.rating));
    if (target.dataset.action === "favorite") toggleFavorite(target.dataset.bookId);
    if (target.dataset.action === "reviews") openReviews(target.dataset.bookId);
  });
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  elements.reviewForm.addEventListener("submit", submitReview);
  document.getElementById("review-rating").addEventListener("click", (event) => { const button = event.target.closest("[data-review-rating]"); if (!button) return; state.reviewRating = Number(button.dataset.reviewRating); renderReviewRating(); });
  elements.reviewList.addEventListener("click", (event) => { const like = event.target.closest("[data-review-like]"); if (like) { toggleReviewLike(like.dataset.reviewLike); return; } const favorite = event.target.closest("[data-review-favorite]"); if (favorite) toggleReviewFavorite(favorite.dataset.reviewFavorite); });
  elements.reviewDialog.addEventListener("close", () => syncReviewRealtime());
  document.getElementById("login-button").addEventListener("click", () => window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")));
  document.getElementById("logout-button").addEventListener("click", () => window.libraryAuth.logout());
  document.getElementById("user-toggle").addEventListener("click", () => { const dropdown = document.getElementById("user-dropdown"); dropdown.hidden = !dropdown.hidden; });
  window.addEventListener("library-auth-changed", (event) => {
    renderAuth(event.detail.user);
    syncNotificationRealtime(event.detail.user);
    if (!state.loading && state.books.length) loadBooks();
    if (state.reviewBook && elements.reviewDialog.open) refreshReviews(state.reviewBook.id).catch(() => {});
  });
}

async function initialize() {
  wireEvents();
  renderSkeletons();
  await window.libraryAuth.ready;
  renderAuth(window.libraryAuth.user);
  syncNotificationRealtime(window.libraryAuth.user);
  await loadBooks();
  const requestedReview = new URLSearchParams(location.search).get("review");
  if (requestedReview) openReviews(requestedReview);
}

initialize();
