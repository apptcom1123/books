const state = {
  books: [],
  filters: { q: "", category: "", source: "", sort: "popular", favoritesOnly: false },
  loading: false,
  feedback: [],
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
  feedbackList: document.getElementById("feedback-list"),
  feedbackDialog: document.getElementById("feedback-dialog"),
  feedbackForm: document.getElementById("feedback-form"),
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
        <div class="book-stats">
          <div class="rating" aria-label="我的評分">${stars}</div>
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
  elements.summary.textContent = `${label}顯示 ${visible.length} 本作品`;
  elements.activeFilter.hidden = !(state.filters.q || state.filters.favoritesOnly);
  elements.activeFilter.textContent = state.filters.favoritesOnly
    ? "目前只顯示你的收藏"
    : state.filters.q ? `搜尋：「${state.filters.q}」` : "";
}

function renderCategories(categories) {
  const all = ["", ...categories];
  elements.categories.innerHTML = all.map((category) => `<button class="category-chip${state.filters.category === category ? " active" : ""}" type="button" data-category="${escapeHtml(category)}">${category || "全部"}</button>`).join("");
}

async function loadStaticCatalog() {
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
  }).map((book) => ({ ...book, metrics: { readerCount: 0, ratingCount: 0, averageRating: 0, favoriteCount: 0, annotationCount: 0 }, viewer: { rating: 0, isFavorite: false, progress: JSON.parse(localStorage.getItem(`mystery-library:progress:${book.id}`) || "null") } }));
  if (state.filters.sort === "title") books.sort((a, b) => a.title_zh.localeCompare(b.title_zh, "zh-Hant"));
  else if (state.filters.sort === "newest") books.sort((a, b) => String(b.edition_release_date).localeCompare(String(a.edition_release_date)));
  return { books, pagination: { total: books.length }, filters: { categories: ["Literature", "Science & Technology", "History", "Social Sciences & Society", "Arts & Culture", "Religion & Philosophy", "Lifestyle & Hobbies", "Health & Medicine"] } };
}

