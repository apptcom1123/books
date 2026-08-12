# 謎讀公共推理圖書館：產品需求說明

版本：1.0  
日期：2026-08-12

## 1. 產品願景

建立一個面向推理小說社群的非營利公開閱讀空間。館藏來自可合法利用的公共電子書來源，讀者能搜尋、閱讀、收藏、獨立評分、標注原文並就標注展開討論。平台不包含 `YZ_json` 的占卜功能，只延續其 Google OAuth、Supabase 使用者、社群投票、標注、回覆與角色概念。

成功標準：

- 讀者能在三次操作內找到並開始閱讀一本書。
- EPUB 的文字、章節、圖片、註腳與出版者 CSS 儘量保持原貌。
- 翻頁操作無明顯空白等待；相鄰章節由 continuous manager 預載。
- 一個使用者對每本書最多一筆評分、一筆收藏及一筆閱讀進度。
- 所有公開作品均有可稽核的來源、檔案雜湊與權利狀態。

## 2. 三階段工作

### 階段一：館藏取得與權利治理

1. 從 Standard Ebooks 的 Mystery subject 與 Project Gutenberg 的機器可讀目錄尋找作品。
2. Gutenberg 批次檔案只從官方允許的 mirror／harvest 管道下載，不批次爬主站。
3. 優先 EPUB；保存封面、來源頁、作者、中文／原文書名、中文短介、主題詞、檔案大小與 SHA-256。
4. 以正規化「作者＋書名」、移除空格／連字號的比較鍵及檔案 SHA-256 三層去重。
5. 權利初篩至少檢查作者死亡年；共同作者、譯者、插畫與特定版本仍需人工複核。
6. `rights_status=hold` 或 `removed` 的書不可出現在公開 API，也不可由閱讀器直接開啟。

### 階段二：閱讀與個人功能

1. 首頁提供全文式關鍵字搜尋、分類、來源及排序。
2. 卡片包含封面、繁中／原文書名、作者、中文短介、個人星等、不重複閱讀人次、收藏狀態與進度。
3. 閱讀器使用 EPUB.js sandboxed iframe；禁止 EPUB scripted content。
4. 支援上一頁／下一頁、鍵盤方向鍵、目錄跳轉、單／跨頁、字級、原書／紙張／夜間主題。
5. continuous manager 預先載入相鄰內容，降低換章等待。
6. 未登入進度保存在 localStorage；登入後同步到 Supabase。
7. 開書事件以 `book_id + reader_key` 計算不重複讀者，另累計開啟次數。匿名裝置代碼只在伺服器保存單向 SHA-256。

### 階段三：標注與讀者回饋

1. 讀者選取 EPUB 文字後，保存 EPUB CFI range、引文、章節、內容及公開／私人狀態。
2. 公開標注可被所有讀者看到；私人標注只由作者本人取得。
3. 每位登入使用者對一則標注最多一票，可上／下投或取消。
4. 公開標注支援回覆；角色為 admin／moderator 的帳號顯示館員識別。
5. 首頁回饋桌允許登入者發主題與回覆；館員可直接答覆社群建議。

## 3. 資訊架構

- `/`：首頁、搜尋、篩選、館藏卡片、回饋桌。
- `/reader.html?id=:bookId`：全頁 EPUB 閱讀器、目錄、閱讀設定與標注側欄。
- `/about.html`：來源、權利、隱私與社群規範。
- `/api/auth/*`：Supabase Google OAuth 設定與登入狀態。
- `/api/books/*`：館藏、評分、收藏、閱讀人次、進度。
- `/api/books/:id/annotations`：標注讀寫。
- `/api/annotations/:id/*`：標注投票與回覆。
- `/api/feedback`：公開留言板與回覆。

## 4. 分類架構

頂層固定為：

1. Literature
2. Science & Technology
3. History
4. Social Sciences & Society
5. Arts & Culture
6. Religion & Philosophy
7. Lifestyle & Hobbies
8. Health & Medicine

首批館藏使用 `Literature / Mystery & Detective Fiction`，其他分類先保留介面與資料約束。

## 5. 角色與權限

- 訪客：搜尋、瀏覽、閱讀、查看公開標注與留言；以雜湊裝置鍵計入不重複閱讀。
- 登入讀者：另可評分、收藏、同步進度、建立私人／公開標注、投票、回覆與留言。
- 版主：讀者權限＋社群管理識別；後續可加入隱藏內容 API。
- 管理者：版主權限＋權利狀態與館藏發布流程；service role 不得傳到瀏覽器。

## 6. 資料與一致性規則

- `book_ratings(book_id,user_id)` 為主鍵，評分 1–5；0 代表由 API 刪除評分。
- `book_favorites(book_id,user_id)` 為主鍵，確保每人每書只有一筆。
- `book_progress(book_id,user_id)` 為主鍵，只保留最新 CFI。
- `book_readers(book_id,reader_key)` 為主鍵，閱讀人次是其筆數，不是每次翻頁數。
- `book_annotation_votes(annotation_id,user_id)` 為主鍵。
- 所有社群寫入要求有效 Supabase access token；後端使用驗證後的 `sub`，不接受前端傳入 user id。

## 7. 安全與隱私

- Google OAuth 採 Supabase Auth PKCE；前端只接觸 publishable key。
- `SUPABASE_SERVICE_KEY` 只存在 Vercel Serverless 環境變數。
- public schema 的新表全部啟用 RLS，且 anon／authenticated 不直接取得表權限；瀏覽器透過 API 操作。
- EPUB scripted content 保持關閉。使用者內容以文字節點或 HTML escaping 呈現。
- JSON body 限制 64 KB，標注與留言限制 2,000 字。
- 正式版應補充檢舉、封鎖、稽核紀錄、備份及資料刪除流程。

## 8. 部署與營運

- 前端：Vercel static output `dist/`。
- API：Vercel Serverless Function `api/index.js`，區域 `hkg1`。
- 認證／資料：Supabase Auth + PostgreSQL。
- 大型 EPUB 為 immutable static asset；部署後使用一年 cache header。更新檔案時應更換路徑或 hash。
- 初始化順序：執行 YZ_json 使用者 schema → `library-schema.sql` → `npm run seed` → Vercel deploy。

## 9. 驗收條件

- 建置輸出同時含 200 筆 catalog、200 個 EPUB、200 張封面與三個 vendor bundle。
- Catalog ID、SHA-256、原始書名＋作者鍵均無重複。
- 200 個 EPUB 都能以 ZIP 方式開啟且含 `mimetype`、`META-INF/container.xml`。
- 未登入寫入 API 回傳 401；前端不包含 service role key。
- 使用者重複收藏不會新增第二筆；重複開書只增加 `open_count`，不增加 reader count。
- 閱讀器可顯示封面／圖片、目錄、分頁，並在重新整理後回到最後 CFI。
- 公開與私人標注的讀取範圍符合規則。
- 手機 390 px、平板 768 px、桌面 1440 px 均可操作。

## 10. 尚待人工／外部設定

- 逐本權利複核不能由程式完全保證；公開發布前由負責人確認台灣及目標讀者所在地法律。
- 在 Supabase SQL Editor 執行 migration 並執行 seed。
- 在 Supabase 啟用 Google provider，設定 Site URL／Redirect URLs。
- 在 Vercel 設定三個 Supabase 環境變數及正式 `APP_ORIGIN`。
- 上線後由推理社團進行可用性測試，再決定第二批類別與館藏。
