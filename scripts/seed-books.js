import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = String(process.env.SUPABASE_URL || "").trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
const rows = catalog.map((book) => ({
  id: book.id,
  source: book.source,
  source_id: book.source_id,
  title_original: book.title_original,
  title_zh: book.title_zh,
  author: book.author,
  author_death_year: book.author_death_year,
  description_zh: book.description_zh,
  category: book.category,
  subcategory: book.subcategory,
  language: book.language,
  edition_release_date: book.edition_release_date || null,
  subjects: book.subjects,
  source_url: book.source_url,
  epub_url: book.epub_url,
  cover_url: book.cover_url,
  sha256: book.sha256,
  file_size: book.file_size,
  license_status: book.license_status,
  local_copyright_check: book.local_copyright_check,
  rights_status: book.rights_status,
  catalog_order: book.catalog_order,
  enabled: true,
  updated_at: new Date().toISOString(),
}));

for (let offset = 0; offset < rows.length; offset += 50) {
  const batch = rows.slice(offset, offset + 50);
  const { error } = await db.from("library_books").upsert(batch, { onConflict: "id" });
  if (error) throw error;
  console.log(`Seeded ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
}
