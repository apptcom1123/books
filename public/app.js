const PAGE_SIZE = 30;

const state = {
  books: [],
  filters: { q: "", category: "", source: "", sort: "popular", favoritesOnly: false },
  loading: false,
  requestId: 0,
  catalogAbort: null,
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
  catalogRealtimeStop: null,
  catalogRefreshTimer: null,
  catalogRefreshIds: new Set(),
  ratingPending: new Set(),
  favoritePending: new Set(),
  reviewMutationPending: new Set(),
  reviewPrefetched: new Set(),
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
  elements.grid.hidden = false;
  elements.empty.hidden = true;
  elements.grid.innerHTML = Array.from({ length: 10 }, () => `
    <article class="book-card book-card-skeleton" aria-hidden="true">
      <div class="skeleton skeleton-cover"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line"></div>
    </article>`).join("");
}

function bookCard(book) {
  const sourceCode = book.source === "Standard Ebooks" ? "SE" : "PG";
  const ratingPending = state.ratingPending.has(book.id);
  const favoritePending = state.favoritePending.has(book.id);
  const stars = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    const active = value <= (book.viewer.rating || 0) ? " active" : "";
    return `<button class="star${active}" type="button" data-action="rate" data-book-id="${book.id}" data-rating="${value}" aria-label="給 ${value} 顆星" aria-pressed="${value <= (book.viewer.rating || 0)}"${ratingPending ? ' disabled aria-busy="true"' : ""}>★</button>`;
  }).join("");
  const progress = book.viewer.progress?.percentage > 0
    ? `<span class="continue-badge">讀到 ${Math.round(book.viewer.progress.percentage)}%</span>`
    : "";
  return `
    <article class="book-card" data-book-id="${book.id}">
      <a class="cover-link" href="/reader.html?id=${encodeURIComponent(book.id)}" aria-label="閱讀《${escapeHtml(book.title_zh)}》">
        <span class="source-badge">${sourceCode}</span>
        <img class="book-cover" src="${encodeURI(book.cover_url)}" alt="《${escapeHtml(book.title_zh)}》封面" width="320" height="480" loading="lazy" decoding="async">
      </a>
      <button class="favorite-button${book.viewer.isFavorite ? " active" : ""}" type="button" data-action="favorite" data-book-id="${book.id}" aria-label="${book.viewer.isFavorite ? "取消收藏" : "收藏"}"${favoritePending ? ' disabled aria-busy="true"' : ""}>${book.viewer.isFavorite ? "♥" : "♡"}</button>
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

function sortLoadedBooks() {
  if (state.filters.sort === "rating") {
    state.books.sort((a, b) => Number(b.metrics.averageRating || 0) - Number(a.metrics.averageRating || 0)
      || Number(b.metrics.ratingCount || 0) - Number(a.metrics.ratingCount || 0));
  } else if (state.filters.sort === "popular") {
    state.books.sort((a, b) => Number(b.metrics.readerCount || 0) - Number(a.metrics.readerCount || 0)
      || Number(b.metrics.favoriteCount || 0) - Number(a.metrics.favoriteCount || 0)
      || Number(a.catalog_order || 0) - Number(b.catalog_order || 0));
  }
}

async function refreshCatalogBooks(ids) {
  const visibleIds = [...new Set(ids)].filter((id) => state.books.some((book) => book.id === id) && !state.ratingPending.has(id) && !state.favoritePending.has(id));
  if (!visibleIds.length) return;
  try {
    const result = await window.libraryApi.get(`/books/sync?ids=${encodeURIComponent(visibleIds.join(","))}`);
    for (const fresh of result.books || []) {
      const current = state.books.find((book) => book.id === fresh.id);
      if (current) Object.assign(current, fresh);
      if (state.reviewBook?.id === fresh.id) state.reviewBook = fresh;
    }
    sortLoadedBooks();
    renderBooks();
    if (state.reviewBook && elements.reviewDialog.open) renderReviews();
  } catch (error) {
    if (navigator.onLine) console.warn("Catalog delta refresh failed", error);
  }
}

function syncCatalogRealtime() {
  if (state.catalogRealtimeStop || !window.libraryRealtime) return;
  state.catalogRealtimeStop = window.libraryRealtime.subscribeCatalog(({ events, reason }) => {
    if (reason === "overflow") state.books.forEach((book) => state.catalogRefreshIds.add(book.id));
    if (!events.length) {
      if (reason === "catchup-truncated") state.books.forEach((book) => state.catalogRefreshIds.add(book.id));
      else return;
    }
    for (const event of events) {
      if (["book_rating", "book_favorite", "review"].includes(event.resource) && event.bookId
        && !(elements.reviewDialog.open && state.reviewBook?.id === event.bookId)) state.catalogRefreshIds.add(event.bookId);
    }
    clearTimeout(state.catalogRefreshTimer);
    state.catalogRefreshTimer = setTimeout(() => {
      const ids = [...state.catalogRefreshIds];
      state.catalogRefreshIds.clear();
      refreshCatalogBooks(ids);
    }, 280);
  });
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

async function loadBooksLegacy({ append = false } = {}) {
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

function applyCatalogResult(result, append) {
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
}

async function loadBooks({ append = false } = {}) {
  if (append && (state.loading || !state.pagination.hasMore)) return;
  if (!append) state.catalogAbort?.abort();
  const controller = new AbortController();
  state.catalogAbort = controller;
  const requestId = ++state.requestId;
  const offset = append ? state.books.length : 0;
  state.loading = true;
  window.libraryUX?.setBusy(elements.grid, true, append ? "正在載入更多館藏" : "正在更新館藏");

  if (append) renderBooks();
  else if (!state.books.length) {
    elements.loadMoreWrap.hidden = true;
    renderSkeletons();
  } else {
    elements.summary.textContent = "正在更新館藏；目前先保留上次載入的內容。";
  }

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort: state.filters.sort });
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.category) params.set("category", state.filters.category);
  if (state.filters.source) params.set("source", state.filters.source);

  try {
    let result;
    try {
      result = await window.libraryApi.cachedGet(`/books?${params}`, {
        key: `catalog:${params}`,
        private: true,
        staleTime: 30_000,
        maxAge: 5 * 60_000,
        signal: controller.signal,
        onUpdate: (fresh) => {
          if (requestId === state.requestId && !append) applyCatalogResult(fresh, false);
        },
        onError: (error) => {
          if (error.code !== "REQUEST_CANCELLED" && navigator.onLine) console.warn("Catalog background refresh failed", error);
        },
      });
    } catch (apiError) {
      if (apiError.code === "REQUEST_CANCELLED") return;
      result = await loadStaticCatalog({ limit: PAGE_SIZE, offset });
      console.warn("API unavailable; showing the read-only static catalog.", apiError);
      if (!state.apiWarningShown) {
        state.apiWarningShown = true;
        toast("互動資料庫暫時不可用；已保留可閱讀的靜態館藏。", "error");
      }
    }
    if (requestId !== state.requestId) return;
    applyCatalogResult(result, append);
  } catch (error) {
    if (requestId !== state.requestId || error.code === "REQUEST_CANCELLED") return;
    if (!state.books.length) {
      elements.grid.innerHTML = "";
      elements.empty.hidden = false;
    } else {
      elements.summary.textContent = "更新失敗；目前顯示上次成功載入的館藏。";
    }
    toast(error.message, "error");
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      state.catalogAbort = null;
      window.libraryUX?.setBusy(elements.grid, false);
      if (state.books.length) renderBooks();
    }
  }
}

async function rateBook(bookId, rating) {
  if (!requireLogin()) return;
  const book = state.books.find((item) => item.id === bookId);
  if (!book || state.ratingPending.has(bookId)) return;
  const previousRating = Number(book.viewer.rating || 0);
  const previousMetrics = { ...book.metrics };
  const nextRating = previousRating === rating ? 0 : rating;
  const previousCount = Number(book.metrics.ratingCount || 0);
  const previousTotal = Number(book.metrics.averageRating || 0) * previousCount;
  const nextCount = Math.max(0, previousCount + (previousRating ? 0 : nextRating ? 1 : 0) - (previousRating && !nextRating ? 1 : 0));
  const nextTotal = Math.max(0, previousTotal - previousRating + nextRating);

  state.ratingPending.add(bookId);
  book.viewer.rating = nextRating;
  book.metrics.ratingCount = nextCount;
  book.metrics.averageRating = nextCount ? nextTotal / nextCount : 0;
  renderBooks();
  try {
    const result = await window.libraryApi.put(`/books/${encodeURIComponent(bookId)}/rating`, { rating: nextRating });
    Object.assign(book.metrics, result.metrics);
    Object.assign(book.viewer, result.viewer);
    toast(nextRating ? `已給《${book.title_zh}》${nextRating} 顆星` : "已取消評分");
  } catch (error) {
    book.viewer.rating = previousRating;
    Object.assign(book.metrics, previousMetrics);
    window.libraryUX?.recordRollback("book-rating", error.code);
    toast(`評分未儲存：${error.message}`, "error");
  } finally {
    window.libraryApi.invalidate((key) => key.includes("catalog:") || key.includes(`/books/${bookId}`));
    state.ratingPending.delete(bookId);
    renderBooks();
  }
}

async function toggleFavorite(bookId) {
  if (!requireLogin()) return;
  const book = state.books.find((item) => item.id === bookId);
  if (!book || state.favoritePending.has(bookId)) return;
  const previousViewer = { ...book.viewer };
  const previousMetrics = { ...book.metrics };
  const nextFavorite = !book.viewer.isFavorite;
  state.favoritePending.add(bookId);
  book.viewer.isFavorite = nextFavorite;
  book.metrics.favoriteCount = Math.max(0, Number(book.metrics.favoriteCount || 0) + (nextFavorite ? 1 : -1));
  renderBooks();
  try {
    const result = await window.libraryApi.post(`/books/${encodeURIComponent(bookId)}/favorite`);
    Object.assign(book.metrics, result.metrics);
    Object.assign(book.viewer, result.viewer);
    renderBooks();
    toast(result.viewer.isFavorite ? `已收藏《${book.title_zh}》` : "已取消收藏");
  } catch (error) {
    Object.assign(book.viewer, previousViewer);
    Object.assign(book.metrics, previousMetrics);
    window.libraryUX?.recordRollback("book-favorite", error.code);
    toast(error.message, "error");
  }
  finally {
    window.libraryApi.invalidate((key) => key.includes("catalog:") || key.includes(`/books/${bookId}`));
    state.favoritePending.delete(bookId);
    renderBooks();
  }
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
    <div class="review-head"><img src="${escapeHtml(avatarFor(review.author || {}))}" alt="" width="30" height="30" loading="lazy" decoding="async"><strong>${escapeHtml(review.author?.public_display_name || "讀者")}</strong>${["admin", "moderator"].includes(review.author?.role) ? '<span class="role-badge">館員</span>' : ""}<time>${new Date(review.updated_at).toLocaleDateString("zh-TW")}</time></div>
    <p>${escapeHtml(review.content)}</p>
    <div class="review-actions"><button class="review-like${review.viewerLiked ? " active" : ""}" type="button" data-review-like="${review.id}"${state.reviewMutationPending.has(`like:${review.id}`) ? " disabled" : ""}>${review.viewerLiked ? "♥" : "♡"} ${review.likeCount} 人讚賞</button><button class="review-favorite${review.viewerFavorite ? " active" : ""}" type="button" data-review-favorite="${review.id}"${state.reviewMutationPending.has(`favorite:${review.id}`) ? " disabled" : ""}>${review.viewerFavorite ? "★ 已收藏" : "☆ 收藏評論"} ${review.favoriteCount || 0}</button></div>
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
    await refreshReviews(bookId, { preferCache: true });
  } catch (error) { toast(error.message, "error"); }
}

async function refreshReviews(bookId, { preferCache = false } = {}) {
  if (!state.reviewBook || state.reviewBook.id !== bookId || !elements.reviewDialog.open) return;
  const read = (endpoint, key, onUpdate) => preferCache
    ? window.libraryApi.cachedGet(endpoint, { key, private: true, staleTime: 20_000, maxAge: 3 * 60_000, onUpdate, onError: () => {} })
    : window.libraryApi.get(endpoint);
  const [bookResult, reviewResult] = await Promise.all([
    read(`/books/${encodeURIComponent(bookId)}`, `book:${bookId}`, (fresh) => {
      if (state.reviewBook?.id !== bookId || !elements.reviewDialog.open) return;
      state.reviewBook = fresh.book;
      renderReviews();
    }),
    read(`/books/${encodeURIComponent(bookId)}/reviews`, `book-reviews:${bookId}`, (fresh) => {
      if (state.reviewBook?.id !== bookId || !elements.reviewDialog.open) return;
      state.reviews = fresh.reviews;
      renderReviews();
    }),
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

function prefetchReviews(bookId) {
  if (!bookId || state.reviewPrefetched.has(bookId)) return;
  state.reviewPrefetched.add(bookId);
  void Promise.all([
    window.libraryApi.prefetch(`/books/${encodeURIComponent(bookId)}`, { key: `book:${bookId}`, private: true, staleTime: 20_000 }),
    window.libraryApi.prefetch(`/books/${encodeURIComponent(bookId)}/reviews`, { key: `book-reviews:${bookId}`, private: true, staleTime: 20_000 }),
  ]);
}

function syncReviewRealtime(bookId = null) {
  if (state.reviewRealtimeBookId === bookId && state.reviewRealtimeStop) return;
  state.reviewRealtimeStop?.();
  state.reviewRealtimeStop = null;
  state.reviewRealtimeBookId = null;
  if (!bookId || !window.libraryRealtime) return;
  state.reviewRealtimeBookId = bookId;
  state.reviewRealtimeStop = window.libraryRealtime.subscribeBook(bookId, ({ events }) => {
    if (events.length && !events.some((event) => ["book_rating", "review", "review_like", "review_favorite"].includes(event.resource))) return;
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
  const pendingKey = `like:${reviewId}`;
  if (state.reviewMutationPending.has(pendingKey)) return;
  const review = state.reviews.find((item) => item.id === reviewId);
  if (!review) return;
  const previous = { ...review };
  state.reviewMutationPending.add(pendingKey);
  review.viewerLiked = !review.viewerLiked;
  review.likeCount = Math.max(0, Number(review.likeCount || 0) + (review.viewerLiked ? 1 : -1));
  renderReviews();
  try {
    const result = await window.libraryApi.post(`/reviews/${encodeURIComponent(reviewId)}/like`);
    const index = state.reviews.findIndex((review) => review.id === reviewId);
    if (index >= 0) state.reviews[index] = result.review;
    renderReviews();
  } catch (error) {
    Object.assign(review, previous);
    window.libraryUX?.recordRollback("review-like", error.code);
    toast(error.message, "error");
  }
  finally {
    window.libraryApi.invalidate((key) => key.includes(`/books/${state.reviewBook?.id}/reviews`));
    state.reviewMutationPending.delete(pendingKey);
    renderReviews();
  }
}

async function toggleReviewFavorite(reviewId) {
  if (!requireLogin()) return;
  const pendingKey = `favorite:${reviewId}`;
  if (state.reviewMutationPending.has(pendingKey)) return;
  const review = state.reviews.find((item) => item.id === reviewId);
  if (!review) return;
  const previous = { ...review };
  state.reviewMutationPending.add(pendingKey);
  review.viewerFavorite = !review.viewerFavorite;
  review.favoriteCount = Math.max(0, Number(review.favoriteCount || 0) + (review.viewerFavorite ? 1 : -1));
  renderReviews();
  try {
    const result = await window.libraryApi.post(`/reviews/${encodeURIComponent(reviewId)}/favorite`);
    const index = state.reviews.findIndex((review) => review.id === reviewId);
    if (index >= 0) state.reviews[index] = result.review;
    renderReviews();
  } catch (error) {
    Object.assign(review, previous);
    window.libraryUX?.recordRollback("review-favorite", error.code);
    toast(error.message, "error");
  }
  finally {
    window.libraryApi.invalidate((key) => key.includes(`/books/${state.reviewBook?.id}/reviews`));
    state.reviewMutationPending.delete(pendingKey);
    renderReviews();
  }
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
  const prefetchFromIntent = (event) => {
    const target = event.target.closest('[data-action="reviews"]');
    if (target) prefetchReviews(target.dataset.bookId);
  };
  elements.grid.addEventListener("pointerover", prefetchFromIntent, { passive: true });
  elements.grid.addEventListener("focusin", prefetchFromIntent);
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
  syncCatalogRealtime();
  const requestedReview = new URLSearchParams(location.search).get("review");
  if (requestedReview) openReviews(requestedReview);
}

initialize();
