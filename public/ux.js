(function initializeLibraryUx() {
  const metrics = [];
  const MAX_METRICS = 120;
  const status = document.createElement("div");
  status.className = "network-status";
  status.hidden = navigator.onLine;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.innerHTML = '<span>目前離線；你仍可查看已載入的內容，重新連線後會自動同步。</span><button type="button">重新整理</button>';
  status.querySelector("button").addEventListener("click", () => location.reload());

  const mountStatus = () => {
    if (!status.isConnected) document.body.prepend(status);
  };
  if (document.body) mountStatus();
  else document.addEventListener("DOMContentLoaded", mountStatus, { once: true });

  function updateNetworkState() {
    status.hidden = navigator.onLine;
    document.documentElement.dataset.network = navigator.onLine ? "online" : "offline";
    if (navigator.onLine) window.dispatchEvent(new CustomEvent("library-network-restored"));
  }
  window.addEventListener("online", updateNetworkState);
  window.addEventListener("offline", updateNetworkState);
  updateNetworkState();

  function record(type, detail = {}) {
    metrics.push({ type, at: Date.now(), ...detail });
    if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
  }

  window.addEventListener("library-api-metric", (event) => record("api", event.detail));
  window.addEventListener("library-realtime-health", (event) => record("realtime", event.detail));

  if ("PerformanceObserver" in window) {
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) record("LCP", { value: Math.round(last.startTime) });
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* metric unsupported */ }
    try {
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value;
        record("CLS", { value: Number(cls.toFixed(4)) });
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* metric unsupported */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record("INP", { value: Math.round(entry.duration), name: entry.name });
      }).observe({ type: "event", buffered: true, durationThreshold: 40 });
    } catch { /* metric unsupported */ }
  }

  window.libraryUX = {
    metrics,
    record,
    recordRollback(action, reason) { record("mutation-rollback", { action, reason: reason || "server-rejected" }); },
    setBusy(element, busy, label = "正在更新") {
      if (!element) return;
      element.setAttribute("aria-busy", String(Boolean(busy)));
      if (busy) element.dataset.busyLabel = label;
      else delete element.dataset.busyLabel;
    },
  };
})();
