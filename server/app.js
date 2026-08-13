import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadCatalog } from "./catalog.js";
import { authMiddleware, attachProfile, attachRepositories } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import booksRoutes from "./routes/books.js";
import annotationsRoutes from "./routes/annotations.js";
import feedbackRoutes from "./routes/feedback.js";
import accountRoutes from "./routes/account.js";
import realtimeRoutes from "./routes/realtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function aliasedEnv(label, names) {
  const values = names.flatMap((name) => String(process.env[name] || "").trim().split(/\s+/).filter(Boolean));
  if (new Set(values).size > 1) throw new Error(`${label} aliases must resolve to exactly one value.`);
  return values[0] || "";
}

function allowedOrigins() {
  const configured = String(process.env.APP_ORIGIN || "").split(",").map((item) => item.trim()).filter(Boolean);
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  return new Set(["http://localhost:3001", "http://127.0.0.1:3001", vercel, ...configured].filter(Boolean));
}

export async function createApp({ serveStatic = false } = {}) {
  const supabaseUrl = aliasedEnv("Supabase URL", ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const publishableKey = aliasedEnv("Supabase publishable key", [
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);
  if (!supabaseUrl || !publishableKey) {
    throw new Error("A Supabase URL and publishable key are required.");
  }

  const app = express();
  const origins = allowedOrigins();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || origins.has(origin));
    },
  }));
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use((req, res, next) => {
    const incoming = String(req.headers["x-request-id"] || "");
    req.requestId = /^[A-Za-z0-9_-]{8,80}$/.test(incoming) ? incoming : crypto.randomUUID();
    const startedAt = performance.now();
    res.setHeader("X-Request-Id", req.requestId);
    res.on("finish", () => {
      if (!req.path.startsWith("/api/")) return;
      const durationMs = Math.round(performance.now() - startedAt);
      if (res.statusCode >= 400 || durationMs >= 750) {
        console.warn("API request", {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
        });
      }
    });
    next();
  });

  if (serveStatic) {
    const dist = path.join(ROOT, "dist");
    if (fs.existsSync(dist)) app.use(express.static(dist, { extensions: ["html"] }));
    else {
      app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));
      app.use("/library", express.static(path.join(ROOT, "library"), { immutable: true, maxAge: "1y" }));
      app.use("/data", express.static(path.join(ROOT, "data")));
      app.use("/vendor/supabase", express.static(path.join(ROOT, "node_modules", "@supabase", "supabase-js", "dist", "umd")));
      app.use("/vendor", express.static(path.join(ROOT, "node_modules", "epubjs", "dist")));
      app.use("/vendor", express.static(path.join(ROOT, "node_modules", "jszip", "dist")));
    }
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const catalog = loadCatalog();

  app.locals.supabaseUrl = supabaseUrl;
  app.locals.supabasePublishableKey = publishableKey;
  app.locals.supabaseAuthClient = authClient;
  app.locals.catalog = catalog;
  app.locals.createDataClient = (accessToken = null) => createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });

  app.use(authMiddleware);
  app.use(attachRepositories);
  app.use(attachProfile);
  app.get("/api/health", (_req, res) => res.json({
    status: "ok",
    database: "supabase-postgresql",
    auth: "supabase-google-oauth",
    catalogBooks: catalog.books.length,
  }));
  app.use("/api/auth", authRoutes);
  app.use("/api/books", booksRoutes);
  app.use("/api", annotationsRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/me", accountRoutes);
  app.use("/api/realtime", realtimeRoutes);

  app.use((req, res) => res.status(404).json({ error: "NOT_FOUND", message: "找不到指定的資源。" }));
  app.use((error, _req, res, _next) => {
    console.error("API error:", error);
    const code = String(error.code || error.message || "INTERNAL_ERROR");
    const databaseStatus = code === "42501" ? 403
      : code === "PGRST205" ? 503
        : code === "23505" ? 409
          : ["23503", "23514", "22P02"].includes(code) ? 400 : null;
    const status = error.status || databaseStatus || (String(error.message).endsWith("NOT_FOUND") ? 404 : 500);
    const publicMessage = code === "42501"
      ? "資料權限未正確套用；請重新登入，若仍失敗請聯絡管理員。"
      : code === "PGRST205"
        ? "資料庫版本尚未完成更新，請聯絡管理員。"
        : code === "23505"
          ? "這項操作已經完成，不需要重複送出。"
          : status >= 500 ? "服務暫時無法完成要求，請稍後再試。" : error.message;
    res.status(status).json({ error: code, message: publicMessage, requestId: _req.requestId });
  });
  return app;
}
