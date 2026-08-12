import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, queryCatalog, CATEGORY_OPTIONS } from "../server/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("catalog has unique ids, hashes, and required Chinese metadata", () => {
  const catalog = loadCatalog(path.join(ROOT, "data", "catalog.json"));
  assert.equal(catalog.books.length, 200);
  assert.equal(new Set(catalog.books.map((book) => book.id)).size, 200);
  assert.equal(new Set(catalog.books.map((book) => book.sha256)).size, 200);
  assert.ok(catalog.books.every((book) => book.title_zh && book.description_zh && book.epub_url && book.cover_url));
});

test("catalog supports bilingual search and fixed category taxonomy", () => {
  const catalog = loadCatalog(path.join(ROOT, "data", "catalog.json"));
  assert.ok(queryCatalog(catalog, { query: "Sherlock Holmes" }).length > 0);
  assert.ok(queryCatalog(catalog, { query: "福爾摩斯" }).length > 0);
  assert.equal(CATEGORY_OPTIONS.length, 8);
  assert.equal(queryCatalog(catalog, { category: "Literature" }).length, 200);
});
