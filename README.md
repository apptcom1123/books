# 謎讀・公共推理圖書館

一個獨立於 `YZ_json` 占卜功能的新專案。它沿用 Supabase Google OAuth 與使用者表，重新實作書籍搜尋、EPUB 閱讀、評分、收藏、進度、共同標注、投票、回覆與讀者留言板。

完整需求見 [PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)。

## 本機啟動

```powershell
npm install
npm run import:library
Copy-Item .env.example .env
npm run build
npm run dev
```

開啟 `http://localhost:3001`。

## Supabase 初始化

1. 若仍使用 `YZ_json` 的 Supabase project，保留既有 `public.users`。
2. 在 SQL Editor 執行 `server/db/library-schema.sql`。
3. 執行 `npm run seed` 產生 `server/db/library-seed.sql`，再於 SQL Editor 執行該檔案。
4. 在 `.env` 設定 Supabase URL 與 publishable key；網站 runtime 不使用 secret/service-role key。
5. Authentication → Providers 啟用 Google。
6. URL Configuration 加入：

```text
http://localhost:3001/
https://你的網域.vercel.app/
```

Google Cloud 的 Authorized redirect URI 使用 Supabase 顯示的 `/auth/v1/callback`，不是本站 API。

## Vercel 環境變數

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# APP_ORIGIN=https://你的網域.vercel.app（選用；自訂網域或跨網域呼叫時設定）
```

也支援不帶 `NEXT_PUBLIC_` 的 `SUPABASE_URL`＋`SUPABASE_PUBLISHABLE_KEY`。兩組名稱擇一即可，不要填 secret/service-role key。Google Client ID 與 Client Secret 只設定在 Supabase Google Provider。

## 館藏更新

`npm run import:library` 從同層的 `mystery_library` 複製 EPUB／封面並重建 `data/catalog.json`。正式營運時應先完成權利複核，再將書籍標為可發布；有疑義的作品使用 `rights_status=hold` 或 `enabled=false`。

供人工檢查與後續資料處理的同內容表格位於 `data/catalog.csv`、`data/catalog.sqlite`，自動驗證摘要位於 `data/verification_report.json`。

## 驗證

```powershell
npm test
npm run build
node --check server/app.js
node --check public/app.js
node --check public/reader.js
```
