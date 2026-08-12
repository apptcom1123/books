import crypto from "node:crypto";

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
      .from("book_public_metrics")
      .select("book_id,reader_count,rating_count,average_rating,favorite_count,annotation_count")
      .in("book_id", ids)));
    for (const result of results) if (result.error) throw result.error;
    return new Map(results.flatMap((result) => result.data || []).map((row) => [row.book_id, {
      readerCount: number(row.reader_count),
      ratingCount: number(row.rating_count),
      averageRating: number(row.average_rating),
      favoriteCount: number(row.favorite_count),
      annotationCount: number(row.annotation_count),
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
      p_user_id: userId,
    });
    if (error) throw error;
    return this.getBook(bookId, userId);
  }

  async setRating(bookId, userId, rating) {
    this.requireBook(bookId);
    if (rating === 0) {
      const { error } = await this.db.from("book_ratings").delete().eq("book_id", bookId).eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await this.db.from("book_ratings").upsert({
        book_id: bookId,
        user_id: userId,
        rating,
        updated_at: new Date().toISOString(),
      }, { onConflict: "book_id,user_id" });
      if (error) throw error;
    }
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
      .select("*")
      .eq("book_id", bookId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    query = userId ? query.or(`visibility.eq.public,author_id.eq.${userId}`) : query.eq("visibility", "public");
    const { data, error } = await query;
    if (error) throw error;
    return this.hydrateAnnotations(data || [], userId);
  }

  async hydrateAnnotations(annotations, userId) {
    const ids = annotations.map((annotation) => annotation.id);
    if (!ids.length) return [];
    const [votesResult, repliesResult] = await Promise.all([
      this.db.from("book_annotation_votes").select("annotation_id,user_id,vote_type").in("annotation_id", ids),
      this.db.from("book_annotation_replies").select("*").in("annotation_id", ids).eq("status", "active").order("created_at", { ascending: true }),
    ]);
    if (votesResult.error) throw votesResult.error;
    if (repliesResult.error) throw repliesResult.error;
    const replies = repliesResult.data || [];
    const profiles = await this.userRepository.publicProfiles([
      ...annotations.map((item) => item.author_id),
      ...replies.map((item) => item.author_id),
    ]);
    const votesByAnnotation = new Map(ids.map((id) => [id, []]));
    for (const vote of votesResult.data || []) votesByAnnotation.get(vote.annotation_id)?.push(vote);
    const repliesByAnnotation = new Map(ids.map((id) => [id, []]));
    for (const reply of replies) {
      repliesByAnnotation.get(reply.annotation_id)?.push({
        ...reply,
        author: profiles.get(reply.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: reply.author_id === userId,
      });
    }
    return annotations.map((annotation) => {
      const votes = votesByAnnotation.get(annotation.id) || [];
      return {
        ...annotation,
        author: profiles.get(annotation.author_id) || { public_display_name: "讀者", role: "user" },
        isOwner: annotation.author_id === userId,
        score: votes.reduce((sum, vote) => sum + (vote.vote_type === "up" ? 1 : -1), 0),
        viewerVote: votes.find((vote) => vote.user_id === userId)?.vote_type || null,
        replies: repliesByAnnotation.get(annotation.id) || [],
      };
    });
  }

  async createAnnotation(bookId, userId, input) {
    this.requireBook(bookId);
    const payload = {
      id: crypto.randomUUID(),
      book_id: bookId,
      author_id: userId,
      chapter_href: cleanText(input.chapterHref, 600),
      cfi_range: cleanText(input.cfiRange, 1400),
      quote: cleanText(input.quote, 600),
      content: cleanText(input.content, 2000),
      visibility: input.visibility === "private" ? "private" : "public",
    };
    if (!payload.cfi_range || !payload.content) throw Object.assign(new Error("INVALID_ANNOTATION"), { status: 400 });
    const { data, error } = await this.db.from("book_annotations").insert(payload).select("*").single();
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
    const { data: existing, error: existingError } = await this.db
      .from("book_annotation_votes")
      .select("vote_type")
      .eq("annotation_id", annotationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;
    const remove = voteType === "none" || existing?.vote_type === voteType;
    const operation = remove
      ? this.db.from("book_annotation_votes").delete().eq("annotation_id", annotationId).eq("user_id", userId)
      : this.db.from("book_annotation_votes").upsert({ annotation_id: annotationId, user_id: userId, vote_type: voteType, updated_at: new Date().toISOString() }, { onConflict: "annotation_id,user_id" });
    const { error } = await operation;
    if (error) throw error;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === annotationId);
  }

  async replyToAnnotation(annotationId, userId, input) {
    const content = cleanText(input.content, 2000);
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
    const { error } = await this.db.from("book_annotation_replies").insert({
      id: crypto.randomUUID(),
      annotation_id: annotationId,
      author_id: userId,
      parent_reply_id: input.parentReplyId || null,
      content,
    });
    if (error) throw error;
    return (await this.listAnnotations(annotation.book_id, userId)).find((item) => item.id === annotationId);
  }

  async listFeedback(userId = null) {
    const { data, error } = await this.db
      .from("library_feedback")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = data || [];
    const profiles = await this.userRepository.publicProfiles(rows.map((row) => row.author_id));
    return rows.map((row) => ({
      ...row,
      author: profiles.get(row.author_id) || { public_display_name: "讀者", role: "user" },
      isOwner: row.author_id === userId,
    }));
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
    const { error } = await this.db.from("library_feedback").insert({
      id: crypto.randomUUID(),
      author_id: userId,
      parent_id: input.parentId || null,
      book_id: input.bookId || null,
      subject: input.parentId ? null : subject || "讀者建議",
      content,
    });
    if (error) throw error;
    return this.listFeedback(userId);
  }
}
