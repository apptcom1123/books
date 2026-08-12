import express from "express";

const router = express.Router();
const TOPIC_PATTERN = /^(book:([A-Za-z0-9_-]{1,180}):activity|user:([A-Za-z0-9_-]{1,180}):notifications)$/;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

router.get("/events", async (req, res, next) => {
  try {
    const topic = String(req.query.topic || "");
    const match = topic.match(TOPIC_PATTERN);
    if (!match) return res.status(400).json({ error: "INVALID_REALTIME_TOPIC", message: "即時更新主題格式不正確。" });

    const bookId = match[2] || null;
    const userId = match[3] || null;
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
