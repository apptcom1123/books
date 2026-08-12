import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const threadId = String(req.query.thread || "").trim() || null;
    if (threadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId)) {
      return res.status(400).json({ error: "INVALID_FEEDBACK_THREAD", message: "討論串識別碼不正確。" });
    }
    const messages = await req.repositories.library.listFeedback(req.user?.userId, threadId);
    res.json({ messages, count: messages.length });
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
    const message = await req.repositories.library.voteFeedback(req.params.feedbackId, req.user.userId, req.body?.voteType);
    res.json({ message });
  } catch (error) {
    next(error);
  }
});

export default router;
