import "dotenv/config";

function aliasedEnv(label, names) {
  const values = names.flatMap((name) => String(process.env[name] || "").trim().split(/\s+/).filter(Boolean));
  if (new Set(values).size > 1) throw new Error(`${label} aliases must resolve to exactly one value.`);
  return values[0] || "";
}

const supabaseUrl = aliasedEnv("Supabase URL", ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
const publishableKey = aliasedEnv("Supabase publishable key", [
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
]);

if (!supabaseUrl || !publishableKey) {
  console.error("Missing Supabase URL or publishable key. Copy .env.example to .env and fill both values.");
  process.exit(1);
}

const checks = [
  ["users", "id"],
  ["library_books", "id"],
  ["book_ratings", "book_id"],
  ["book_favorites", "book_id"],
  ["book_progress", "book_id"],
  ["book_annotations", "id"],
  ["book_annotation_votes", "annotation_id"],
  ["book_annotation_replies", "id"],
  ["book_reviews", "id"],
  ["book_review_likes", "review_id"],
  ["book_annotation_favorites", "annotation_id"],
  ["library_user_settings", "user_id"],
  ["library_notifications", "id"],
  ["library_realtime_events", "sequence_id"],
  ["library_feedback", "id"],
];

const headers = {
  apikey: publishableKey,
  Authorization: `Bearer ${publishableKey}`,
  Accept: "application/json",
};

let failed = false;
console.log(`Checking ${new URL(supabaseUrl).hostname} ...`);
for (const [table, column] of checks) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("select", column);
  url.searchParams.set("limit", "1");
  try {
    const response = await fetch(url, { headers });
    if (response.ok) {
      console.log(`  OK      ${table}`);
      continue;
    }
    failed = true;
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.code ? `${body.code}: ${body.message || detail}` : body.message || detail;
    } catch {}
    console.log(`  MISSING ${table} (${detail})`);
  } catch (error) {
    failed = true;
    console.log(`  ERROR   ${table} (${error.message})`);
  }
}

if (failed) {
  console.error("\nSupabase is not ready. Run server/db/library-schema.sql, then server/db/library-seed.sql in the Supabase SQL Editor.");
  process.exit(1);
}

console.log("\nSupabase schema is reachable. You can now run the app and complete Google sign-in.");
