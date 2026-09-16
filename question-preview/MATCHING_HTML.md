# 連連看：純 HTML 重畫方法（matching → HTML buttons）

把「連連看」從「依原圖座標絕對定位的裁切方塊」改為真正的 HTML `<button>` 排版：
**上排＝`pairs.a`（條件／左側）**、**下排＝`pairs.b`（答案／右側）**，連接點用黑點，連線用 SVG 量測後繪製。

- 文字型元件 → HTML 文字（分數自動轉堆疊分數）。
- 圖形型元件 → 原圖該區塊裁切（`cropBg` 的背景裁切）當按鈕內容。
- 適用站台：`question-preview`（`app.js` / `styles.css`）。

## 1. 資料格式（`out/matching-pairs.json`）

```json
{ "items": { "<id>": {
  "image": "https://.../<id>.png", "width": 1526, "height": 607,
  "boxes": [ { "box": [ymin, xmin, ymax, xmax], "label": "比 5/12 大且比 1/2 小" } ],
  "pairs": [ { "a": 0, "b": 2 } ]
} } }
```

- `box` 為 0–1000 正規化（左上到右下：`ymin,xmin,ymax,xmax`）。
- `pairs.a` 指向「上排」元件索引、`pairs.b` 指向「下排」元件索引。
- 由 workdir 的 `gen_matching_pairs.mjs`（DeepSeek V4.1 Flash 視覺）抽取，站台於 runtime 讀 `preview-matching`（`resource-files /preview/matching-pairs.json`）。

## 2. 版面與內容規則

- **只有資料可靠時才互動**：`boxes.length ≥ 2`、`pairs` 非空，且 **`a` 集合與 `b` 集合不重疊**。
  - 重疊（同一索引同時在上下排）→ 抽取不可靠 → 退回原圖裁切預覽（`.app-canvas` 同色框）。
- 上排渲染索引在 `a` 集合的 boxes；下排渲染在 `b` 集合者；`grid-template-columns: repeat(n, 1fr)`。
- 每顆按鈕含 `.match-dot`（上排貼底、下排貼頂），作為連線端點。
- **內容型別由 `app.js` 的 `MATCHING_MODE` 逐題指定**：
  - `'text'`：HTML 文字；`a/b` 形式自動轉 `<span class="frac">`（分子／分母堆疊）。
  - `'figure'`：`cropBg()` 背景裁切（`background-image / background-size / background-position`）。
  - `{ top, bottom }`：上下排分別指定（例：立體圖上排 `figure`、下排 `text`）。
  - 未列出者預設 `'figure'`。
- 目前設定：
  - `text`：`0187` `0635` `0982` `1028`
  - `{figure,text}`：`4744` `4859` `4863`
  - `figure`：`2747` `2786` `2878` `4463` `4903`（`4903` 因 a∩b 重疊自動退回預覽）

## 3. 互動

- 點上排 → `state.matchingPlay[id].selected = index`。
- 再點下排 → push `{ a, b, correct }`（依 `pairs` 判斷對錯），並清除 selected。
- 正確＝綠實線、錯誤＝紅虛線。
- 全部預期配對都對 → 顯示「全部配對正確 ✓」；有錯 → 「有配對不正確（n/N）」；否則「已完成 n/N 條配對」。
- 側別判定以 **DOM 位置**（`.match-top` / `.match-bottom`）為準，不靠索引集合（可容忍重疊）。

## 4. 連線繪製（`drawMatchLines`）

- 對頁面上每個 `.app-match-board[data-match-id]` 個別處理。
- 量測 `.match-top` / `.match-bottom` 內對應 `.match-dot` 的 `getBoundingClientRect()`，
  相對 board 取中心點，設 `viewBox="0 0 板寬 板高"`、`preserveAspectRatio="none"`，畫 `<line>`。
- `render()` 後以 `requestAnimationFrame(drawMatchLines)` 重畫；`window.resize` 亦重畫。
- 因排版是 flex/grid（非固定比例），端點必須用 DOM 量測，不能用原圖座標。

## 5. 新增／調整一題

1. 跑 `gen_matching_pairs.mjs` 取得該題 `boxes/pairs`，更新/上傳 `preview/matching-pairs.json`。
2. 看原圖決定內容型別，在 `app.js` 的 `MATCHING_MODE` 補上 `'text'` / `'figure'` / `{top,bottom}`。
3. 若 `a ∩ b` 不為空 → 目前會退回裁切預覽（需重跑抽取修正資料）。

## 6. 驗證

- `node --check question-preview/app.js`
- Playwright（本機起 http.server 並攔截資料）：逐題檢查
  - board 存在、上／下排節點數等於 `|a|` / `|b|`；
  - `figure` 節點有背景裁切、`text` 節點無裁切；
  - 完整配對 → 「全部配對正確」且綠線數 = `pairs` 數；
  - 錯誤配對 → 紅虛線；無 JS error。

## 7. 部署

- push `coursepass-services` 的 `develop` → Coolify 自動部署（base dir `question-preview`）。
- **務必 bump `index.html` 的 `?v=YYYYMMDDx`**：Cloudflare 對帶 query 的資產 URL 有約 4 小時快取，未換版本會拿到舊 JS/CSS。

## 8. 已知限制

- 抽取品質：vision 可能誤判 pairs（例：`EMA1509004903` a∩b 重疊、`EMA1509000635` 少一組），需重跑或人工複核。
- 圖形型按鈕內容仍是原圖點陣裁切，非向量、未重繪。

## 9. 裁圖精修（box snap，2026-09）

**問題**：`gen_matching_pairs.mjs` 用 DeepSeek V4.1 Flash 視覺吐出的 `box_2d` 常鬆散／偏移
（框到連接點、留白、或框到鄰居），直接裁會「亂七八糟」。Vision-only 無法穩定給到像素級外框；
Gemini 2.5 Flash 的 object detection（官方 `box_2d` 0–1000）在此類圖同樣粗、且會把《答案》區也算進來
（另有 instance segmentation mask 可用，但對這種線稿/示意圖不穩）。

**方法（hybrid：vision anchor + 連通元件 snap）**：

1. 影像二值化：非白 `min(R,G,B) < 235` → 8-連通元件。
2. 移除小元件（連接點圓點、文字筆畫）：bbox 長邊 `< small_frac · min(W,H)`（預設 0.03）。
3. 合併相近元件（同一圖形的筆畫／虛線黏回一塊）：gap `<= merge_px`（預設 3px）。
4. 對每個 vision anchor box 取交集最大的元件，把框 snap 成該元件外框；
   **僅在元件面積 / anchor 面積 ∈ [0.35, 2.5] 才採用**（避免 snap 到小點或跨元件大塊）。
5. 座標轉回 0–1000 後寫回 `matching-pairs.json`（label / pairs 沿用 vision 結果）。

腳本：workdir `refine_matching_boxes.py`（僅需 Pillow）

```bash
python3 refine_matching_boxes.py \
  --matching out/matching-pairs.json \
  --images ./match_pngs \
  --out out/matching-pairs.refined.json     # 或用 --image-url-prefix https://.../preview-img
```

**效果**：對「元件彼此分離」的圖形題（`EMA1509002747`、`EMA1509004744`、`EMA1509002786`、`EMA1509002878`、`EMA1509004463`）
可得到貼緊、不含點與鄰居的裁切；文字題不受影響（預覽用 HTML 文字）。
**限制**：相鄰元件互相黏在一起（如 `EMA1509004859`/`EMA1509004863` 的 ①②③④ 柱狀圖）連通元件無法分離；
`EMA1509004903` 抽取資料本身 a∩b 重疊，仍退回裁切預覽。
