import { createApp } from "../server/app.js";

const appPromise = createApp();

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, "https://vercel.local");
  const rewrittenPath = requestUrl.searchParams.get("path");
  if (rewrittenPath) {
    requestUrl.searchParams.delete("path");
    const query = requestUrl.searchParams.toString();
    req.url = `/api/${rewrittenPath}${query ? `?${query}` : ""}`;
  }
  const app = await appPromise;
  return app(req, res);
}
