# Coolify 部署設定參考

所有服務：**Build Pack = Dockerfile**、來源 = Public GitHub `lin0603/coursepass-services`、分支 = `develop`、自動部署（Git webhook）。

| 服務 | base_directory | ports | 環境變數 | 資料 volume | 對外網域 |
|---|---|---|---|---|---|
| coursepass-knowledge-service | `knowledge-service` | 8080 | `DATA=/app/data/knowledge.sqlite` | host `/srv/coursepass` → `/app/data` (ro) | 僅內網（不對外） |
| coursepass-companion-api | `companion-api` | 8080 | `DATA_DIR=/app/data`、`KNOWLEDGE_BASE=http://coursepass-knowledge-service:8080`、`COMPANION_API_TOKEN` | host `/srv/coursepass/companion-data` → `/app/data` (rw) | companion-api-dev.starxinteractive.com |
| coursepass-resource-files | `resource-files-server` | 80 | — | host `/hdd/coursepass-resource-files` → `/usr/share/nginx/html` (ro) | resource-files-dev.starxinteractive.com |
| coursepass-resource-index | `index-site` | 80 | — | — | resource-index-dev.starxinteractive.com |
| coursepass-figure-tikz | `figure-tikz` | 8390 | — | — | 僅內網（別名 `coursepass-figure-tikz`） |
| coursepass-figure-asymptote | `figure-asymptote` | 8391 | — | — | 僅內網（別名 `coursepass-figure-asymptote`） |

## 題圖編譯服務（Tier 2/3）

- `figure-tikz`：TikZ＋tkz-euclide → `xelatex` → `dvisvgm --no-fonts` → SVG（CJK 轉路徑）。
- `figure-asymptote`：Asymptote → SVG。
- 基底為 `texlive/texlive`；兩者僅內網，供 figure-service 以
  `COMPILE_TIKZ_URL=http://coursepass-figure-tikz:8390/compile`、
  `COMPILE_ASY_URL=http://coursepass-figure-asymptote:8391/compile` 呼叫。
- 健康檢查：`GET /health`。

## 自動部署
- Coolify Application → Source：Public GitHub，repo `lin0603/coursepass-services`，branch `develop`。
- 開啟 Auto Deploy（GitHub webhook：`https://<coolify>/webhooks/source/github/events/manual`，或 Coolify 產生）。
- 推送到 `develop` 即觸發。

## 資料更新（不重建映像）
1. 於 vc66 跑 `knowledge-service/build_db.py` 寫入 `/srv/coursepass/knowledge.sqlite`。
2. Restart `coursepass-knowledge-service`。
   （可用 Coolify Scheduled Task 排程。）

## 網路
- 知識服務僅內網；companion-api 為唯一公開學伴 API（含驗證）。
- 對外一律經 Cloudflare Tunnel（vc66 `coursepass-v2-dev-vc66`）。
