# CoursePass Services

乾淨的 CoursePass 服務 monorepo。**程式用 Git、資料用 volume。** 推送到 `develop` 由 Coolify 以 Git webhook 自動部署。

## 服務

| 目錄 | 服務 | 說明 |
|---|---|---|
| `knowledge-service/` | coursepass-knowledge-service | 唯讀知識 API（知識圖譜＋綁定題庫，SQLite） |
| `companion-api/` | coursepass-companion-api | 學伴 BFF＋學習者狀態（progress/mastery/wrongbook） |
| `resource-files-server/` | coursepass-resource-files | 出版社來源檔案（DOC/PDF/圖片）nginx |
| `index-site/` | coursepass-resource-index | 資源目錄索引靜態站 |

## 部署模型（Git webhook 自動部署）

```
push develop ─► Coolify webhook ─► Dockerfile build ─► rolling deploy
```

- Build Pack：**Dockerfile**；`base_directory` 指到各服務目錄。
- 來源：Coolify 內建 Public GitHub（本 repo 為 public）。
- 分支：`develop`（不要用 master）。
- 憑證/設定：Coolify 環境變數（不進 Git）。
- 資料：Coolify **Persistent Storage** 掛載，**不進 Git**。

## 資料與程式分離

- `knowledge-service`：映像只含程式；SQLite 由 `build_db.py` 產生後掛載到 `/app/data/knowledge.sqlite`。
- `companion-api`：狀態存 `/app/data/companion.sqlite`（volume）。
- `resource-files-server`：掛載 `/hdd/coursepass-resource-files`（ro）。

## 本機開發

```bash
# knowledge-service
cd knowledge-service && npm install --omit=dev
DATA=./data/knowledge.sqlite PORT=8080 node server.mjs

# companion-api
cd companion-api && npm install --omit=dev
KNOWLEDGE_BASE=http://127.0.0.1:8080 PORT=8081 DATA_DIR=/tmp/companion node src/server.mjs
```

## 詳細
見 `deploy/README.md` 與各服務的 README。