async function loadBooks() {
  state.loading = true;
  renderSkeletons();
  const params = new URLSearchParams({ limit: "200", sort: state.filters.sort });
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.category) params.set("category", state.filters.category);
  if (state.filters.source) params.set("source", state.filters.source);
  try {
    let result;
    try {
      result = await window.libraryApi.get(`/books?${params}`);
    } catch (apiError) {
      result = await loadStaticCatalog();
      console.warn("API unavailable; showing the read-only static catalog.", apiError);
    }
    state.books = result.books;
    document.getElementById("catalog-total").textContent = result.pagination.total;
    renderCategories(result.filters.categories);
    renderBooks();
  } catch (error) {
    elements.grid.innerHTML = "";
    elements.empty.hidden = false;
    toast(error.message, "error");
  } finally {
    state.loading = false;
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

function renderFeedback() {
  const roots = state.feedback.filter((message) => !message.parent_id);
  const replies = new Map(roots.map((root) => [root.id, []]));
  for (const message of state.feedback) if (message.parent_id && replies.has(message.parent_id)) replies.get(message.parent_id).push(message);
  if (!roots.length) {
    elements.feedbackList.innerHTML = '<p class="muted">還沒有留言，成為第一位提出建議的讀者。</p>';
    return;
  }
  elements.feedbackList.innerHTML = roots.map((message) => {
    const author = message.author || {};
    const children = (replies.get(message.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return `<article class="feedback-thread">
      <div class="feedback-head">
        <img class="feedback-avatar" src="${escapeHtml(avatarFor(author))}" alt="">
        <div class="feedback-author"><strong>${escapeHtml(author.public_display_name || "讀者")}</strong><time>${new Date(message.created_at).toLocaleString("zh-TW")}</time></div>
        ${["admin", "moderator"].includes(author.role) ? `<span class="role-badge">${author.role === "admin" ? "館員" : "版主"}</span>` : ""}
      </div>
      <h3>${escapeHtml(message.subject || "讀者建議")}</h3>
      <p>${escapeHtml(message.content)}</p>
      <button class="reply-action" type="button" data-feedback-reply="${message.id}" data-feedback-subject="${escapeHtml(message.subject || "讀者建議")}">回覆這則留言</button>
      <div class="feedback-replies">${children.map((reply) => `<div class="feedback-reply"><div class="feedback-head"><img class="feedback-avatar" src="${escapeHtml(avatarFor(reply.author || {}))}" alt=""><div class="feedback-author"><strong>${escapeHtml(reply.author?.public_display_name || "讀者")}</strong><time>${new Date(reply.created_at).toLocaleString("zh-TW")}</time></div>${["admin", "moderator"].includes(reply.author?.role) ? '<span class="role-badge">館員回覆</span>' : ""}</div><p>${escapeHtml(reply.content)}</p></div>`).join("")}</div>
    </article>`;
  }).join("");
}

async function loadFeedback() {
  try {
    const result = await window.libraryApi.get("/feedback");
    state.feedback = result.messages;
    renderFeedback();
  } catch (error) {
    elements.feedbackList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

function openFeedback(parentId = "", subject = "") {
  if (!requireLogin()) return;
  document.getElementById("feedback-parent").value = parentId;
  document.getElementById("feedback-dialog-title").textContent = parentId ? `回覆：${subject}` : "提出建議";
  document.getElementById("feedback-subject-wrap").hidden = Boolean(parentId);
  document.getElementById("feedback-subject").value = "";
  document.getElementById("feedback-content").value = "";
  elements.feedbackDialog.showModal();
}

function renderAuth(user) {
  document.getElementById("login-button").hidden = Boolean(user);
  const menu = document.getElementById("user-menu");
  menu.hidden = !user;
  if (!user) return;
  document.getElementById("user-name").textContent = user.publicDisplayName || user.displayName;
  document.getElementById("user-email").textContent = user.email;
  const avatar = document.getElementById("user-avatar");
  avatar.src = user.avatarUrl || avatarFor({ public_display_name: user.publicDisplayName || user.displayName });
}

function wireEvents() {
  let searchTimer;
  elements.searchForm.addEventListener("submit", (event) => { event.preventDefault(); state.filters.q = elements.search.value.trim(); loadBooks(); document.getElementById("collection").scrollIntoView(); });
  elements.search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.filters.q = elements.search.value.trim(); loadBooks(); }, 320); });
  elements.categories.addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.filters.category = button.dataset.category; loadBooks(); });
  elements.source.addEventListener("change", () => { state.filters.source = elements.source.value; loadBooks(); });
  elements.sort.addEventListener("change", () => { state.filters.sort = elements.sort.value; loadBooks(); });
  elements.favoriteFilter.addEventListener("click", () => { if (!requireLogin()) return; state.filters.favoritesOnly = !state.filters.favoritesOnly; elements.favoriteFilter.classList.toggle("active", state.filters.favoritesOnly); renderBooks(); document.getElementById("collection").scrollIntoView(); });
  elements.grid.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    event.preventDefault();
    if (target.dataset.action === "rate") rateBook(target.dataset.bookId, Number(target.dataset.rating));
    if (target.dataset.action === "favorite") toggleFavorite(target.dataset.bookId);
  });
  document.getElementById("new-feedback-button").addEventListener("click", () => openFeedback());
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  elements.feedbackList.addEventListener("click", (event) => { const target = event.target.closest("[data-feedback-reply]"); if (target) openFeedback(target.dataset.feedbackReply, target.dataset.feedbackSubject); });
  elements.feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("feedback-submit");
    submit.disabled = true;
    try {
      const result = await window.libraryApi.post("/feedback", {
        parentId: document.getElementById("feedback-parent").value || null,
        subject: document.getElementById("feedback-subject").value,
        content: document.getElementById("feedback-content").value,
      });
      state.feedback = result.messages;
      renderFeedback();
      elements.feedbackDialog.close();
      toast("留言已送出");
    } catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; }
  });
  document.getElementById("login-button").addEventListener("click", () => window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")));
  document.getElementById("logout-button").addEventListener("click", () => window.libraryAuth.logout());
  document.getElementById("user-toggle").addEventListener("click", () => { const dropdown = document.getElementById("user-dropdown"); dropdown.hidden = !dropdown.hidden; });
  window.addEventListener("library-auth-changed", (event) => { renderAuth(event.detail.user); if (!state.loading && state.books.length) loadBooks(); loadFeedback(); });
}

async function initialize() {
  wireEvents();
  renderSkeletons();
  await window.libraryAuth.ready;
  renderAuth(window.libraryAuth.user);
  await Promise.all([loadBooks(), loadFeedback()]);
}

initialize();
