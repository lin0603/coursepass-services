# CoursePass Companion API

新的、乾淨的學伴後端。只依賴 **Knowledge Service**（知識層），自己擁有學習者狀態（progress / mastery / wrongbook / answers），提供 V4 學伴所需的乾淨 REST API。

## 定位

| 層 | 服務 | 角色 |
|---|---|---|
| 知識層 | `coursepass-knowledge-service` | 唯讀：知識節點、章節、綁定題庫、覆蓋 |
| **應用層（本服務）** | `coursepass-companion-api` | 學伴 BFF＋學習者狀態＋活動組裝 |
| 前端 | V4（學伴） | 只打本服務，不直接碰知識層與題庫 |

## 架構

```
V4 ──► companion-api ──► knowledge-service（HTTP，唯讀）
                │
                └──► SQLite（learner state: progress / answers / wrongbook）
```

- 無狀態知識查詢（快取 60s）＋ 有狀態學習紀錄（SQLite，WAL）。
- 模組：`config` / `knowledgeClient` / `activities` / `db` / `server`。
- 可選 Bearer 驗證：設定 `COMPANION_API_TOKEN` 後除 `/healthz` 外都要帶 token。

## API

| Method | Path | 說明 |
|---|---|---|
| GET | `/healthz` | 健康檢查 |
| GET | `/version` | 本服務＋知識層版本 |
| GET | `/v1/catalog/subjects` | 科目 |
| GET | `/v1/catalog/chapters?publisher&subject&grade` | 章節 |
| GET | `/v1/catalog/search?q` | 知識節點搜尋 |
| GET | `/v1/units?subject&grade` | 單元（知識節點） |
| GET | `/v1/units/:id` | 單元＋邊＋覆蓋 |
| GET | `/v1/units/:id/activities?limit=10` | **組成可玩的學伴活動**（預設只取 approved；`allowReviewRequired=1` 供開發） |
| GET | `/v1/learners/:id/progress` | 掌握度 |
| GET | `/v1/learners/:id/wrongbook` | 錯題本 |
| POST | `/v1/learners/:id/answers` | 回寫作答（更新 mastery／錯題） |

作答 body：
```json
{ "sourceQuestionId": "EMA1509000001", "nodeId": "N-5-4", "selected": "B", "correct": true }
```

## 執行

```bash
cd companion-api
npm install --omit=dev
KNOWLEDGE_BASE=https://knowledge-api-dev.starxinteractive.com PORT=8892 DATA_DIR=/tmp/companion-dev node src/server.mjs
```

## 部署

- Coolify app `coursepass-companion-api`（image `localhost:5000/coursepass-companion-api`），對外 `https://companion-api-dev.starxinteractive.com`。
- 資料：SQLite 於容器 `/app/data`（可掛 Coolify persistent storage）。

## Roadmap
- P0（本版）：catalog/units/activities/learner state。
- P1：審查閘門整合（只出 approved）、活動資產（圖片/音檔）。
- P2：登入/多學生、點數/連續天數、學習計劃接排程。
- P3：AI 解說/錯因（接 Obsidian Tutoring Service）。
