const feedbackState = {
  messages: [],
  roots: [],
  activeId: null,
  query: "",
};

const feedbackElements = {
  list: document.getElementById("feedback-list"),
  empty: document.getElementById("feedback-empty"),
  summary: document.getElementById("feedback-result-summary"),
  search: document.getElementById("feedback-search"),
  threadDialog: document.getElementById("feedback-thread-dialog"),
  threadContent: document.getElementById("feedback-thread-content"),
  replyForm: document.getElementById("feedback-reply-form"),
  createDialog: document.getElementById("feedback-create-dialog"),
  createForm: document.getElementById("feedback-create-form"),
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function safeAvatar(user = {}) {
  if (user.avatar_url) {
    try { const url = new URL(user.avatar_url); if (["https:", "http:"].includes(url.protocol)) return url.href; } catch {}
  }
  const initial = (user.public_display_name || "讀").slice(0, 1);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#dbe2d8"/><text x="32" y="41" text-anchor="middle" font-size="27" fill="#233d32">${escapeHtml(initial)}</text></svg>`)}`;
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
  toast("請先登入，再建立或回覆討論。", "error");
  window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error"));
  return false;
}

function threadRows(rootId) {
  return feedbackState.messages
    .filter((message) => message.parent_id === rootId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function rebuildThreads() {
  feedbackState.roots = feedbackState.messages
    .filter((message) => !message.parent_id)
    .map((root) => ({ ...root, replies: threadRows(root.id) }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function searchableText(thread) {
  return [thread.subject, thread.content, thread.author?.public_display_name, ...thread.replies.flatMap((reply) => [reply.content, reply.author?.public_display_name])]
    .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("zh-Hant");
}

function filteredThreads() {
  const terms = feedbackState.query.normalize("NFKC").toLocaleLowerCase("zh-Hant").split(/\s+/).filter(Boolean);
  if (!terms.length) return feedbackState.roots;
  return feedbackState.roots.filter((thread) => {
    const haystack = searchableText(thread);
    return terms.every((term) => haystack.includes(term));
  });
}

function roleBadge(author = {}) {
  if (!['admin', 'moderator'].includes(author.role)) return "";
  return `<span class="role-badge">${author.role === "admin" ? "館員" : "版主"}</span>`;
}

function renderFeedback() {
  const threads = filteredThreads();
  feedbackElements.empty.hidden = threads.length > 0;
  feedbackElements.list.hidden = threads.length === 0;
  feedbackElements.summary.textContent = feedbackState.query
    ? `「${feedbackState.query}」找到 ${threads.length} 段討論（已搜尋所有回覆）`
    : `共 ${threads.length} 段公開討論`;
  feedbackElements.list.innerHTML = threads.map((thread) => {
    const latest = thread.replies.at(-1);
    const preview = latest ? latest.content : thread.content;
    return `<button class="feedback-card" type="button" data-thread-id="${thread.id}">
      <span class="feedback-card-line"></span>
      <span class="feedback-card-main">
        <span class="feedback-card-meta"><img src="${escapeHtml(safeAvatar(thread.author))}" alt=""><strong>${escapeHtml(thread.author?.public_display_name || "讀者")}</strong>${roleBadge(thread.author)}<time>${new Date(thread.created_at).toLocaleDateString("zh-TW")}</time></span>
        <strong class="feedback-card-title">${escapeHtml(thread.subject || "讀者建議")}</strong>
        <span class="feedback-card-preview">${escapeHtml(preview)}</span>
      </span>
      <span class="feedback-card-count"><b>${thread.replies.length}</b><small>則回覆</small><i>↗</i></span>
    </button>`;
  }).join("");
}

function messageMarkup(message, { root = false } = {}) {
  return `<article class="thread-message${root ? " root" : ""}">
    <header><img src="${escapeHtml(safeAvatar(message.author))}" alt=""><div><strong>${escapeHtml(message.author?.public_display_name || "讀者")}</strong><time>${new Date(message.created_at).toLocaleString("zh-TW")}</time></div>${roleBadge(message.author)}</header>
    <p>${escapeHtml(message.content)}</p>
  </article>`;
}

function openThread(id, { updateUrl = true } = {}) {
  const thread = feedbackState.roots.find((item) => item.id === id);
  if (!thread) return;
  feedbackState.activeId = id;
  feedbackElements.threadContent.innerHTML = `<p class="eyebrow">READER CONVERSATION</p><h2>${escapeHtml(thread.subject || "讀者建議")}</h2>${messageMarkup(thread, { root: true })}<div class="thread-divider"><span>${thread.replies.length} 則回覆</span></div><div class="thread-replies">${thread.replies.map((reply) => messageMarkup(reply)).join("") || '<p class="thread-no-replies">尚未有人回覆，成為第一位加入討論的讀者。</p>'}</div>`;
  feedbackElements.replyForm.hidden = !window.libraryAuth.user;
  if (!feedbackElements.threadDialog.open) feedbackElements.threadDialog.showModal();
  if (updateUrl) history.replaceState(null, "", `${location.pathname}?thread=${encodeURIComponent(id)}`);
}

async function loadFeedback({ preserveThread = true } = {}) {
  try {
    const result = await window.libraryApi.get("/feedback");
    feedbackState.messages = result.messages || [];
    rebuildThreads();
    renderFeedback();
    if (preserveThread && feedbackState.activeId) openThread(feedbackState.activeId, { updateUrl: false });
  } catch (error) {
    feedbackElements.summary.textContent = "暫時無法載入讀者回饋";
    toast(error.message, "error");
  }
}

function renderAuth(user) {
  document.getElementById("login-button").hidden = Boolean(user);
  const menu = document.getElementById("user-menu");
  menu.hidden = !user;
  if (user) {
    document.getElementById("user-name").textContent = user.publicDisplayName || user.displayName;
    document.getElementById("user-email").textContent = user.email;
    document.getElementById("user-avatar").src = user.avatarUrl || safeAvatar({ public_display_name: user.publicDisplayName || user.displayName });
  }
  if (feedbackElements.threadDialog.open) feedbackElements.replyForm.hidden = !user;
}

function wireFeedbackEvents() {
  let searchTimer;
  feedbackElements.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { feedbackState.query = feedbackElements.search.value.trim(); renderFeedback(); }, 120);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); feedbackElements.search.focus(); }
  });
  feedbackElements.list.addEventListener("click", (event) => {
    const card = event.target.closest("[data-thread-id]");
    if (card) openThread(card.dataset.threadId);
  });
  document.getElementById("new-feedback-button").addEventListener("click", () => {
    if (!requireLogin()) return;
    feedbackElements.createForm.reset();
    feedbackElements.createDialog.showModal();
  });
  feedbackElements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    const submit = document.getElementById("feedback-create-submit");
    submit.disabled = true;
    try {
      await window.libraryApi.post("/feedback", { subject: document.getElementById("feedback-subject").value, content: document.getElementById("feedback-content").value });
      feedbackElements.createDialog.close();
      await loadFeedback({ preserveThread: false });
      toast("新討論已建立");
    } catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; }
  });
  feedbackElements.replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireLogin() || !feedbackState.activeId) return;
    const submit = document.getElementById("feedback-reply-submit");
    submit.disabled = true;
    try {
      await window.libraryApi.post("/feedback", { parentId: feedbackState.activeId, content: document.getElementById("feedback-reply-content").value });
      feedbackElements.replyForm.reset();
      await loadFeedback();
      toast("回覆已送出");
    } catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; }
  });
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  feedbackElements.threadDialog.addEventListener("close", () => { feedbackState.activeId = null; history.replaceState(null, "", location.pathname); });
  document.getElementById("login-button").addEventListener("click", () => window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")));
  document.getElementById("logout-button").addEventListener("click", () => window.libraryAuth.logout());
  document.getElementById("user-toggle").addEventListener("click", () => { const dropdown = document.getElementById("user-dropdown"); dropdown.hidden = !dropdown.hidden; });
  window.addEventListener("library-auth-changed", (event) => { renderAuth(event.detail.user); loadFeedback(); });
}

async function initializeFeedback() {
  wireFeedbackEvents();
  await window.libraryAuth.ready;
  renderAuth(window.libraryAuth.user);
  await loadFeedback({ preserveThread: false });
  const requestedThread = new URLSearchParams(location.search).get("thread");
  if (requestedThread) openThread(requestedThread, { updateUrl: false });
}

initializeFeedback();
