import crypto from "node:crypto";

const ANNOTATION_CLUSTER_SIZE = 5;
const ANNOTATION_COLUMNS = "id,book_id,author_id,chapter_href,cfi_range,anchor_offset_start,anchor_offset_end,cluster_key,quote,content,visibility,status,created_at,updated_at";
const ANNOTATION_REPLY_COLUMNS = "id,annotation_id,parent_reply_id,author_id,content,status,created_at,updated_at";
const REVIEW_COLUMNS = "id,book_id,author_id,content,status,created_at,updated_at";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function byKey(rows, key) {
  return new Map((rows || []).map((row) => [row[key], row]));
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function batches(values, size = 40) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export class LibraryRepository {
  constructor(db, catalog, userRepository) {
    this.db = db;
    this.catalog = catalog;
    this.userRepository = userRepository;
  }

  requireBook(bookId) {
    const book = this.catalog.byId.get(bookId);
    if (!book) {
      const error = new Error("BOOK_NOT_FOUND");
      error.status = 404;
      throw error;
    }
    return book;
  }

  async metrics(bookIds) {
    if (!bookIds.length) return new Map();
    const results = await Promise.all(batches(bookIds).map((ids) => this.db
      .rpc("get_book_public_metrics", { p_book_ids: ids })));
    for (const result of results) if (result.error) throw result.error;
    return new Map(results.flatMap((result) => result.data || []).map((row) => [row.book_id, {
      readerCount: number(row.reader_count),
      ratingCount: number(row.rating_count),
      averageRating: number(row.average_rating),
      favoriteCount: number(row.favorite_count),
      annotationCount: number(row.annotation_count),
      reviewCount: number(row.review_count),
    }]));
  }

  async viewerState(userId, bookIds) {
    if (!userId || !bookIds.length) return new Map();
    const queryBatches = (table, columns) => Promise.all(batches(bookIds).map((ids) => this.db
      .from(table).select(columns).eq("user_id", userId).in("book_id", ids)));
    const [ratingsResults, favoritesResults, progressResults] = await Promise.all([
      queryBatches("book_ratings", "book_id,rating"),
      queryBatches("book_favorites", "book_id"),
      queryBatches("book_progress", "book_id,cfi,percentage,chapter_href,updated_at"),
    ]);
    for (const result of [...ratingsResults, ...favoritesResults, ...progressResults]) if (result.error) throw result.error;
    const ratings = ratingsResults.flatMap((result) => result.data || []);
    const favorites = favoritesResults.flatMap((result) => result.data || []);
    const progress = progressResults.flatMap((result) => result.data || []);
    const state = new Map(bookIds.map((id) => [id, { rating: 0, isFavorite: false, progress: null }]));
    for (const row of ratings) state.get(row.book_id).rating = number(row.rating);
    for (const row of favorites) state.get(row.book_id).isFavorite = true;
    for (const row of progress) state.get(row.book_id).progress = row;
    return state;
  }

  async decorate(books, userId) {
    const ids = books.map((book) => book.id);
    const [metrics, viewer] = await Promise.all([this.metrics(ids), this.viewerState(userId, ids)]);
    return books.map((book) => ({
      ...book,
      search_text: undefined,
      metrics: metrics.get(book.id) || {
        readerCount: 0,
        ratingCount: 0,
        averageRating: 0,
        favoriteCount: 0,
        annotationCount: 0,
        reviewCount: 0,
      },
      viewer: viewer.get(book.id) || { rating: 0, isFavorite: false, progress: null },
    }));
  }

  async getBook(bookId, userId = null) {
    const [book] = await this.decorate([this.requireBook(bookId)], userId);
    return book;
  }

  async recordRead(bookId, { userId = null, deviceId = "" } = {}) {
    this.requireBook(bookId);
    if (!userId && !/^[a-zA-Z0-9_-]{12,120}$/.test(deviceId)) {
      const error = new Error("INVALID_READER_KEY");
      error.status = 400;
      throw error;
    }
    const readerKey = userId
      ? `user:${userId}`
      : `anon:${crypto.createHash("sha256").update(deviceId).digest("hex")}`;
    const { error } = await this.db.rpc("record_book_open", {
      p_book_id: bookId,
      p_reader_key: readerKey,
    });
    if (error) throw error;
    return this.getBook(bookId, userId);
  }

  async setRating(bookId, userId, rating) {
    this.requireBook(bookId);
    if (!userId) throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
    const { error } = await this.db.rpc("set_library_book_rating", {
      p_book_id: bookId,
      p_rating: rating,
    });
    if (error) throw error;
    return this.getBook(bookId, userId);
  }

  async toggleFavorite(bookId, userId) {
    this.requireBook(bookId);
    const { data: existing, error: findError } = await this.db
      .from("book_favorites")
      .select("book_id")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { error } = await this.db.from("book_favorites").delete().eq("book_id", bookId).eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await this.db.from("book_favorites").insert({ book_id: bookId, user_id: userId });
      if (error) throw error;
    }
    return this.getBook(bookId, userId);
  }

  async saveProgress(bookId, userId, progress) {
    this.requireBook(bookId);
    const percentage = Math.max(0, Math.min(100, number(progress.percentage)));
    const payload = {
      book_id: bookId,
      user_id: userId,
      cfi: cleanText(progress.cfi, 1200),
      chapter_href: cleanText(progress.chapterHref, 600) || null,
      percentage,
      updated_at: new Date().toISOString(),
    };
    if (!payload.cfi) throw Object.assign(new Error("INVALID_PROGRESS"), { status: 400 });
    const { data, error } = await this.db
      .from("book_progress")
      .upsert(payload, { onConflict: "book_id,user_id" })
      .select("book_id,cfi,percentage,chapter_href,updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  async listAnnotations(bookId, userId = null) {
    this.requireBook(bookId);
    let query = this.db
      .from("book_annotations")
      .select(ANNOTATION_COLUMNS)
      .eq("book_id", bookId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(500);
    query = userId ? query.or(`visibility.eq.public,author_id.eq.${userId}`) : query.eq("visibility", "public");
    const { data, error } = await query;
    if (error) throw error;
    return this.hydrateAnnotations(data || [], userId);
  }

  async hydrateAnnotations(annotations, userId) {
    const ids = annotations.map((annotation) => annotation.id);
    if (!ids.length) return [];
    const [votesResult, favoritesResult, repliesResult] = await Promise.all([
      this.db.rpc("get_library_annotation_vote_stats", { p_annotation_ids: ids }),
      this.db.rpc("get_library_annotation_favorite_stats", { p_annotation_ids: ids }),
      this.db.from("book_annotation_replies").select(ANNOTATION_REPLY_COLUMNS).in("annotation_id", ids).eq("status", "active").order("created_at", { ascending: true }).limit(2000),
    ]);
    if (votesResult.error) throw votesResult.error;
    if (favoritesResult.error) throw favoritesResult.error;
    if (repliesResult.error) throw repliesResult.error;
    const replies = repliesResult.data || [];
    const replyVoteResults = replies.length
      ? await Promise.all(batches(replies.map((reply) => reply.id), 500)
        .map((ids) => this.db.rpc("get_library_annotation_reply_vote_stats", { p_reply_ids: ids })))
      : [];
    for (const result of replyVoteResults) if (result.error) throw result.error;
    const profiles = await this.userRepository.publicProfiles([
      ...annotations.map((item) => item.author_id),
      ...replies.map((item) => item.author_id),
    ]);
    const votesByAnnotation = byKey(votesResult.data || [], "annotation_id");
    const favoritesByAnnotation = byKey(favoritesResult.data || [], "annotation_id");
    const repliesByAnnotation = new Map(ids.map((id) => [id, []]));
    const replyVotes = byKey(replyVoteResults.flatMap((result) => result.data || []), "reply_id");
    for (const reply of replies) {
      const interaction = replyVotes.get(reply.id) || { score: 0, up_count: 0, down_count: 0, viewer_vote: null };
      repliesByAnnotation.get(reply.annotation_id)?.push({
        ...reply,
        author: profiles.get(reply.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: reply.author_id === userId,
        score: number(interaction.score),
        upCount: number(interaction.up_count),
        downCount: number(interaction.down_count),
        viewerVote: interaction.viewer_vote || null,
      });
    }
    for (const annotationReplies of repliesByAnnotation.values()) {
      annotationReplies.sort((a, b) => b.score - a.score || b.upCount - a.upCount || new Date(b.created_at) - new Date(a.created_at));
    }
    return annotations.map((annotation) => {
      const votes = votesByAnnotation.get(annotation.id) || { score: 0, up_count: 0, down_count: 0, viewer_vote: null };
      const favorites = favoritesByAnnotation.get(annotation.id) || { favorite_count: 0, viewer_favorite: false };
      return {
        ...annotation,
        author: profiles.get(annotation.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: annotation.author_id === userId,
        score: number(votes.score),
        upCount: number(votes.up_count),
        downCount: number(votes.down_count),
        viewerVote: votes.viewer_vote || null,
        favoriteCount: number(favorites.favorite_count),
        viewerFavorite: Boolean(favorites.viewer_favorite),
        replies: repliesByAnnotation.get(annotation.id) || [],
      };
    });
  }

  async createAnnotation(bookId, userId, input) {
    this.requireBook(bookId);
    const anchorOffsetStart = Number(input.anchorOffsetStart);
    const anchorOffsetEnd = Number(input.anchorOffsetEnd);
    const validOffsets = Number.isSafeInteger(anchorOffsetStart)
      && Number.isSafeInteger(anchorOffsetEnd)
      && anchorOffsetStart >= 0
      && anchorOffsetEnd >= anchorOffsetStart
      && anchorOffsetEnd <= 50_000_000;
    const payload = {
      id: crypto.randomUUID(),
      book_id: bookId,
      author_id: userId,
      chapter_href: cleanText(input.chapterHref, 600),
      cfi_range: cleanText(input.cfiRange, 1400),
      anchor_offset_start: anchorOffsetStart,
      anchor_offset_end: anchorOffsetEnd,
      cluster_key: Math.floor(anchorOffsetStart / ANNOTATION_CLUSTER_SIZE),
      quote: cleanText(input.quote, 600),
      content: cleanText(input.content, 2000),
      visibility: input.visibility === "private" ? "private" : "public",
    };
    if (!payload.cfi_range || !payload.content || !validOffsets) {
      throw Object.assign(new Error("INVALID_ANNOTATION"), { status: 400 });
    }
    const { data, error } = await this.db.from("book_annotations").insert(payload)
      .select(ANNOTATION_COLUMNS).single();
    if (error) throw error;
    return (await this.hydrateAnnotations([data], userId))[0];
  }

  async voteAnnotation(annotationId, userId, voteType) {
    if (!["up", "down", "none"].includes(voteType)) throw Object.assign(new Error("INVALID_VOTE"), { status: 400 });
    const { data: annotation, error: annotationError } = await this.db
      .from("book_annotations")
      .select("id,book_id,visibility,author_id,status")
      .eq("id", annotationId)
      .single();
    if (annotationError) throw annotationError;
    if (annotation.status !== "active" || (annotation.visibility !== "public" && annotation.author_id !== userId)) {
      throw Object.assign(new Error("ANNOTATION_NOT_FOUND"), { status: 404 });
    }
    const remove = voteType === "none";
    const operation = remove
      ? this.db.from("book_annotation_votes").delete().eq("annotation_id", annotationId).eq("user_id", userId)
      : this.db.from("book_annotation_votes").upsert({ annotation_id: annotationId, user_id: userId, vote_type: voteType, updated_at: new Date().toISOString() }, { onConflict: "annotation_id,user_id" });
    const { error } = await operation;
    if (error) throw error;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === annotationId);
  }

  async toggleAnnotationFavorite(annotationId, userId) {
    const { data: annotation, error: annotationError } = await this.db
      .from("book_annotations")
      .select("id,book_id,visibility,status")
      .eq("id", annotationId)
      .single();
    if (annotationError || !annotation || annotation.status !== "active" || annotation.visibility !== "public") {
      throw Object.assign(new Error("ANNOTATION_NOT_FOUND"), { status: 404 });
    }
    const { data: existing, error: findError } = await this.db
      .from("book_annotation_favorites")
      .select("annotation_id")
      .eq("annotation_id", annotationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (findError) throw findError;
    const operation = existing
      ? this.db.from("book_annotation_favorites").delete().eq("annotation_id", annotationId).eq("user_id", userId)
      : this.db.from("book_annotation_favorites").insert({ annotation_id: annotationId, user_id: userId });
    const { error } = await operation;
    if (error) throw error;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === annotationId);
  }

  async updateAnnotation(annotationId, userId, input) {
    const content = cleanText(input.content, 2000);
    if (!content) throw Object.assign(new Error("INVALID_ANNOTATION"), { status: 400 });
    const payload = {
      content,
      visibility: input.visibility === "private" ? "private" : "public",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db.from("book_annotations")
      .update(payload).eq("id", annotationId).eq("author_id", userId).eq("status", "active")
      .select(ANNOTATION_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("ANNOTATION_NOT_FOUND"), { status: 404 });
    return (await this.hydrateAnnotations([data], userId))[0];
  }

  async deleteAnnotation(annotationId, userId) {
    const { data, error } = await this.db.from("book_annotations")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", annotationId).eq("author_id", userId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("ANNOTATION_NOT_FOUND"), { status: 404 });
  }

  async replyToAnnotation(annotationId, userId, input) {
    const content = cleanText(input.content, 2000);
    const parentReplyId = cleanText(input.parentReplyId, 100) || null;
    if (!content) throw Object.assign(new Error("INVALID_REPLY"), { status: 400 });
    const { data: annotation, error: annotationError } = await this.db
      .from("book_annotations")
      .select("id,book_id,visibility,author_id,status")
      .eq("id", annotationId)
      .single();
    if (annotationError) throw annotationError;
    if (annotation.status !== "active" || (annotation.visibility !== "public" && annotation.author_id !== userId)) {
      throw Object.assign(new Error("ANNOTATION_NOT_FOUND"), { status: 404 });
    }
    if (parentReplyId) {
      const { data: parent, error: parentError } = await this.db.from("book_annotation_replies")
        .select("id").eq("id", parentReplyId).eq("annotation_id", annotationId).eq("status", "active").maybeSingle();
      if (parentError) throw parentError;
      if (!parent) throw Object.assign(new Error("REPLY_NOT_FOUND"), { status: 404 });
    }
    const { error } = await this.db.from("book_annotation_replies").insert({
      id: crypto.randomUUID(),
      annotation_id: annotationId,
      parent_reply_id: parentReplyId,
      author_id: userId,
      content,
    });
    if (error) throw error;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === annotationId);
  }

  async deleteAnnotationReply(replyId, userId) {
    const { data, error } = await this.db.from("book_annotation_replies")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", replyId).eq("author_id", userId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("REPLY_NOT_FOUND"), { status: 404 });
  }

  async voteAnnotationReply(replyId, userId, voteType) {
    if (!["up", "down", "none"].includes(voteType)) throw Object.assign(new Error("INVALID_VOTE"), { status: 400 });
    const { data: reply, error: replyError } = await this.db.from("book_annotation_replies")
      .select("id,annotation_id,status").eq("id", replyId).single();
    if (replyError || !reply || reply.status !== "active") throw Object.assign(new Error("REPLY_NOT_FOUND"), { status: 404 });
    const operation = voteType === "none"
      ? this.db.from("book_annotation_reply_votes").delete().eq("reply_id", replyId).eq("user_id", userId)
      : this.db.from("book_annotation_reply_votes").upsert({ reply_id: replyId, user_id: userId, vote_type: voteType, updated_at: new Date().toISOString() }, { onConflict: "reply_id,user_id" });
    const { error } = await operation;
    if (error) throw error;
    const { data: annotation, error: annotationError } = await this.db.from("book_annotations").select("book_id").eq("id", reply.annotation_id).single();
    if (annotationError) throw annotationError;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === reply.annotation_id);
  }

  async hydrateReviews(reviews, userId) {
    const ids = reviews.map((review) => review.id);
    if (!ids.length) return [];
    const [profiles, likesResult] = await Promise.all([
      this.userRepository.publicProfiles(reviews.map((review) => review.author_id)),
      this.db.rpc("get_library_review_like_stats", { p_review_ids: ids }),
    ]);
    if (likesResult.error) throw likesResult.error;
    const likes = byKey(likesResult.data || [], "review_id");
    return reviews.map((review) => {
      const interaction = likes.get(review.id) || { like_count: 0, viewer_liked: false, favorite_count: 0, viewer_favorite: false };
      return {
        ...review,
        author: profiles.get(review.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: review.author_id === userId,
        likeCount: number(interaction.like_count),
        viewerLiked: Boolean(interaction.viewer_liked),
        favoriteCount: number(interaction.favorite_count),
        viewerFavorite: Boolean(interaction.viewer_favorite),
      };
    });
  }

  async listReviews(bookId, userId = null) {
    this.requireBook(bookId);
    const { data, error } = await this.db.from("book_reviews").select(REVIEW_COLUMNS)
      .eq("book_id", bookId).eq("status", "active").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return this.hydrateReviews(data || [], userId);
  }

  async saveReview(bookId, userId, input) {
    this.requireBook(bookId);
    const content = cleanText(input.content, 4000);
    if (!content) throw Object.assign(new Error("INVALID_REVIEW"), { status: 400 });
    const { data: existing, error: findError } = await this.db.from("book_reviews")
      .select("id").eq("book_id", bookId).eq("author_id", userId).maybeSingle();
    if (findError) throw findError;
    let result;
    if (existing) {
      result = await this.db.from("book_reviews").update({ content, status: "active", updated_at: new Date().toISOString() })
        .eq("id", existing.id).eq("author_id", userId).select(REVIEW_COLUMNS).single();
    } else {
      result = await this.db.from("book_reviews").insert({ id: crypto.randomUUID(), book_id: bookId, author_id: userId, content })
        .select(REVIEW_COLUMNS).single();
    }
    if (result.error) throw result.error;
    return (await this.hydrateReviews([result.data], userId))[0];
  }

  async deleteReview(reviewId, userId) {
    const { data, error } = await this.db.from("book_reviews")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", reviewId).eq("author_id", userId).eq("status", "active")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("REVIEW_NOT_FOUND"), { status: 404 });
  }

  async toggleReviewLike(reviewId, userId) {
    const { data: review, error: reviewError } = await this.db.from("book_reviews")
      .select(REVIEW_COLUMNS).eq("id", reviewId).eq("status", "active").single();
    if (reviewError) throw reviewError;
    const { data: existing, error: findError } = await this.db.from("book_review_likes")
      .select("review_id").eq("review_id", reviewId).eq("user_id", userId).maybeSingle();
    if (findError) throw findError;
    const operation = existing
      ? this.db.from("book_review_likes").delete().eq("review_id", reviewId).eq("user_id", userId)
      : this.db.from("book_review_likes").insert({ review_id: reviewId, user_id: userId });
    const { error } = await operation;
    if (error) throw error;
    return (await this.hydrateReviews([review], userId))[0];
  }

  async toggleReviewFavorite(reviewId, userId) {
    const { data: review, error: reviewError } = await this.db.from("book_reviews")
      .select(REVIEW_COLUMNS).eq("id", reviewId).eq("status", "active").single();
    if (reviewError) throw reviewError;
    const { data: existing, error: findError } = await this.db.from("book_review_favorites")
      .select("review_id").eq("review_id", reviewId).eq("user_id", userId).maybeSingle();
    if (findError) throw findError;
    const operation = existing
      ? this.db.from("book_review_favorites").delete().eq("review_id", reviewId).eq("user_id", userId)
      : this.db.from("book_review_favorites").insert({ review_id: reviewId, user_id: userId });
    const { error } = await operation;
    if (error) throw error;
    return (await this.hydrateReviews([review], userId))[0];
  }

  async userDashboard(userId) {
    const [favoritesResult, ratingsResult, progressResult, reviewsResult, annotationsResult, repliesResult, savedResult, savedReviewsResult] = await Promise.all([
      this.db.from("book_favorites").select("book_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      this.db.from("book_ratings").select("book_id,rating,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200),
      this.db.from("book_progress").select("book_id,cfi,chapter_href,percentage,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200),
      this.db.from("book_reviews").select(REVIEW_COLUMNS).eq("author_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(200),
      this.db.from("book_annotations").select(ANNOTATION_COLUMNS).eq("author_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(200),
      this.db.from("book_annotation_replies").select(ANNOTATION_REPLY_COLUMNS).eq("author_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(200),
      this.db.from("book_annotation_favorites").select("annotation_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      this.db.from("book_review_favorites").select("review_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    ]);
    for (const result of [favoritesResult, ratingsResult, progressResult, reviewsResult, annotationsResult, repliesResult, savedResult, savedReviewsResult]) {
      if (result.error) throw result.error;
    }
    const savedIds = (savedResult.data || []).map((row) => row.annotation_id);
    const savedReviewIds = (savedReviewsResult.data || []).map((row) => row.review_id);
    const replyAnnotationIds = (repliesResult.data || []).map((row) => row.annotation_id);
    const relatedIds = [...new Set([...savedIds, ...replyAnnotationIds])];
    let relatedAnnotations = [];
    if (relatedIds.length) {
      const { data, error } = await this.db.from("book_annotations").select(ANNOTATION_COLUMNS).in("id", relatedIds).eq("status", "active");
      if (error) throw error;
      relatedAnnotations = data || [];
    }
    let savedReviewRows = [];
    if (savedReviewIds.length) {
      const { data, error } = await this.db.from("book_reviews").select(REVIEW_COLUMNS).in("id", savedReviewIds).eq("status", "active");
      if (error) throw error;
      savedReviewRows = data || [];
    }
    const bookIds = [...new Set([
      ...(favoritesResult.data || []).map((row) => row.book_id),
      ...(ratingsResult.data || []).map((row) => row.book_id),
      ...(progressResult.data || []).map((row) => row.book_id),
      ...(reviewsResult.data || []).map((row) => row.book_id),
      ...(annotationsResult.data || []).map((row) => row.book_id),
      ...relatedAnnotations.map((row) => row.book_id),
      ...savedReviewRows.map((row) => row.book_id),
    ])].filter((id) => this.catalog.byId.has(id));
    const decoratedBooks = bookIds.length
      ? await this.decorate(bookIds.map((id) => this.catalog.byId.get(id)), userId)
      : [];
    const books = new Map(decoratedBooks.map((book) => [book.id, book]));
    const ownReviews = await this.hydrateReviews(reviewsResult.data || [], userId);
    const savedReviews = await this.hydrateReviews(savedReviewRows, userId);
    const ownAnnotations = await this.hydrateAnnotations(annotationsResult.data || [], userId);
    const relatedById = new Map(relatedAnnotations.map((annotation) => [annotation.id, annotation]));
    const savedAnnotations = savedIds.length
      ? await this.hydrateAnnotations(savedIds.map((id) => relatedById.get(id)).filter(Boolean), userId)
      : [];
    return {
      stats: {
        favorites: favoritesResult.data?.length || 0,
        reading: progressResult.data?.length || 0,
        reviews: ownReviews.length,
        annotations: ownAnnotations.length,
      },
      favorites: (favoritesResult.data || []).map((row) => ({ ...row, book: books.get(row.book_id) })).filter((row) => row.book),
      reading: (progressResult.data || []).map((row) => ({ ...row, book: books.get(row.book_id) })).filter((row) => row.book),
      ratings: (ratingsResult.data || []).map((row) => ({ ...row, book: books.get(row.book_id) })).filter((row) => row.book),
      reviews: ownReviews.map((review) => ({ ...review, book: books.get(review.book_id) })).filter((review) => review.book),
      annotations: ownAnnotations.map((annotation) => ({ ...annotation, book: books.get(annotation.book_id) })).filter((annotation) => annotation.book),
      replies: (repliesResult.data || []).map((reply) => {
        const annotation = relatedById.get(reply.annotation_id);
        return { ...reply, annotation, book: annotation ? books.get(annotation.book_id) : null };
      }).filter((reply) => reply.book),
      savedAnnotations: savedAnnotations.map((annotation) => ({ ...annotation, book: books.get(annotation.book_id) })).filter((annotation) => annotation.book),
      savedReviews: savedReviews.map((review) => ({ ...review, book: books.get(review.book_id) })).filter((review) => review.book),
    };
  }

  async listFeedback(userId = null, rootId = null) {
    let query = this.db
      .from("library_feedback")
      .select("id,parent_id,author_id,book_id,subject,content,status,created_at,updated_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);
    if (rootId) query = query.or(`id.eq.${rootId},parent_id.eq.${rootId}`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const [profiles, voteStatsResult] = await Promise.all([
      this.userRepository.publicProfiles(rows.map((row) => row.author_id)),
      rows.length
        ? this.db.rpc("get_library_feedback_vote_stats", { p_feedback_ids: rows.map((row) => row.id) })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (voteStatsResult.error) throw voteStatsResult.error;
    const voteStats = byKey(voteStatsResult.data || [], "feedback_id");
    return rows.map((row) => {
      const interaction = voteStats.get(row.id) || { score: 0, up_count: 0, down_count: 0, viewer_vote: null };
      return {
        ...row,
        author: profiles.get(row.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: row.author_id === userId,
        score: number(interaction.score),
        upCount: number(interaction.up_count),
        downCount: number(interaction.down_count),
        viewerVote: interaction.viewer_vote || null,
      };
    });
  }

  async voteFeedback(feedbackId, userId, voteType) {
    if (!["up", "down", "none"].includes(voteType)) throw Object.assign(new Error("INVALID_VOTE"), { status: 400 });
    const { data: feedback, error: feedbackError } = await this.db
      .from("library_feedback")
      .select("id,parent_id,status")
      .eq("id", feedbackId)
      .maybeSingle();
    if (feedbackError) throw feedbackError;
    if (!feedback || feedback.status !== "active") throw Object.assign(new Error("FEEDBACK_NOT_FOUND"), { status: 404 });
    const operation = voteType === "none"
      ? this.db.from("library_feedback_votes").delete().eq("feedback_id", feedbackId).eq("user_id", userId)
      : this.db.from("library_feedback_votes").upsert({ feedback_id: feedbackId, user_id: userId, vote_type: voteType, updated_at: new Date().toISOString() }, { onConflict: "feedback_id,user_id" });
    const { error } = await operation;
    if (error) throw error;
    return (await this.listFeedback(userId, feedback.parent_id || feedback.id)).find((item) => item.id === feedbackId);
  }

  async createFeedback(userId, input) {
    const content = cleanText(input.content, 2000);
    const subject = cleanText(input.subject, 100);
    if (!content) throw Object.assign(new Error("INVALID_FEEDBACK"), { status: 400 });
    if (input.bookId) this.requireBook(input.bookId);
    if (input.parentId) {
      const { data: parent, error } = await this.db.from("library_feedback").select("id").eq("id", input.parentId).eq("status", "active").single();
      if (error || !parent) throw Object.assign(new Error("FEEDBACK_NOT_FOUND"), { status: 404 });
    }
    const id = crypto.randomUUID();
    const rootId = input.parentId || id;
    const { error } = await this.db.from("library_feedback").insert({
      id,
      author_id: userId,
      parent_id: input.parentId || null,
      book_id: input.bookId || null,
      subject: input.parentId ? null : subject || "讀者建議",
      content,
    });
    if (error) throw error;
    // Return only the affected thread. The browser can merge this stable,
    // server-authoritative slice without downloading every discussion again.
    return this.listFeedback(userId, rootId);
  }
}
