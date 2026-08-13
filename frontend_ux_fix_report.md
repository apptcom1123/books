# 前端互動與 UX 修正紀錄

日期：2026-08-13

## 問題與根因

- 公開書評、公開標注與標注回覆的 RLS policy 混入只授權 `authenticated` 的 `library_user_is_active()`；匿名讀取會回 `42501`，並使建立標注後的重新載入、回覆與投票看似失敗。
- 標注已改用可信任的文字位移與五字聚合，但 `book_annotations` 的欄位級 `INSERT` grant 沒有同步加入三個必填欄位；因此已登入使用者仍會在資料庫層建立失敗。
- 回饋列表一次抓取最多 200 筆主題與回覆，再由瀏覽器搜尋和整理；資料增加後 payload、作者與投票 hydration 都會變慢，也沒有自己的內容刪除權限。
- 共用 Realtime trigger 的 catalog 條件直接引用 `OLD.status`／`NEW.status`；PostgreSQL 不保證布林運算短路，因此收藏、評分、投票與標注等沒有 `status` 欄位的資料表會拋出 `42703`，使原本已通過 RLS 的 mutation 全部回滾。
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
12. **登入狀態收斂**：互動 API 遇到 `401` 時只自動刷新一次 Supabase session 並重送原要求；刷新失敗會清除登入者與私人快取，避免畫面顯示已登入但 API 持續匿名。
13. **登入確認前鎖定操作**：回饋建立按鈕在 auth ready 前保持停用，確認身分後才顯示「提出回饋」或「登入後提出回饋」。
14. **註解建立權限**：migration 補齊 `anchor_offset_start`、`anchor_offset_end`、`cluster_key` 欄位級 INSERT grant；登入 smoke test 也實際送出這三欄。
15. **回饋分頁與延遲載入**：新增 `created_at + id` 游標 RPC、根討論索引與「載入更多」；列表只取根討論、回覆數和最新摘要，完整回覆在開啟討論時才載入。
16. **伺服器搜尋**：主旨、本文、作者與所有有效回覆改由 RPC 搜尋，不再先下載固定 200 筆後由瀏覽器過濾。
17. **回饋刪除**：新增自己的回饋 soft-delete RLS、DELETE route 與介面；使用者不能刪除他人的內容，管理員隱藏狀態也不會被一般使用者覆寫。
18. **背景重新驗證**：回饋列表與討論串有快取時先顯示舊資料，stale 後在背景更新；舊請求仍由 request ID 阻止覆蓋新搜尋。
19. **可追蹤 API 錯誤**：每個回應加入 `X-Request-Id`；後端記錄錯誤／慢於 750 ms 的 route、狀態與耗時，前端錯誤紀錄包含 endpoint、status、code 與 request ID。
20. **完整登入驗收**：`test:authenticated` 新增回饋討論／回覆／投票／搜尋／刪除，並修正標注 payload；測試結束會清理建立的暫時資料。
21. **Realtime trigger 跨表修復**：書評是否影響 catalog 的判斷改在 `book_reviews` 分支內先計算 `v_catalog_changed`；其他資料表不再讀取不存在的 `status` 欄位。新增獨立 migration，避免重新部署前端仍留下資料庫 trigger 錯誤。
22. **欄位級權限與 upsert 相容性**：標注投票、回覆投票、回饋投票及閱讀進度不再用會嘗試更新 ownership 主鍵的 PostgREST upsert；改為只更新允許變更的欄位，不存在時才 INSERT，唯一鍵競態則收斂回 UPDATE。`user_id` 與 target ID 仍保持不可更新。
23. **回覆 RLS 遞迴修復**：標注回覆 INSERT policy 不再直接查詢自己的資料表；父回覆是否有效及是否屬於同一標注改由只回傳布林值的 security-definer helper 驗證，消除 `42P17` 並維持巢狀回覆邊界。
24. **Soft-delete 回傳修復**：刪除標注、回覆、書評與回饋後不再 SELECT 已被 read policy 隱藏的 deleted row；改以精確 affected-row count 判斷成功，避免合法 UPDATE 因回傳資料不可見而變成 `42501`。
25. **Soft-delete 可見性 policy**：回覆與回饋新增只限作者自己的 SELECT policy，使狀態更新為 deleted 後仍符合 PostgreSQL UPDATE 可見性要求；匿名及其他使用者仍只能讀取 active 公開資料。
26. **標注討論獨立分頁**：同一位置泡泡內不再一次展開所有討論串，也不顯示位置聚合統計；每次只渲染一個標注，提供上一個／下一個按鈕與行動裝置左右滑動切換。切頁時仍保留各標注尚未送出的回覆草稿。

