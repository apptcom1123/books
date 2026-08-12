import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(ROOT, "data", "catalog.json");

export const CATEGORY_OPTIONS = Object.freeze([
  "Literature",
  "Science & Technology",
  "History",
  "Social Sciences & Society",
  "Arts & Culture",
  "Religion & Philosophy",
  "Lifestyle & Hobbies",
  "Health & Medicine",
]);

function normalizeSearch(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadCatalog(filePath = CATALOG_PATH) {
  const books = JSON.parse(fs.readFileSync(filePath, "utf8"))
    .filter((book) => book.rights_status === "reviewed" && book.enabled !== false);
  const byId = new Map();
  for (const book of books) {
    if (!book.id || byId.has(book.id)) throw new Error(`Invalid or duplicate catalog id: ${book.id}`);
    byId.set(book.id, Object.freeze({
      ...book,
      search_text: normalizeSearch([
        book.title_zh,
        book.title_original,
        book.author,
        book.description_zh,
        ...(book.subjects || []),
      ].join(" ")),
    }));
  }
  return Object.freeze({ books: Object.freeze([...byId.values()]), byId });
}

export function queryCatalog(catalog, { query = "", category = "", source = "" } = {}) {
  const needle = normalizeSearch(query);
  return catalog.books.filter((book) => {
    if (category && category !== "All" && book.category !== category) return false;
    if (source && source !== "All" && book.source !== source) return false;
    return !needle || needle.split(" ").every((term) => book.search_text.includes(term));
  });
}

export function publicBook(book) {
  if (!book) return null;
  const { search_text: _searchText, ...safe } = book;
  return safe;
}
