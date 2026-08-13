const accountState = { data: null, loading: false, loadingRequestId: 0, authRequestId: 0, thresholdSaveTimer: null, notificationRealtimeStop: null, notificationRealtimeUserId: null, notificationRefreshTimer: null };
const NOTIFICATION_SETTING_IDS = ["notify-annotation-replies", "notify-annotation-likes", "notify-annotation-favorites", "notify-review-likes", "notify-feedback-replies"];

const $ = (id) => document.getElementById(id);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("toast-region").append(node);
  setTimeout(() => node.remove(), 3600);
}

function avatarFor(user) {
  if (user?.avatarUrl) return user.avatarUrl;
  const initial = escapeHtml((user?.publicDisplayName || user?.displayName || "讀")[0]);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbe2d8"/><text x="40" y="51" text-anchor="middle" font-size="34" fill="#233d32">${initial}</text></svg>`)}`;
}

function empty(message) {
  return `<div class="empty-account">${escapeHtml(message)}</div>`;
}

function bookTile(entry, mode = "favorite") {
  const book = entry.book;
  const progress = Number(entry.percentage ?? book.viewer?.progress?.percentage ?? 0);
  return `<article class="account-book">
    <a href="/reader.html?id=${encodeURIComponent(book.id)}"><img src="${encodeURI(book.cover_url)}" alt="《${escapeHtml(book.title_zh)}》封面" loading="lazy"></a>
    <div><h3><a href="/reader.html?id=${encodeURIComponent(book.id)}">${escapeHtml(book.title_zh)}</a></h3><p>${escapeHtml(book.author)}</p>
      ${mode === "reading" ? `<p>讀到 ${Math.round(progress)}%</p><div class="progress-track"><i style="width:${Math.max(0, Math.min(100, progress))}%"></i></div>` : `<p>★ ${Number(book.metrics?.averageRating || 0).toFixed(1)} ・ ${book.metrics?.readerCount || 0} 人閱讀</p>`}
      <div class="account-book-actions"><a class="mini-action" href="/reader.html?id=${encodeURIComponent(book.id)}">${progress > 0 ? "繼續閱讀" : "開始閱讀"}</a>${mode === "favorite" ? `<button class="mini-action danger" type="button" data-remove-favorite="${book.id}">取消收藏</button>` : ""}</div>
    </div>
  </article>`;
}

function reviewCard(review, compact = false, saved = false) {
  return `<article class="activity-card">
    <div class="activity-card-head"><div><h4><a href="/?review=${encodeURIComponent(review.book_id)}#collection">${escapeHtml(review.book.title_zh)}</a></h4><span class="activity-meta">${review.likeCount} 人讚賞</span></div><time class="activity-meta">${new Date(review.updated_at).toLocaleDateString("zh-TW")}</time></div>
    <p>${escapeHtml(compact ? review.content.slice(0, 150) : review.content)}${compact && review.content.length > 150 ? "…" : ""}</p>
    ${compact ? "" : `<div class="activity-actions">${saved ? `<a class="mini-action" href="/?review=${encodeURIComponent(review.book_id)}#collection">查看評論</a><button class="mini-action danger" type="button" data-unsave-review="${review.id}">移出收藏</button>` : `<button class="mini-action" type="button" data-edit-review="${review.id}">編輯</button><button class="mini-action danger" type="button" data-delete-review="${review.id}">刪除</button>`}</div>`}
  </article>`;
}

