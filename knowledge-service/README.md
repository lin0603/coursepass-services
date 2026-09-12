# CoursePass Knowledge Service

獨立、唯讀的知識服務：把「知識圖譜＋已綁定題庫」整理成 SQLite，提供乾淨的 REST API 給學伴、Dashboard 與答題 AI 使用。

## 架構

```
knowledge_graph.*.json  ┐
out/bound/*.ndjson      ┼─► build_db.py ─► data/knowledge.sqlite ─► server.mjs (REST) ─► Coolify
章節（由題目單元彙總）   ┘
```

- **build_db.py**：Python，無第三方依賴，可重跑、決定性；輸出資料版本雜湊。
- **server.mjs**：Node + Express + better-sqlite3，唯讀開啟。
- **部署**：Coolify app `coursepass-knowledge-service`（image `localhost:5000/coursepass-knowledge-service`），對外 `https://knowledge-api-dev.starxinteractive.com`。

## 建置資料

```bash
python3 knowledge-service/build_db.py
# 或指定來源
python3 knowledge-service/build_db.py --graphs <api dir> --bound out/bound --out data/knowledge.sqlite
```

## 本機執行

```bash
cd knowledge-service
npm install --omit=dev
PORT=8891 node server.mjs
```

## API

| Method | Path | 說明 |
|---|---|---|
| GET | `/healthz` | 健康檢查 |
| GET | `/version` | 資料版本與統計（nodes/edges/questions/builtAt） |
| GET | `/v1/subjects` | 科目清單 |
| GET | `/v1/nodes?subject&grade&q&limit&offset` | 節點查詢 |
| GET | `/v1/nodes/:id` | 單一節點＋邊＋覆蓋 |
| GET | `/v1/nodes/:id/questions?limit&offset&type&reviewStatus` | 節點題目 |
| GET | `/v1/chapters?publisher&subject&grade` | 章節（單元）清單 |
| GET | `/v1/coverage?subject&grade&publisher` | 覆蓋統計 |
| GET | `/v1/search?q&subject` | 節點搜尋 |

## 更新流程（資料→服務）

1. 更新來源（重抽題庫／完成綁定）→ `out/bound/*.ndjson`。
2. `python3 build_db.py`（產生新 `knowledge.sqlite`）。
3. 重建 image：`docker build -t localhost:5000/coursepass-knowledge-service:latest .`（於 vc66 的 build 目錄）。
4. `docker push` → Coolify redeploy。

> 服務本身無狀態；資料版本由 `/version` 的 `version` 雜湊可追溯。

## 目錄

```
knowledge-service/
  build_db.py      # 建資料庫
  server.mjs       # API
  package.json
  Dockerfile
  data/knowledge.sqlite   # 產物（建置時產生）
```

## 狀態（2026-09-12）
- 節點 1,872、邊 991、題目 66,777（南一四科已綁定）。
- 待辦：康軒／翰林綁定後重建；章節重點（課程計畫）匯入；審查狀態串接。