## `frontend_data_ux_onboarding.md` 對照

| 檢查面向 | 本次狀態 |
| --- | --- |
| 穩定載入與保留舊畫面 | 保留既有骨架屏、背景更新與舊資料；新增 request ID 防止舊回應覆蓋。 |
| 操作立即回饋與回滾 | 投票／收藏樂觀更新、重複提交鎖定、失敗回滾與草稿保留已完成。 |
| 必要欄位與請求整合 | 全部 repository `select(*)` 已移除；互動後只回傳受影響資料。 |
| 搜尋與高頻事件 | 回饋搜尋維持 debounce；非同步列表增加最後請求保護。 |
| 分頁／大量 DOM | 館藏與回饋都有「載入更多」；回饋已改為 `created_at + id` 游標及伺服器搜尋，完整回覆按需載入，討論卡另使用 `content-visibility`。 |
| 快取生命週期 | 沿用專案的 `LibraryApi` stale-while-revalidate、帳號分區與登出清除；mutation 改為主鍵局部合併。此專案是原生 JS，故使用同等機制而非 React Query。 |
| Realtime | 沿用小型 delta、批次刷新、去重、補漏、背景取消訂閱與重連後驗證；mutation 以伺服器資料收斂。 |
| 渲染與媒體 | 館藏圖片維持固定尺寸、lazy loading；討論長列表使用瀏覽器原生延遲渲染。Storage 上傳與 Next.js hydration 本專案未使用。 |
| 錯誤、離線與權限 | 網路狀態列、分類錯誤、有限 GET 重試、RLS 公私分離及 migration 驗證已完成。 |
| 索引與原子更新 | 新增回饋根討論游標索引；讚、收藏維持複合主鍵，投票採只更新 mutable 欄位／不存在才 INSERT，評分及統計維持資料庫 RPC，不由前端讀值加一再寫回。 |
| 可觀測性 | API 延遲／payload、request ID、錯誤 route、LCP、CLS、INP、Realtime 健康度與 mutation rollback 均可記錄。 |

## 驗證結果

- `npm test`：19/19 通過。
- JavaScript syntax check：前端、後端、repository 與驗證腳本通過。
- `npm run build`：200 筆館藏、200 個 EPUB 建置成功。
- 正式 Supabase 公開讀取與私人表隔離：通過；舊的三個公開 policy 問題已修復。
- 正式 Supabase 新回饋分頁 RPC：已部署；匿名與登入狀態的 schema、RPC、公開讀取及私人表讀取均通過。
- 正式 authenticated smoke 曾依序重現並定位 Realtime trigger `42703`、投票 upsert 欄位權限、回覆 policy `42P17` 與 soft-delete `42501`；各根因均已修正。
- 最新本機後端連正式 Supabase 的完整 authenticated smoke：全部通過。涵蓋身分、個人書房、設定還原、圖書收藏／評分、書評建立／編輯／按讚／收藏／刪除、標注建立／編輯／投票／收藏／回覆／回覆投票／刪除，以及回饋建立／回覆／投票／搜尋／刪除。
- 失敗過程留下的兩則暫時回覆已成功 soft-delete；最終個人書房重新載入確認清理完成。

## 正式環境必要部署

1. `20260813_social_platform_audit.sql`、`20260813_fix_realtime_trigger_row_fields.sql`、`20260813_fix_annotation_reply_policy_recursion.sql`、`20260813_fix_soft_delete_read_policies.sql` 均已套用。
2. 將本次 repository、schema、migration、測試與紀錄提交 GitHub，觸發 Vercel 部署；正式站需要新版 repository 才能使用安全的 UPDATE／INSERT 投票流程。
3. 部署完成後在正式網址再執行一次 `npm run test:authenticated`，確認 Vercel Function 已載入新 commit。
