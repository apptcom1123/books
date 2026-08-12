import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const messages = await req.app.locals.repositories.library.listFeedback(req.user?.userId);
    res.json({ messages, count: messages.length });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const messages = await req.app.locals.repositories.library.createFeedback(req.user.userId, req.body || {});
    res.status(201).json({ messages });
  } catch (error) {
    next(error);
  }
});

export default router;
