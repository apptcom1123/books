# 謎讀・公共推理圖書館

一個獨立於 `YZ_json` 占卜功能的新專案。它沿用 Supabase Google OAuth 的登入方式，重新實作書籍搜尋、EPUB 閱讀、評分、收藏、進度、共同標注、泡泡排序、留言投票、書評收藏、讀者回饋、站內通知與個人書房。

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

1. 在 SQL Editor 的一個新查詢中完整執行 `server/db/library-schema.sql`，並確認顯示成功。全新 project 會建立最小的 `public.users`；若沿用 `YZ_json`，則保留既有資料表並補上圖書館功能。schema 使用 transaction，任何一行失敗都會整批回滾，這時不要繼續執行 seed。
2. 可先執行 `select to_regclass('public.library_books');`；結果必須是 `public.library_books`。
3. 執行 `npm run seed` 產生 `server/db/library-seed.sql`，再於另一個 SQL Editor 查詢中完整執行該檔案。
4. 在 `.env` 設定 Supabase URL 與 publishable key；網站 runtime 不使用 secret/service-role key。
5. Authentication → Providers 啟用 Google。
6. Authentication → URL Configuration 將正式網域設成 Site URL，Redirect URLs 同時加入本機與正式網域：

```text
http://localhost:3001/
https://你的網域.vercel.app/
```

Google Cloud 的 Authorized redirect URI 使用 Supabase 顯示的 `/auth/v1/callback`，不是本站 API。

執行 SQL 後可以先確認資料表是否齊全：

```powershell
npm run verify:supabase
```

這個指令在你的專案目錄／本機終端執行；它會用 `.env` 的 Supabase URL 與 publishable key 呼叫正式 Supabase REST API，檢查公開讀取、私人表隔離及必要 RPC。SQL 本身才是在 Supabase SQL Editor 執行。`verify:supabase` 不會建立資料表，也不會寫入或刪除正式資料。

若顯示 `PGRST205`，代表該 Supabase project 尚未執行 schema；首頁仍可能用靜態館藏正常顯示，但登入後的收藏、評論與標注不會工作。

每次拉取包含資料表／RPC 更新的版本後，依日期順序在 Supabase SQL Editor 執行尚未套用的 `server/db/migrations/*.sql`；全新環境則完整執行 schema。migration 與 schema 都使用 transaction，既有館藏、帳號、標注與閱讀進度不會被清空。

## 回饋與閱讀標注

`/feedback.html` 是獨立的讀者回饋頁，搜尋範圍包含討論主旨、本文、作者及所有回覆；列表以 `created_at + id` 游標分頁，只先載入根討論與回覆摘要，點選後才載入完整討論。作者可以刪除自己的討論或回覆。

閱讀器不會在反白時立刻打開表單。完成選取後先按畫面下方的「增加標注」，再決定內容與公開範圍。公私標注都儲存在 Supabase；RLS 只允許作者讀取自己的私人標注。和 `yz_json` 一樣，標注以章節內的文字起始位置計算，每 5 個位置聚合成一顆泡泡；公私標注分開聚合，舊版沒有文字位移的資料保持獨立以避免錯誤合併。公開泡泡依局部討論串的淨分、讚數與時間排名，顯示閾值可在閱讀器或個人書房調整。點兩下泡泡會開啟該五字詞區段內的所有獨立小討論串。

## 個人書房與通知

登入後從右上角或「我的書房」進入 `/account.html`，可管理收藏、閱讀進度、評分、書評、自己的標注與回覆、收藏的公開標注／讀者評論，以及通知偏好。公開標注被收藏／按讚、標注收到回覆、書評被按讚／收藏、留言收到回覆時會產生站內通知；自己的互動不會通知自己。

書籍本身來自公共館藏，沒有「書籍擁有者」，所以別人收藏一本書不會通知任何人；「被別人收藏」在本站對應的是讀者公開標注被其他讀者收藏。

## 即時同步與健康檢查

本站不在 Vercel Function 內另開常駐 WebSocket Server，而是共用瀏覽器中的單一 Supabase Realtime 連線。資料庫只廣播很小的 Delta（資源類型、操作、目標 ID、書籍 ID、序列號、時間），收到後再由既有 REST API 讀取經 RLS 授權的完整內容。

- `user:{userId}:notifications` 是登入者自己的私有通知 Topic。
- `book:{bookId}:activity` 只傳該書的評分、收藏、公開評論／標注變更 ID；評論視窗與閱讀器只在位於該書區域時加入 Topic。
- `catalog:activity` 是首頁唯一的館藏聚合 Topic。評分、書籍收藏或評論異動時，前端以變更的 `bookId` 批次刷新現有書卡，不為每本書建立 Channel，也不重抓整份館藏。
- `feedback:activity` 只在讀者回饋頁加入；回覆與投票依根討論串 ID 局部刷新。
- 頁面進入背景 15 秒後移除 Channel；回到前景、恢復網路或重連成功時，以 `sequence_id` 從 `/api/realtime/events` 補拿遺漏事件。
- SDK 每 30 秒執行心跳，斷線使用含 jitter 的 1、2、5、10、30 秒退避。Channel 未恢復時，每 45 秒使用 HTTP 補漏；畫面仍保留最後一次成功取得的資料。
- 同一瀏覽器分頁的所有 Topic 共用一條 Supabase Socket；關閉評論視窗會立即 unsubscribe 該書 Room，沒有 listener 的 Channel 會被移除。事件先以 220–280 ms 合併，避免高頻按讚／投票造成重複 REST 請求。
- 個人書房的通知頁顯示連線狀態與心跳延遲；開發者也可在瀏覽器 Console 執行 `libraryRealtime.diagnostics()` 查看 Socket `readyState`、最近 50 筆狀態日誌、重連、錯誤、重複事件、事件延遲與訂閱 Topic。

WebSocket 由 HTTPS Supabase URL 自動使用 `wss://`。個人通知 Channel 是 private，JWT 在 join 與 token refresh 時由 SDK 更新，接收權限由 `realtime.messages` RLS 決定；公開 Room 則不含私人標注、使用者 ID 或完整資料。HTTP 補漏端點另有每 IP 每分鐘 120 次限制。連線數、訊息量、Lag、錯誤率與節點記憶體請在 Supabase Dashboard 的 Realtime Reports 監看，因為 Socket 並不終止於本站 Express/Vercel 節點。

目前沒有額外套用 `permessage-deflate`、MessagePack 或 Protocol Buffers：傳輸內容已是小型 Delta，而 Supabase 託管傳輸不提供本站逐連線調整壓縮的介面。若日後改為自架大量二進位串流，再評估二進位協定、每 IP 連線上限與 Redis Pub/Sub；目前水平分發、連線上限及惡意 Socket 防護由 Supabase Realtime 層負責。

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
npm run verify:supabase
node --check server/app.js
node --check public/app.js
node --check public/reader.js
node --check public/realtime.js
```

完成一次 Google 登入並取得短效 access token 後，可以對本機 API 執行登入後煙霧測試。它會測試並還原通知／泡泡閾值設定、圖書收藏和評分，另建立後刪除暫時書評、讚賞／收藏、標注、標注與回覆投票，以及回饋討論、回覆、投票與搜尋：

```powershell
$env:SUPABASE_TEST_ACCESS_TOKEN='短效 access token'
npm run test:authenticated
Remove-Item Env:SUPABASE_TEST_ACCESS_TOKEN
```

access token 不要寫入 `.env`、不要提交。跨使用者通知仍需以第二個測試帳號人工操作一次。
