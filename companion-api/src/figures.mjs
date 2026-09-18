// 參數化圖形重繪（方案 C）：由 AI 給 figure{template,params}，這裡以 SVG 模板安全重繪。
// 只接受白名單模板與經過驗證/夾限的參數；輸出可信任的 SVG（供前端 innerHTML 顯示）。

const W = 640;

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

const TEMPLATES = ['number_line', 'bar', 'blocks', 'points', 'fraction_bar'];

function numberLine(p) {
  const min = num(p.min, 0), max = num(p.max, 10), step = Math.max(0.0001, num(p.step, 1));
  const H = 110, y = 60, left = 40, right = W - 40;
  const ticks = [];
  for (let v = min, i = 0; v <= max + 1e-9 && i < 21; v += step, i += 1) ticks.push(Number(v.toFixed(6)));
  const x = (v) => left + ((v - min) / (max - min)) * (right - left);
  const marks = Array.isArray(p.marks) ? p.marks.slice(0, 12) : [];
  const parts = [`<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#2b2b2b" stroke-width="2"/>`,
    `<polygon points="${right},${y} ${right - 10},${y - 5} ${right - 10},${y + 5}" fill="#2b2b2b"/>`];
  for (const t of ticks) {
    const tx = x(t);
    parts.push(`<line x1="${tx.toFixed(1)}" y1="${y - 5}" x2="${tx.toFixed(1)}" y2="${y + 5}" stroke="#2b2b2b" stroke-width="1.5"/>`);
    parts.push(`<text x="${tx.toFixed(1)}" y="${y + 22}" font-size="14" fill="#2b2b2b" text-anchor="middle">${esc(t)}</text>`);
  }
  for (const m of marks) {
    const mx = clamp(x(num(m.value, min)), left, right);
    parts.push(`<circle cx="${mx.toFixed(1)}" cy="${y - 18}" r="5" fill="#e05252"/>`);
    if (m.label) parts.push(`<text x="${mx.toFixed(1)}" y="${y - 28}" font-size="13" fill="#e05252" text-anchor="middle">${esc(m.label)}</text>`);
  }
  return { inner: parts.join(''), h: H };
}

function bar(p) {
  const cats = (Array.isArray(p.categories) ? p.categories : []).slice(0, 8).map((c) => esc(c));
  const vals = (Array.isArray(p.values) ? p.values : []).slice(0, cats.length).map((v) => Math.max(0, num(v)));
  const n = Math.max(1, cats.length);
  const H = 220, top = 24, base = H - 40, left = 48, right = W - 20;
  const yMax = Math.max(1, num(p.yMax, Math.max(...vals, 1)));
  const bw = (right - left) / n;
  const parts = [`<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${base}" stroke="#2b2b2b" stroke-width="2"/>`,
    `<line x1="${left}" y1="${base}" x2="${right}" y2="${base}" stroke="#2b2b2b" stroke-width="2"/>`];
  for (let i = 0; i < n; i += 1) {
    const h = (vals[i] / yMax) * (base - top);
    const x = left + i * bw + bw * 0.2;
    parts.push(`<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${h.toFixed(1)}" fill="#9cc3e0" stroke="#4a7ca3"/>`);
    parts.push(`<text x="${(x + bw * 0.3).toFixed(1)}" y="${(base - h - 4).toFixed(1)}" font-size="12" fill="#2b2b2b" text-anchor="middle">${esc(vals[i])}</text>`);
    if (cats[i]) parts.push(`<text x="${(x + bw * 0.3).toFixed(1)}" y="${base + 18}" font-size="13" fill="#2b2b2b" text-anchor="middle">${cats[i]}</text>`);
  }
  return { inner: parts.join(''), h: H };
}

