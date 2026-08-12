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
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    const config = await fetch(`http://127.0.0.1:${port}/api/auth/config`).then((response) => response.json());
    assert.equal(health.status, "ok");
    assert.equal(health.catalogBooks, 200);
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
  const schema = fs.readFileSync(path.join(ROOT, "server", "db", "library-schema.sql"), "utf8");
  const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.doesNotMatch(`${appSource}\n${middlewareSource}\n${envExample}`, /SUPABASE_SERVICE|service_role|sb_secret/);
  assert.match(appSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(schema, /create policy book_ratings_own_insert/i);
  assert.match(schema, /create policy book_annotations_visible_read/i);
  assert.match(schema, /create or replace function public\.record_book_open\(p_book_id text, p_reader_key text\)/i);
  assert.match(schema, /grant execute on function public\.get_book_public_metrics\(text\[\]\) to anon, authenticated/i);
  assert.doesNotMatch(schema, /grant .* to service_role/i);
});

test("generated SQL seed contains all 200 public-domain catalog rows", () => {
  const seed = fs.readFileSync(path.join(ROOT, "server", "db", "library-seed.sql"), "utf8");
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  assert.equal(catalog.length, 200);
  for (const book of catalog) assert.ok(seed.includes(`'${book.id.replaceAll("'", "''")}'`), `seed missing ${book.id}`);
  assert.match(seed, /on conflict \(id\) do update/i);
});
