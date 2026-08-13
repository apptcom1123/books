class LibraryApi {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
    this.cachePrefix = "mystery-library:api-cache:";
  }

  emitMetric(detail) {
    window.dispatchEvent(new CustomEvent("library-api-metric", { detail: { at: Date.now(), ...detail } }));
  }

  userMessage(status, code, fallback) {
    const known = {
      INVALID_ANNOTATION: "標注內容或文字位置不完整，請重新選取文字後再試。",
      INVALID_REPLY: "請先輸入回覆內容。",
      INVALID_FEEDBACK: "請先輸入討論或回覆內容。",
      INVALID_VOTE: "這次評價無法辨識，請重新操作。",
      ANNOTATION_NOT_FOUND: "這則標注已不存在，或你沒有查看權限。",
      REPLY_NOT_FOUND: "這則回覆已不存在，請重新整理討論串。",
      FEEDBACK_NOT_FOUND: "這段討論已不存在，請回到列表重新選擇。",
      USER_INACTIVE: "這個帳號目前無法進行互動，請聯絡管理員。",
      AUTH_REQUIRED: "請重新登入後再試。",
    };
    if (known[code]) return known[code];
    if (code === "REQUEST_TIMEOUT") return "連線逾時，請檢查網路後重試。";
    if (code === "REQUEST_CANCELLED") return "要求已取消。";
    if (!navigator.onLine) return "目前沒有網路連線；已保留畫面上的舊資料。";
    if (status === 401) return "登入狀態已失效，請重新登入後再試。";
    if (status === 403 || code === "42501") return "資料權限未通過；請重新登入，若仍失敗請聯絡管理員。";
    if (status === 404) return "找不到指定的資料。";
    if (status >= 500) return "服務暫時無法完成要求，請稍後再試。";
    if (fallback && fallback !== code) return fallback;
    if (status === 400) return "送出的內容不完整，請檢查後再試。";
    return "要求未完成，請稍後再試。";
  }

  async request(method, endpoint, body, options = {}) {
    const startedAt = performance.now();
    const maxRetries = method === "GET" ? Math.max(0, Math.min(options.retries ?? 2, 2)) : 0;
    let attempt = 0;
    let lastError = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutMs = Math.max(1_000, options.timeoutMs ?? 12_000);
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const abortFromCaller = () => controller.abort();
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        const token = await window.libraryAuth.token();
        if (options.signal?.aborted) controller.abort();
        const headers = { Accept: "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const response = await fetch(`/api${endpoint}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "same-origin",
          signal: controller.signal,
          keepalive: Boolean(options.keepalive),
        });
        const raw = await response.text();
        let result = {};
        try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }
        const durationMs = Math.round(performance.now() - startedAt);
        this.emitMetric({
          endpoint,
          method,
          status: response.status,
          ok: response.ok,
          durationMs,
          payloadBytes: new TextEncoder().encode(raw).byteLength,
          attempt,
        });
        if (!response.ok) {
          const error = new Error(this.userMessage(response.status, result.error, result.message));
          error.status = response.status;
          error.code = result.error;
          error.retryable = response.status >= 500;
          throw error;
        }
        return result;
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        if (error.name === "AbortError") {
          error.code = options.signal?.aborted ? "REQUEST_CANCELLED" : "REQUEST_TIMEOUT";
          error.status = timedOut ? 408 : 0;
          error.message = this.userMessage(error.status, error.code);
          error.retryable = timedOut;
        } else if (!Number.isFinite(error.status)) {
          error.status = 0;
          error.code ||= "NETWORK_ERROR";
          error.message = this.userMessage(0, error.code);
          error.retryable = true;
        }
        lastError = error;
        const canRetry = method === "GET" && error.retryable && error.code !== "REQUEST_CANCELLED" && attempt < maxRetries;
        if (!canRetry) {
          this.emitMetric({
            endpoint,
            method,
            status: error.status || 0,
            ok: false,
            durationMs: Math.round(performance.now() - startedAt),
            payloadBytes: 0,
            attempt,
            errorCode: error.code || "REQUEST_FAILED",
          });
          throw error;
        }
        const waitMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 150);
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        attempt += 1;
      } finally {
        window.clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortFromCaller);
      }
    }
    throw lastError;
  }

  cacheScope(isPrivate) {
    if (!isPrivate) return "public";
    return `private:${window.libraryAuth.user?.id || "anonymous"}`;
  }

  cacheKey(key, isPrivate) {
    return `${this.cacheScope(isPrivate)}:${key}`;
  }

  readCache(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const raw = sessionStorage.getItem(`${this.cachePrefix}${key}`);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      this.cache.set(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  writeCache(key, data) {
    const entry = { storedAt: Date.now(), data };
    this.cache.set(key, entry);
    try { sessionStorage.setItem(`${this.cachePrefix}${key}`, JSON.stringify(entry)); } catch { /* quota/privacy mode */ }
    return data;
  }

  async revalidate(endpoint, key, options, background) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.get(endpoint, { signal: options.signal })
      .then((data) => {
        this.writeCache(key, data);
        if (background) options.onUpdate?.(data);
        return data;
      })
      .catch((error) => {
        if (background) options.onError?.(error);
        else throw error;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async cachedGet(endpoint, options = {}) {
    const key = this.cacheKey(options.key || endpoint, Boolean(options.private));
    const staleTime = Math.max(0, options.staleTime ?? 30_000);
    const maxAge = Math.max(staleTime, options.maxAge ?? 5 * 60_000);
    const entry = this.readCache(key);
    const age = entry ? Date.now() - entry.storedAt : Infinity;
    if (entry && age <= maxAge) {
      this.emitMetric({ endpoint, method: "GET", ok: true, status: 200, durationMs: 0, payloadBytes: 0, cacheHit: true, stale: age > staleTime });
      if (age > staleTime) void this.revalidate(endpoint, key, options, true);
      return entry.data;
    }
    return this.revalidate(endpoint, key, options, false);
  }

  prefetch(endpoint, options = {}) {
    return this.cachedGet(endpoint, { ...options, onUpdate: undefined, onError: undefined }).catch(() => null);
  }

  invalidate(match) {
    const predicate = typeof match === "function" ? match : (key) => key.includes(String(match));
    for (const key of [...this.cache.keys()]) if (predicate(key)) this.cache.delete(key);
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const storageKey = sessionStorage.key(index);
        if (!storageKey?.startsWith(this.cachePrefix)) continue;
        const key = storageKey.slice(this.cachePrefix.length);
        if (predicate(key)) sessionStorage.removeItem(storageKey);
      }
    } catch { /* storage unavailable */ }
  }

  clearPrivateCache() {
    this.invalidate((key) => key.startsWith("private:"));
  }

  get(endpoint, options = {}) { return this.request("GET", endpoint, undefined, options); }
  post(endpoint, body = {}, options = {}) { return this.request("POST", endpoint, body, options); }
  put(endpoint, body = {}, options = {}) { return this.request("PUT", endpoint, body, options); }
  patch(endpoint, body = {}, options = {}) { return this.request("PATCH", endpoint, body, options); }
  delete(endpoint, options = {}) { return this.request("DELETE", endpoint, undefined, options); }
}

window.libraryApi = new LibraryApi();
