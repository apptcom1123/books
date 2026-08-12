import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const messages = await req.repositories.library.listFeedback(req.user?.userId);
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
