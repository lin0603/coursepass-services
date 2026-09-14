# CoursePass V4 · 小關卡播放器（v4-player）

把新題庫鏈的活動真的「玩起來」的最小前端（P0/P1 垂直切片）：預設顯示**學習地圖**
（`GET /v1/units/:id/path`，completed/current/locked），點節點進入小關卡，抓
companion-api 的 `GET /v1/units/:id/activity-set` 一題一題呈現、判分、把作答回報 companion-api。

- **純前端、無框架、無建置**：原生 ES modules；數學用**原生 MathML**（`promptHtml`/`optionsHtml`）直接渲染，不需 KaTeX/MathJax。
- **不依賴 V3**：直接吃新鏈（`coursepass-services`）。

## 執行

```bash
# 本機靜態伺服器（無依賴）
node scripts/serve.mjs 4321
# → http://localhost:4321/                  （學習地圖，預設 N-5-4）
# → http://localhost:4321/?view=lesson&unit=N-5-4   （直接進小關）
```

線上：https://v4-player-dev.starxinteractive.com/

URL 參數：

| 參數 | 預設 | 說明 |
|---|---|---|
| `unit` | `N-5-4` | 知識節點 id（knowledge-service 的 nodeId） |
| `view` | `map` | `map`＝學習地圖；`lesson`＝直接進小關 |
| `limit` | `10` | 一輪題數（1–20） |
| `api` | `https://companion-api-dev.starxinteractive.com` | companion-api base |
| `token` | `cp-dev-token-change-me` | Bearer token（會存入 localStorage） |
| `learner` | `v4-demo` | 學習者 id（地圖狀態與作答記錄） |

## 檔案

```
src/app.mjs       入口：地圖 ↔ 小關卡切換（view 路由）
src/map.mjs       學習地圖（GET /v1/units/:id/path）
src/adapter.mjs   companion-api activity → 播放器模型（activityId→id、補預設、過濾不可玩）
src/render.mjs    題幹/選項/圖/MathML 的 HTML 產生（framework-agnostic）
src/grade.mjs     choice / fill_blank / matching 判分（全半形與空白正規化）
src/player.mjs    抓 activity-set → 逐題互動 → 判分 → 回報答案 → 完成
scripts/serve.mjs 本機靜態伺服器
test/             node --test（adapter / render / grade / map）
```

## 契約（consumes companion-api）

`activity-set` 每題主要欄位：`activityId`、`nodeId`、`type`（choice/fill_blank/matching）、
`prompt`、`promptHtml`(MathML)、`options`、`optionsHtml`(MathML)、`correctIndex`、
`answer`/`answerHtml`、`pairs`、`figureUrl`/`imageUrl`/`hasFigure`、`chapter`、
`generator`、`explanation`、`playable`。adapter 會把 `activityId` 正規化為 `id`。

判分：choice 比 `correctIndex`；fill_blank 比 `answer`（正規化全形/空白/大小寫）；
matching 每對都要對。

## 測試

```bash
npm test        # node --test
```

## 待辦（P1+）

- Dockerfile + Coolify 靜態站（目前僅本機 serve）。
- 題庫 HTML 直接注入（內部研究可）；正式上線需 sanitize。
- 更多題型（word_order / listening / speaking）與 TTS。
- 接 `progress`/`wrongbook` 顯示與「回地圖」。