function blocks(p) {
  const rows = clamp(Math.round(num(p.rows, 4)), 1, 12);
  const cols = clamp(Math.round(num(p.cols, 4)), 1, 12);
  const s = 34, pad = 16;
  const H = rows * s + pad * 2, gw = cols * s;
  const offX = (W - gw) / 2;
  const set = new Set((Array.isArray(p.shaded) ? p.shaded : []).map((c) => `${Math.round(num(c[0]))}:${Math.round(num(c[1]))}`));
  const parts = [`<rect width="${W}" height="${H}" fill="#fff"/>`];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const shaded = set.has(`${r}:${c}`);
      parts.push(`<rect x="${(offX + c * s).toFixed(1)}" y="${(pad + r * s).toFixed(1)}" width="${s}" height="${s}" fill="${shaded ? '#d9d9d9' : '#fff'}" stroke="#2b2b2b" stroke-width="1.2"/>`);
    }
  }
  return { inner: parts.join(''), h: H };
}

function points(p) {
  const xMax = clamp(Math.round(num(p.xMax, 6)), 1, 10);
  const yMax = clamp(Math.round(num(p.yMax, 6)), 1, 10);
  const H = 320, left = 48, bottom = H - 36, top = 20, right = W - 24;
  const x = (v) => left + (clamp(num(v), 0, xMax) / xMax) * (right - left);
  const y = (v) => bottom - (clamp(num(v), 0, yMax) / yMax) * (bottom - top);
  const parts = [`<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#2b2b2b" stroke-width="2"/>`,
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#2b2b2b" stroke-width="2"/>`];
  for (let i = 0; i <= xMax; i += 1) { const tx = x(i); parts.push(`<line x1="${tx.toFixed(1)}" y1="${bottom}" x2="${tx.toFixed(1)}" y2="${bottom + 5}" stroke="#2b2b2b"/><text x="${tx.toFixed(1)}" y="${bottom + 20}" font-size="12" fill="#2b2b2b" text-anchor="middle">${i}</text>`); }
  for (let j = 0; j <= yMax; j += 1) { const ty = y(j); parts.push(`<line x1="${left - 5}" y1="${ty.toFixed(1)}" x2="${left}" y2="${ty.toFixed(1)}" stroke="#2b2b2b"/><text x="${left - 9}" y="${(ty + 4).toFixed(1)}" font-size="12" fill="#2b2b2b" text-anchor="end">${j}</text>`); }
  const pts = (Array.isArray(p.points) ? p.points : []).slice(0, 12);
  if (p.connect && pts.length > 1) parts.push(`<polyline fill="none" stroke="#4a7ca3" stroke-width="2" points="${pts.map((q) => `${x(q.x).toFixed(1)},${y(q.y).toFixed(1)}`).join(' ')}"/>`);
  for (const q of pts) {
    parts.push(`<circle cx="${x(q.x).toFixed(1)}" cy="${y(q.y).toFixed(1)}" r="5" fill="#e05252"/>`);
    if (q.label) parts.push(`<text x="${(x(q.x) + 8).toFixed(1)}" y="${(y(q.y) - 6).toFixed(1)}" font-size="12" fill="#e05252">${esc(q.label)}</text>`);
  }
  return { inner: parts.join(''), h: H };
}

function fractionBar(p) {
  const den = clamp(Math.round(num(p.den, 4)), 1, 12);
  const shaded = clamp(Math.round(num(p.shaded, 0)), 0, den);
  const H = 110, bw = 48, pad = 16;
  const gw = den * bw, offX = (W - gw) / 2, y = 36;
  const parts = [`<rect width="${W}" height="${H}" fill="#fff"/>`];
  for (let i = 0; i < den; i += 1) {
    parts.push(`<rect x="${(offX + i * bw).toFixed(1)}" y="${y}" width="${bw}" height="40" fill="${i < shaded ? '#d9d9d9' : '#fff'}" stroke="#2b2b2b" stroke-width="1.2"/>`);
  }
  return { inner: parts.join(''), h: H };
}

const RENDERERS = { number_line: numberLine, bar, blocks, points, fraction_bar: fractionBar };

export function isTemplate(t) { return TEMPLATES.includes(t); }

export function renderFigureSvg(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const t = String(spec.template || '');
  const fn = RENDERERS[t];
  if (!fn) return null;
  try {
    const out = fn(spec.params || {});
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${out.h}" width="${W}" height="${out.h}" preserveAspectRatio="xMidYMin meet" font-family="PingFang TC, Noto Sans TC, sans-serif">${out.inner}</svg>`;
  } catch {
    return null;
  }
}

export const FIGURE_TEMPLATES = TEMPLATES;
