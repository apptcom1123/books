import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/books/:bookId/annotations", async (req, res, next) => {
  try {
    const annotations = await req.repositories.library.listAnnotations(req.params.bookId, req.user?.userId);
    res.json({ annotations, count: annotations.length });
  } catch (error) {
    next(error);
  }
});

router.post("/books/:bookId/annotations", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.createAnnotation(req.params.bookId, req.user.userId, req.body || {});
    res.status(201).json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.post("/annotations/:annotationId/vote", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.voteAnnotation(req.params.annotationId, req.user.userId, req.body?.voteType);
    res.json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.post("/annotations/:annotationId/replies", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.replyToAnnotation(req.params.annotationId, req.user.userId, req.body || {});
    res.status(201).json({ annotation });
  } catch (error) {
    next(error);
  }
});

export default router;
