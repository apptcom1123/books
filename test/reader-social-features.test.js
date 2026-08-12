import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  assert.match(script, /thread\.replies\.flatMap/);
  assert.match(script, /terms\.every/);
  assert.match(script, /data-feedback-vote="up"/);
  assert.match(script, /data-feedback-vote="down"/);
  assert.doesNotMatch(script, /data-feedback-favorite/);
  assert.match(routes, /\/:feedbackId\/vote/);
  assert.match(schema, /create table if not exists public\.library_feedback_votes/);
  assert.match(schema, /create or replace function public\.get_library_feedback_vote_stats/);
});

test("annotation creation waits for an explicit selection action", () => {
  const html = read("public/reader.html");
  const script = read("public/reader.js");
  assert.match(html, /id="selection-action"[^>]*hidden>＋ 增加標注/);
  assert.match(script, /readerState\.rendition\.on\("selected"/);
  assert.match(script, /action\.hidden = false/);
  assert.doesNotMatch(script, /readerState\.rendition\.on\("selected"[\s\S]{0,500}annotation-dialog"\)\.showModal/);
  assert.match(script, /getElementById\("selection-action"\)\.addEventListener\("click"/);
});

test("annotation bubbles use thresholded fusion ranking and cloud interactions", () => {
  const html = read("public/reader.html");
  const script = read("public/reader.js");
  const routes = read("server/routes/annotations.js");
  const schema = read("server/db/library-schema.sql");
  assert.match(html, /id="annotation-threshold"/);
  assert.match(html, /id="annotation-thread-dialog"/);
  assert.match(script, /function visibleBubbleNotes/);
  assert.match(script, /function fusedAnnotationOrder/);
  assert.match(script, /mystery-note-bubble/);
  assert.match(script, /annotationVisibilityThreshold/);
  assert.match(routes, /annotation-replies\/:replyId\/vote/);
  assert.match(routes, /reviews\/:reviewId\/favorite/);
  assert.match(schema, /create table if not exists public\.book_annotation_reply_votes/);
  assert.match(schema, /create table if not exists public\.book_review_favorites/);
  assert.match(schema, /create policy book_annotation_votes_own_read/);
  assert.match(schema, /tg_table_name = 'book_annotation_votes'[\s\S]*?v_visibility = 'private'/);
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
