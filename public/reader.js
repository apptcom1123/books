const params = new URLSearchParams(location.search);
const bookId = params.get("id");
const requestedNoteId = params.get("note");
const ANNOTATION_CLUSTER_SIZE = 5;
const PUBLIC_ANNOTATION_RANK_WINDOW = 20;
const READER_THEMES = new Set(["publisher", "paper", "night"]);
const READER_THEME_CSS = {
  publisher: "",
  paper: `
    :root { color-scheme: light; }
    body { color:#24231f !important; background:#f8f2e8 !important; font-family:Georgia,"Noto Serif TC",serif !important; padding:0 3% !important; }
    p { line-height:2.05 !important; }
    a { color:#8e432e !important; }
  `,
  night: `
    :root { color-scheme: dark; }
    body { color:#d8d4ca !important; background:#151916 !important; font-family:Georgia,"Noto Serif TC",serif !important; padding:0 3% !important; }
    p, li, blockquote { color:#d8d4ca !important; line-height:2.05 !important; }
    h1, h2, h3, h4, h5, h6 { color:#f0e9dc !important; }
    a { color:#d59b70 !important; }
  `,
};
const readerState = {
  bookRecord: null,
  epub: null,
  rendition: null,
  navigation: null,
  locationsReady: false,
  currentHref: "",
  currentCfi: "",
  annotations: [],
  selected: null,
  fontSize: 100,
  saveTimer: null,
  turning: false,
  requestedNoteHandled: false,
  annotationRealtimeStop: null,
  annotationRefreshTimer: null,
  annotationThreshold: 50,
  annotationThresholdSaveTimer: null,
  annotationRequestId: 0,
  pendingProgress: null,
  progressSavedOnce: false,
  progressSaveQueue: Promise.resolve(),
  activeThreadNoteId: null,
  threadSwipe: null,
  replySort: "best",
  replyParentId: null,
  replyDrafts: new Map(),
  expandedReplyNotes: new Set(),
  annotationMutationPending: new Set(),
  bubbleTap: { id: null, at: 0 },
  theme: "publisher",
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
  const savedTheme = localStorage.getItem("mystery-library:theme");
  readerState.theme = READER_THEMES.has(savedTheme) ? savedTheme : "publisher";
  const savedSize = Number(localStorage.getItem("mystery-library:font-size"));
  if (savedSize >= 80 && savedSize <= 160) readerState.fontSize = savedSize;
  themes.fontSize(`${readerState.fontSize}%`);
}

function applyThemeToContents(contents, theme = readerState.theme) {
  const head = contents?.document?.head;
  if (!head) return;
  let style = contents.document.getElementById("mystery-reader-theme");
  if (!style) {
    style = contents.document.createElement("style");
    style.id = "mystery-reader-theme";
    head.append(style);
  }
  // Replacing one style node avoids epub.js retaining every previously
  // selected theme and letting an older, later-injected rule win forever.
  style.textContent = READER_THEME_CSS[theme] || "";
  contents.document.body?.setAttribute("data-reader-theme", theme);
}

function applyReaderTheme(theme) {
  const nextTheme = READER_THEMES.has(theme) ? theme : "publisher";
  readerState.theme = nextTheme;
  for (const contents of readerState.rendition?.getContents?.() || []) applyThemeToContents(contents, nextTheme);
  document.body.dataset.theme = nextTheme;
  document.getElementById("theme-select").value = nextTheme;
  return nextTheme;
}

function wireRenditionEvents() {
  readerState.rendition.hooks.content.register((contents) => {
    contents.document.addEventListener("keydown", handlePageKey);
    applyThemeToContents(contents);
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
    const selection = contents.window.getSelection();
    const quote = selection?.toString().replace(/\s+/g, " ").trim().slice(0, 600) || "";
    if (!quote) return;
    const offsets = selectionCharacterOffsets(contents, selection);
    if (!offsets) {
      toast("無法判斷這段文字的位置，請重新選取。", "error");
      return;
    }
    readerState.selected = {
      cfiRange,
      quote,
      chapterHref: readerState.currentHref,
      anchorOffsetStart: offsets.start,
      anchorOffsetEnd: offsets.end,
    };
    document.getElementById("selected-quote").textContent = quote;
    document.getElementById("annotation-content").value = "";
    const action = document.getElementById("selection-action");
    action.hidden = false;
  });
}

