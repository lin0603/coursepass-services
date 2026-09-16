# 題目預覽站（question-preview）

康軒 115 上 · 數學 · 五年級題目預覽的靜態站（章節／知識節點／題型／狀態篩選、只看圖形題）。

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