function annotationCard(annotation, { saved = false } = {}) {
  return `<article class="activity-card">
    <div class="activity-card-head"><div><h4><a href="/reader.html?id=${encodeURIComponent(annotation.book_id)}&note=${encodeURIComponent(annotation.id)}">${escapeHtml(annotation.book.title_zh)}</a></h4><span class="activity-meta">${annotation.visibility === "private" ? "私人標注" : `公開標注 ・ ${annotation.score >= 0 ? "+" : ""}${annotation.score} 分 ・ ${annotation.favoriteCount} 次收藏`}</span></div><time class="activity-meta">${new Date(annotation.updated_at).toLocaleDateString("zh-TW")}</time></div>
    ${annotation.quote ? `<blockquote>${escapeHtml(annotation.quote)}</blockquote>` : ""}<p>${escapeHtml(annotation.content)}</p>
    <div class="activity-actions"><a class="mini-action" href="/reader.html?id=${encodeURIComponent(annotation.book_id)}&note=${encodeURIComponent(annotation.id)}">回到原文</a>${saved ? `<button class="mini-action danger" type="button" data-unsave-annotation="${annotation.id}">移出收藏</button>` : `<button class="mini-action" type="button" data-edit-annotation="${annotation.id}">編輯</button><button class="mini-action danger" type="button" data-delete-annotation="${annotation.id}">刪除</button>`}</div>
  </article>`;
}

function replyCard(reply) {
  return `<article class="activity-card"><div class="activity-card-head"><h4><a href="/reader.html?id=${encodeURIComponent(reply.book.id)}&note=${encodeURIComponent(reply.annotation_id)}">回覆《${escapeHtml(reply.book.title_zh)}》的標注</a></h4><time class="activity-meta">${new Date(reply.updated_at).toLocaleDateString("zh-TW")}</time></div><p>${escapeHtml(reply.content)}</p><div class="activity-actions"><a class="mini-action" href="/reader.html?id=${encodeURIComponent(reply.book.id)}&note=${encodeURIComponent(reply.annotation_id)}">查看討論</a><button class="mini-action danger" type="button" data-delete-reply="${reply.id}">刪除</button></div></article>`;
}

function notificationLink(notification) {
  if (notification.target_type === "annotation" && notification.book_id) return `/reader.html?id=${encodeURIComponent(notification.book_id)}&note=${encodeURIComponent(notification.target_id)}`;
  if (notification.target_type === "review" && notification.book_id) return `/?review=${encodeURIComponent(notification.book_id)}#collection`;
  if (notification.target_type === "feedback") return `/feedback.html?thread=${encodeURIComponent(notification.target_id || "")}`;
  return "/account.html#notifications";
}

function notificationCard(notification) {
  return `<article class="notification-card${notification.read_at ? "" : " unread"}">
    <button class="notification-open" type="button" data-notification-open="${notification.id}" data-notification-link="${escapeHtml(notificationLink(notification))}"><span>${escapeHtml(notification.message)}</span><time>${new Date(notification.created_at).toLocaleString("zh-TW")}</time></button>
    <button class="notification-delete" type="button" data-notification-delete="${notification.id}" aria-label="刪除這則通知">刪除</button>
  </article>`;
}

function renderNotifications() {
  const notifications = (accountState.data?.notifications || []).slice(0, 30);
  $("overview-notifications").innerHTML = notifications.length ? notifications.slice(0, 4).map(notificationCard).join("") : empty("目前沒有通知。");
  $("notification-list").innerHTML = notifications.length ? notifications.map(notificationCard).join("") : empty("目前沒有通知。");
  const unread = notifications.filter((notification) => !notification.read_at).length;
  $("notification-tab-count").hidden = unread === 0;
  $("notification-tab-count").textContent = unread;
  $("mark-all-read").disabled = unread === 0;
}

