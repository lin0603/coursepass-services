# 題目預覽站（question-preview）

適康 115 上 · 數學 · 五年級題目預覽的靜態站（章節／知識節點／題型／狀態篩選、只看圖形題）。

- 程式碼在本 repo（`coursepass-services/question-preview/`），**git push → Coolify 自動部署**（Dockerfile/nginx）。
- 連連看改成 HTML 按鈕的做法見 [`MATCHING_HTML.md`](./MATCHING_HTML.md)。
- **資料不進 Git**：題庫資料放 vc66 的 resource-files volume，站台於 runtime 抓取。
  - 預設資料 URL：`https://resource-files-dev.starxinteractive.com/preview/knsh-math5.json`
  - 可用 `?data=<url>` 覆寫，或改 `index.html` 的 `<meta name="preview-data">`。

## 資料更新

```bash
# 本機產生（workdir）
#   out/knsh-math5-preview.json
# 上傳到 vc66 resource-files volume（/hdd/coursepass-resource-files/preview/）
scp out/knsh-math5-preview.json lin@192.168.0.140:/hdd/coursepass-resource-files/preview/knsh-math5.json
```

## 執行 / 部署

```bash
docker build -t question-preview .   # 本機預覽（不帶資料）
# 部署：push coursepass-services develop → Coolify（base dir question-preview）
```

公開網址：`https://question-preview-dev.starxinteractive.com/`

## 審查功能（雙審）
- 右上「審查人」選單＋「＋新增」＝身分（免密碼，先選自己是誰）；審查都會署名。
- 每題預設 **2 位不同審查人**（雙審）；「審查分配」面板：題池＝目前篩選、填各人題數（可不相等）→ 預覽 → 建立；可「匯出 CSV」與看每人進度。
- 卡片可看「其他審查人意見」與「審查歷史」（誰何時改成什麼）。
- API（companion-api）：`/v1/reviewers`、`/v1/assignments`、`/v1/assignments/reassign`、`/v1/review-progress`、`/v1/reviews`（逐審查人）、`/v1/reviews/:id/history`、`/v1/reviews/export?format=csv`。
- 老師改選題型會回饋到活動組裝：`toActivity({typeOverrides})`（來源 `question_reviews.type`）。

## 品質旗標
- `figure_quality.py`（workdir）對每張題目原圖做低成本健檢（HTTP/型別/檔案過小/尺寸/幾乎全白），
  並合併連連看品質閘；輸出上傳為 `preview/figure-quality.json`，站上以「品質需檢查」徽章與篩選呈現。

## 老師資料保存與優化
- **保存**：老師的審查（逐審查人 status/note/type/typeMismatch）、指派、審查歷史、AI 解題、改選題型全部寫入 companion-api 的 SQLite；DB 位於 vc66 持久化 volume（`/home/lin/coursepass/companion-data`），並有每日備份 cron。
- **讀取**：`GET /v1/reviews`（含 `courseId`）、`/v1/reviews/:id/history`、`/v1/assignments`、`/v1/course-progress`。
- **給 AI 優化**：`GET /v1/reviews/export?format=csv`（結構化：題號、審查人、狀態、註解、建議題型、課程）＋ `GET /v1/reviews/consensus`（雙審共識／分歧／題型不適合彙總），可餵給 AI 重寫或再生成題目。
- **回饋出題**：老師改選的題型會經 `toActivity({ typeOverrides })` 覆寫活動組裝（App 呈現會跟著變）。

## 正式化（待辦／已做）
- ✅ **備份**：vc66 cron（每日 03:05）以 sqlite backup API 快照到 `/home/lin/coursepass/companion-backups/`，保留 30 份。
  還原：`cp companion-YYYYMMDD-HHMM.sqlite /home/lin/coursepass/companion-data/companion.sqlite && docker restart <companion容器>`。
- ⏳ **站台登入**：建議在 Cloudflare Zero Trust 對 `question-preview-dev.starxinteractive.com`（及 companion-api）加 **Access**（限公司 Email/OTP）；需在 CF 後台建立。
- ⏳ **獨立環境／token**：正式給老師前，開獨立 Coolify app＋獨立 `COMPANION_API_TOKEN`（目前仍 dev 共用 token，且 token 會出現在前端 HTML）。
- ⏳ **權限模型**：誰能進站、誰能改分配（目前任何人皆可改）。
