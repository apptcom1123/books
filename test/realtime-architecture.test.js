import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("realtime client scopes private topics and protects mobile/background resources", () => {
  const auth = fs.readFileSync(path.join(ROOT, "public", "auth.js"), "utf8");
  const realtime = fs.readFileSync(path.join(ROOT, "public", "realtime.js"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const reader = fs.readFileSync(path.join(ROOT, "public", "reader.js"), "utf8");
  assert.match(auth, /heartbeatIntervalMs:\s*30_000/);
  assert.match(auth, /reconnectAfterMs:[\s\S]*30_000/);
  assert.match(realtime, /book:\$\{bookId\}:activity/);
  assert.match(realtime, /user:\$\{userId\}:notifications/);
  assert.match(realtime, /config:\s*\{\s*private:\s*record\.requiresAuth/);
  assert.match(realtime, /visibilitychange/);
  assert.match(realtime, /background-paused/);
  assert.match(realtime, /fallback-poll/);
  assert.match(realtime, /sequenceId/);
  assert.doesNotMatch(realtime, /postgres_changes/);
  assert.match(home, /reviewDialog\.addEventListener\("close"/);
  assert.match(reader, /syncAnnotationRealtime\(!panel\.hidden\)/);
});

test("database Broadcast uses RLS and compact sequence deltas", () => {
  const schema = fs.readFileSync(path.join(ROOT, "server", "db", "library-schema.sql"), "utf8");
  const route = fs.readFileSync(path.join(ROOT, "server", "routes", "realtime.js"), "utf8");
  assert.match(schema, /create table if not exists public\.library_realtime_events/i);
  assert.match(schema, /perform realtime\.send\(v_payload, 'delta', v_topic, v_user_id is not null\)/i);
  assert.match(schema, /create policy library_realtime_user_broadcast_read on realtime\.messages/i);
  assert.doesNotMatch(schema, /alter table realtime\.messages/i);
  assert.match(schema, /realtime\.topic\(\).*auth\.uid\(\)::text.*notifications/is);
  assert.match(schema, /create policy library_realtime_book_events_read/i);
  assert.match(schema, /emitted_at < now\(\) - interval '7 days'/i);
  assert.match(route, /REALTIME_TOPIC_FORBIDDEN/);
  assert.match(route, /gt\("sequence_id", after\)/);
});
