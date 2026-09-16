# 連連看：HTML 按鈕重畫 + 資料管線（matching）

把「連連看」從「依原圖座標絕對定位的裁切方塊」改為真正的 HTML `<button>`：
**a 側（`pairs.a`）在前排、b 側（`pairs.b`）在後排**，連接點用黑點，連線用 SVG 量測後繪製。

- 文字型元件 → HTML 文字（分數自動轉堆疊分數）。
- 圖形型元件 → 原圖該區塊裁切（`cropBg`）當按鈕內容。
- 版面：`tb`（a 上 / b 下）或 `lr`（a 左 / b 右）。
- **內容型別與版面都存在資料裡**（`box.kind` / `item.layout`），`app.js` 不再硬編題號、新增題不需改程式。
- 適用站台：`question-preview`（`app.js` / `styles.css`）。

## 1. 資料格式（`out/matching-pairs.json`）

```json
{ "items": { "<id>": {
  "image": "https://.../<id>.png", "width": 1526, "height": 907,
  "layout": "tb",                         // "tb"（上下）| "lr"（左右）
  "boxes": [
    { "box": [ymin, xmin, ymax, xmax], "label": "比 5/12 大且比 1/2 小", "kind": "text" }
  ],
  "pairs": [ { "a": 0, "b": 2 } ],
  "review": { "status": "ok", "reasons": [] }
} } }
```

- `box` 為 0–1000 正規化（左上到右下）。
- `kind`：`text`（HTML 文字；`a/b` 自動轉堆疊分數）或 `figure`（原圖裁切）。
- `layout`：`tb`（上下）、`lr`（左右）或 `chain`（三欄以上；節點可同時是來源與目標，需搭配每 box 的 `col`，`pairs` 表 `a`→`b` 方向）。
- `review`：品質閘結果；`needs_review` 會列出原因（`a_b_overlap`、`box5_blank`…）。
- 站台 runtime 讀 `preview-matching`（`resource-files /preview/matching-pairs.json`）。

## 2. 資料管線（單一 CLI，workdir）

`gen_matching_pairs.mjs`（視覺抽取）＋ `refine_matching_boxes.py`（精修）已整合進 `matching_pipeline.py`：

```bash
# 只重跑指定題（其餘沿用 --existing），用本機圖精修，不呼叫視覺
python3 matching_pipeline.py --only EMA1509002743,EMA1509004859 \
    --existing out/matching-pairs.json --images ./match_pngs --out out/matching-pairs.json

# 全部 matching 題、重新視覺抽取（DeepSeek V4.1 Flash）
python3 matching_pipeline.py --all --extract --source out/knsh-math5-preview.json \
    --url-prefix https://resource-files-dev.starxinteractive.com/iso/.../Single --out out/matching-pairs.json
```

流程：**抽取 → 精修(snap) → 分類(kind) → 版面(layout) → 品質閘(review) → 輸出單一 json**。
`kind` 由 `matching-kinds.json` 依題設定（權威），未列者用影像啟發式：

```json
{ "EMA1509004744": { "a": "figure", "b": "text" }, "EMA1509002743": { "a": "figure", "b": "figure" } }
```

`review.status = needs_review` 的題目請人工複核（目前名單會印在指令結尾）。

## 3. 版面與內容規則

- **只有資料可靠時才互動**：`boxes.length ≥ 2`、`pairs` 非空，且 **`a` 集合與 `b` 集合不重疊**。
  - 重疊（同一索引同時在 a/b）→ 抽取不可靠 → 退回原圖裁切預覽（`.app-canvas` 同色框）。
- 逐 box 依 `kind` 決定內容（`text` → HTML、`figure` → 裁切）；每顆按鈕含 `.match-dot`。
- **尺寸還原**：figure 的 `aspect-ratio` 用原圖像素比 `(dx·W)/(dy·H)`；同一排/欄的欄寬依原圖像素寬等比例、共用同一 scale（短側補空白）。
- `layout:"lr"` → 左欄（`.match-left`）／右欄（`.match-right`）；`tb` → `.match-top` / `.match-bottom`。
- `layout:"chain"` → 依 `box.col` 分欄；每顆按鈕左右各一連接點，`pairs` 的 `a` 連到 `b`（例：名稱→實物→透視圖）。`a∩b` 重疊視為正常、不觸發退回預覽。

## 4. 互動

- 點前排（`.match-top` / `.match-left`）→ `state.matchingPlay[id].selected = index`。
- 再點後排 → push `{ a, b, correct }`（依 `pairs` 判斷），清除 selected。
- 正確＝綠實線、錯誤＝紅虛線；全部正確 → 「全部配對正確 ✓」。
- 側別判定以 **DOM 位置**為準，不靠索引集合（可容忍重疊）。

## 5. 連線繪製（`drawMatchLines`）

- 對每個 `.app-match-board[data-match-id]` 個別處理。
- 依 `layout` 量測 a 側（`top`/`left`）與 b 側（`bottom`/`right`）的 `.match-dot` 中心，設 `viewBox="0 0 板寬 板高"`、`preserveAspectRatio="none"`，畫 `<line>`。
- `render()` 後以 `requestAnimationFrame` 重畫；`window.resize` 亦重畫。
- 排版為 flex/grid（非固定比例），端點必須用 DOM 量測。

## 6. 新增／調整一題

1. `matching_pipeline.py --only <id> --extract --url-prefix …` 抽取（或 `--existing` 沿用）。
2. 在 `matching-kinds.json` 幫該題設定 `a`/`b` 的 `kind`（有需要）。
3. 看 `review` 報告：`needs_review` 就人工複核框；OK 就上傳。

## 7. 驗證

- `node --check question-preview/app.js`
- Playwright：逐題檢查 board 節點數、figure/text 內容、完整配對→「全部配對正確」、錯誤→紅虛線、`layout` 對應的 DOM 側別、無 JS error。

## 8. 部署

- push `coursepass-services` `develop` → Coolify 自動部署（base dir `question-preview`）。
- **務必 bump `index.html` 的 `?v=YYYYMMDDx`**（Cloudflare 對帶 query 的資產有約 4 小時快取）。

## 9. 已知限制

- 自動 `kind` 分類不可靠（文字/圖形混排），以 `matching-kinds.json` 為權威。
- vision `pairs` 可能誤判（如 `EMA1509004903` a∩b 重疊）；此類由品質閘標記。
- 圖形型按鈕內容仍是原圖點陣裁切，非向量。

## 10. 裁圖精修（box snap）

**問題**：vision 的 `box_2d` 常鬆散／偏移（框到連接點、留白、框到鄰居）；Gemini object detection 亦同。
**方法（hybrid：vision anchor + 連通元件 snap）**：

1. 非白 `min(R,G,B) < 235` → 8-連通元件。
2. 移除小元件（圓點、文字筆畫）：bbox 長邊 `< 0.03·min(W,H)`。
3. 合併相近元件（同圖形筆畫／虛線）：gap `<= 3px`。
4. 同排（a 或 b）若元件數＝錨框數 → 依左右順序 1:1 對應；否則逐一取交集最大者 snap；
   面積比需 ∈ [0.35, 2.5]（避免小點或跨元件大塊）。
5. 座標轉回 0–1000。

腳本：`refine_matching_boxes.py`（僅需 Pillow）；`matching_pipeline.py` 已內含。

**限制**：相鄰元件黏在一起（如 `4859`/`4863` 的立體圖列）需靠「題目圖形列的欄位分群」處理；
`4903` 資料本身 a∩b 重疊，退回裁切預覽。
