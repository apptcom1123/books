import express from "express";

const router = express.Router();
const TOPIC_PATTERN = /^(?:book:([A-Za-z0-9_-]{1,180}):activity|user:([A-Za-z0-9_-]{1,180}):notifications|catalog:activity|feedback:activity)$/;
const catchupWindows = new Map();

function limitCatchupRequests(req, res, next) {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || "unknown");
  const current = catchupWindows.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
  bucket.count += 1;
  catchupWindows.set(key, bucket);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("RateLimit-Limit", "120");
  res.setHeader("RateLimit-Remaining", String(Math.max(0, 120 - bucket.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (catchupWindows.size > 5_000) {
    for (const [address, window] of catchupWindows) if (window.resetAt <= now) catchupWindows.delete(address);
    while (catchupWindows.size > 5_000) catchupWindows.delete(catchupWindows.keys().next().value);
  }
  if (bucket.count > 120) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: "REALTIME_CATCHUP_RATE_LIMITED", message: "同步要求過於頻繁，請稍後再試。" });
  }
  next();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

router.get("/events", limitCatchupRequests, async (req, res, next) => {
  try {
    const topic = String(req.query.topic || "");
    const match = topic.match(TOPIC_PATTERN);
    if (!match) return res.status(400).json({ error: "INVALID_REALTIME_TOPIC", message: "即時更新主題格式不正確。" });

    const bookId = match[1] || null;
    const userId = match[2] || null;
    if (bookId && !req.app.locals.catalog.byId.has(bookId)) {
      return res.status(404).json({ error: "BOOK_NOT_FOUND", message: "找不到指定的館藏。" });
    }
    if (userId && req.user?.userId !== userId) {
      return res.status(403).json({ error: "REALTIME_TOPIC_FORBIDDEN", message: "你無法讀取這個通知主題。" });
    }

    const hasAfter = req.query.after !== undefined && req.query.after !== "";
    const after = boundedInteger(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
    if (!hasAfter) {
      const { data, error } = await req.supabaseClient.from("library_realtime_events")
        .select("sequence_id").eq("topic", topic).order("sequence_id", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return res.json({ events: [], cursor: Number(data?.sequence_id || 0), hasMore: false });
    }

    const limit = boundedInteger(req.query.limit, 100, 1, 100);
    const { data, error } = await req.supabaseClient.from("library_realtime_events")
      .select("sequence_id,resource,operation,target_id,book_id,emitted_at")
      .eq("topic", topic).gt("sequence_id", after).order("sequence_id", { ascending: true }).limit(limit + 1);
    if (error) throw error;
    const rows = data || [];
    const events = rows.slice(0, limit);
    res.json({
      events,
      cursor: Number(events.at(-1)?.sequence_id || after),
      hasMore: rows.length > limit,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
