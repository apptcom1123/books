import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/", async (req, res, next) => {
  try {
    const threadId = String(req.query.thread || "").trim() || null;
    if (threadId && !UUID.test(threadId)) {
      return res.status(400).json({ error: "INVALID_FEEDBACK_THREAD", message: "討論串識別碼不正確。" });
    }
    if (threadId) {
      const messages = await req.repositories.library.listFeedback(req.user?.userId, threadId);
      return res.json({ messages, count: messages.length, hasMore: false, cursor: null });
    }
    const limit = Number(req.query.limit || 24);
    const beforeCreatedAt = String(req.query.beforeCreatedAt || "").trim() || null;
    const beforeId = String(req.query.beforeId || "").trim() || null;
    const search = String(req.query.q || "").trim();
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({ error: "INVALID_FEEDBACK_LIMIT", message: "討論載入筆數不正確。" });
    }
    if ((beforeCreatedAt === null) !== (beforeId === null)
      || (beforeId && !UUID.test(beforeId))
      || (beforeCreatedAt && !Number.isFinite(Date.parse(beforeCreatedAt)))) {
      return res.status(400).json({ error: "INVALID_FEEDBACK_CURSOR", message: "討論分頁位置不正確。" });
    }
    if (search.length > 100) return res.status(400).json({ error: "FEEDBACK_SEARCH_TOO_LONG", message: "搜尋文字不可超過 100 字。" });
    const page = await req.repositories.library.listFeedbackPage(req.user?.userId, { limit, beforeCreatedAt, beforeId, search });
    res.json({ ...page, count: page.messages.length });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const messages = await req.repositories.library.createFeedback(req.user.userId, req.body || {});
    res.status(201).json({ messages });
  } catch (error) {
    next(error);
  }
});

router.post("/:feedbackId/vote", requireAuth, async (req, res, next) => {
  try {
    if (!UUID.test(req.params.feedbackId)) return res.status(400).json({ error: "INVALID_FEEDBACK_ID", message: "回饋識別碼不正確。" });
    const message = await req.repositories.library.voteFeedback(req.params.feedbackId, req.user.userId, req.body?.voteType);
    res.json({ message });
  } catch (error) {
    next(error);
  }
});

router.delete("/:feedbackId", requireAuth, async (req, res, next) => {
  try {
    if (!UUID.test(req.params.feedbackId)) return res.status(400).json({ error: "INVALID_FEEDBACK_ID", message: "回饋識別碼不正確。" });
    const deleted = await req.repositories.library.deleteFeedback(req.params.feedbackId, req.user.userId);
    res.json({ success: true, deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
