# CoursePass Services（coursepass-services）

> 上層工作區規則見 [`../AGENTS.md`](../AGENTS.md)；以下為本 repo 重點。

## 最高優先規則（務必遵守）

- **絕不推送 `master`**：只用 `develop`；push 一律 `git push origin HEAD:develop`。
- **secrets 不進 Git**：`apikey.md`、`.env*`、`~/.codex/coursepass-deploy.env`（勿 commit、勿顯示）。
- **出版社名稱（版權）不得直接露出**：任何畫面／文案／文件／資料顯示名稱都**不可出現「康軒／翰林／南一」**，一律使用代稱 **「適康／適翰／適南」**；publisher code `knsh`／`hle`／`nan-i` 維持不變。
  - 適用站台／服務：`index-site`（審題入口）、`question-preview`（審題站）、`companion-api`、`knowledge-service`（含 `build_db.py` 的 PUBLISHER 對照）等。
  - 資料檔案（resource-files 上的 `resources.json`／`courses.json`、題庫 JSON）與 UI 文字新增時務必沿用代稱。
- **vc66 上的服務一律用 Coolify app 管理**（不要用 `docker run` 跑常駐容器）；資料用 persistent storage（host path bind mount）。
- **題庫／圖片／ISO 等出版社衍生資料不進 Git**。

## 常用

- 部署：push `develop` → Coolify 自動部署（各 app 有各自 base dir）。
- 站台資產（`app.js`／`styles.css`／`index.html`）改版請 **bump `?v=YYYYMMDDx`**（Cloudflare 對帶 query 的資產有快取）。
- 審題站與索引站皆有簡易登入（通行碼／管理者密碼，設在 companion-api 的 `PREVIEW_PASSCODE`／`ADMIN_PASSCODE`）。
