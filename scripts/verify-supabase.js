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
const accessToken = String(process.env.SUPABASE_TEST_ACCESS_TOKEN || "").trim();

if (!supabaseUrl || !publishableKey) {
  console.error("Missing Supabase URL or publishable key. Copy .env.example to .env and fill both values.");
  process.exit(1);
}

// Public resources must be readable with the publishable key. A 42501 response
// is only healthy for account-private tables when no short-lived user token was
// supplied; treating every protected table as "missing" hid real RLS failures.
const checks = [
  ["users", "id", "public"],
  ["library_books", "id", "public"],
  ["book_ratings", "book_id", "private"],
  ["book_favorites", "book_id", "private"],
  ["book_progress", "book_id", "private"],
  ["book_annotations", "id,visibility", "public"],
  ["book_annotation_votes", "annotation_id", "private"],
  ["book_annotation_replies", "id,annotation_id", "public"],
  ["book_annotation_reply_votes", "reply_id", "private"],
  ["book_reviews", "id", "public"],
  ["book_review_likes", "review_id", "private"],
  ["book_review_favorites", "review_id", "private"],
  ["book_annotation_favorites", "annotation_id", "private"],
  ["library_user_settings", "user_id", "private"],
  ["library_notifications", "id", "private"],
  ["library_realtime_events", "sequence_id", "public"],
  ["library_feedback", "id", "public"],
  ["library_feedback_votes", "feedback_id", "private"],
];

const headers = {
  apikey: publishableKey,
  Authorization: `Bearer ${accessToken || publishableKey}`,
  Accept: "application/json",
};

let failed = false;
console.log(`Checking ${new URL(supabaseUrl).hostname} as ${accessToken ? "an authenticated user" : "an anonymous visitor"} ...`);
for (const [table, columns, exposure] of checks) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("select", columns);
  url.searchParams.set("limit", "1");
  try {
    const response = await fetch(url, { headers });
    if (response.ok) {
      console.log(`  OK        ${table}`);
      continue;
    }
    let body = {};
    try { body = await response.json(); } catch {}
    if (!accessToken && exposure === "private" && response.status === 401 && body.code === "42501") {
      console.log(`  PROTECTED ${table} (expected for anonymous visitors)`);
      continue;
    }
    failed = true;
    const detail = body.code ? `${body.code}: ${body.message || `HTTP ${response.status}`}` : body.message || `HTTP ${response.status}`;
    console.log(`  FAILED    ${table} (${detail})`);
  } catch (error) {
    failed = true;
    console.log(`  ERROR     ${table} (${error.message})`);
  }
}

try {
  const response = await fetch(new URL("/rest/v1/rpc/get_library_feedback_root_page", supabaseUrl), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 1, p_before_created_at: null, p_before_id: null, p_search: null }),
  });
  if (response.ok) console.log("  OK        get_library_feedback_root_page RPC");
  else {
    failed = true;
    let detail = `HTTP ${response.status}`;
    try { const body = await response.json(); detail = body.code ? `${body.code}: ${body.message || detail}` : body.message || detail; } catch {}
    console.log(`  FAILED    get_library_feedback_root_page RPC (${detail})`);
  }
} catch (error) {
  failed = true;
  console.log(`  ERROR     get_library_feedback_root_page RPC (${error.message})`);
}

if (failed) {
  console.error("\nSupabase schema/RLS verification failed. Run pending files in server/db/migrations in the Supabase SQL Editor (or apply server/db/library-schema.sql for a full refresh), then run this check again.");
  process.exit(1);
}

console.log(`\nSupabase ${accessToken ? "authenticated schema and RLS" : "public schema and private-table isolation"} are ready.`);
if (!accessToken) console.log("Set SUPABASE_TEST_ACCESS_TOKEN temporarily to verify authenticated private reads; use npm run test:authenticated for actual mutations.");