function selectionCharacterOffsets(contents, selection) {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const root = contents?.document?.body;
  if (!root?.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  try {
    // Same offset model as yz_json: count text before the selection and put
    // every five starting positions into one local discussion cluster.
    const before = contents.document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { start, end: start + selection.toString().length };
  } catch {
    return null;
  }
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

function normalizedChapterHref(note) {
  return String(note.chapter_href || "").split("#")[0];
}

function annotationClusterDescriptor(note) {
  const chapter = normalizedChapterHref(note);
  const storedCluster = note.cluster_key;
  const storedStart = note.anchor_offset_start;
  const hasCluster = storedCluster !== null && storedCluster !== undefined && storedCluster !== ""
    && Number.isInteger(Number(storedCluster)) && Number(storedCluster) >= 0;
  const hasStart = storedStart !== null && storedStart !== undefined && storedStart !== ""
    && Number.isInteger(Number(storedStart)) && Number(storedStart) >= 0;
  const clusterIndex = hasCluster
    ? Number(storedCluster)
    : hasStart ? Math.floor(Number(storedStart) / ANNOTATION_CLUSTER_SIZE) : null;
  const visibility = note.visibility === "private" ? "private" : "public";
  return {
    chapter,
    clusterIndex,
    start: hasStart ? Number(storedStart) : Number.MAX_SAFE_INTEGER,
    visibility,
    // Rows created before offsets existed remain separate. Opaque CFI path
    // numbers are not text positions and must not be used to merge threads.
    key: clusterIndex === null
      ? `${visibility}:${chapter}:legacy:${note.id}`
      : `${visibility}:${chapter}:${clusterIndex}`,
  };
}

function compareAnnotationRank(a, b) {
  return Number(b.score || 0) - Number(a.score || 0)
    || Number(b.upCount || 0) - Number(a.upCount || 0)
    || new Date(b.created_at) - new Date(a.created_at);
}

function annotationClusters(notes = readerState.annotations) {
  const clusters = new Map();
  for (const note of notes) {
    const descriptor = annotationClusterDescriptor(note);
    if (!clusters.has(descriptor.key)) clusters.set(descriptor.key, { ...descriptor, notes: [] });
    clusters.get(descriptor.key).notes.push(note);
  }
  return [...clusters.values()].map((cluster) => {
    const notesByPosition = [...cluster.notes].sort((a, b) => {
      const hasStartA = a.anchor_offset_start !== null && a.anchor_offset_start !== undefined && a.anchor_offset_start !== ""
        && Number.isInteger(Number(a.anchor_offset_start));
      const hasStartB = b.anchor_offset_start !== null && b.anchor_offset_start !== undefined && b.anchor_offset_start !== ""
        && Number.isInteger(Number(b.anchor_offset_start));
      const startA = hasStartA ? Number(a.anchor_offset_start) : Number.MAX_SAFE_INTEGER;
      const startB = hasStartB ? Number(b.anchor_offset_start) : Number.MAX_SAFE_INTEGER;
      return startA - startB || compareAnnotationRank(a, b);
    });
    return {
      ...cluster,
      notes: [...cluster.notes].sort(compareAnnotationRank),
      representative: notesByPosition[0],
      score: Math.max(...cluster.notes.map((note) => Number(note.score) || 0)),
      upCount: Math.max(...cluster.notes.map((note) => Number(note.upCount) || 0)),
      newest: Math.max(...cluster.notes.map((note) => new Date(note.created_at).getTime() || 0)),
    };
  });
}

function compareAnnotationClusters(a, b) {
  return a.chapter.localeCompare(b.chapter)
    || a.start - b.start
    || a.visibility.localeCompare(b.visibility)
    || a.key.localeCompare(b.key);
}

function visibleBubbleNotes() {
  const clusters = annotationClusters();
  const privateClusters = clusters.filter((cluster) => cluster.visibility === "private");
  const publicClusters = clusters.filter((cluster) => cluster.visibility === "public");
  let selected = publicClusters;
  if (readerState.annotationThreshold >= 100) selected = [];
  else if (readerState.annotationThreshold > 0) {
    const regions = new Map();
    for (const cluster of publicClusters) {
      const regionIndex = cluster.clusterIndex === null
        ? `legacy:${cluster.key}`
        : Math.floor(cluster.clusterIndex / PUBLIC_ANNOTATION_RANK_WINDOW);
      const key = `${cluster.chapter}::${regionIndex}`;
      if (!regions.has(key)) regions.set(key, []);
      regions.get(key).push(cluster);
    }
    selected = [];
    for (const region of regions.values()) {
      const ordered = [...region].sort((a, b) => b.score - a.score
        || b.upCount - a.upCount
        || b.newest - a.newest
        || a.start - b.start);
      const visibleCount = Math.ceil(ordered.length * (100 - readerState.annotationThreshold) / 100);
      selected.push(...ordered.slice(0, visibleCount));
    }
  }
  if (window.matchMedia("(max-width: 700px)").matches && selected.length > 4) {
    const score = (cluster) => {
      let hash = 2166136261;
      for (const character of `${bookId}:${readerState.annotationThreshold}:${cluster.key}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    const chapters = new Map();
    for (const cluster of selected) {
      if (!chapters.has(cluster.chapter)) chapters.set(cluster.chapter, []);
      chapters.get(cluster.chapter).push(cluster);
    }
    selected = [...chapters.values()].flatMap((chapter) => [...chapter].sort((a, b) => score(a) - score(b)).slice(0, 4));
  }
  return [...privateClusters, ...selected].sort(compareAnnotationClusters);
}

function installBubbleStyles(contents) {
  if (!contents?.document?.head || contents.document.getElementById("mystery-note-bubble-style")) return;
  const style = contents.document.createElement("style");
  style.id = "mystery-note-bubble-style";
  style.textContent = `
    .mystery-note-bubble{position:fixed;z-index:2147483000;width:24px;height:21px;border:1px solid rgba(62,39,22,.26);border-radius:11px 11px 11px 4px;display:grid;place-items:center;padding:0;box-shadow:0 2px 7px rgba(30,23,17,.22);font:800 9px/1 system-ui,sans-serif;cursor:pointer;touch-action:manipulation;}
    .mystery-note-bubble::before{content:"";position:absolute;left:5px;top:-4px;width:7px;height:7px;background:inherit;border-left:1px solid rgba(62,39,22,.2);border-top:1px solid rgba(62,39,22,.2);transform:rotate(45deg);}
    .mystery-note-bubble.public{background:#d87942;color:#fff;}.mystery-note-bubble.private{background:#5c8da4;color:#fff;}
    .mystery-note-bubble:focus{outline:3px solid rgba(220,154,83,.45);outline-offset:2px;}
  `;
  contents.document.head.append(style);
}

function activateBubble(cluster) {
  const id = cluster?.representative?.id;
  const key = cluster?.key;
  if (!id || !key) return;
  const now = Date.now();
  if (readerState.bubbleTap.id === key && now - readerState.bubbleTap.at < 430) {
    readerState.bubbleTap = { id: null, at: 0 };
    openAnnotationThread(id, { reset: true });
  } else {
    readerState.bubbleTap = { id: key, at: now };
    toast(`再點一下可開啟這組 ${cluster.notes.length} 個局部討論串`);
  }
}

function renderAnnotationBubbles() {
  if (!readerState.rendition) return;
  const clusters = visibleBubbleNotes();
  for (const contents of readerState.rendition.getContents?.() || []) {
    installBubbleStyles(contents);
    contents.document.querySelectorAll(".mystery-note-bubble").forEach((node) => node.remove());
    const occupied = new Map();
    for (const cluster of clusters) {
      const note = cluster.representative;
      let range;
      try { range = contents.range(note.cfi_range); } catch { continue; }
      const rects = [...(range?.getClientRects?.() || [])].filter((item) => item.width || item.height);
      const rect = rects.at(-1) || range?.getBoundingClientRect?.();
      if (!rect || (!rect.width && !rect.height)) continue;
      const viewportWidth = contents.window.innerWidth || contents.document.documentElement.clientWidth;
      const viewportHeight = contents.window.innerHeight || contents.document.documentElement.clientHeight;
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) continue;
      const row = Math.round(rect.bottom / 22);
      const lane = occupied.get(row) || 0;
      occupied.set(row, lane + 1);
      const button = contents.document.createElement("button");
      button.type = "button";
      button.className = `mystery-note-bubble ${cluster.visibility}`;
      button.dataset.noteId = note.id;
      button.dataset.clusterKey = cluster.key;
      button.textContent = String(Math.min(99, cluster.notes.length));
      button.title = "點兩下開啟這一組局部討論串";
      const replyCount = cluster.notes.reduce((total, item) => total + (item.replies?.length || 0), 0);
      button.setAttribute("aria-label", `${cluster.notes.length} 個局部討論串、${replyCount} 則回覆；點兩下開啟`);
      button.style.left = `${Math.max(4, Math.min(viewportWidth - 28, rect.right - 9 + lane * 26))}px`;
      button.style.top = `${Math.max(5, Math.min(viewportHeight - 24, rect.bottom + 4))}px`;
      button.addEventListener("pointerup", (event) => { event.preventDefault(); event.stopPropagation(); activateBubble(cluster); });
      contents.document.body.append(button);
    }
  }
}

function compareReplies(a, b) {
  if (readerState.replySort === "latest") return new Date(b.created_at) - new Date(a.created_at);
  return Number(b.score || 0) - Number(a.score || 0)
    || Number(b.upCount || 0) - Number(a.upCount || 0)
    || new Date(b.created_at) - new Date(a.created_at);
}

function annotationReplyTree(replies) {
  const nodes = new Map((replies || []).map((reply) => [reply.id, { ...reply, children: [] }]));
  const roots = [];
  for (const reply of nodes.values()) {
    const parent = reply.parent_reply_id ? nodes.get(reply.parent_reply_id) : null;
    if (parent && parent.id !== reply.id) parent.children.push(reply);
    else roots.push(reply);
  }
  const sortBranch = (branch) => branch.sort(compareReplies).map((reply) => ({ ...reply, children: sortBranch(reply.children) }));
  return sortBranch(roots);
}

function annotationReplyMarkup(reply, depth = 0) {
  const votePending = readerState.annotationMutationPending.has(`reply-vote:${reply.id}`);
  return `<article class="thread-note-reply" data-reply-id="${escapeHtml(reply.id)}" style="--reply-depth:${Math.min(depth, 5)}">
    <header><img src="${escapeHtml(avatarFor(reply.author))}" alt=""><strong>${escapeHtml(reply.author?.public_display_name || "讀者")}</strong><time>${new Date(reply.created_at).toLocaleString("zh-TW")}</time></header>
    <p>${escapeHtml(reply.content)}</p>
    <div class="reply-actions"><button type="button" data-reply-vote="up" data-reply-id="${escapeHtml(reply.id)}" class="${reply.viewerVote === "up" ? "active" : ""}" aria-pressed="${reply.viewerVote === "up"}"${votePending ? " disabled" : ""}>▲ ${Number(reply.upCount) || 0}</button><button type="button" data-reply-vote="down" data-reply-id="${escapeHtml(reply.id)}" class="${reply.viewerVote === "down" ? "active down" : "down"}" aria-pressed="${reply.viewerVote === "down"}"${votePending ? " disabled" : ""}>▼ ${Number(reply.downCount) || 0}</button><span>${Number(reply.score) >= 0 ? "+" : ""}${Number(reply.score) || 0}</span><button type="button" data-reply-target="${escapeHtml(reply.id)}" data-reply-author="${escapeHtml(reply.author?.public_display_name || "讀者")}">回覆</button></div>
    ${reply.children.map((child) => annotationReplyMarkup(child, depth + 1)).join("")}
  </article>`;
}

function annotationThreadCard(note) {
  const replies = annotationReplyTree(note.replies || []);
  const compactReplies = window.matchMedia("(max-width: 700px)").matches
    && !readerState.expandedReplyNotes.has(note.id) && (note.replies?.length || 0) > 2;
  const visibleReplies = compactReplies
    ? [...(note.replies || [])].sort(compareReplies).slice(0, 2).map((reply) => ({ ...reply, children: [] }))
    : replies;
  const parentReply = readerState.replyParentId ? note.replies?.find((reply) => reply.id === readerState.replyParentId) : null;
  const votePending = readerState.annotationMutationPending.has(`note-vote:${note.id}`);
  const favoritePending = readerState.annotationMutationPending.has(`note-favorite:${note.id}`);
  const replyPending = readerState.annotationMutationPending.has(`note-reply:${note.id}`);
  const replyDraft = readerState.replyDrafts.get(note.id) || "";
  return `<article class="thread-note ${note.visibility}" data-thread-note-id="${note.id}">
    <div class="thread-note-layout">
      <div class="note-vote-rail" role="group" aria-label="標注評價">
        <button type="button" class="${note.viewerVote === "up" ? "active" : ""}" data-note-vote="up" data-id="${note.id}" aria-label="讚賞，目前 ${Number(note.upCount) || 0} 票"${votePending ? " disabled" : ""}>▲</button>
        <strong aria-label="淨分 ${note.score >= 0 ? "+" : ""}${note.score}">${note.score >= 0 ? "+" : ""}${note.score}</strong>
        <button type="button" class="down ${note.viewerVote === "down" ? "active" : ""}" data-note-vote="down" data-id="${note.id}" aria-label="不讚同，目前 ${Number(note.downCount) || 0} 票"${votePending ? " disabled" : ""}>▼</button>
      </div>
      <div class="thread-note-body">
        <div class="annotation-author"><img src="${escapeHtml(avatarFor(note.author))}" alt=""><strong>${escapeHtml(note.author?.public_display_name || "讀者")}</strong>${["admin", "moderator"].includes(note.author?.role) ? "<em>館員</em>" : ""}<time>${new Date(note.created_at).toLocaleString("zh-TW")}</time></div>
        ${note.quote ? `<blockquote>${escapeHtml(note.quote)}</blockquote>` : ""}
        <p>${escapeHtml(note.content)}</p>
        <div class="note-actions">${note.visibility === "public" ? `<button class="${note.viewerFavorite ? "active" : ""}" data-note-favorite="${note.id}"${favoritePending ? " disabled" : ""}>${note.viewerFavorite ? "♥ 已收藏" : "♡ 收藏"} ${note.favoriteCount}</button>` : '<span>私人標注</span>'}</div>
      </div>
    </div>
    <form class="reply-form thread-reply-form" data-reply-form="${note.id}" data-parent-reply-id="${escapeHtml(parentReply?.id || "")}">${parentReply ? `<div class="reply-parent-context">正在回覆 ${escapeHtml(parentReply.author?.public_display_name || "讀者")}<button type="button" data-cancel-reply>取消</button></div>` : ""}<input maxlength="2000" aria-label="回覆標注" value="${escapeHtml(replyDraft)}" placeholder="${parentReply ? `回覆 ${escapeHtml(parentReply.author?.public_display_name || "讀者")}…` : note.visibility === "private" ? "補充這則私人標注…" : "加入這個討論串…"}"${replyPending ? " disabled" : ""}><button type="submit"${replyPending ? " disabled" : ""}>送出</button></form>
    <div class="thread-note-replies"><div class="thread-reply-heading"><h3>${note.replies?.length || 0} 則${note.visibility === "private" ? "私人補充" : "回覆"}</h3><div role="group" aria-label="回覆排序"><button type="button" data-reply-sort="best" class="${readerState.replySort === "best" ? "active" : ""}" aria-pressed="${readerState.replySort === "best"}">最佳</button><button type="button" data-reply-sort="latest" class="${readerState.replySort === "latest" ? "active" : ""}" aria-pressed="${readerState.replySort === "latest"}">最新</button></div></div><div class="thread-replies-list">${visibleReplies.map((reply) => annotationReplyMarkup(reply)).join("") || '<p class="muted">尚無回覆。</p>'}</div>${compactReplies ? `<button class="thread-replies-expand" type="button" data-toggle-replies="${note.id}">查看全部 ${note.replies.length} 則回覆</button>` : ""}</div>
  </article>`;
}

function annotationClusterForNote(noteId) {
  return annotationClusters().find((cluster) => cluster.notes.some((note) => note.id === noteId)) || null;
}

function openAnnotationThread(noteId, { reset = false } = {}) {
  const selected = readerState.annotations.find((note) => note.id === noteId);
  const cluster = selected ? annotationClusterForNote(noteId) : null;
  if (!selected || !cluster) return;
  if (reset || readerState.activeThreadNoteId !== noteId) {
    readerState.replySort = "best";
    readerState.replyParentId = null;
  }
  readerState.activeThreadNoteId = noteId;
  const pageIndex = cluster.notes.findIndex((note) => note.id === noteId);
  const previousButton = document.getElementById("annotation-thread-previous");
  const nextButton = document.getElementById("annotation-thread-next");
  previousButton.disabled = pageIndex <= 0;
  nextButton.disabled = pageIndex >= cluster.notes.length - 1;
  document.getElementById("annotation-thread-page").textContent = `${pageIndex + 1} / ${cluster.notes.length}`;
  document.getElementById("annotation-thread-content").innerHTML = annotationThreadCard(selected);
  const dialog = document.getElementById("annotation-thread-dialog");
  if (!dialog.open) dialog.showModal();
}

function turnAnnotationThread(direction) {
  if (!readerState.activeThreadNoteId) return;
  const cluster = annotationClusterForNote(readerState.activeThreadNoteId);
  const currentIndex = cluster?.notes.findIndex((note) => note.id === readerState.activeThreadNoteId) ?? -1;
  const nextNote = cluster?.notes[currentIndex + direction];
  if (!nextNote) return;
  openAnnotationThread(nextNote.id, { reset: true });
  document.getElementById("annotation-thread-content").scrollIntoView({ block: "start" });
}

async function loadAnnotations() {
  const requestId = ++readerState.annotationRequestId;
  try {
    const result = await window.libraryApi.get(`/books/${encodeURIComponent(bookId)}/annotations`);
    if (requestId !== readerState.annotationRequestId) return;
    readerState.annotations = result.annotations || [];
    renderAnnotationBubbles();
    if (readerState.activeThreadNoteId && document.getElementById("annotation-thread-dialog").open) openAnnotationThread(readerState.activeThreadNoteId);
    const requested = !readerState.requestedNoteHandled && requestedNoteId && readerState.annotations.find((note) => note.id === requestedNoteId);
    if (requested) {
      readerState.requestedNoteHandled = true;
      try { await readerState.rendition.display(requested.cfi_range); } catch {}
      openAnnotationThread(requested.id);
    }
  } catch (error) {
    if (requestId !== readerState.annotationRequestId) return;
    console.warn("Unable to load annotations.", error);
    toast(error.message, "error");
  }
}

function renderAnnotationState() {
  renderAnnotationBubbles();
  const dialog = document.getElementById("annotation-thread-dialog");
  if (readerState.activeThreadNoteId && dialog?.open) {
    const scrollTop = dialog.scrollTop;
    openAnnotationThread(readerState.activeThreadNoteId);
    dialog.scrollTop = scrollTop;
  }
}

async function saveAnnotationThreshold() {
  if (!window.libraryAuth.user) return;
  try {
    await window.libraryApi.patch("/me/settings", { annotationVisibilityThreshold: readerState.annotationThreshold });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function syncAnnotationThreshold(user = window.libraryAuth.user) {
  let threshold = Number(localStorage.getItem("mystery-library:annotation-threshold") ?? 50);
  if (user) {
    try {
      const result = await window.libraryApi.get("/me/settings");
      threshold = Number(result.settings.annotationVisibilityThreshold ?? 50);
      localStorage.setItem("mystery-library:annotation-threshold", String(threshold));
    } catch (error) {
      console.warn("Unable to load annotation threshold.", error);
    }
  }
  if (!Number.isFinite(threshold)) threshold = 50;
  readerState.annotationThreshold = Math.max(0, Math.min(100, threshold));
  document.getElementById("annotation-threshold").value = String(readerState.annotationThreshold);
  document.getElementById("annotation-threshold-output").value = `${readerState.annotationThreshold}%`;
  renderAnnotationBubbles();
}

function replaceAnnotation(updated) {
  if (!updated?.id) return;
  // A local mutation is newer than any list request that was already in
  // flight, so prevent that older snapshot from overwriting this state.
  readerState.annotationRequestId += 1;
  const index = readerState.annotations.findIndex((note) => note.id === updated.id);
  if (index === -1) readerState.annotations = [...readerState.annotations, updated];
  else readerState.annotations = readerState.annotations.map((note) => note.id === updated.id ? updated : note);
}

function optimisticVote(item, nextVote) {
  let upCount = Number(item?.upCount) || 0;
  let downCount = Number(item?.downCount) || 0;
  if (item?.viewerVote === "up") upCount = Math.max(0, upCount - 1);
  if (item?.viewerVote === "down") downCount = Math.max(0, downCount - 1);
  if (nextVote === "up") upCount += 1;
  if (nextVote === "down") downCount += 1;
  return { ...item, upCount, downCount, score: upCount - downCount, viewerVote: nextVote === "none" ? null : nextVote };
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
    const result = await window.libraryApi.post(`/books/${encodeURIComponent(bookId)}/annotations`, {
      ...readerState.selected,
      content: document.getElementById("annotation-content").value,
      visibility: document.getElementById("annotation-public").checked ? "public" : "private",
    });
    document.getElementById("annotation-dialog").close();
    document.getElementById("selection-action").hidden = true;
    readerState.selected = null;
    replaceAnnotation(result.annotation);
    renderAnnotationState();
    toast("標注已儲存");
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
}

async function voteAnnotation(id, voteType) {
  if (!ensureLogin()) return;
  const pendingKey = `note-vote:${id}`;
  if (readerState.annotationMutationPending.has(pendingKey)) return;
  const note = readerState.annotations.find((item) => item.id === id);
  if (!note) return;
  const nextVote = note.viewerVote === voteType ? "none" : voteType;
  readerState.annotationMutationPending.add(pendingKey);
  replaceAnnotation(optimisticVote(note, nextVote));
  renderAnnotationState();
  try {
    const result = await window.libraryApi.post(`/annotations/${encodeURIComponent(id)}/vote`, { voteType: nextVote });
    replaceAnnotation(result.annotation);
  } catch (error) {
    replaceAnnotation(note);
    window.libraryUX?.recordRollback?.("annotation-vote", error.code);
    toast(error.message, "error");
  }
  finally {
    readerState.annotationMutationPending.delete(pendingKey);
    renderAnnotationState();
  }
}

async function favoriteAnnotation(id) {
  if (!ensureLogin()) return;
  const pendingKey = `note-favorite:${id}`;
  if (readerState.annotationMutationPending.has(pendingKey)) return;
  const note = readerState.annotations.find((item) => item.id === id);
  if (!note) return;
  readerState.annotationMutationPending.add(pendingKey);
  replaceAnnotation({
    ...note,
    viewerFavorite: !note.viewerFavorite,
    favoriteCount: Math.max(0, Number(note.favoriteCount || 0) + (note.viewerFavorite ? -1 : 1)),
  });
  renderAnnotationState();
  try {
    const result = await window.libraryApi.post(`/annotations/${encodeURIComponent(id)}/favorite`);
    replaceAnnotation(result.annotation);
  } catch (error) {
    replaceAnnotation(note);
    window.libraryUX?.recordRollback?.("annotation-favorite", error.code);
    toast(error.message, "error");
  }
  finally {
    readerState.annotationMutationPending.delete(pendingKey);
    renderAnnotationState();
  }
}

async function replyAnnotation(id, content, parentReplyId = null) {
  if (!ensureLogin()) return;
  const pendingKey = `note-reply:${id}`;
  if (readerState.annotationMutationPending.has(pendingKey)) return;
  readerState.annotationMutationPending.add(pendingKey);
  readerState.replyDrafts.set(id, content);
  renderAnnotationState();
  try {
    const result = await window.libraryApi.post(`/annotations/${encodeURIComponent(id)}/replies`, { content: content.trim(), parentReplyId });
    readerState.replyParentId = null;
    readerState.replyDrafts.delete(id);
    replaceAnnotation(result.annotation);
    toast("回覆已送出");
    return true;
  } catch (error) {
    window.libraryUX?.recordRollback?.("annotation-reply", error.code);
    toast(error.message, "error");
    return false;
  }
  finally {
    readerState.annotationMutationPending.delete(pendingKey);
    renderAnnotationState();
    if (readerState.replyDrafts.has(id)) {
      [...document.querySelectorAll("#annotation-thread-content [data-thread-note-id]")]
        .find((node) => node.dataset.threadNoteId === id)
        ?.querySelector(".thread-reply-form input")?.focus();
    }
  }
}

async function voteAnnotationReply(replyId, voteType) {
  if (!ensureLogin()) return;
  const pendingKey = `reply-vote:${replyId}`;
  if (readerState.annotationMutationPending.has(pendingKey)) return;
  const reply = readerState.annotations.flatMap((note) => note.replies || []).find((item) => item.id === replyId);
  const note = readerState.annotations.find((item) => item.replies?.some((candidate) => candidate.id === replyId));
  if (!reply || !note) return;
  const nextVote = reply.viewerVote === voteType ? "none" : voteType;
  readerState.annotationMutationPending.add(pendingKey);
  replaceAnnotation({ ...note, replies: note.replies.map((item) => item.id === replyId ? optimisticVote(item, nextVote) : item) });
  renderAnnotationState();
  try {
    const result = await window.libraryApi.post(`/annotation-replies/${encodeURIComponent(replyId)}/vote`, { voteType: nextVote });
    replaceAnnotation(result.annotation);
  } catch (error) {
    replaceAnnotation(note);
    window.libraryUX?.recordRollback?.("annotation-reply-vote", error.code);
    toast(error.message, "error");
  }
  finally {
    readerState.annotationMutationPending.delete(pendingKey);
    renderAnnotationState();
  }
}

function selectTheme(theme) {
  const nextTheme = applyReaderTheme(theme);
  localStorage.setItem("mystery-library:theme", nextTheme);
}

function wireControls() {
  const previous = () => turnPage("previous");
  const next = () => turnPage("next");
  for (const id of ["previous-page", "footer-prev"]) document.getElementById(id).addEventListener("click", previous);
  for (const id of ["next-page", "footer-next"]) document.getElementById(id).addEventListener("click", next);
  document.addEventListener("keydown", handlePageKey);
  document.getElementById("toc-toggle").addEventListener("click", () => { const panel = document.getElementById("toc-panel"); panel.hidden = !panel.hidden; });
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
    clearTimeout(readerState.annotationThresholdSaveTimer);
    readerState.annotationThresholdSaveTimer = setTimeout(saveAnnotationThreshold, 400);
  });
  threshold.addEventListener("change", () => { clearTimeout(readerState.annotationThresholdSaveTimer); void saveAnnotationThreshold(); });
  document.getElementById("annotation-form").addEventListener("submit", submitAnnotation);
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.dialogClose)?.close()));
  document.getElementById("annotation-thread-previous").addEventListener("click", () => turnAnnotationThread(-1));
  document.getElementById("annotation-thread-next").addEventListener("click", () => turnAnnotationThread(1));
  const threadContent = document.getElementById("annotation-thread-content");
  threadContent.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.target.closest("button, input, a, select, textarea")) return;
    readerState.threadSwipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  });
  threadContent.addEventListener("pointerup", (event) => {
    const swipe = readerState.threadSwipe;
    readerState.threadSwipe = null;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.x;
    const deltaY = event.clientY - swipe.y;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    turnAnnotationThread(deltaX < 0 ? 1 : -1);
  });
  threadContent.addEventListener("pointercancel", () => { readerState.threadSwipe = null; });
  threadContent.addEventListener("input", (event) => {
    const form = event.target.closest("[data-reply-form]");
    if (form && event.target.matches("input")) readerState.replyDrafts.set(form.dataset.replyForm, event.target.value);
  });
  document.getElementById("annotation-thread-content").addEventListener("click", (event) => {
    const toggleReplies = event.target.closest("[data-toggle-replies]");
    if (toggleReplies) { readerState.expandedReplyNotes.add(toggleReplies.dataset.toggleReplies); renderAnnotationState(); return; }
    const vote = event.target.closest("[data-note-vote]");
    if (vote) { voteAnnotation(vote.dataset.id, vote.dataset.noteVote); return; }
    const favorite = event.target.closest("[data-note-favorite]");
    if (favorite) { favoriteAnnotation(favorite.dataset.noteFavorite); return; }
    const replyVote = event.target.closest("[data-reply-vote]");
    if (replyVote) { voteAnnotationReply(replyVote.dataset.replyId, replyVote.dataset.replyVote); return; }
    const sort = event.target.closest("[data-reply-sort]");
    if (sort && readerState.activeThreadNoteId) {
      readerState.replySort = sort.dataset.replySort;
      openAnnotationThread(readerState.activeThreadNoteId);
      return;
    }
    const replyTarget = event.target.closest("[data-reply-target]");
    if (replyTarget && readerState.activeThreadNoteId) {
      const noteCard = replyTarget.closest("[data-thread-note-id]");
      if (noteCard?.dataset.threadNoteId) readerState.activeThreadNoteId = noteCard.dataset.threadNoteId;
      readerState.replyParentId = replyTarget.dataset.replyTarget;
      openAnnotationThread(readerState.activeThreadNoteId);
      [...document.querySelectorAll("#annotation-thread-content [data-thread-note-id]")]
        .find((node) => node.dataset.threadNoteId === readerState.activeThreadNoteId)
        ?.querySelector(".thread-reply-form input")?.focus();
      return;
    }
    if (event.target.closest("[data-cancel-reply]") && readerState.activeThreadNoteId) {
      readerState.replyParentId = null;
      openAnnotationThread(readerState.activeThreadNoteId);
    }
  });
  document.getElementById("annotation-thread-content").addEventListener("submit", async (event) => { const form = event.target.closest("[data-reply-form]"); if (!form) return; event.preventDefault(); const input = form.querySelector("input"); const button = form.querySelector('button[type="submit"]'); if (!input.value.trim()) return; input.disabled = true; button.disabled = true; const sent = await replyAnnotation(form.dataset.replyForm, input.value, form.dataset.parentReplyId || null); if (!sent && form.isConnected) { input.disabled = false; button.disabled = false; input.focus(); } });
  document.getElementById("annotation-thread-dialog").addEventListener("close", () => { readerState.activeThreadNoteId = null; readerState.replyParentId = null; readerState.threadSwipe = null; });
  document.getElementById("reader-login").addEventListener("click", () => { if (window.libraryAuth.user) location.href = "/account.html"; else window.libraryAuth.login(location.href).catch((error) => toast(error.message, "error")); });
  window.addEventListener("library-auth-changed", (event) => { document.getElementById("reader-login").textContent = event.detail.user ? "書房" : "登入"; void syncAnnotationThreshold(event.detail.user); if (readerState.rendition) { loadAnnotations(); if (event.detail.user) persistProgress(); } });
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
    await syncAnnotationThreshold(window.libraryAuth.user);
    const record = await loadBookRecord();
    await initializeEpub(record);
    await loadAnnotations();
    applyReaderTheme(readerState.theme);
    syncAnnotationRealtime(true);
  } catch (error) {
    console.error(error);
    document.getElementById("epub-viewer").innerHTML = `<div class="reader-loading"><span class="loading-mark">!</span><p>${escapeHtml(error.message)}</p><a href="/">回到書庫</a></div>`;
  }
}

initialize();
