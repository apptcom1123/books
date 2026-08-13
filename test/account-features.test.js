import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("personal center ships the expected management surfaces", () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "account.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "public", "account.js"), "utf8");
  const routes = fs.readFileSync(path.join(ROOT, "server", "routes", "account.js"), "utf8");
  const repository = fs.readFileSync(path.join(ROOT, "server", "repositories", "UserRepository.js"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  for (const id of ["favorite-books", "reading-books", "my-reviews", "my-annotations", "my-replies", "saved-annotations", "notification-list", "notification-settings-form"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(home, /id="review-dialog"/);
  assert.match(script, /\/me\/notifications\/read-all/);
  assert.match(script, /notifyAnnotationFavorites/);
  assert.match(script, /data-delete-annotation/);
  assert.match(html, /id="account-loading-message"/);
  assert.match(html, /id="notify-all-interactions"/);
  assert.match(script, /function setAccountView/);
  assert.match(script, /setAccountView\("ready"\)/);
  assert.match(script, /data-notification-delete/);
  assert.match(routes, /router\.delete\("\/notifications\/:notificationId"/);
  assert.match(repository, /async notifications\(userId, limit = 30\)/);
  assert.match(repository, /async deleteNotification/);
  assert.match(html, /class="account-activity-shelves"/);
  assert.match(html, /class="activity-shelf"/);
  const css = fs.readFileSync(path.join(ROOT, "public", "account.css"), "utf8");
  assert.match(css, /\.account-gate\[hidden\],#account-content\[hidden\]/);
  assert.match(css, /\.activity-shelf \.activity-list[^}]*overflow-y:auto/);
});

test("personal center API rejects anonymous access", async () => {
  const app = await createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/me`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error, "AUTH_REQUIRED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("library schema contains reviews, saved annotations, preferences and trigger-owned notifications", () => {
  const schema = fs.readFileSync(path.join(ROOT, "server", "db", "library-schema.sql"), "utf8");
  assert.match(schema, /create table if not exists public\.users/i);
  assert.match(schema, /create table if not exists public\.book_reviews/i);
  assert.match(schema, /create table if not exists public\.book_review_likes/i);
  assert.match(schema, /create table if not exists public\.book_annotation_favorites/i);
  assert.match(schema, /create table if not exists public\.library_user_settings/i);
  assert.match(schema, /create table if not exists public\.library_notifications/i);
  assert.match(schema, /security definer[\s\S]*create_library_activity_notification/i);
  assert.match(schema, /v_recipient = v_actor then return new/i);
});
