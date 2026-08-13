import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

for (const parameter of ["annotationId", "replyId", "reviewId"]) {
  router.param(parameter, (req, res, next, value) => {
    if (!UUID.test(value)) return res.status(400).json({ error: "INVALID_RESOURCE_ID", message: "內容識別碼不正確。" });
    next();
  });
}

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

router.post("/annotations/:annotationId/favorite", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.toggleAnnotationFavorite(req.params.annotationId, req.user.userId);
    res.json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.patch("/annotations/:annotationId", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.updateAnnotation(req.params.annotationId, req.user.userId, req.body || {});
    res.json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.delete("/annotations/:annotationId", requireAuth, async (req, res, next) => {
  try {
    await req.repositories.library.deleteAnnotation(req.params.annotationId, req.user.userId);
    res.json({ success: true });
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

router.delete("/annotation-replies/:replyId", requireAuth, async (req, res, next) => {
  try {
    await req.repositories.library.deleteAnnotationReply(req.params.replyId, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/annotation-replies/:replyId/vote", requireAuth, async (req, res, next) => {
  try {
    const annotation = await req.repositories.library.voteAnnotationReply(req.params.replyId, req.user.userId, req.body?.voteType);
    res.json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.post("/reviews/:reviewId/like", requireAuth, async (req, res, next) => {
  try {
    const review = await req.repositories.library.toggleReviewLike(req.params.reviewId, req.user.userId);
    res.json({ review });
  } catch (error) {
    next(error);
  }
});

router.post("/reviews/:reviewId/favorite", requireAuth, async (req, res, next) => {
  try {
    const review = await req.repositories.library.toggleReviewFavorite(req.params.reviewId, req.user.userId);
    res.json({ review });
  } catch (error) {
    next(error);
  }
});

router.delete("/reviews/:reviewId", requireAuth, async (req, res, next) => {
  try {
    await req.repositories.library.deleteReview(req.params.reviewId, req.user.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
