import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("realtime client scopes private topics and protects mobile/background resources", () => {
  const auth = fs.readFileSync(path.join(ROOT, "public", "auth.js"), "utf8");
  const realtime = fs.readFileSync(path.join(ROOT, "public", "realtime.js"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const reader = fs.readFileSync(path.join(ROOT, "public", "reader.js"), "utf8");
  assert.match(auth, /heartbeatIntervalMs:\s*30_000/);
  assert.match(auth, /reconnectAfterMs:[\s\S]*30_000/);
  assert.match(realtime, /book:\$\{bookId\}:activity/);
  assert.match(realtime, /subscribeCatalog[\s\S]*catalog:activity/);
  assert.match(realtime, /subscribeFeedback[\s\S]*feedback:activity/);
  assert.match(realtime, /user:\$\{userId\}:notifications/);
  assert.match(realtime, /config:\s*\{\s*private:\s*record\.requiresAuth/);
  assert.match(realtime, /visibilitychange/);
  assert.match(realtime, /background-paused/);
  assert.match(realtime, /fallback-poll/);
  assert.match(realtime, /sequenceId/);
  assert.match(realtime, /socketState\(\)/);
  assert.doesNotMatch(realtime, /postgres_changes/);
  assert.match(home, /reviewDialog\.addEventListener\("close"/);
  assert.match(home, /subscribeCatalog/);
  assert.match(home, /\/books\/sync\?ids=/);
  assert.match(home, /catalogRefreshTimer = setTimeout/);
  assert.match(reader, /syncAnnotationRealtime\(true\)/);
  assert.match(reader, /window\.libraryRealtime\.subscribeBook\(bookId/);
  assert.doesNotMatch(reader, /syncAnnotationRealtime\(!panel\.hidden\)/);
});

test("database Broadcast uses RLS and compact sequence deltas", () => {
  const schema = fs.readFileSync(path.join(ROOT, "server", "db", "library-schema.sql"), "utf8");
  const rowFieldMigration = fs.readFileSync(path.join(ROOT, "server", "db", "migrations", "20260813_fix_realtime_trigger_row_fields.sql"), "utf8");
  const route = fs.readFileSync(path.join(ROOT, "server", "routes", "realtime.js"), "utf8");
  const feedback = fs.readFileSync(path.join(ROOT, "public", "feedback.js"), "utf8");
  const feedbackHtml = fs.readFileSync(path.join(ROOT, "public", "feedback.html"), "utf8");
  assert.match(schema, /create table if not exists public\.library_realtime_events/i);
  assert.match(schema, /perform realtime\.send\(v_payload, 'delta', v_topic, v_user_id is not null\)/i);
  assert.match(schema, /create policy library_realtime_user_broadcast_read on realtime\.messages/i);
  assert.doesNotMatch(schema, /alter table realtime\.messages/i);
  assert.match(schema, /realtime\.topic\(\).*auth\.uid\(\)::text.*notifications/is);
  assert.match(schema, /create policy library_realtime_book_events_read/i);
  assert.match(schema, /'catalog:activity'/i);
  assert.match(schema, /'feedback:activity'/i);
  for (const table of ["book_ratings", "book_favorites", "book_reviews", "book_review_likes", "book_review_favorites", "book_annotations", "book_annotation_replies", "book_annotation_reply_votes", "book_annotation_votes", "book_annotation_favorites", "library_feedback", "library_feedback_votes", "library_notifications"]) {
    assert.match(schema, new RegExp(`library_realtime_[\\s\\S]{0,80}on public\\.${table}`, "i"));
  }
  assert.match(schema, /emitted_at < now\(\) - interval '7 days'/i);
  assert.match(schema, /v_catalog_changed boolean := true/i);
  assert.match(schema, /if tg_op = 'UPDATE' then[\s\S]{0,180}to_jsonb\(old\)[\s\S]{0,80}status/i);
  assert.doesNotMatch(schema, /and not \(tg_table_name = 'book_reviews'[\s\S]{0,100}old\.status = new\.status\)/i);
  assert.match(rowFieldMigration, /begin;[\s\S]*v_catalog_changed[\s\S]*commit;/i);
  assert.match(route, /REALTIME_TOPIC_FORBIDDEN/);
  assert.match(route, /REALTIME_CATCHUP_RATE_LIMITED/);
  assert.match(route, /gt\("sequence_id", after\)/);
  assert.match(feedbackHtml, /src="\/realtime\.js"/);
  assert.match(feedback, /subscribeFeedback/);
  assert.match(feedback, /\/feedback\?thread=/);
});

test("realtime catch-up and partial refresh endpoints reject invalid scope before querying data", async () => {
  const app = await createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/realtime/events?topic=bad-topic`),
      fetch(`http://127.0.0.1:${port}/api/realtime/events?topic=user:another-user:notifications`),
      fetch(`http://127.0.0.1:${port}/api/books/sync?ids=`),
      fetch(`http://127.0.0.1:${port}/api/feedback?thread=not-a-thread`),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [400, 403, 400, 400]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
