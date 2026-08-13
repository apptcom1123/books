# 前端互動與 UX 修正紀錄

日期：2026-08-13

## 問題與根因

- 公開書評、公開標注與標注回覆的 RLS policy 混入只授權 `authenticated` 的 `library_user_is_active()`；匿名讀取會回 `42501`，並使建立標注後的重新載入、回覆與投票看似失敗。
- 標注回覆完成時仍處於 pending 狀態，重新渲染後表單保持停用，使用者無法繼續回覆。
- epub.js 會保留每次注入的主題 CSS；反覆切換後，較晚注入的舊規則持續覆蓋目前選擇。
- `dist` 曾與 `public` 原始碼不同步；直接使用舊輸出會缺少新版 API 錯誤、逾時、快取與 UX 邏輯。

## 已套用的修改

1. **RLS 與權限**：公開書評／標注／回覆 policy 只判斷公開資料；另設登入者自己的私人讀取 policy，避免匿名請求執行登入專用函式。
2. **回覆可連續送出**：pending 結束後一定重新渲染為可操作狀態；失敗時保留草稿並重新聚焦輸入框。
3. **讚、倒讚與收藏**：標注、標注回覆及讀者回饋採樂觀更新；失敗會回滾原數值、顯示可理解訊息並記錄 rollback 指標。
4. **避免重複 mutation**：請求進行中停用同一操作；成功後以伺服器完整回傳覆蓋本地資料，不再立即整頁重抓。
5. **主題反覆切換**：每個 EPUB iframe 只保留一個 `mystery-reader-theme` 樣式節點，每次直接替換內容，最後一次選擇必定生效。
6. **請求競態**：標注與讀者回饋載入加入 request ID；較舊、較晚完成的回應不能覆蓋新狀態。
7. **縮小 payload**：移除 repository 內所有 `select("*")`；標注、回覆、書評、通知與設定只查畫面需要的欄位。
8. **局部資料合併**：建立討論或回覆後，API 只回受影響的討論串，前端以主鍵合併，不再重新下載全部討論。
9. **錯誤與離線訊息**：區分輸入錯誤、內容不存在、登入失效、權限、資料庫未更新、逾時、離線與 5xx；後端不再把所有資料庫錯誤都包成不明 500。
10. **驗證工具**：`verify:supabase` 現在會區分「私人表正確拒絕匿名」與「公開 RLS 故障」，並涵蓋新增的投票／收藏表。
11. **建置一致性**：已重新執行 build，並以 SHA-256 逐檔確認 `dist` 與 `public` 相同；Vercel 部署時也會由 build command 重建。

## `frontend_data_ux_onboarding.md` 對照

| 檢查面向 | 本次狀態 |
| --- | --- |
| 穩定載入與保留舊畫面 | 保留既有骨架屏、背景更新與舊資料；新增 request ID 防止舊回應覆蓋。 |
| 操作立即回饋與回滾 | 投票／收藏樂觀更新、重複提交鎖定、失敗回滾與草稿保留已完成。 |
| 必要欄位與請求整合 | 全部 repository `select(*)` 已移除；互動後只回傳受影響資料。 |
| 搜尋與高頻事件 | 回饋搜尋維持 debounce；非同步列表增加最後請求保護。 |
| 分頁／大量 DOM | 館藏維持分頁與「載入更多」；討論卡使用 `content-visibility` 且 API 有 200 筆上限。若討論量超過此上限，下一階段應改成 `created_at + id` 游標與伺服器搜尋。 |
| 快取生命週期 | 沿用專案的 `LibraryApi` stale-while-revalidate、帳號分區與登出清除；mutation 改為主鍵局部合併。此專案是原生 JS，故使用同等機制而非 React Query。 |
| Realtime | 沿用小型 delta、批次刷新、去重、補漏、背景取消訂閱與重連後驗證；mutation 以伺服器資料收斂。 |
| 渲染與媒體 | 館藏圖片維持固定尺寸、lazy loading；討論長列表使用瀏覽器原生延遲渲染。Storage 上傳與 Next.js hydration 本專案未使用。 |
| 錯誤、離線與權限 | 網路狀態列、分類錯誤、有限 GET 重試、RLS 公私分離及 migration 驗證已完成。 |
| 索引與原子更新 | 既有複合索引、RPC 計數與唯一鍵 upsert 保留；本次 RLS policy 修正不放寬資料邊界。 |
| 可觀測性 | API 延遲／payload、LCP、CLS、INP、Realtime 健康度與 mutation rollback 均可記錄。 |

## 驗證結果

- `npm test`：19/19 通過。
- JavaScript syntax check：前端、後端、repository 與驗證腳本通過。
- `npm run build`：200 筆館藏、200 個 EPUB 建置成功。
- `dist`／`public` hash：一致。
- 正式 Supabase 公開檢查：目前仍會在三個舊 policy 回 `42501`；必須先執行下列部署步驟。

## 正式環境必要部署

1. 若完整最新版 schema 已經套用，只需在 Supabase SQL Editor 執行 `server/db/migrations/20260813_fix_public_read_policies.sql`；若不確定版本，完整執行修正後的 `server/db/library-schema.sql`。兩者都使用 transaction，不會清空既有討論、標注或帳號資料。
2. 執行 `npm run verify:supabase`；公開書評、標注、回覆應顯示 `OK`，私人表應顯示 `PROTECTED`。
3. 重新部署／執行 `npm run build`，避免使用舊 `dist`。
4. 有短效登入 token 時再執行 `npm run test:authenticated`，驗證建立標注、回覆、標注／回覆投票及復原流程。
