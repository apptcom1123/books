const feedbackState = {
  messages: [],
  roots: [],
  activeId: null,
  query: "",
  votePending: new Set(),
  voteAnimations: new Map(),
  expandedThreads: new Set(),
  deletePending: new Set(),
  cursor: null,
  hasMore: false,
  loading: false,
  realtimeStop: null,
  refreshTimer: null,
  refreshThreadIds: new Set(),
  requestId: 0,
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
  loadMoreWrap: document.getElementById("feedback-load-more-wrap"),
  loadMore: document.getElementById("feedback-load-more"),
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
  toast("請先登入，再建立、回覆或投票。", "error");
  window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error"));
  return false;
}

function threadRows(rootId) {
  return feedbackState.messages
    .filter((message) => message.parent_id === rootId)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
      || Number(b.upCount || 0) - Number(a.upCount || 0)
      || new Date(b.created_at) - new Date(a.created_at));
}

function rebuildThreads() {
  feedbackState.roots = feedbackState.messages
    .filter((message) => !message.parent_id)
    .map((root) => ({ ...root, replies: threadRows(root.id) }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function roleBadge(author = {}) {
  if (!['admin', 'moderator'].includes(author.role)) return "";
  return `<span class="role-badge">${author.role === "admin" ? "館員" : "版主"}</span>`;
}

function renderFeedback() {
  const threads = feedbackState.roots;
  feedbackElements.empty.hidden = threads.length > 0;
  feedbackElements.list.hidden = threads.length === 0;
  feedbackElements.summary.textContent = feedbackState.query
    ? `「${feedbackState.query}」目前顯示 ${threads.length} 段討論（伺服器已搜尋主旨、作者與所有回覆）`
    : `目前顯示 ${threads.length} 段公開討論${feedbackState.hasMore ? "，可繼續載入" : ""}`;
  feedbackElements.loadMoreWrap.hidden = !feedbackState.hasMore;
  feedbackElements.loadMore.disabled = feedbackState.loading;
  feedbackElements.loadMore.textContent = feedbackState.loading ? "正在載入…" : "載入更多討論";
  feedbackElements.list.innerHTML = threads.map((thread) => {
    const latest = [...thread.replies].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).at(-1);
    const preview = latest?.content || thread.latestReplyContent || thread.content;
    const replyCount = thread.repliesLoaded ? thread.replies.length : Number(thread.replyCount || 0);
    return `<button class="feedback-card" type="button" data-thread-id="${thread.id}">
      <span class="feedback-card-line"></span>
      <span class="feedback-card-main">
        <span class="feedback-card-meta"><img src="${escapeHtml(safeAvatar(thread.author))}" alt=""><strong>${escapeHtml(thread.author?.public_display_name || "讀者")}</strong>${roleBadge(thread.author)}<time>${new Date(thread.created_at).toLocaleDateString("zh-TW")}</time></span>
        <strong class="feedback-card-title">${escapeHtml(thread.subject || "讀者建議")}</strong>
        <span class="feedback-card-preview">${escapeHtml(preview)}</span>
      </span>
      <span class="feedback-card-count"><b>${replyCount}</b><small>則回覆</small><i>↗</i></span>
    </button>`;
  }).join("");
}

function messageMarkup(message, { root = false } = {}) {
  const score = Number(message.score) || 0;
  const upCount = Number(message.upCount) || 0;
  const downCount = Number(message.downCount) || 0;
  const pending = feedbackState.votePending.has(message.id);
  const deletePending = feedbackState.deletePending.has(message.id);
  return `<article class="thread-message${root ? " root" : ""}" data-feedback-message="${escapeHtml(message.id)}" data-social-key="feedback:${escapeHtml(message.id)}">
    <div class="feedback-message-layout">
      <div class="social-vote-rail" role="group" aria-label="這則${root ? "討論" : "回覆"}的評價">
        <button type="button" data-feedback-vote="up" data-feedback-id="${escapeHtml(message.id)}" class="social-vote-button ${message.viewerVote === "up" ? "active" : ""}" aria-pressed="${message.viewerVote === "up"}" aria-label="讚賞，目前 ${upCount} 票" ${pending ? "disabled" : ""}>▲</button>
        ${feedbackVoteScoreContent(message.id, score)}
        <button type="button" data-feedback-vote="down" data-feedback-id="${escapeHtml(message.id)}" class="social-vote-button down ${message.viewerVote === "down" ? "active" : ""}" aria-pressed="${message.viewerVote === "down"}" aria-label="不讚同，目前 ${downCount} 票" ${pending ? "disabled" : ""}>▼</button>
      </div>
      <div class="feedback-message-body"><header><img src="${escapeHtml(safeAvatar(message.author))}" alt=""><div><strong>${escapeHtml(message.author?.public_display_name || "讀者")}</strong><time>${new Date(message.created_at).toLocaleString("zh-TW")}</time></div>${roleBadge(message.author)}</header>
      <p>${escapeHtml(message.content)}</p></div>
    </div>
    ${message.isOwner ? `<button type="button" class="feedback-delete" data-feedback-delete="${escapeHtml(message.id)}"${deletePending ? " disabled" : ""}>${deletePending ? "刪除中…" : "刪除"}</button>` : ""}
  </article>`;
}

function queueFeedbackVoteAnimation(id, fromScore, toScore) {
  const from = Number(fromScore) || 0;
  const to = Number(toScore) || 0;
  if (from !== to) feedbackState.voteAnimations.set(id, { from, to });
}

function feedbackSignedScore(score) {
  return `${score >= 0 ? "+" : ""}${score}`;
}

function feedbackVoteScoreContent(id, score) {
  const animation = feedbackState.voteAnimations.get(id);
  feedbackState.voteAnimations.delete(id);
  const attributes = animation && animation.from !== animation.to
    ? ` data-score-from="${animation.from}" data-score-to="${animation.to}"`
    : "";
  return `<strong class="social-vote-score" aria-label="淨分 ${feedbackSignedScore(score)}"${attributes}>${feedbackSignedScore(score)}</strong>`;
}

function replaceFeedbackMessage(updated) {
  feedbackState.requestId += 1;
  feedbackState.loading = false;
  feedbackState.messages = feedbackState.messages.map((message) => message.id === updated.id ? { ...message, ...updated } : message);
}

function mergeFeedbackThreads(messages = [], { complete = true, invalidateRequest = true } = {}) {
  const roots = new Set(messages.map((message) => message.parent_id || message.id));
  if (!roots.size) return;
  if (invalidateRequest) {
    feedbackState.requestId += 1;
    feedbackState.loading = false;
  }
  const previousRoots = new Map(feedbackState.messages.filter((message) => !message.parent_id).map((message) => [message.id, message]));
  const previousMessages = new Map(feedbackState.messages.map((message) => [message.id, message]));
  for (const message of messages) {
    if ((message.parent_id || message.id) !== feedbackState.activeId || !feedbackElements.threadDialog.open) continue;
    const previous = previousMessages.get(message.id);
    if (previous) queueFeedbackVoteAnimation(message.id, previous.score, message.score);
  }
  const incomingRoots = messages.filter((message) => !message.parent_id).map((root) => {
    const replies = messages.filter((message) => message.parent_id === root.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return {
      ...previousRoots.get(root.id),
      ...root,
      ...(complete ? {
        repliesLoaded: true,
        replyCount: replies.length,
        latestReplyContent: replies.at(-1)?.content || null,
      } : {}),
    };
  });
  feedbackState.messages = feedbackState.messages
    .filter((message) => !roots.has(message.parent_id || message.id))
    .concat(incomingRoots, messages.filter((message) => message.parent_id));
}

function renderFeedbackViews() {
  rebuildThreads();
  renderFeedback();
  if (feedbackState.activeId) void openThread(feedbackState.activeId, { updateUrl: false });
}

function optimisticFeedbackVote(message, nextVote) {
  let upCount = Number(message.upCount) || 0;
  let downCount = Number(message.downCount) || 0;
  if (message.viewerVote === "up") upCount = Math.max(0, upCount - 1);
  if (message.viewerVote === "down") downCount = Math.max(0, downCount - 1);
  if (nextVote === "up") upCount += 1;
  if (nextVote === "down") downCount += 1;
  return { ...message, upCount, downCount, score: upCount - downCount, viewerVote: nextVote === "none" ? null : nextVote };
}

async function toggleFeedbackVote(feedbackId, voteType) {
  if (!requireLogin() || feedbackState.votePending.has(feedbackId)) return;
  const message = feedbackState.messages.find((item) => item.id === feedbackId);
  if (!message) return;
  const nextVote = message.viewerVote === voteType ? "none" : voteType;
  feedbackState.votePending.add(feedbackId);
  const optimistic = optimisticFeedbackVote(message, nextVote);
  queueFeedbackVoteAnimation(feedbackId, message.score, optimistic.score);
  replaceFeedbackMessage(optimistic);
  renderFeedbackViews();
  const animationStartedAt = performance.now();
  try {
    const result = await window.libraryApi.post(`/feedback/${encodeURIComponent(feedbackId)}/vote`, { voteType: nextVote });
    if (result.message) {
      const current = feedbackState.messages.find((item) => item.id === feedbackId);
      queueFeedbackVoteAnimation(feedbackId, current?.score, result.message.score);
      replaceFeedbackMessage(result.message);
    }
    window.libraryApi.invalidate("feedback");
  } catch (error) {
    const current = feedbackState.messages.find((item) => item.id === feedbackId);
    queueFeedbackVoteAnimation(feedbackId, current?.score, message.score);
    replaceFeedbackMessage(message);
    window.libraryUX?.recordRollback?.("feedback-vote", error.code);
    toast(error.message, "error");
  } finally {
    const remaining = 1000 - (performance.now() - animationStartedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    feedbackState.votePending.delete(feedbackId);
    renderFeedbackViews();
  }
}

function showThread(thread) {
  const replyCount = thread.repliesLoaded ? thread.replies.length : Number(thread.replyCount || 0);
  const scrollTop = feedbackElements.threadContent.scrollTop;
  const previousPositions = window.librarySocialMotion?.capturePositions(feedbackElements.threadContent);
  const expanded = feedbackState.expandedThreads.has(thread.id);
  const compact = window.matchMedia("(max-width: 580px)").matches && !expanded && thread.replies.length > 2;
  const visibleReplies = compact ? thread.replies.slice(0, 2) : thread.replies;
  feedbackElements.threadContent.innerHTML = `<p class="eyebrow">READER CONVERSATION</p><h2>${escapeHtml(thread.subject || "讀者建議")}</h2>${messageMarkup(thread, { root: true })}<div class="thread-divider"><span>${replyCount} 則回覆</span></div><div class="thread-replies">${visibleReplies.map((reply) => messageMarkup(reply)).join("") || '<p class="thread-no-replies">尚未有人回覆，成為第一位加入討論的讀者。</p>'}</div>${thread.replies.length > 2 && window.matchMedia("(max-width: 580px)").matches ? `<button class="thread-replies-toggle" type="button" data-feedback-replies-toggle="${thread.id}" aria-expanded="${expanded}">${expanded ? "收起回覆" : `查看全部 ${thread.replies.length} 則回覆`}</button>` : ""}`;
  feedbackElements.threadContent.scrollTop = scrollTop;
  window.librarySocialMotion?.animateScores(feedbackElements.threadContent);
  window.librarySocialMotion?.animateCardSwap(feedbackElements.threadContent, previousPositions);
  feedbackElements.replyForm.hidden = !window.libraryAuth.user;
}

function showFeedbackLiveStatus(message) {
  const node = document.getElementById("feedback-live-status");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(showFeedbackLiveStatus.timer);
  showFeedbackLiveStatus.timer = setTimeout(() => { node.hidden = true; }, 2200);
}

async function openThread(id, { updateUrl = true, force = false } = {}) {
  feedbackState.activeId = id;
  if (!feedbackElements.threadDialog.open) feedbackElements.threadDialog.showModal();
  if (updateUrl) history.replaceState(null, "", `${location.pathname}?thread=${encodeURIComponent(id)}`);
  let thread = feedbackState.roots.find((item) => item.id === id);
  if (thread?.repliesLoaded && !force) return showThread(thread);
  feedbackElements.threadContent.innerHTML = '<div class="feedback-thread-loading" role="status"><span class="loading-mark"></span><p>正在載入討論與回覆…</p></div>';
  feedbackElements.replyForm.hidden = true;
  const endpoint = `/feedback?thread=${encodeURIComponent(id)}`;
  try {
    const result = force
      ? await window.libraryApi.get(endpoint)
      : await window.libraryApi.cachedGet(endpoint, {
        key: `feedback-thread:${id}`,
        private: Boolean(window.libraryAuth.user),
        staleTime: 20_000,
        onUpdate: (updated) => {
          if (feedbackState.activeId !== id) return;
          mergeFeedbackThreads(updated.messages || [], { complete: true });
          rebuildThreads();
          renderFeedback();
          const current = feedbackState.roots.find((item) => item.id === id);
          if (current) showThread(current);
        },
      });
    if (feedbackState.activeId !== id) return;
    mergeFeedbackThreads(result.messages || [], { complete: true });
    rebuildThreads();
    renderFeedback();
    thread = feedbackState.roots.find((item) => item.id === id);
    if (!thread) throw new Error("找不到這段討論，可能已由作者刪除。");
    showThread(thread);
  } catch (error) {
    if (feedbackState.activeId !== id) return;
    feedbackElements.threadContent.innerHTML = `<div class="feedback-thread-loading error"><p>${escapeHtml(error.message)}</p><button type="button" class="button button-quiet" data-thread-retry="${escapeHtml(id)}">重新嘗試</button></div>`;
    toast(error.message, "error");
  }
}

function feedbackPageEndpoint() {
  const params = new URLSearchParams({ limit: "24" });
  if (feedbackState.query) params.set("q", feedbackState.query);
  if (feedbackState.cursor) {
    params.set("beforeCreatedAt", feedbackState.cursor.beforeCreatedAt);
    params.set("beforeId", feedbackState.cursor.beforeId);
  }
  return `/feedback?${params}`;
}

function applyFeedbackPage(result, { preserveThread = true, append = false } = {}) {
  const activeRows = preserveThread && feedbackState.activeId
    ? feedbackState.messages.filter((message) => (message.parent_id || message.id) === feedbackState.activeId)
    : [];
  if (append) {
    const existingIds = new Set(feedbackState.messages.map((message) => message.id));
    feedbackState.messages.push(...(result.messages || []).filter((message) => !existingIds.has(message.id)));
  } else {
    feedbackState.messages = result.messages || [];
    if (activeRows.length) mergeFeedbackThreads(activeRows, { complete: true, invalidateRequest: false });
  }
  feedbackState.hasMore = Boolean(result.hasMore);
  feedbackState.cursor = result.cursor || null;
  rebuildThreads();
  renderFeedback();
  if (preserveThread && feedbackState.activeId) void openThread(feedbackState.activeId, { updateUrl: false });
}

async function loadFeedback({ preserveThread = true, append = false } = {}) {
  if (append && feedbackState.loading) return;
  if (!append) feedbackState.cursor = null;
  feedbackState.loading = true;
  renderFeedback();
  const requestId = ++feedbackState.requestId;
  const endpoint = feedbackPageEndpoint();
  try {
    const result = await window.libraryApi.cachedGet(endpoint, {
      key: `feedback-page:${feedbackState.query}:${feedbackState.cursor?.beforeCreatedAt || "first"}:${feedbackState.cursor?.beforeId || ""}`,
      private: Boolean(window.libraryAuth.user),
      staleTime: 20_000,
      onUpdate: (updated) => {
        if (requestId !== feedbackState.requestId) return;
        applyFeedbackPage(updated, { preserveThread, append });
      },
    });
    if (requestId !== feedbackState.requestId) return;
    applyFeedbackPage(result, { preserveThread, append });
  } catch (error) {
    if (requestId !== feedbackState.requestId) return;
    feedbackElements.summary.textContent = "暫時無法載入讀者回饋";
    toast(error.message, "error");
  } finally {
    if (requestId === feedbackState.requestId) {
      feedbackState.loading = false;
      renderFeedback();
    }
  }
}

async function refreshFeedbackThreads(ids) {
  const threadIds = [...new Set(ids)].filter(Boolean);
  if (!threadIds.length) return;
  if (threadIds.length > 4) return loadFeedback();
  try {
    const results = await Promise.all(threadIds.map((id) => window.libraryApi.get(`/feedback?thread=${encodeURIComponent(id)}`)));
    mergeFeedbackThreads(results.flatMap((result) => result.messages || []), { complete: true });
    renderFeedbackViews();
  } catch (error) {
    if (navigator.onLine) console.warn("Feedback delta refresh failed", error);
  }
}

async function deleteFeedback(feedbackId) {
  if (!requireLogin() || feedbackState.deletePending.has(feedbackId)) return;
  const message = feedbackState.messages.find((item) => item.id === feedbackId);
  if (!message?.isOwner) return;
  if (!window.confirm(message.parent_id ? "確定刪除這則回覆？" : "確定刪除這段討論？相關回覆將不再顯示。")) return;
  feedbackState.deletePending.add(feedbackId);
  renderFeedbackViews();
  try {
    const result = await window.libraryApi.delete(`/feedback/${encodeURIComponent(feedbackId)}`);
    window.libraryApi.invalidate("feedback");
    if (!message.parent_id) {
      feedbackState.messages = feedbackState.messages.filter((item) => (item.parent_id || item.id) !== feedbackId);
      if (feedbackState.activeId === feedbackId) feedbackElements.threadDialog.close();
      rebuildThreads();
      renderFeedback();
    } else {
      feedbackState.messages = feedbackState.messages.filter((item) => item.id !== feedbackId);
      await refreshFeedbackThreads([result.deleted?.rootId || message.parent_id]);
    }
    toast("內容已刪除");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    feedbackState.deletePending.delete(feedbackId);
    renderFeedbackViews();
  }
}

function syncFeedbackRealtime() {
  if (feedbackState.realtimeStop || !window.libraryRealtime) return;
  feedbackState.realtimeStop = window.libraryRealtime.subscribeFeedback(({ events, reason }) => {
    if (reason === "overflow") {
      clearTimeout(feedbackState.refreshTimer);
      feedbackState.refreshThreadIds.clear();
      loadFeedback();
      return;
    }
    if (!events.length) {
      if (reason === "catchup-truncated") loadFeedback();
      return;
    }
    for (const event of events) {
      if (["feedback", "feedback_vote"].includes(event.resource) && event.targetId) feedbackState.refreshThreadIds.add(event.targetId);
    }
    if (feedbackState.activeId && events.some((event) => event.targetId === feedbackState.activeId) && feedbackState.votePending.size === 0) {
      showFeedbackLiveStatus("有新的討論動態，正在同步…");
    }
    clearTimeout(feedbackState.refreshTimer);
    feedbackState.refreshTimer = setTimeout(() => {
      const ids = [...feedbackState.refreshThreadIds];
      feedbackState.refreshThreadIds.clear();
      refreshFeedbackThreads(ids);
    }, feedbackState.votePending.size ? 1050 : 280);
  });
}

function renderAuth(user) {
  document.getElementById("login-button").hidden = Boolean(user);
  const createButton = document.getElementById("new-feedback-button");
  createButton.disabled = false;
  createButton.removeAttribute("aria-busy");
  createButton.textContent = user ? "＋ 提出新回饋" : "登入後提出回饋";
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
    searchTimer = setTimeout(() => {
      feedbackState.query = feedbackElements.search.value.trim();
      loadFeedback({ preserveThread: true, append: false });
    }, 320);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); feedbackElements.search.focus(); }
  });
  feedbackElements.list.addEventListener("click", (event) => {
    const card = event.target.closest("[data-thread-id]");
    if (card) void openThread(card.dataset.threadId);
  });
  feedbackElements.threadContent.addEventListener("click", (event) => {
    const toggleReplies = event.target.closest("[data-feedback-replies-toggle]");
    if (toggleReplies) {
      const id = toggleReplies.dataset.feedbackRepliesToggle;
      if (feedbackState.expandedThreads.has(id)) feedbackState.expandedThreads.delete(id);
      else feedbackState.expandedThreads.add(id);
      const thread = feedbackState.roots.find((item) => item.id === id);
      if (thread) showThread(thread);
      return;
    }
    const button = event.target.closest("[data-feedback-vote]");
    if (button) { toggleFeedbackVote(button.dataset.feedbackId, button.dataset.feedbackVote); return; }
    const remove = event.target.closest("[data-feedback-delete]");
    if (remove) { deleteFeedback(remove.dataset.feedbackDelete); return; }
    const retry = event.target.closest("[data-thread-retry]");
    if (retry) void openThread(retry.dataset.threadRetry, { updateUrl: false, force: true });
  });
  feedbackElements.loadMore.addEventListener("click", () => loadFeedback({ append: true }));
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
    window.libraryUX?.setBusy(feedbackElements.createForm, true, "正在建立討論");
    try {
      const result = await window.libraryApi.post("/feedback", { subject: document.getElementById("feedback-subject").value.trim(), content: document.getElementById("feedback-content").value.trim() });
      window.libraryApi.invalidate("feedback");
      mergeFeedbackThreads(result.messages || [], { complete: true });
      feedbackElements.createDialog.close();
      feedbackElements.createForm.reset();
      renderFeedbackViews();
      toast("新討論已建立");
    } catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; window.libraryUX?.setBusy(feedbackElements.createForm, false); }
  });
  feedbackElements.replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireLogin() || !feedbackState.activeId) return;
    const submit = document.getElementById("feedback-reply-submit");
    submit.disabled = true;
    window.libraryUX?.setBusy(feedbackElements.replyForm, true, "正在送出回覆");
    try {
      const result = await window.libraryApi.post("/feedback", { parentId: feedbackState.activeId, content: document.getElementById("feedback-reply-content").value.trim() });
      window.libraryApi.invalidate("feedback");
      feedbackElements.replyForm.reset();
      mergeFeedbackThreads(result.messages || [], { complete: true });
      renderFeedbackViews();
      toast("回覆已送出");
    } catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; window.libraryUX?.setBusy(feedbackElements.replyForm, false); }
  });
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  feedbackElements.threadDialog.addEventListener("close", () => { feedbackState.activeId = null; history.replaceState(null, "", location.pathname); });
  document.getElementById("login-button").addEventListener("click", () => window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")));
  document.getElementById("logout-button").addEventListener("click", () => window.libraryAuth.logout());
  document.getElementById("user-toggle").addEventListener("click", (event) => { const dropdown = document.getElementById("user-dropdown"); dropdown.hidden = !dropdown.hidden; event.currentTarget.setAttribute("aria-expanded", String(!dropdown.hidden)); });
  window.addEventListener("library-auth-changed", (event) => {
    renderAuth(event.detail.user);
    if (window.libraryAuth.initialized) loadFeedback({ preserveThread: true });
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(feedbackState.refreshTimer);
    feedbackState.realtimeStop?.();
    feedbackState.realtimeStop = null;
  }, { once: true });
}

async function initializeFeedback() {
  wireFeedbackEvents();
  await window.libraryAuth.ready;
  renderAuth(window.libraryAuth.user);
  await loadFeedback({ preserveThread: false });
  syncFeedbackRealtime();
  const requestedThread = new URLSearchParams(location.search).get("thread");
  if (requestedThread) await openThread(requestedThread, { updateUrl: false });
}

initializeFeedback();