function renderAccount() {
  const data = accountState.data;
  if (!data) return;
  $("account-name").textContent = data.user.publicDisplayName || data.user.displayName;
  $("account-email").textContent = data.user.email;
  $("account-avatar").src = avatarFor(data.user);
  $("account-stats").innerHTML = [
    [data.stats.favorites, "收藏圖書"], [data.stats.reading, "閱讀紀錄"], [data.stats.reviews, "公開書評"], [data.stats.annotations, "個人標注"],
  ].map(([value, label]) => `<div class="account-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const recentReading = data.reading.slice(0, 4);
  $("overview-reading").innerHTML = recentReading.length ? recentReading.map((entry) => bookTile(entry, "reading")).join("") : empty("還沒有閱讀進度，從書架挑一本開始吧。");
  $("overview-reviews").innerHTML = data.reviews.length ? data.reviews.slice(0, 3).map((review) => reviewCard(review, true)).join("") : empty("還沒有發表書評。");
  renderNotifications();
  $("favorite-books").innerHTML = data.favorites.length ? data.favorites.map((entry) => bookTile(entry, "favorite")).join("") : empty("還沒有收藏圖書。");
  $("reading-books").innerHTML = data.reading.length ? data.reading.map((entry) => bookTile(entry, "reading")).join("") : empty("還沒有同步閱讀進度。");
  $("rating-list").innerHTML = data.ratings.length ? data.ratings.map((entry) => `<article class="activity-card"><div class="activity-card-head"><h4><a href="/reader.html?id=${encodeURIComponent(entry.book.id)}">${escapeHtml(entry.book.title_zh)}</a></h4><strong aria-label="${entry.rating} 顆星">${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}</strong></div></article>`).join("") : empty("還沒有評分紀錄。");
  $("my-reviews").innerHTML = data.reviews.length ? data.reviews.map((review) => reviewCard(review)).join("") : empty("還沒有發表書評。");
  $("saved-reviews").innerHTML = data.savedReviews?.length ? data.savedReviews.map((review) => reviewCard(review, false, true)).join("") : empty("還沒有收藏其他讀者的評論。");
  $("my-annotations").innerHTML = data.annotations.length ? data.annotations.map((annotation) => annotationCard(annotation)).join("") : empty("還沒有建立標注。");
  $("my-replies").innerHTML = data.replies.length ? data.replies.map(replyCard).join("") : empty("還沒有回覆其他標注。");
  $("saved-annotations").innerHTML = data.savedAnnotations.length ? data.savedAnnotations.map((annotation) => annotationCard(annotation, { saved: true })).join("") : empty("還沒有收藏其他讀者的公開標注。");
  $("public-display-name").value = data.user.publicDisplayName || data.user.displayName || "";
  $("profile-email").value = data.user.email;
  for (const [id, key] of [
    ["notify-annotation-replies", "notifyAnnotationReplies"], ["notify-annotation-likes", "notifyAnnotationLikes"],
    ["notify-annotation-favorites", "notifyAnnotationFavorites"], ["notify-review-likes", "notifyReviewLikes"],
    ["notify-feedback-replies", "notifyFeedbackReplies"],
  ]) $(id).checked = Boolean(data.settings[key]);
  const allNotifications = $("notify-all-interactions");
  const enabledCount = NOTIFICATION_SETTING_IDS.filter((id) => $(id).checked).length;
  allNotifications.checked = enabledCount === NOTIFICATION_SETTING_IDS.length;
  allNotifications.indeterminate = enabledCount > 0 && enabledCount < NOTIFICATION_SETTING_IDS.length;
  $("account-annotation-threshold").value = String(data.settings.annotationVisibilityThreshold ?? 50);
  $("account-threshold-output").value = `${data.settings.annotationVisibilityThreshold ?? 50}%`;
}

async function loadAccount(requestId = accountState.authRequestId) {
  if ((accountState.loading && accountState.loadingRequestId === requestId) || !window.libraryAuth.user) return Boolean(accountState.data);
  accountState.loading = true;
  accountState.loadingRequestId = requestId;
  try {
    const data = await window.libraryApi.get("/me");
    if (requestId !== accountState.authRequestId || !window.libraryAuth.user) return false;
    accountState.data = data;
    renderAccount();
    return true;
  } catch (error) {
    toast(error.message, "error");
    return false;
  } finally {
    if (accountState.loadingRequestId === requestId) accountState.loading = false;
  }
}

async function refreshNotifications() {
  if (!accountState.data || !window.libraryAuth.user) return;
  try {
    const result = await window.libraryApi.get("/me/notifications");
    accountState.data.notifications = result.notifications;
    renderNotifications();
  } catch (error) {
    if (navigator.onLine) console.warn("Notification refresh failed", error);
  }
}

function syncNotificationRealtime(user) {
  if (accountState.notificationRealtimeUserId === user?.id && accountState.notificationRealtimeStop) return;
  accountState.notificationRealtimeStop?.();
  accountState.notificationRealtimeStop = null;
  accountState.notificationRealtimeUserId = null;
  if (!user || !window.libraryRealtime) return;
  accountState.notificationRealtimeUserId = user.id;
  accountState.notificationRealtimeStop = window.libraryRealtime.subscribeNotifications(() => {
    clearTimeout(accountState.notificationRefreshTimer);
    accountState.notificationRefreshTimer = setTimeout(refreshNotifications, 260);
  });
}

function renderRealtimeHealth(detail = window.libraryRealtime?.diagnostics?.()) {
  const node = $("realtime-health");
  if (!node || !detail) return;
  const labels = {
    healthy: "即時連線正常",
    connecting: "正在重新連線",
    fallback: "已切換 HTTP 補漏模式",
    offline: "目前離線，保留畫面快取",
    paused: "背景模式已暫停非必要連線",
    idle: "即時連線待命中",
  };
  node.dataset.state = detail.state;
  const latency = Number.isFinite(detail.heartbeatLatencyMs) ? `・${detail.heartbeatLatencyMs} ms` : "";
  node.querySelector("span").textContent = `${labels[detail.state] || "即時連線狀態未知"}${latency}`;
}

function showTab(tab) {
  const valid = ["overview", "favorites", "activity", "notifications", "settings"];
  const selected = valid.includes(tab) ? tab : "overview";
  document.querySelectorAll("[data-account-tab]").forEach((button) => button.classList.toggle("active", button.dataset.accountTab === selected));
  document.querySelectorAll("[data-account-panel]").forEach((panel) => { panel.hidden = panel.dataset.accountPanel !== selected; });
  history.replaceState(null, "", `#${selected}`);
}

function openActivityDialog(kind, item) {
  $("activity-kind").value = kind;
  $("activity-id").value = item.id;
  $("activity-book-id").value = item.book_id;
  $("activity-content-input").value = item.content;
  $("activity-dialog-title").textContent = kind === "review" ? `編輯《${item.book.title_zh}》書評` : `編輯《${item.book.title_zh}》標注`;
  $("activity-visibility-wrap").hidden = kind !== "annotation";
  if (kind === "annotation") $("activity-public").checked = item.visibility === "public";
  $("activity-dialog").showModal();
}

async function deleteAndReload(endpoint, message) {
  if (!confirm(message)) return;
  try { await window.libraryApi.delete(endpoint); await loadAccountAfterMutation(); toast("已刪除"); }
  catch (error) { toast(error.message, "error"); }
}

async function loadAccountAfterMutation() {
  accountState.loading = false;
  await loadAccount();
}

async function openNotification(card) {
  try {
    if (card.closest(".notification-card")?.classList.contains("unread")) await window.libraryApi.patch(`/me/notifications/${card.dataset.notificationOpen}/read`);
  } catch {}
  location.href = card.dataset.notificationLink;
}

function setAccountView(view, message = "正在確認登入狀態…") {
  $("account-loading").hidden = view !== "loading" && view !== "error";
  $("account-gate").hidden = view !== "signed-out";
  $("account-content").hidden = view !== "ready";
  $("account-loading-message").textContent = message;
  $("account-loading-card").hidden = view === "error";
  $("account-retry").hidden = view !== "error";
}

function wireAccountEvents() {
  $("account-login").addEventListener("click", () => window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")));
  $("account-logout").addEventListener("click", () => window.libraryAuth.logout());
  document.querySelector(".account-tabs").addEventListener("click", (event) => { const button = event.target.closest("[data-account-tab]"); if (button) showTab(button.dataset.accountTab); });
  document.addEventListener("click", async (event) => {
    const favorite = event.target.closest("[data-remove-favorite]");
    if (favorite) {
      try { await window.libraryApi.post(`/books/${encodeURIComponent(favorite.dataset.removeFavorite)}/favorite`); await loadAccountAfterMutation(); toast("已取消收藏"); }
      catch (error) { toast(error.message, "error"); }
      return;
    }
    const editReview = event.target.closest("[data-edit-review]");
    if (editReview) { const item = accountState.data.reviews.find((review) => review.id === editReview.dataset.editReview); if (item) openActivityDialog("review", item); return; }
    const editAnnotation = event.target.closest("[data-edit-annotation]");
    if (editAnnotation) { const item = accountState.data.annotations.find((annotation) => annotation.id === editAnnotation.dataset.editAnnotation); if (item) openActivityDialog("annotation", item); return; }
    const deleteReview = event.target.closest("[data-delete-review]");
    if (deleteReview) return deleteAndReload(`/reviews/${deleteReview.dataset.deleteReview}`, "確定刪除這則書評？");
    const deleteAnnotation = event.target.closest("[data-delete-annotation]");
    if (deleteAnnotation) return deleteAndReload(`/annotations/${deleteAnnotation.dataset.deleteAnnotation}`, "確定刪除這則標注及其討論？");
    const deleteReply = event.target.closest("[data-delete-reply]");
    if (deleteReply) return deleteAndReload(`/annotation-replies/${deleteReply.dataset.deleteReply}`, "確定刪除這則回覆？");
    const unsave = event.target.closest("[data-unsave-annotation]");
    if (unsave) {
      try { await window.libraryApi.post(`/annotations/${encodeURIComponent(unsave.dataset.unsaveAnnotation)}/favorite`); await loadAccountAfterMutation(); toast("已移出標注收藏"); }
      catch (error) { toast(error.message, "error"); }
      return;
    }
    const unsaveReview = event.target.closest("[data-unsave-review]");
    if (unsaveReview) {
      try { await window.libraryApi.post(`/reviews/${encodeURIComponent(unsaveReview.dataset.unsaveReview)}/favorite`); await loadAccountAfterMutation(); toast("已移出評論收藏"); }
      catch (error) { toast(error.message, "error"); }
      return;
    }
    const deleteNotification = event.target.closest("[data-notification-delete]");
    if (deleteNotification) {
      if (!confirm("確定刪除這則通知？")) return;
      try {
        await window.libraryApi.delete(`/me/notifications/${deleteNotification.dataset.notificationDelete}`);
        accountState.data.notifications = accountState.data.notifications.filter((item) => String(item.id) !== deleteNotification.dataset.notificationDelete);
        renderNotifications(); toast("通知已刪除");
      } catch (error) { toast(error.message, "error"); }
      return;
    }
    const notification = event.target.closest("[data-notification-open]");
    if (notification) openNotification(notification);
  });
  document.querySelectorAll("[data-activity-close]").forEach((button) => button.addEventListener("click", () => $("activity-dialog").close()));
  $("activity-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = $("activity-kind").value;
    try {
      if (kind === "review") {
        await window.libraryApi.put(`/books/${encodeURIComponent($("activity-book-id").value)}/review`, { content: $("activity-content-input").value });
      } else {
        await window.libraryApi.patch(`/annotations/${encodeURIComponent($("activity-id").value)}`, { content: $("activity-content-input").value, visibility: $("activity-public").checked ? "public" : "private" });
      }
      $("activity-dialog").close(); await loadAccountAfterMutation(); toast("修改已儲存");
    } catch (error) { toast(error.message, "error"); }
  });
  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await window.libraryApi.patch("/me/profile", { publicDisplayName: $("public-display-name").value });
      await window.libraryAuth.refreshProfile(); await loadAccountAfterMutation(); toast("公開名稱已更新");
    } catch (error) { toast(error.message, "error"); }
  });
  $("notification-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearTimeout(accountState.thresholdSaveTimer);
    try {
      const result = await window.libraryApi.patch("/me/settings", {
        notifyAnnotationReplies: $("notify-annotation-replies").checked,
        notifyAnnotationLikes: $("notify-annotation-likes").checked,
        notifyAnnotationFavorites: $("notify-annotation-favorites").checked,
        notifyReviewLikes: $("notify-review-likes").checked,
        notifyFeedbackReplies: $("notify-feedback-replies").checked,
        annotationVisibilityThreshold: Number($("account-annotation-threshold").value),
      });
      accountState.data.settings = result.settings; renderAccount(); toast("通知設定已儲存");
    } catch (error) { toast(error.message, "error"); }
  });
  $("notify-all-interactions").addEventListener("change", (event) => {
    for (const id of NOTIFICATION_SETTING_IDS) $(id).checked = event.target.checked;
    event.target.indeterminate = false;
  });
  for (const id of NOTIFICATION_SETTING_IDS) $(id).addEventListener("change", () => {
    const enabledCount = NOTIFICATION_SETTING_IDS.filter((settingId) => $(settingId).checked).length;
    $("notify-all-interactions").checked = enabledCount === NOTIFICATION_SETTING_IDS.length;
    $("notify-all-interactions").indeterminate = enabledCount > 0 && enabledCount < NOTIFICATION_SETTING_IDS.length;
  });
  $("account-annotation-threshold").addEventListener("input", () => {
    const value = Number($("account-annotation-threshold").value);
    $("account-threshold-output").value = `${value}%`;
    localStorage.setItem("mystery-library:annotation-threshold", String(value));
    if (accountState.data) accountState.data.settings.annotationVisibilityThreshold = value;
    clearTimeout(accountState.thresholdSaveTimer);
    accountState.thresholdSaveTimer = setTimeout(async () => {
      try {
        const result = await window.libraryApi.patch("/me/settings", { annotationVisibilityThreshold: value });
        if (accountState.data) accountState.data.settings.annotationVisibilityThreshold = result.settings.annotationVisibilityThreshold;
      } catch (error) { toast(error.message, "error"); }
    }, 400);
  });
  $("mark-all-read").addEventListener("click", async () => {
    try { await window.libraryApi.post("/me/notifications/read-all"); await loadAccountAfterMutation(); toast("通知已全部標為已讀"); }
    catch (error) { toast(error.message, "error"); }
  });
  $("account-retry").addEventListener("click", () => { void applyAccountAuth(window.libraryAuth.user, { force: true }); });
}

