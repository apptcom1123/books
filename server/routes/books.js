import express from "express";
import { CATEGORY_OPTIONS, queryCatalog } from "../catalog.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function sortBooks(books, sort) {
  const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });
  const sorted = [...books];
  if (sort === "rating") {
    sorted.sort((a, b) => b.metrics.averageRating - a.metrics.averageRating || b.metrics.ratingCount - a.metrics.ratingCount);
  } else if (sort === "title") {
    sorted.sort((a, b) => collator.compare(a.title_zh, b.title_zh));
  } else if (sort === "newest") {
    sorted.sort((a, b) => String(b.edition_release_date).localeCompare(String(a.edition_release_date)));
  } else {
    sorted.sort((a, b) => b.metrics.readerCount - a.metrics.readerCount || b.metrics.favoriteCount - a.metrics.favoriteCount || a.catalog_order - b.catalog_order);
  }
  return sorted;
}

router.get("/", async (req, res, next) => {
  try {
    const limit = boundedInteger(req.query.limit, 48, 1, 200);
    const offset = boundedInteger(req.query.offset, 0, 0, 10_000);
    const matches = queryCatalog(req.app.locals.catalog, {
      query: req.query.q,
      category: req.query.category,
      source: req.query.source,
    });
    const decorated = await req.repositories.library.decorate(matches, req.user?.userId);
    const sorted = sortBooks(decorated, req.query.sort);
    res.json({
      books: sorted.slice(offset, offset + limit),
      pagination: { total: sorted.length, limit, offset, hasMore: offset + limit < sorted.length },
      filters: { categories: CATEGORY_OPTIONS, sources: ["Standard Ebooks", "Project Gutenberg"] },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/sync", async (req, res, next) => {
  try {
    const ids = [...new Set(String(req.query.ids || "").split(",").map((id) => id.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 50 || ids.some((id) => !/^[A-Za-z0-9_-]{1,180}$/.test(id))) {
      return res.status(400).json({ error: "INVALID_BOOK_SYNC_IDS", message: "同步的館藏範圍不正確。" });
    }
    const books = ids.map((id) => req.app.locals.catalog.byId.get(id)).filter(Boolean);
    const decorated = await req.repositories.library.decorate(books, req.user?.userId);
    res.json({ books: decorated });
  } catch (error) {
    next(error);
  }
});

router.get("/:bookId", async (req, res, next) => {
  try {
    const book = await req.repositories.library.getBook(req.params.bookId, req.user?.userId);
    res.json({ book });
  } catch (error) {
    next(error);
  }
});

router.post("/:bookId/read", async (req, res, next) => {
  try {
    const book = await req.repositories.library.recordRead(req.params.bookId, {
      userId: req.user?.userId,
      deviceId: req.body?.deviceId,
    });
    res.json({ success: true, metrics: book.metrics });
  } catch (error) {
    next(error);
  }
});

router.put("/:bookId/rating", requireAuth, async (req, res, next) => {
  try {
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return res.status(400).json({ error: "INVALID_RATING", message: "評分必須是 0 到 5 的整數。" });
    }
    const book = await req.repositories.library.setRating(req.params.bookId, req.user.userId, rating);
    res.json({ success: true, metrics: book.metrics, viewer: book.viewer });
  } catch (error) {
    next(error);
  }
});

router.post("/:bookId/favorite", requireAuth, async (req, res, next) => {
  try {
    const book = await req.repositories.library.toggleFavorite(req.params.bookId, req.user.userId);
    res.json({ success: true, metrics: book.metrics, viewer: book.viewer });
  } catch (error) {
    next(error);
  }
});

router.put("/:bookId/progress", requireAuth, async (req, res, next) => {
  try {
    const progress = await req.repositories.library.saveProgress(req.params.bookId, req.user.userId, req.body || {});
    res.json({ success: true, progress });
  } catch (error) {
    next(error);
  }
});

router.get("/:bookId/reviews", async (req, res, next) => {
  try {
    const reviews = await req.repositories.library.listReviews(req.params.bookId, req.user?.userId);
    res.json({ reviews, count: reviews.length });
  } catch (error) {
    next(error);
  }
});

router.put("/:bookId/review", requireAuth, async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "INVALID_REVIEW", message: "請輸入評論內容。" });
    const review = await req.repositories.library.saveReview(req.params.bookId, req.user.userId, { content });
    const book = await req.repositories.library.getBook(req.params.bookId, req.user.userId);
    res.json({ success: true, review, metrics: book.metrics, viewer: book.viewer });
  } catch (error) {
    next(error);
  }
});

export default router;
