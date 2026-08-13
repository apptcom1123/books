import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("runtime starts with only the two existing NEXT_PUBLIC Supabase variables", async () => {
  const original = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  const app = await createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const health = await healthResponse.json();
    const config = await fetch(`http://127.0.0.1:${port}/api/auth/config`).then((response) => response.json());
    assert.equal(health.status, "ok");
    assert.equal(health.catalogBooks, 200);
    assert.match(healthResponse.headers.get("x-request-id"), /^[0-9a-f-]{36}$/i);
    assert.equal(config.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(config.supabasePublishableKey, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = original;
  }
});

test("runtime code has no secret-key dependency and database authorization is RLS-first", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "server", "app.js"), "utf8");
  const middlewareSource = fs.readFileSync(path.join(ROOT, "server", "middleware", "auth.js"), "utf8");
  const browserAuthSource = fs.readFileSync(path.join(ROOT, "public", "auth.js"), "utf8");
  const browserApiSource = fs.readFileSync(path.join(ROOT, "public", "api.js"), "utf8");
  const schema = fs.readFileSync(path.join(ROOT, "server", "db", "library-schema.sql"), "utf8");
  const publicReadMigration = fs.readFileSync(path.join(ROOT, "server", "db", "migrations", "20260813_fix_public_read_policies.sql"), "utf8");
  const socialAuditMigration = fs.readFileSync(path.join(ROOT, "server", "db", "migrations", "20260813_social_platform_audit.sql"), "utf8");
  const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.doesNotMatch(`${appSource}\n${middlewareSource}\n${envExample}`, /SUPABASE_SERVICE|service_role|sb_secret/);
  assert.match(browserAuthSource, /redirectTo:\s*`\$\{location\.origin\}\/`/);
  assert.doesNotMatch(browserAuthSource, /redirectTo:[^\n]*localhost/);
  assert.match(appSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(appSource, /X-Request-Id/);
  assert.match(browserApiSource, /error\.status === 401[\s\S]*refreshSession\(\)/);
  assert.match(schema, /create policy book_ratings_own_insert/i);
  assert.match(schema, /create policy book_annotations_visible_read/i);
  assert.match(schema, /create policy book_annotations_own_read[\s\S]*?to authenticated/i);
  assert.match(schema, /create policy book_annotation_replies_own_read[\s\S]*?to authenticated/i);
  assert.match(schema, /create policy book_annotation_replies_author_read[\s\S]*?author_id = auth\.uid\(\)::text/i);
  assert.match(schema, /library_annotation_reply_parent_is_valid\(parent_reply_id, annotation_id\)/i);
  assert.doesNotMatch(schema, /create policy book_annotation_replies_own_insert[\s\S]{0,900}select 1 from public\.book_annotation_replies parent/i);
  assert.match(schema, /create policy book_annotations_visible_read[\s\S]*?visibility = 'public'/i);
  assert.doesNotMatch(schema, /create policy book_annotations_visible_read[\s\S]{0,240}library_user_is_active/i);
  assert.match(publicReadMigration, /begin;[\s\S]*book_annotations_visible_read[\s\S]*book_annotation_replies_own_read[\s\S]*commit;/i);
  assert.match(socialAuditMigration, /begin;[\s\S]*anchor_offset_start[\s\S]*get_library_feedback_root_page[\s\S]*commit;/i);
  assert.match(schema, /grant insert \(id, book_id, author_id, chapter_href, cfi_range, anchor_offset_start, anchor_offset_end, cluster_key, quote, content, visibility\) on public\.book_annotations to authenticated/i);
  assert.match(schema, /create policy library_notifications_own_read/i);
  assert.match(schema, /create policy library_feedback_own_read[\s\S]*?author_id = auth\.uid\(\)::text/i);
  assert.match(schema, /create policy library_user_settings_own_update/i);
  assert.match(schema, /create trigger library_notify_annotation_favorite/i);
  assert.match(schema, /create trigger library_notify_review_like/i);
  assert.match(schema, /create or replace function public\.update_library_profile\(p_public_display_name text\)/i);
  assert.match(schema, /on conflict on constraint users_pkey do update/i);
  assert.doesNotMatch(schema, /on conflict \(id\) do update[\s\S]*?insert into public\.library_user_settings/i);
  assert.match(schema, /create or replace function public\.record_book_open\(p_book_id text, p_reader_key text\)/i);
  assert.match(schema, /grant execute on function public\.get_book_public_metrics\(text\[\]\) to anon, authenticated/i);
  assert.doesNotMatch(schema, /grant .* to service_role/i);
  assert.doesNotMatch(schema, /grant insert[^;]*library_notifications[^;]*to authenticated/i);
});

test("generated SQL seed contains all 200 public-domain catalog rows", () => {
  const seed = fs.readFileSync(path.join(ROOT, "server", "db", "library-seed.sql"), "utf8");
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  assert.equal(catalog.length, 200);
  for (const book of catalog) assert.ok(seed.includes(`'${book.id.replaceAll("'", "''")}'`), `seed missing ${book.id}`);
  assert.match(seed, /to_regclass\('public\.library_books'\)/i);
  assert.match(seed, /LIBRARY_SCHEMA_REQUIRED/i);
  assert.match(seed, /on conflict \(id\) do update/i);
});
