const params = new URLSearchParams(location.search);
const bookId = params.get("id");
const requestedNoteId = params.get("note");
const readerState = {
  bookRecord: null,
  epub: null,
  rendition: null,
  navigation: null,
  locationsReady: false,
  currentHref: "",
  currentCfi: "",
  annotations: [],
  renderedCfis: new Set(),
  selected: null,
  noteFilter: "all",
  fontSize: 100,
  saveTimer: null,
  turning: false,
  requestedNoteHandled: false,
  annotationRealtimeStop: null,
  annotationRefreshTimer: null,
  annotationThreshold: 50,
  pendingProgress: null,
  progressSavedOnce: false,
  progressSaveQueue: Promise.resolve(),
  activeThreadNoteId: null,
  bubbleTap: { id: null, at: 0 },
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function toast(message, type = "info") {
  const region = document.getElementById("reader-toast");
  const node = document.createElement("span");
  node.className = type;
  node.textContent = message;
  region.replaceChildren(node);
  setTimeout(() => { if (region.firstChild === node) region.replaceChildren(); }, 3000);
}

function avatarFor(user = {}) {
  if (user.avatar_url) {
    try {
      const url = new URL(user.avatar_url);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch {}
  }
  const initial = escapeHtml((user.public_display_name || "讀")[0]);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="#dbe2d8"/><text x="25" y="32" text-anchor="middle" font-size="21" fill="#233d32">${initial}</text></svg>`)}`;
}

function ensureLogin() {
  if (window.libraryAuth.user) return true;
  toast("登入後才能留下標注、回覆或投票。", "error");
  return false;
}

function deviceId() {
  const key = "mystery-library:reader-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}

function localProgressKey() {
  return `mystery-library:progress:${bookId}`;
}

async function loadBookRecord() {
  let record;
  try {
    const result = await window.libraryApi.get(`/books/${encodeURIComponent(bookId)}`);
    record = result.book;
  } catch (apiError) {
    const response = await fetch("/data/catalog.json");
    if (!response.ok) throw apiError;
    record = (await response.json()).find((book) => book.id === bookId && book.rights_status === "reviewed" && book.enabled !== false);
    if (!record) throw apiError;
    record.metrics = { readerCount: 0, ratingCount: 0, averageRating: 0, favoriteCount: 0, annotationCount: 0 };
    record.viewer = { rating: 0, isFavorite: false, progress: null };
    console.warn("API unavailable; opening the static EPUB record.", apiError);
  }
  readerState.bookRecord = record;
  document.title = `${record.title_zh}・謎讀`;
  document.getElementById("book-title").textContent = record.title_zh;
  document.getElementById("book-author").textContent = record.author;
  document.getElementById("annotation-count").textContent = record.metrics.annotationCount;
  window.libraryApi.post(`/books/${encodeURIComponent(bookId)}/read`, { deviceId: deviceId() }).catch(() => {});
  return record;
}

function renderToc(items, depth = 0) {
  return items.map((item) => `<div style="padding-left:${depth * 12}px"><button type="button" data-toc-href="${escapeHtml(item.href)}">${escapeHtml(item.label.trim())}</button>${item.subitems?.length ? renderToc(item.subitems, depth + 1) : ""}</div>`).join("");
}

async function initializeEpub(record) {
  if (!window.ePub) throw new Error("EPUB 閱讀器載入失敗");
  const loadingMessage = document.querySelector(".reader-loading p");
  if (loadingMessage) loadingMessage.textContent = "正在下載並檢查電子書…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(record.epub_url, { cache: "force-cache", signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("電子書下載逾時，請檢查網路後重試。");
    throw new Error(`電子書下載失敗：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`找不到電子書檔案（HTTP ${response.status}）。請重新執行建置並確認 EPUB 已部署。`);
  const epubData = await response.arrayBuffer();
  const signature = new Uint8Array(epubData, 0, Math.min(4, epubData.byteLength));
  if (epubData.byteLength < 58 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
    throw new Error("下載到的檔案不是有效的 EPUB（ZIP）格式。");
  }
  if (loadingMessage) loadingMessage.textContent = "正在還原原書排版與圖片…";
  // ArrayBuffer must be opened as binary; forcing "epub" makes epub.js try
  // to issue a second network request with the ArrayBuffer as its URL.
  readerState.epub = window.ePub(epubData, { openAs: "binary" });
  await readerState.epub.ready;
  readerState.rendition = readerState.epub.renderTo("epub-viewer", {
    width: "100%",
    height: "100%",
    manager: "default",
    flow: "paginated",
    spread: "auto",
    minSpreadWidth: 900,
    allowScriptedContent: false,
  });
  registerThemes();
  wireRenditionEvents();

  const local = JSON.parse(localStorage.getItem(localProgressKey()) || "null");
  const target = record.viewer.progress?.cfi || local?.cfi || undefined;
  try {
    await readerState.rendition.display(target);
  } catch (error) {
    if (!target) throw error;
    localStorage.removeItem(localProgressKey());
    await readerState.rendition.display();
  }
  await assertRenderedEpub();
  document.querySelector(".reader-loading")?.remove();

  readerState.epub.loaded.navigation.then((navigation) => {
    readerState.navigation = navigation;
    document.getElementById("toc-list").innerHTML = renderToc(navigation.toc || []);
  });
  readerState.epub.locations.generate(1500).then(() => {
    readerState.locationsReady = true;
    const current = readerState.rendition.currentLocation();
    if (current?.start) updateProgress(current);
  }).catch(() => {});
}

async function assertRenderedEpub() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const contents = readerState.rendition?.getContents?.() || [];
    if (contents.some((content) => content.document?.documentElement && content.document?.body)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("EPUB 已下載，但內文頁面沒有完成渲染。請重新整理後再試。");
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function handlePageKey(event) {
  if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    turnPage("previous");
  } else if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    turnPage("next");
  }
}

async function turnPage(direction) {
  if (!readerState.rendition || readerState.turning) return;
  readerState.turning = true;
  const viewer = document.getElementById("epub-viewer");
  viewer.dataset.turning = direction;
  try {
    await readerState.rendition[direction === "previous" ? "prev" : "next"]();
  } catch (error) {
    console.error("Unable to turn EPUB page.", error);
    toast("這一頁暫時無法翻動，請稍後再試。", "error");
  } finally {
    readerState.turning = false;
    delete viewer.dataset.turning;
  }
}

function registerThemes() {
  const themes = readerState.rendition.themes;
  themes.default({
    "section.epub-type-contains-word-titlepage h1, section.epub-type-contains-word-titlepage p, section.epub-type-contains-word-colophon h2, section.epub-type-contains-word-imprint h2": {
      left: "0 !important",
      width: "1px !important",
      height: "1px !important",
      overflow: "hidden !important",
      clip: "rect(0 0 0 0) !important",
      "clip-path": "inset(50%) !important",
      "white-space": "nowrap !important",
    },
    "p, li, blockquote": { "line-height": "2.02 !important" },
  });
  themes.register("publisher", {});
  themes.register("paper", {
    body: { color: "#24231f !important", background: "#f8f2e8 !important", "font-family": 'Georgia, "Noto Serif TC", serif !important', padding: "0 3% !important" },
    p: { "line-height": "2.05 !important" },
    a: { color: "#8e432e !important" },
  });
  themes.register("night", {
    body: { color: "#d8d4ca !important", background: "#151916 !important", "font-family": 'Georgia, "Noto Serif TC", serif !important', padding: "0 3% !important" },
    p: { color: "#d8d4ca !important", "line-height": "2.05 !important" },
    h1: { color: "#f0e9dc !important" }, h2: { color: "#f0e9dc !important" }, h3: { color: "#f0e9dc !important" },
    a: { color: "#d59b70 !important" },
  });
  themes.select(localStorage.getItem("mystery-library:theme") || "publisher");
  const savedSize = Number(localStorage.getItem("mystery-library:font-size"));
  if (savedSize >= 80 && savedSize <= 160) readerState.fontSize = savedSize;
  themes.fontSize(`${readerState.fontSize}%`);
}

function wireRenditionEvents() {
  readerState.rendition.hooks.content.register((contents) => {
    contents.document.addEventListener("keydown", handlePageKey);
    installBubbleStyles(contents);
    setTimeout(() => renderAnnotationBubbles(), 0);
  });
  readerState.rendition.on("relocated", (location) => {
    updateProgress(location);
    for (const id of ["previous-page", "footer-prev"]) document.getElementById(id).disabled = Boolean(location.atStart);
    for (const id of ["next-page", "footer-next"]) document.getElementById(id).disabled = Boolean(location.atEnd);
    setTimeout(() => renderAnnotationBubbles(), 40);
  });
  readerState.rendition.on("selected", (cfiRange, contents) => {
    const quote = contents.window.getSelection()?.toString().replace(/\s+/g, " ").trim().slice(0, 600) || "";
    if (!quote) return;
    readerState.selected = { cfiRange, quote, chapterHref: readerState.currentHref };
    document.getElementById("selected-quote").textContent = quote;
    document.getElementById("annotation-content").value = "";
    const action = document.getElementById("selection-action");
    action.hidden = false;
  });
}

function chapterLabel(href) {
  if (!readerState.navigation) return "閱讀中";
  const flat = [];
  const walk = (items) => items.forEach((item) => { flat.push(item); if (item.subitems) walk(item.subitems); });
  walk(readerState.navigation.toc || []);
  const normalized = href?.split("#")[0];
  return flat.find((item) => item.href.split("#")[0] === normalized)?.label.trim() || "閱讀中";
}

function updateProgress(location) {
  readerState.currentHref = location.start?.href || "";
  readerState.currentCfi = location.start?.cfi || "";
  let percentage = 0;
  if (readerState.locationsReady && readerState.currentCfi) percentage = readerState.epub.locations.percentageFromCfi(readerState.currentCfi) * 100;
  else if (location.start?.percentage != null) percentage = location.start.percentage * 100;
  percentage = Math.max(0, Math.min(100, percentage || 0));
  document.getElementById("progress-label").textContent = `${Math.round(percentage)}%`;
  document.getElementById("progress-bar").style.width = `${percentage}%`;
  document.getElementById("chapter-label").textContent = chapterLabel(readerState.currentHref);
  const progress = { cfi: readerState.currentCfi, chapterHref: readerState.currentHref, percentage, updatedAt: new Date().toISOString() };
  readerState.pendingProgress = progress;
  localStorage.setItem(localProgressKey(), JSON.stringify(progress));
  clearTimeout(readerState.saveTimer);
  if (window.libraryAuth.user && progress.cfi) {
    if (!readerState.progressSavedOnce) persistProgress();
    else readerState.saveTimer = setTimeout(() => persistProgress(), 350);
  }
  if (readerState.noteFilter === "chapter") renderAnnotations();
}

async function persistProgress({ keepalive = false } = {}) {
  const progress = readerState.pendingProgress ? { ...readerState.pendingProgress } : null;
  if (!window.libraryAuth.user || !progress?.cfi) return;
  clearTimeout(readerState.saveTimer);
  try {
    if (keepalive) {
      const token = window.libraryAuth.session?.access_token || await window.libraryAuth.token();
      await fetch(`/api/books/${encodeURIComponent(bookId)}/progress`, {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(progress),
        credentials: "same-origin",
        keepalive: true,
      });
    } else {
      readerState.progressSaveQueue = readerState.progressSaveQueue
        .catch(() => {})
        .then(() => window.libraryApi.put(`/books/${encodeURIComponent(bookId)}/progress`, progress));
      await readerState.progressSaveQueue;
    }
    readerState.progressSavedOnce = true;
  } catch (error) {
    console.warn("Unable to save reading progress.", error);
  }
}

function annotationClusterKey(note) {
  const cfiStart = String(note.cfi_range || "").split(",")[0].replace(/\)$/, "");
  return `${String(note.chapter_href || "").split("#")[0]}::${cfiStart}`;
}

function annotationRegionKey(note) {
  const numbers = String(note.cfi_range || "").match(/\d+/g)?.map(Number) || [0];
  const anchor = numbers.at(-2) || numbers.at(-1) || 0;
  return `${String(note.chapter_href || "").split("#")[0]}::${Math.floor(anchor / 20)}`;
}

function annotationSignal(note) {
  const ageDays = Math.max(0, (Date.now() - new Date(note.created_at).getTime()) / 86400000);
  const recency = Math.max(0, 2 - Math.log10(ageDays + 1));
  return Number(note.score || 0) * 4 + Math.log2(Number(note.favoriteCount || 0) + 1) * 2 + Math.log2((note.replies?.length || 0) + 1) * 1.5 + recency;
}

function visibleBubbleNotes() {
  const privateNotes = readerState.annotations.filter((note) => note.visibility === "private");
  const publicNotes = readerState.annotations.filter((note) => note.visibility === "public");
  const regions = new Map();
  for (const note of publicNotes) {
    const key = annotationRegionKey(note);
    if (!regions.has(key)) regions.set(key, []);
    regions.get(key).push(note);
  }
  const selected = [];
  for (const notes of regions.values()) {
    const ordered = [...notes].sort((a, b) => annotationSignal(b) - annotationSignal(a) || new Date(b.created_at) - new Date(a.created_at));
    const ratio = Math.max(0, Math.min(1, (100 - readerState.annotationThreshold) / 100));
    const visibleCount = readerState.annotationThreshold <= 0 ? ordered.length : Math.max(1, Math.ceil(ordered.length * ratio));
    const cutoff = annotationSignal(ordered[Math.min(ordered.length - 1, visibleCount - 1)] || {});
    selected.push(...ordered.filter((note, index) => index < visibleCount || annotationSignal(note) === cutoff));
  }
  return [...privateNotes, ...selected];
}

function bubbleGroups() {
  const groups = new Map();
  for (const note of visibleBubbleNotes()) {
    const key = annotationClusterKey(note);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }
  return [...groups.values()].map((notes) => notes.sort((a, b) => annotationSignal(b) - annotationSignal(a)));
}

function installBubbleStyles(contents) {
  if (!contents?.document?.head || contents.document.getElementById("mystery-note-bubble-style")) return;
  const style = contents.document.createElement("style");
  style.id = "mystery-note-bubble-style";
  style.textContent = `
    .mystery-note-bubble{position:fixed;z-index:2147483000;width:27px;height:27px;border:1px solid rgba(62,39,22,.28);border-radius:50% 50% 50% 5px;display:grid;place-items:center;padding:0;box-shadow:0 3px 9px rgba(30,23,17,.26);font:700 10px/1 system-ui,sans-serif;cursor:pointer;touch-action:manipulation;transform:translateY(-45%);}
    .mystery-note-bubble.public{background:#d87942;color:#fff;}.mystery-note-bubble.private{background:#5c8da4;color:#fff;}.mystery-note-bubble.mixed{background:linear-gradient(135deg,#5c8da4 0 48%,#d87942 52% 100%);color:#fff;}
    .mystery-note-bubble:focus{outline:3px solid rgba(220,154,83,.45);outline-offset:2px;}
  `;
  contents.document.head.append(style);
}

function activateBubble(notes) {
  const id = notes[0]?.id;
  if (!id) return;
  const now = Date.now();
  if (readerState.bubbleTap.id === id && now - readerState.bubbleTap.at < 430) {
    readerState.bubbleTap = { id: null, at: 0 };
    openAnnotationThread(id);
  } else {
    readerState.bubbleTap = { id, at: now };
    toast(notes.length > 1 ? `${notes.length} 則標注・再點一下開啟討論` : "再點一下泡泡，開啟標注與留言");
  }
}

function renderAnnotationBubbles() {
  if (!readerState.rendition) return;
  const groups = bubbleGroups();
  for (const contents of readerState.rendition.getContents?.() || []) {
    installBubbleStyles(contents);
    contents.document.querySelectorAll(".mystery-note-bubble").forEach((node) => node.remove());
    const occupied = new Map();
    for (const notes of groups) {
      const representative = notes[0];
      let range;
      try { range = contents.range(representative.cfi_range); } catch { continue; }
      const rect = range?.getBoundingClientRect?.();
      if (!rect || (!rect.width && !rect.height)) continue;
      const viewportWidth = contents.window.innerWidth || contents.document.documentElement.clientWidth;
      const viewportHeight = contents.window.innerHeight || contents.document.documentElement.clientHeight;
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) continue;
      const row = Math.round(rect.top / 22);
      const lane = occupied.get(row) || 0;
      occupied.set(row, lane + 1);
      const button = contents.document.createElement("button");
      const visibilities = new Set(notes.map((note) => note.visibility));
      button.type = "button";
      button.className = `mystery-note-bubble ${visibilities.size > 1 ? "mixed" : representative.visibility}`;
      button.textContent = notes.length > 1 ? String(notes.length) : "✦";
      button.title = `${notes.length} 則標注；點兩下開啟討論`;
      button.setAttribute("aria-label", `${notes.length} 則標注，點兩下開啟討論`);
      button.style.left = `${Math.max(4, Math.min(viewportWidth - 31, rect.right + 5 + lane * 29))}px`;
      button.style.top = `${Math.max(16, Math.min(viewportHeight - 16, rect.top + Math.min(rect.height, 24) / 2))}px`;
      button.addEventListener("pointerup", (event) => { event.preventDefault(); event.stopPropagation(); activateBubble(notes); });
      contents.document.body.append(button);
    }
  }
}

function fusedAnnotationOrder(notes) {
  const bySignal = [...notes].sort((a, b) => annotationSignal(b) - annotationSignal(a));
  const byNewest = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const result = [];
  const add = (note) => { if (note && !result.some((item) => item.id === note.id)) result.push(note); };
  [bySignal[0], bySignal[1], byNewest[0], bySignal[2], byNewest[1], bySignal[3], byNewest[2]].forEach(add);
  byNewest.forEach(add);
  return result;
}

function annotationThreadCard(note, index) {
  const replies = [...(note.replies || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || new Date(b.created_at) - new Date(a.created_at));
  return `<article class="thread-note ${note.visibility}" data-thread-note-id="${note.id}">
    <div class="thread-note-order"><span>${String(index + 1).padStart(2, "0")}</span><small>${index === 0 ? "融合排序首位" : "相關標注"}</small></div>
    <div class="annotation-author"><img src="${escapeHtml(avatarFor(note.author))}" alt=""><strong>${escapeHtml(note.author?.public_display_name || "讀者")}</strong>${["admin", "moderator"].includes(note.author?.role) ? "<em>館員</em>" : ""}<time>${new Date(note.created_at).toLocaleString("zh-TW")}</time></div>
    ${note.quote ? `<blockquote>${escapeHtml(note.quote)}</blockquote>` : ""}
    <p>${escapeHtml(note.content)}</p>
    <div class="note-actions"><button class="${note.viewerVote === "up" ? "active" : ""}" data-note-vote="up" data-id="${note.id}">▲ 讚賞</button><button class="${note.viewerVote === "down" ? "active" : ""}" data-note-vote="down" data-id="${note.id}">▼</button><span>${note.score >= 0 ? "+" : ""}${note.score}</span>${note.visibility === "public" ? `<button class="${note.viewerFavorite ? "active" : ""}" data-note-favorite="${note.id}">${note.viewerFavorite ? "♥ 已收藏" : "♡ 收藏"} ${note.favoriteCount}</button>` : '<span>私人標注</span>'}</div>
    <div class="thread-note-replies"><h3>${replies.length} 則${note.visibility === "private" ? "私人補充" : "留言"}</h3>${replies.map((reply) => `<div class="thread-note-reply"><header><img src="${escapeHtml(avatarFor(reply.author))}" alt=""><strong>${escapeHtml(reply.author?.public_display_name || "讀者")}</strong><time>${new Date(reply.created_at).toLocaleString("zh-TW")}</time></header><p>${escapeHtml(reply.content)}</p>${reply.score != null ? `<button data-reply-vote="up" data-reply-id="${reply.id}" class="${reply.viewerVote === "up" ? "active" : ""}">▲ ${reply.score}</button>` : ""}</div>`).join("") || '<p class="muted">尚無留言。</p>'}</div><form class="reply-form thread-reply-form" data-reply-form="${note.id}"><input maxlength="2000" aria-label="回覆標注" placeholder="${note.visibility === "private" ? "補充這則私人標注…" : "回覆這則標注…"}"><button type="submit">送出</button></form>
  </article>`;
}

function openAnnotationThread(noteId) {
  const selected = readerState.annotations.find((note) => note.id === noteId);
  if (!selected) return;
  const related = readerState.annotations.filter((note) => annotationClusterKey(note) === annotationClusterKey(selected));
  const ordered = fusedAnnotationOrder(related);
  const selectedIndex = ordered.findIndex((note) => note.id === noteId);
  if (selectedIndex > 0) ordered.unshift(...ordered.splice(selectedIndex, 1));
  readerState.activeThreadNoteId = noteId;
  document.getElementById("annotation-thread-rank").textContent = related.length > 1
    ? `此處共有 ${related.length} 則獨立標注；依讚賞、收藏、回覆與新鮮度融合排序。`
    : "這是一則獨立標注；所有留言與互動都收在這裡。";
  document.getElementById("annotation-thread-content").innerHTML = ordered.map(annotationThreadCard).join("");
  const dialog = document.getElementById("annotation-thread-dialog");
  if (!dialog.open) dialog.showModal();
}

async function loadAnnotations() {
  try {
    const result = await window.libraryApi.get(`/books/${encodeURIComponent(bookId)}/annotations`);
    readerState.annotations = result.annotations;
    document.getElementById("annotation-count").textContent = result.annotations.filter((note) => note.visibility === "public").length;
    renderHighlights();
    renderAnnotationBubbles();
    renderAnnotations();
    if (readerState.activeThreadNoteId && document.getElementById("annotation-thread-dialog").open) openAnnotationThread(readerState.activeThreadNoteId);
    const requested = !readerState.requestedNoteHandled && requestedNoteId && readerState.annotations.find((note) => note.id === requestedNoteId);
    if (requested) {
      readerState.requestedNoteHandled = true;
      try { await readerState.rendition.display(requested.cfi_range); } catch {}
      openAnnotationThread(requested.id);
    }
  } catch (error) {
    document.getElementById("annotation-list").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

function renderHighlights() {
  if (!readerState.rendition) return;
  for (const cfi of readerState.renderedCfis) {
    try { readerState.rendition.annotations.remove(cfi, "highlight"); } catch {}
  }
  readerState.renderedCfis.clear();
  for (const note of readerState.annotations) {
    try {
      readerState.rendition.annotations.highlight(
        note.cfi_range,
        { annotationId: note.id },
        () => openAnnotationThread(note.id),
        `reader-annotation-${note.visibility}`,
        { fill: note.visibility === "private" ? "#4f87a3" : "#d47a3c", "fill-opacity": "0.3", "mix-blend-mode": "multiply" },
      );
      readerState.renderedCfis.add(note.cfi_range);
    } catch {}
  }
}

function renderAnnotations() {
  const list = document.getElementById("annotation-list");
  const notes = readerState.noteFilter === "chapter"
    ? readerState.annotations.filter((note) => note.chapter_href?.split("#")[0] === readerState.currentHref?.split("#")[0])
    : readerState.annotations;
  if (!notes.length) {
    list.innerHTML = '<p class="muted">這裡還沒有標注。選取一段文字，留下第一個線索。</p>';
    return;
  }
  list.innerHTML = notes.map((note) => `<article class="annotation-card ${note.visibility}" data-annotation-id="${note.id}" data-cfi="${escapeHtml(note.cfi_range)}">
    <div class="annotation-author"><img src="${escapeHtml(avatarFor(note.author))}" alt=""><strong>${escapeHtml(note.author.public_display_name || "讀者")}</strong>${["admin", "moderator"].includes(note.author.role) ? "<em>館員</em>" : ""}<time>${new Date(note.created_at).toLocaleDateString("zh-TW")}</time></div>
    ${note.quote ? `<blockquote>${escapeHtml(note.quote)}</blockquote>` : ""}
    <p>${escapeHtml(note.content)}</p>
    <div class="note-actions"><button class="${note.viewerVote === "up" ? "active" : ""}" data-note-vote="up" data-id="${note.id}" aria-label="讚賞標注">▲</button><button class="${note.viewerVote === "down" ? "active" : ""}" data-note-vote="down" data-id="${note.id}" aria-label="不贊同標注">▼</button><span>${note.score >= 0 ? "+" : ""}${note.score}</span>${note.visibility === "public" ? `<button class="${note.viewerFavorite ? "active" : ""}" data-note-favorite="${note.id}">${note.viewerFavorite ? "♥" : "♡"} ${note.favoriteCount}</button>` : ""}<span>· ${note.visibility === "private" ? `私人・${note.replies.length} 則留言` : `${note.replies.length} 則回覆`}</span></div>
    <div class="annotation-replies">${note.replies.map((reply) => `<div class="annotation-reply"><strong>${escapeHtml(reply.author.public_display_name || "讀者")}${["admin", "moderator"].includes(reply.author.role) ? "・館員" : ""}</strong>${escapeHtml(reply.content)}</div>`).join("")}</div><form class="reply-form" data-reply-form="${note.id}"><input maxlength="2000" aria-label="回覆標注" placeholder="${note.visibility === "private" ? "補充這則私人標注…" : "回覆這則標注…"}"><button type="submit">送出</button></form>
  </article>`).join("");
}

function openAnnotationPanel() {
  document.getElementById("annotation-panel").hidden = false;
  document.getElementById("toc-panel").hidden = true;
  syncAnnotationRealtime(true);
}

function syncAnnotationRealtime(active) {
  if (!active) {
    readerState.annotationRealtimeStop?.();
    readerState.annotationRealtimeStop = null;
    return;
  }
  if (readerState.annotationRealtimeStop || !bookId || !window.libraryRealtime) return;
  readerState.annotationRealtimeStop = window.libraryRealtime.subscribeBook(bookId, ({ events }) => {
    if (events.length && !events.some((event) => event.resource.startsWith("annotation"))) return;
    clearTimeout(readerState.annotationRefreshTimer);
    readerState.annotationRefreshTimer = setTimeout(() => loadAnnotations(), 280);
  });
}

async function submitAnnotation(event) {
  event.preventDefault();
  if (!ensureLogin() || !readerState.selected) return;
  const button = document.getElementById("annotation-submit");
  button.disabled = true;
  try {
    await window.libraryApi.post(`/books/${encodeURIComponent(bookId)}/annotations`, {
      ...readerState.selected,
      content: document.getElementById("annotation-content").value,
      visibility: document.getElementById("annotation-public").checked ? "public" : "private",
    });
    document.getElementById("annotation-dialog").close();
    document.getElementById("selection-action").hidden = true;
    readerState.selected = null;
    await loadAnnotations();
    openAnnotationPanel();
    toast("標注已儲存");
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
}

async function voteAnnotation(id, voteType) {
  if (!ensureLogin()) return;
  const note = readerState.annotations.find((item) => item.id === id);
  try {
    await window.libraryApi.post(`/annotations/${id}/vote`, { voteType: note?.viewerVote === voteType ? "none" : voteType });
    await loadAnnotations();
  } catch (error) { toast(error.message, "error"); }
}

async function favoriteAnnotation(id) {
  if (!ensureLogin()) return;
  try {
    await window.libraryApi.post(`/annotations/${id}/favorite`);
    await loadAnnotations();
  } catch (error) { toast(error.message, "error"); }
}

async function replyAnnotation(id, content) {
  if (!ensureLogin()) return;
  try {
    await window.libraryApi.post(`/annotations/${id}/replies`, { content });
    await loadAnnotations();
    toast("回覆已送出");
  } catch (error) { toast(error.message, "error"); }
}

async function voteAnnotationReply(replyId, voteType) {
  if (!ensureLogin()) return;
  const reply = readerState.annotations.flatMap((note) => note.replies || []).find((item) => item.id === replyId);
  try {
    await window.libraryApi.post(`/annotation-replies/${encodeURIComponent(replyId)}/vote`, { voteType: reply?.viewerVote === voteType ? "none" : voteType });
    await loadAnnotations();
  } catch (error) { toast(error.message, "error"); }
}

function selectTheme(theme) {
  readerState.rendition?.themes.select(theme);
  localStorage.setItem("mystery-library:theme", theme);
  document.body.dataset.theme = theme;
}

function wireControls() {
  const previous = () => turnPage("previous");
  const next = () => turnPage("next");
  for (const id of ["previous-page", "footer-prev"]) document.getElementById(id).addEventListener("click", previous);
  for (const id of ["next-page", "footer-next"]) document.getElementById(id).addEventListener("click", next);
  document.addEventListener("keydown", handlePageKey);
  document.getElementById("toc-toggle").addEventListener("click", () => { const panel = document.getElementById("toc-panel"); panel.hidden = !panel.hidden; document.getElementById("annotation-panel").hidden = true; });
  document.getElementById("annotation-toggle").addEventListener("click", () => { const panel = document.getElementById("annotation-panel"); panel.hidden = !panel.hidden; document.getElementById("toc-panel").hidden = true; syncAnnotationRealtime(!panel.hidden); });
  document.querySelectorAll("[data-close-panel]").forEach((button) => button.addEventListener("click", () => { document.getElementById(button.dataset.closePanel).hidden = true; }));
  document.getElementById("settings-toggle").addEventListener("click", () => { const panel = document.getElementById("settings-panel"); panel.hidden = !panel.hidden; });
  document.getElementById("toc-list").addEventListener("click", (event) => { const button = event.target.closest("[data-toc-href]"); if (!button) return; readerState.rendition.display(button.dataset.tocHref); document.getElementById("toc-panel").hidden = true; });
  document.getElementById("font-smaller").addEventListener("click", () => { readerState.fontSize = Math.max(80, readerState.fontSize - 10); readerState.rendition.themes.fontSize(`${readerState.fontSize}%`); localStorage.setItem("mystery-library:font-size", readerState.fontSize); });
  document.getElementById("font-larger").addEventListener("click", () => { readerState.fontSize = Math.min(160, readerState.fontSize + 10); readerState.rendition.themes.fontSize(`${readerState.fontSize}%`); localStorage.setItem("mystery-library:font-size", readerState.fontSize); });
  document.getElementById("theme-select").addEventListener("change", (event) => selectTheme(event.target.value));
  document.getElementById("spread-select").addEventListener("change", (event) => readerState.rendition.spread(event.target.value));
  document.getElementById("selection-action").addEventListener("click", () => {
    if (!readerState.selected) return;
    if (!ensureLogin()) {
      window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error"));
      return;
    }
    document.getElementById("selection-action").hidden = true;
    document.getElementById("annotation-dialog").showModal();
    document.getElementById("annotation-content").focus();
    for (const contents of readerState.rendition?.getContents?.() || []) contents.window.getSelection()?.removeAllRanges();
  });
  const threshold = document.getElementById("annotation-threshold");
  threshold.addEventListener("input", () => {
    readerState.annotationThreshold = Number(threshold.value);
    document.getElementById("annotation-threshold-output").value = `${readerState.annotationThreshold}%`;
    localStorage.setItem("mystery-library:annotation-threshold", String(readerState.annotationThreshold));
    renderAnnotationBubbles();
  });
  threshold.addEventListener("change", () => {
    if (window.libraryAuth.user) window.libraryApi.patch("/me/settings", { annotationVisibilityThreshold: readerState.annotationThreshold }).catch(() => {});
  });
  document.getElementById("annotation-form").addEventListener("submit", submitAnnotation);
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  document.querySelector(".annotation-filter").addEventListener("click", (event) => { const button = event.target.closest("[data-note-filter]"); if (!button) return; readerState.noteFilter = button.dataset.noteFilter; document.querySelectorAll("[data-note-filter]").forEach((item) => item.classList.toggle("active", item === button)); renderAnnotations(); });
  document.getElementById("annotation-list").addEventListener("click", (event) => {
    const vote = event.target.closest("[data-note-vote]");
    if (vote) { event.stopPropagation(); voteAnnotation(vote.dataset.id, vote.dataset.noteVote); return; }
    const favorite = event.target.closest("[data-note-favorite]");
    if (favorite) { event.stopPropagation(); favoriteAnnotation(favorite.dataset.noteFavorite); return; }
    const card = event.target.closest("[data-cfi]");
    if (card && !event.target.closest("form,button,input")) readerState.rendition.display(card.dataset.cfi);
  });
  document.getElementById("annotation-list").addEventListener("submit", (event) => { const form = event.target.closest("[data-reply-form]"); if (!form) return; event.preventDefault(); const input = form.querySelector("input"); if (input.value.trim()) replyAnnotation(form.dataset.replyForm, input.value); });
  document.getElementById("annotation-thread-content").addEventListener("click", (event) => {
    const vote = event.target.closest("[data-note-vote]");
    if (vote) { voteAnnotation(vote.dataset.id, vote.dataset.noteVote); return; }
    const favorite = event.target.closest("[data-note-favorite]");
    if (favorite) { favoriteAnnotation(favorite.dataset.noteFavorite); return; }
    const replyVote = event.target.closest("[data-reply-vote]");
    if (replyVote) voteAnnotationReply(replyVote.dataset.replyId, replyVote.dataset.replyVote);
  });
  document.getElementById("annotation-thread-content").addEventListener("submit", (event) => { const form = event.target.closest("[data-reply-form]"); if (!form) return; event.preventDefault(); const input = form.querySelector("input"); if (input.value.trim()) replyAnnotation(form.dataset.replyForm, input.value); });
  document.getElementById("reader-login").addEventListener("click", () => { if (window.libraryAuth.user) location.href = "/account.html"; else window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")); });
  window.addEventListener("library-auth-changed", (event) => { document.getElementById("reader-login").textContent = event.detail.user ? "書房" : "登入"; if (readerState.rendition) { loadAnnotations(); if (event.detail.user) persistProgress(); } });
  window.addEventListener("focus", () => { if (readerState.rendition) loadAnnotations(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistProgress({ keepalive: true }); });
  window.addEventListener("pagehide", () => { persistProgress({ keepalive: true }); });
}

async function initialize() {
  wireControls();
  if (!bookId) {
    document.getElementById("epub-viewer").innerHTML = '<div class="reader-loading"><p>網址中缺少書籍編號。</p><a href="/">回到書庫</a></div>';
    return;
  }
  try {
    await window.libraryAuth.ready;
    document.getElementById("reader-login").textContent = window.libraryAuth.user ? "書房" : "登入";
    const record = await loadBookRecord();
    await initializeEpub(record);
    await loadAnnotations();
    syncAnnotationRealtime(true);
    document.getElementById("theme-select").value = localStorage.getItem("mystery-library:theme") || "publisher";
    const savedThreshold = localStorage.getItem("mystery-library:annotation-threshold");
    readerState.annotationThreshold = Math.max(0, Math.min(100, Number(savedThreshold ?? 50)));
    if (window.libraryAuth.user) {
      try {
        const result = await window.libraryApi.get("/me/settings");
        if (savedThreshold == null) readerState.annotationThreshold = Number(result.settings.annotationVisibilityThreshold ?? 50);
      } catch {}
    }
    document.getElementById("annotation-threshold").value = String(readerState.annotationThreshold);
    document.getElementById("annotation-threshold-output").value = `${readerState.annotationThreshold}%`;
    renderAnnotationBubbles();
  } catch (error) {
    console.error(error);
    document.getElementById("epub-viewer").innerHTML = `<div class="reader-loading"><span class="loading-mark">!</span><p>${escapeHtml(error.message)}</p><a href="/">回到書庫</a></div>`;
  }
}

initialize();
