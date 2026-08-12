import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));

test("all public catalog assets exist and EPUB hashes match", () => {
  const sourceCounts = new Map();
  for (const book of catalog) {
    sourceCounts.set(book.source, (sourceCounts.get(book.source) || 0) + 1);
    const epub = path.join(ROOT, book.epub_url.replace(/^\/library\//, "library/"));
    const cover = path.join(ROOT, book.cover_url.replace(/^\/library\//, "library/"));
    assert.ok(fs.existsSync(epub), `missing EPUB ${book.id}`);
    assert.ok(fs.existsSync(cover), `missing cover ${book.id}`);
    const content = fs.readFileSync(epub);
    assert.equal(content.subarray(0, 2).toString(), "PK", `invalid EPUB header ${book.id}`);
    assert.equal(crypto.createHash("sha256").update(content).digest("hex"), book.sha256, `hash mismatch ${book.id}`);
  }
  assert.ok(sourceCounts.get("Standard Ebooks") > 0);
  assert.ok(sourceCounts.get("Project Gutenberg") > 0);
});

test("known shared-house pseudonyms and locally unexpired authors are excluded", () => {
  const blocked = /Carolyn Keene|Franklin W\. Dixon|Agatha Christie|Andre Norton|Ellery Queen|Mignon G\. Eberhart|Philip MacDonald/i;
  assert.deepEqual(catalog.filter((book) => blocked.test(book.author)).map((book) => book.title_original), []);
  assert.ok(catalog.every((book) => book.rights_status === "reviewed"));
  assert.ok(catalog.every((book) => Number.isInteger(book.author_death_year) && book.author_death_year <= 1975));
});
