import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = path.resolve(ROOT, "..", "mystery_library");
const SOURCE_CATALOG = path.join(SOURCE_ROOT, "books.json");
const SOURCE_TABLES = [
  ["books.csv", "catalog.csv"],
  ["books.sqlite", "catalog.sqlite"],
  ["verification_report.json", "verification_report.json"],
];
const TARGET_LIBRARY = path.join(ROOT, "library");
const TARGET_DATA = path.join(ROOT, "data");

function bookId(book) {
  if (book.source === "Project Gutenberg") return `pg-${book.source_id}`;
  return `se-${book.source_id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function cleanAssetFolder(folder) {
  const resolved = path.resolve(TARGET_LIBRARY, folder);
  const safeRoot = `${path.resolve(TARGET_LIBRARY)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) throw new Error(`Unsafe destination: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function copyAsset(relativePath) {
  if (!relativePath) return;
  const source = path.resolve(SOURCE_ROOT, relativePath);
  const destination = path.resolve(TARGET_LIBRARY, relativePath);
  if (!source.startsWith(`${SOURCE_ROOT}${path.sep}`) || !destination.startsWith(`${TARGET_LIBRARY}${path.sep}`)) throw new Error(`Unsafe asset path: ${relativePath}`);
  if (!fs.existsSync(source)) throw new Error(`Missing asset: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

if (!fs.existsSync(SOURCE_CATALOG)) throw new Error(`Missing source catalog: ${SOURCE_CATALOG}`);
fs.mkdirSync(TARGET_DATA, { recursive: true });
const sourceBooks = JSON.parse(fs.readFileSync(SOURCE_CATALOG, "utf8"));
cleanAssetFolder("ebooks");
cleanAssetFolder("covers");
for (const book of sourceBooks) {
  copyAsset(book.local_path);
  copyAsset(book.cover_path);
}
const seenIds = new Set();
const seenHashes = new Set();
const catalog = sourceBooks.map((book, index) => {
  const id = bookId(book);
  if (seenIds.has(id)) throw new Error(`Duplicate book id: ${id}`);
  if (seenHashes.has(book.sha256)) throw new Error(`Duplicate EPUB hash: ${book.sha256}`);
  seenIds.add(id);
  seenHashes.add(book.sha256);
  return {
    id,
    source: book.source,
    source_id: book.source_id,
    title_original: book.title_original,
    title_zh: book.title_zh,
    author: book.author,
    author_death_year: book.author_death_year,
    description_zh: book.description_zh,
    description_method: book.description_method,
    category: book.category,
    subcategory: book.subcategory,
    language: book.language,
    publication_year: book.publication_year,
    edition_release_date: book.edition_release_date,
    subjects: book.subjects,
    source_url: book.source_url,
    epub_url: `/library/${book.local_path}`,
    cover_url: `/library/${book.cover_path}`,
    sha256: book.sha256,
    file_size: book.file_size,
    license_status: book.license_status,
    local_copyright_check: book.local_copyright_check,
    rights_status: "reviewed",
    catalog_order: index + 1,
  };
});

fs.writeFileSync(path.join(TARGET_DATA, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
for (const [sourceName, targetName] of SOURCE_TABLES) {
  const source = path.join(SOURCE_ROOT, sourceName);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(TARGET_DATA, targetName));
}
console.log(`Imported ${catalog.length} books, ${seenHashes.size} unique EPUB files.`);