async function applyAccountAuth(user, { force = false } = {}) {
  const requestId = ++accountState.authRequestId;
  $("account-logout").hidden = !user;
  syncNotificationRealtime(user);
  if (!user) {
    clearTimeout(accountState.thresholdSaveTimer);
    accountState.data = null;
    setAccountView("signed-out");
    return;
  }
  if (!force && accountState.data?.user?.id === user.id) {
    renderAccount();
    setAccountView("ready");
    showTab(location.hash.slice(1));
    renderRealtimeHealth();
    void loadAccount(requestId);
    return;
  }
  setAccountView("loading", "正在載入你的書房資料…");
  showTab(location.hash.slice(1));
  const loaded = await loadAccount(requestId);
  if (requestId !== accountState.authRequestId) return;
  if (loaded) { setAccountView("ready"); renderRealtimeHealth(); }
  else setAccountView("error", "書房資料暫時無法載入，請稍後再試。");
}

async function initializeAccount() {
  wireAccountEvents();
  window.addEventListener("library-realtime-status", (event) => renderRealtimeHealth(event.detail));
  await window.libraryAuth.ready;
  await applyAccountAuth(window.libraryAuth.user);
  window.addEventListener("library-auth-changed", (event) => applyAccountAuth(event.detail.user));
}

initializeAccount();
