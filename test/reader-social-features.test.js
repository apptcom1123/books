import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LibraryRepository } from "../server/repositories/LibraryRepository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("reader feedback is a standalone searchable thread surface", () => {
  const homepage = read("public/index.html");
  const page = read("public/feedback.html");
  const script = read("public/feedback.js");
  const routes = read("server/routes/feedback.js");
  const schema = read("server/db/library-schema.sql");
  assert.match(homepage, /href="\/feedback\.html"/);
  assert.doesNotMatch(homepage, /id="feedback-list"/);
  assert.match(page, /id="feedback-search"/);
  assert.match(page, /id="feedback-thread-dialog"/);
  assert.match(script, /feedbackPageEndpoint/);
  assert.match(script, /beforeCreatedAt/);
  assert.match(script, /cachedGet\(endpoint/);
  assert.match(script, /onUpdate: \(updated\)/);
  assert.match(script, /window\.addEventListener\("pagehide"/);
  assert.match(script, /data-feedback-delete/);
  assert.match(script, /data-feedback-vote="up"/);
  assert.match(script, /data-feedback-vote="down"/);
  assert.doesNotMatch(script, /data-feedback-favorite/);
  assert.match(routes, /\/:feedbackId\/vote/);
  assert.match(routes, /router\.delete\("\/:feedbackId"/);
  assert.match(routes, /listFeedbackPage/);
  assert.match(schema, /create table if not exists public\.library_feedback_votes/);
  assert.match(schema, /create or replace function public\.get_library_feedback_vote_stats/);
  assert.match(schema, /create function public\.get_library_feedback_root_page/);
  assert.match(schema, /create policy library_feedback_own_update/);
});

test("annotation creation waits for an explicit selection action", () => {
  const html = read("public/reader.html");
  const script = read("public/reader.js");
  assert.match(html, /id="selection-action"[^>]*hidden>＋ 增加標注/);
  assert.match(script, /readerState\.rendition\.on\("selected"/);
  assert.match(script, /action\.hidden = false/);
  assert.doesNotMatch(script, /readerState\.rendition\.on\("selected"[\s\S]{0,500}annotation-dialog"\)\.showModal/);
  assert.match(script, /getElementById\("selection-action"\)\.addEventListener\("click"/);
  assert.match(script, /function selectionCharacterOffsets/);
  assert.match(script, /before\.toString\(\)\.length/);
  assert.match(script, /anchorOffsetStart: offsets\.start/);
});

test("annotation bubbles aggregate five-position local threads with ranked realtime replies", () => {
  const html = read("public/reader.html");
  const script = read("public/reader.js");
  const css = read("public/reader.css");
  const routes = read("server/routes/annotations.js");
  const repository = read("server/repositories/LibraryRepository.js");
  const schema = read("server/db/library-schema.sql");
  assert.match(html, /id="annotation-threshold"/);
  assert.match(html, /id="annotation-thread-dialog"/);
  assert.doesNotMatch(html, /id="annotation-panel"/);
  assert.match(script, /function visibleBubbleNotes/);
  assert.match(script, /const ANNOTATION_CLUSTER_SIZE = 5/);
  assert.match(script, /function annotationClusterDescriptor/);
  assert.match(script, /function annotationClusters/);
  assert.match(script, /Math\.floor\(Number\(storedStart\) \/ ANNOTATION_CLUSTER_SIZE\)/);
  assert.match(script, /function compareAnnotationRank/);
  assert.match(script, /function compareReplies/);
  assert.match(script, /function annotationReplyTree/);
  assert.match(script, /mystery-note-bubble/);
  assert.match(script, /annotationVisibilityThreshold/);
  assert.match(script, /rect\.bottom \+ 4/);
  assert.match(script, /innerHTML = annotationThreadCard\(selected\)/);
  assert.match(script, /cluster\.notes\.length/);
  assert.match(script, /function turnAnnotationThread/);
  assert.match(script, /annotation-thread-previous/);
  assert.match(script, /annotation-thread-next/);
  assert.match(script, /threadContent\.addEventListener\("pointerup"/);
  assert.match(script, /note-vote-rail/);
  assert.match(css, /\.note-vote-rail[^{]*\{/);
  assert.match(css, /\.thread-reply-form[^}]*position:sticky/);
  assert.match(script, /data-toggle-replies/);
  assert.match(script, /setTimeout\(saveAnnotationThreshold, 400\)/);
  assert.match(script, /await window\.libraryApi\.patch\("\/me\/settings"/);
  assert.doesNotMatch(html, /annotation-thread-rank/);
  assert.doesNotMatch(script, /起始位置第/);
  assert.match(script, /data-reply-sort="best"/);
  assert.match(script, /subscribeBook\(bookId/);
  assert.doesNotMatch(script, /annotations\.highlight/);
  assert.doesNotMatch(script, /function renderHighlights/);
  assert.doesNotMatch(script, /function fusedAnnotationOrder/);
  assert.doesNotMatch(script, /Math\.floor\(anchor \/ 20\)/);
  assert.match(routes, /annotation-replies\/:replyId\/vote/);
  assert.match(routes, /reviews\/:reviewId\/favorite/);
  assert.match(repository, /cluster_key: Math\.floor\(anchorOffsetStart \/ ANNOTATION_CLUSTER_SIZE\)/);
  assert.match(schema, /anchor_offset_start integer/);
  assert.match(schema, /anchor_offset_end integer/);
  assert.match(schema, /cluster_key integer/);
  assert.match(schema, /cluster_key = floor\(anchor_offset_start \/ 5\.0\)::integer/);
  assert.match(schema, /create table if not exists public\.book_annotation_reply_votes/);
  assert.match(schema, /create table if not exists public\.book_review_favorites/);
  assert.match(schema, /create policy book_annotation_votes_own_read/);
  assert.match(schema, /returns table \(reply_id text, score bigint, up_count bigint, down_count bigint, viewer_vote text\)/);
  assert.match(schema, /parent\.annotation_id = p_annotation_id/);
  assert.match(schema, /tg_table_name = 'book_annotation_votes'[\s\S]*?v_visibility = 'private'/);
});

test("text reviews stay separate from book star ratings and mobile lists stay compact", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");
  const account = read("public/account.html");
  const routes = read("server/routes/books.js");
  const smoke = read("scripts/authenticated-smoke.js");
  assert.doesNotMatch(html, /id="review-rating"/);
  assert.doesNotMatch(account, /id="activity-rating"/);
  assert.match(app, /function stableSocialSample/);
  assert.match(app, /data-review-expand/);
  assert.doesNotMatch(app, /reviewRating/);
  assert.doesNotMatch(routes, /發表評論時請選擇/);
  assert.doesNotMatch(routes, /router\.put\("\/:bookId\/review"[\s\S]{0,700}\.setRating/);
  assert.match(smoke, /\/review`, \{ content: marker \}/);
});

test("source dossiers reveal once without making JavaScript a visibility dependency", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");
  const css = read("public/styles.css");
  assert.match(html, /id="source-info"[^>]*data-source-reveal/);
  assert.match(app, /function initializeSourceReveal/);
  assert.match(app, /new IntersectionObserver/);
  assert.match(app, /observer\.disconnect\(\)/);
  assert.match(css, /source-reveal-ready:not\(\.is-revealed\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /source-reveal-ready/);
});

test("annotation cluster keys are derived from trusted five-position offsets", async () => {
  let inserted = null;
  const db = {
    from(table) {
      assert.equal(table, "book_annotations");
      return {
        insert(payload) {
          inserted = payload;
          return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
        },
      };
    },
  };
  const repository = new LibraryRepository(db, { byId: new Map([["book-1", { id: "book-1" }]]) }, {});
  repository.hydrateAnnotations = async (rows) => rows;
  await repository.createAnnotation("book-1", "user-1", {
    chapterHref: "chapter.xhtml",
    cfiRange: "epubcfi(/6/2!/4/2,/1:14,/1:18)",
    quote: "example",
    content: "local thread",
    visibility: "public",
    anchorOffsetStart: 14,
    anchorOffsetEnd: 21,
    clusterKey: 999,
  });
  assert.equal(inserted.anchor_offset_start, 14);
  assert.equal(inserted.anchor_offset_end, 21);
  assert.equal(inserted.cluster_key, 2);
  await assert.rejects(() => repository.createAnnotation("book-1", "user-1", {
    cfiRange: "epubcfi(/6/2!/4/2,/1:14,/1:18)",
    content: "missing offsets",
  }), /INVALID_ANNOTATION/);
});

test("progress flushes to cloud and aggregate rating is shown on book cards", () => {
  const reader = read("public/reader.js");
  const app = read("public/app.js");
  const repository = read("server/repositories/LibraryRepository.js");
  const schema = read("server/db/library-schema.sql");
  assert.match(reader, /function persistProgress/);
  assert.match(reader, /keepalive: true/);
  assert.match(reader, /document\.addEventListener\("visibilitychange"/);
  assert.match(reader, /window\.addEventListener\("pagehide"/);
  assert.match(app, /book-rating-summary/);
  assert.match(app, /averageRating/);
  assert.match(app, /ratingCount/);
  assert.match(app, /ratingPending: new Set/);
  assert.match(app, /book\.viewer\.rating = nextRating/);
  assert.match(repository, /rpc\("set_library_book_rating"/);
  assert.match(schema, /create or replace function public\.set_library_book_rating\(p_book_id text, p_rating integer\)/);
  assert.match(schema, /on conflict on constraint book_ratings_pkey do update/);
});

test("reader mutations recover cleanly and repeated theme switches replace one stylesheet", () => {
  const reader = read("public/reader.js");
  const repository = read("server/repositories/LibraryRepository.js");
  assert.match(reader, /id = "mystery-reader-theme"/);
  assert.match(reader, /style\.textContent = READER_THEME_CSS\[theme\]/);
  assert.doesNotMatch(reader, /themes\.select\(theme\)/);
  assert.match(reader, /function optimisticVote/);
  assert.match(reader, /recordRollback\?\.\("annotation-vote"/);
  assert.match(reader, /recordRollback\?\.\("annotation-reply-vote"/);
  assert.match(reader, /finally \{[\s\S]{0,180}annotationMutationPending\.delete\(pendingKey\);[\s\S]{0,80}renderAnnotationState\(\)/);
  assert.match(repository, /async updateOrInsertOwnedRow/);
  assert.match(repository, /async softDeleteOwnedRow/);
  assert.match(repository, /update\(\{ status: "deleted"[\s\S]{0,100}count: "exact"/);
  assert.doesNotMatch(repository, /\.upsert\(/);
});
