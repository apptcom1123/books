class LibraryRealtime {
  constructor() {
    this.topics = new Map();
    this.recentEvents = new Map();
    this.logs = [];
    this.hiddenPaused = document.hidden;
    this.hiddenTimer = null;
    this.pollTimer = null;
    this.metrics = {
      state: document.hidden ? "paused" : "idle",
      heartbeatStatus: "waiting",
      heartbeatLatencyMs: null,
      lastHeartbeatAt: null,
      lastEventAt: null,
      lastEventLatencyMs: null,
      reconnects: 0,
      errors: 0,
      events: 0,
      duplicates: 0,
      catchups: 0,
      transport: "websocket",
    };
    window.addEventListener("library-realtime-heartbeat", (event) => this.onHeartbeat(event.detail || {}));
    window.addEventListener("library-auth-changed", () => this.sync());
    window.addEventListener("online", () => { this.log("network", "online"); this.sync(true); });
    window.addEventListener("offline", () => { this.log("network", "offline"); this.sync(); });
    document.addEventListener("visibilitychange", () => this.onVisibilityChange());
  }

  validPart(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
  }

  subscribeBook(bookId, listener) {
    if (!this.validPart(bookId)) throw new Error("INVALID_REALTIME_BOOK_ID");
    return this.subscribe(`book:${bookId}:activity`, listener, false);
  }

  subscribeNotifications(listener) {
    const userId = window.libraryAuth?.user?.id;
    if (!this.validPart(userId)) return () => {};
    return this.subscribe(`user:${userId}:notifications`, listener, true);
  }

  subscribe(topic, listener, requiresAuth) {
    if (typeof listener !== "function") throw new Error("INVALID_REALTIME_LISTENER");
    let record = this.topics.get(topic);
    if (!record) {
      record = {
        topic,
        requiresAuth,
        listeners: new Set(),
        channel: null,
        channelStatus: "CLOSED",
        everSubscribed: false,
        generation: 0,
        pending: [],
        flushTimer: null,
        catchingUp: false,
        lastSequence: this.readSequence(topic),
      };
      this.topics.set(topic, record);
    }
    record.listeners.add(listener);
    this.activate(record);
    this.updateStatus();
    return () => {
      record.listeners.delete(listener);
      if (!record.listeners.size) this.removeRecord(record);
    };
  }

  canActivate(record) {
    return Boolean(
      record.listeners.size
      && window.libraryAuth?.client
      && navigator.onLine
      && !this.hiddenPaused
      && (!record.requiresAuth || window.libraryAuth?.user),
    );
  }

  activate(record) {
    if (!this.canActivate(record) || record.channel) return;
    const client = window.libraryAuth.client;
    const generation = ++record.generation;
    record.channelStatus = "JOINING";
    const channel = client.channel(record.topic, {
      config: { private: record.requiresAuth, broadcast: { self: false, ack: false } },
    });
    record.channel = channel;
    channel
      .on("broadcast", { event: "delta" }, (message) => {
        if (record.generation !== generation) return;
        this.receive(record, message?.payload || message, "live");
      })
      .subscribe((status, error) => {
        if (record.generation !== generation || record.channel !== channel) return;
        record.channelStatus = status;
        if (status === "SUBSCRIBED") {
          if (record.everSubscribed) this.metrics.reconnects += 1;
          record.everSubscribed = true;
          this.metrics.transport = "websocket";
          this.log("channel", "subscribed", { topic: record.topic });
          this.catchUp(record, "subscribed");
        } else if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          this.metrics.errors += 1;
          this.log("channel", status.toLowerCase(), { topic: record.topic, error: error?.message || null });
        }
        this.updateStatus();
      });
    this.updateStatus();
  }

  async deactivate(record) {
    const channel = record.channel;
    record.generation += 1;
    record.channel = null;
    record.channelStatus = "CLOSED";
    if (channel && window.libraryAuth?.client) {
      try { await window.libraryAuth.client.removeChannel(channel); } catch {}
    }
    this.updateStatus();
  }

  removeRecord(record) {
    clearTimeout(record.flushTimer);
    this.topics.delete(record.topic);
    this.deactivate(record);
  }

  sync(forceCatchup = false) {
    for (const record of this.topics.values()) {
      if (this.canActivate(record)) {
        this.activate(record);
        if (forceCatchup && record.channelStatus === "SUBSCRIBED") this.catchUp(record, "network-restored");
      } else {
        this.deactivate(record);
      }
    }
    this.updateStatus();
  }

  onVisibilityChange() {
    clearTimeout(this.hiddenTimer);
    if (document.hidden) {
      this.hiddenTimer = setTimeout(() => {
        this.hiddenPaused = true;
        this.log("page", "background-paused");
        this.sync();
      }, 15_000);
      return;
    }
    this.hiddenPaused = false;
    this.log("page", "foreground-resumed");
    this.sync(true);
  }

  onHeartbeat(detail) {
    this.metrics.heartbeatStatus = detail.status || "unknown";
    this.metrics.lastHeartbeatAt = detail.at || Date.now();
    if (Number.isFinite(detail.latency)) this.metrics.heartbeatLatencyMs = detail.latency;
    if (["timeout", "error", "disconnected"].includes(detail.status)) this.metrics.errors += 1;
    this.updateStatus();
  }

  eventKey(record, event) {
    return `${record.topic}:${event.sequenceId || "none"}:${event.resource || "unknown"}:${event.operation || "unknown"}`;
  }

  receive(record, rawEvent, source) {
    const event = {
      version: Number(rawEvent?.version || 1),
      sequenceId: Number(rawEvent?.sequenceId || rawEvent?.sequence_id || 0),
      resource: String(rawEvent?.resource || "unknown"),
      operation: String(rawEvent?.operation || "update"),
      targetId: rawEvent?.targetId || rawEvent?.target_id || null,
      bookId: rawEvent?.bookId || rawEvent?.book_id || null,
      emittedAt: rawEvent?.emittedAt || rawEvent?.emitted_at || null,
      source,
    };
    const key = this.eventKey(record, event);
    if (this.recentEvents.has(key)) {
      this.metrics.duplicates += 1;
      return;
    }
    this.recentEvents.set(key, Date.now());
    if (this.recentEvents.size > 250) this.recentEvents.delete(this.recentEvents.keys().next().value);
    if (event.sequenceId > record.lastSequence) {
      record.lastSequence = event.sequenceId;
      this.writeSequence(record.topic, event.sequenceId);
    }
    this.metrics.events += 1;
    this.metrics.lastEventAt = Date.now();
    if (event.emittedAt) {
      const latency = Date.now() - Date.parse(event.emittedAt);
      if (Number.isFinite(latency) && latency >= 0) this.metrics.lastEventLatencyMs = latency;
    }
    record.pending.push(event);
    if (record.pending.length > 50) record.pending.splice(0, record.pending.length - 50);
    clearTimeout(record.flushTimer);
    record.flushTimer = setTimeout(() => {
      const events = record.pending.splice(0);
      for (const listener of record.listeners) {
        try { listener({ topic: record.topic, events, reason: source }); } catch (error) { console.warn("Realtime listener failed", error); }
      }
    }, 220);
    this.updateStatus();
  }

  async catchUp(record, reason) {
    if (record.catchingUp || !navigator.onLine || document.hidden || !window.libraryAuth?.client) return;
    record.catchingUp = true;
    try {
      const headers = { Accept: "application/json" };
      const token = await window.libraryAuth.token();
      if (token) headers.Authorization = `Bearer ${token}`;
      let page = 0;
      let hasMore = false;
      let eventCount = 0;
      do {
        const query = new URLSearchParams({ topic: record.topic });
        if (record.lastSequence > 0) query.set("after", String(record.lastSequence));
        const response = await fetch(`/api/realtime/events?${query}`, { headers, credentials: "same-origin" });
        if (!response.ok) throw new Error(`REALTIME_CATCHUP_${response.status}`);
        const result = await response.json();
        const events = Array.isArray(result.events) ? result.events : [];
        if (!record.lastSequence && Number(result.cursor) > 0) {
          record.lastSequence = Number(result.cursor);
          this.writeSequence(record.topic, record.lastSequence);
        }
        for (const event of events) this.receive(record, event, "catchup");
        eventCount += events.length;
        hasMore = Boolean(result.hasMore);
        page += 1;
      } while (hasMore && page < 5);
      this.metrics.catchups += 1;
      if (!eventCount || hasMore) {
        for (const listener of record.listeners) {
          try { listener({ topic: record.topic, events: [], reason: hasMore ? "catchup-truncated" : reason }); } catch {}
        }
      }
    } catch (error) {
      this.metrics.errors += 1;
      this.log("catchup", "failed", { topic: record.topic, error: error.message });
    } finally {
      record.catchingUp = false;
      this.updateStatus();
    }
  }

  readSequence(topic) {
    try { return Number(sessionStorage.getItem(`mystery-library:realtime-sequence:${topic}`) || 0); } catch { return 0; }
  }

  writeSequence(topic, sequence) {
    try { sessionStorage.setItem(`mystery-library:realtime-sequence:${topic}`, String(sequence)); } catch {}
  }

  updateStatus() {
    const records = [...this.topics.values()];
    if (!navigator.onLine) this.metrics.state = "offline";
    else if (this.hiddenPaused) this.metrics.state = "paused";
    else if (!records.length) this.metrics.state = "idle";
    else if (records.every((record) => record.channelStatus === "SUBSCRIBED")) this.metrics.state = "healthy";
    else if (records.some((record) => ["CHANNEL_ERROR", "TIMED_OUT"].includes(record.channelStatus))) this.metrics.state = "fallback";
    else this.metrics.state = "connecting";
    this.metrics.activeChannels = records.filter((record) => record.channelStatus === "SUBSCRIBED").length;
    this.metrics.requestedTopics = records.length;
    this.scheduleFallbackPoll();
    window.dispatchEvent(new CustomEvent("library-realtime-status", { detail: this.diagnostics() }));
  }

  scheduleFallbackPoll() {
    clearTimeout(this.pollTimer);
    const shouldPoll = navigator.onLine && !document.hidden && this.topics.size > 0
      && ![...this.topics.values()].every((record) => record.channelStatus === "SUBSCRIBED");
    if (!shouldPoll) return;
    this.pollTimer = setTimeout(() => {
      this.metrics.transport = "http-poll";
      for (const record of this.topics.values()) this.catchUp(record, "fallback-poll");
      this.scheduleFallbackPoll();
    }, 45_000);
  }

  log(kind, message, data = null) {
    this.logs.push({ at: new Date().toISOString(), kind, message, data });
    if (this.logs.length > 50) this.logs.shift();
  }

  diagnostics() {
    return { ...this.metrics, topics: [...this.topics.values()].map((record) => ({ topic: record.topic, status: record.channelStatus, lastSequence: record.lastSequence })), logs: [...this.logs] };
  }
}

window.libraryRealtime = new LibraryRealtime();
