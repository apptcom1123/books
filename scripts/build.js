import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const required = [path.join(ROOT, "public"), path.join(ROOT, "library"), path.join(ROOT, "data", "catalog.json")];
for (const item of required) if (!fs.existsSync(item)) throw new Error(`Missing build input: ${path.relative(ROOT, item)}`);

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "public"), DIST, { recursive: true });
fs.cpSync(path.join(ROOT, "library"), path.join(DIST, "library"), { recursive: true });
fs.mkdirSync(path.join(DIST, "data"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "data", "catalog.json"), path.join(DIST, "data", "catalog.json"));
fs.mkdirSync(path.join(DIST, "vendor"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "node_modules", "epubjs", "dist", "epub.min.js"), path.join(DIST, "vendor", "epub.min.js"));
fs.copyFileSync(path.join(ROOT, "node_modules", "jszip", "dist", "jszip.min.js"), path.join(DIST, "vendor", "jszip.min.js"));
fs.copyFileSync(path.join(ROOT, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js"), path.join(DIST, "vendor", "supabase.js"));

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
const epubCount = fs.readdirSync(path.join(DIST, "library", "ebooks"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".epub")).length;
console.log(`Built dist: ${catalog.length} catalog records, ${epubCount} EPUB files.`);
