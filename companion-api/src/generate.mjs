// Mathematics-aware activity generation (activity layer Phase B).
// 教育原則：數學以 MathML 為正式顯示（分數用堆疊分數，不以斜線文字呈現）；
// 誘答取自「反映常見錯誤」的規則，並經驗證（互異、唯一正解、非等值）。
import { config } from './config.mjs';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// a/b（可含整數部分 w）
export function mathmlFraction(whole, num, den) {
  const head = whole ? `<mn>${whole}</mn>` : '';
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline">${head}<mfrac><mrow><mn>${num}</mn></mrow><mrow><mn>${den}</mn></mrow></mfrac></math>`;
}

// 去除結尾的參考註記，例如「(本題答案僅供參考)」。
export function stripNote(text) {
  return String(text ?? '').trim().replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
}

// 拆多值答案（以 、，,;； 分隔；不切分數的 /）。
export function splitValues(text) {
  const cleaned = stripNote(text);
  if (!cleaned) return [];
  return cleaned.split(/[，,、;；]+/).map((s) => s.trim()).filter(Boolean);
}

// 解析純文字答案 → 值；多值/無法解析回傳 null（不生成）。
export function parseAnswer(raw) {
  let text = stripNote(raw);
  if (!text) return null;
  if (/[，,、;；]/.test(text)) return null; // 多個答案 → 略過
  let unit = '';
  const unitMatch = text.match(/[\u4e00-\u9fffA-Za-z]+$/);
  if (unitMatch) {
    unit = unitMatch[0];
    text = text.slice(0, unitMatch.index).trim();
  }
  let m;
  if ((m = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {
    const whole = Number(m[1]);
    const num = Number(m[2]);
    const den = Number(m[3]);
    if (!den) return null;
    return { kind: 'fraction', whole, num, den, value: whole + num / den, unit, raw: text };
  }
  if ((m = text.match(/^(\d+)\s*\/\s*(\d+)$/))) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!den) return null;
    return { kind: 'fraction', whole: 0, num, den, value: num / den, unit, raw: text };
  }
  if ((m = text.match(/^\d+\.\d+$/))) {
    return { kind: 'decimal', value: Number(text), unit, raw: text };
  }
  if ((m = text.match(/^\d+$/))) {
    return { kind: 'integer', value: Number(text), unit, raw: text };
  }
  return null;
}

export function formatValue(parsed) {
  if (!parsed) return '';
  if (parsed.kind === 'fraction') {
    return parsed.whole ? `${parsed.whole} ${parsed.num}/${parsed.den}` : `${parsed.num}/${parsed.den}`;
  }
  return String(parsed.raw ?? parsed.value);
}

export function htmlForValue(parsed) {
  if (parsed && parsed.kind === 'fraction') return mathmlFraction(parsed.whole, parsed.num, parsed.den);
  return escapeHtml(formatValue(parsed));
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function fractionOf(value, maxDen = 100) {
  // 找最接近 value 的簡分數（限定合理分母）
  let best = null;
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(value * den);
    if (num <= 0) continue;
    const diff = Math.abs(value - num / den);
    if (!best || diff < best.diff - 1e-12) best = { num, den, diff };
    if (diff < 1e-9) break;
  }
  if (!best) return null;
  const g = gcd(best.num, best.den);
  return { whole: 0, num: best.num / g, den: best.den / g, kind: 'fraction', value };
}

// 依「常見錯誤」生成候選干擾項（值），再挑最接近正確值者。
function candidateDistractors(parsed) {
  const cands = [];
  const push = (p) => {
    if (p && Number.isFinite(p.value) && p.value > 0) cands.push(p);
  };
  if (parsed.kind === 'fraction') {
    const { whole, num, den } = parsed;
    if (num) push({ kind: 'fraction', whole, num: den, den: num, value: whole + den / num }); // 分子分母互換
    push({ kind: 'fraction', whole, num: num + 1, den, value: whole + (num + 1) / den }); // 分子±1
    if (num > 1) push({ kind: 'fraction', whole, num: num - 1, den, value: whole + (num - 1) / den });
    push({ kind: 'fraction', whole, num, den: den + 1, value: whole + num / (den + 1) }); // 分母±1
    if (den > 1) push({ kind: 'fraction', whole, num, den: den - 1, value: whole + num / (den - 1) });
    push({ kind: 'fraction', whole, num: num + den, den, value: whole + (num + den) / den }); // 誤把分子加分母
    if (whole) {
      push({ kind: 'fraction', whole: whole + 1, num, den, value: whole + 1 + num / den }); // 整數部分錯
      if (whole > 1) push({ kind: 'fraction', whole: whole - 1, num, den, value: whole - 1 + num / den });
      push(fractionOf(whole * den + num, 100)); // 錯把帶分數當乘積
    }
  } else if (parsed.kind === 'integer') {
    const n = parsed.value;
    for (const d of [1, -1, 10, -10, 9, -9, 100, -100]) push({ kind: 'integer', value: n + d, raw: String(n + d) });
    push({ kind: 'integer', value: n * 2, raw: String(n * 2) });
    if (n % 2 === 0) push({ kind: 'integer', value: n / 2, raw: String(n / 2) });
    const rev = Number(String(n).split('').reverse().join(''));
    push({ kind: 'integer', value: rev, raw: String(rev) });
  } else if (parsed.kind === 'decimal') {
    const n = parsed.value;
    for (const d of [0.1, -0.1, 1, -1, 0.01, -0.01, 10, -10]) {
      const v = Math.round((n + d) * 1e6) / 1e6;
      push({ kind: 'decimal', value: v, raw: String(v) });
    }
  }
  return cands;
}

// 產生 3 個干擾項：值互異、非等於正解、盡量接近正解（似真）。
export function buildDistractors(parsed, count = 3) {
  const correct = parsed.value;
  const seen = new Set([Math.round(correct * 1e6)]);
  const picked = [];
  const cands = candidateDistractors(parsed)
    .filter((c) => {
      const k = Math.round(c.value * 1e6);
      if (seen.has(k)) return false;
      if (Math.abs(c.value - correct) < 1e-9) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => Math.abs(a.value - correct) - Math.abs(b.value - correct));
  for (const c of cands) {
    picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 由 fill_blank / short_answer 產生 choice 變體（含 MathML 選項）；
// 無法解析或干擾項不足者回傳 null。
export function toChoiceVariant(question, { count = 3 } = {}) {
  const type = String(question.questionType || '').trim();
  if (!['fill_blank', 'short_answer'].includes(type)) return null;
  const parsed = parseAnswer(question.answer);
  if (!parsed) return null;
  const distractors = buildDistractors(parsed, count);
  if (distractors.length < count) return null;
  const correct = { ...parsed, isCorrect: true };
  const mixed = shuffle([correct, ...distractors.map((d) => ({ ...d, isCorrect: false }))]);
  const correctIndex = mixed.findIndex((o) => o.isCorrect);
  return {
    type: 'choice',
    generator: 'rule-distractor',
    generatorVersion: '1.0.0',
    confidence: 0.7,
    unit: parsed.unit || null,
    options: mixed.map((o) => formatValue(o)),
    optionsHtml: mixed.map((o) => htmlForValue(o)),
    correctIndex,
    correctValue: formatValue(parsed),
    correctHtml: htmlForValue(parsed),
  };
}

// 真分數的等值分數配對（數學：擴分/約分表徵轉換）。
// 取同一節點內相異的「真分數」答案，各自配一個擴分後的分數；值互異 → 唯一配對。
export function buildMatching(questions, { pairCount = 4 } = {}) {
  const seen = new Map();
  for (const q of questions || []) {
    const p = parseAnswer(q.answer);
    if (!p || p.kind !== 'fraction' || p.whole) continue;
    if (!p.den || p.den > 20 || p.value >= 2) continue;
    const g = gcd(p.num, p.den);
    const num = p.num / g;
    const den = p.den / g;
    if (num >= den) continue; // 僅真分數
    const key = `${num}/${den}`;
    if (!seen.has(key)) seen.set(key, { num, den });
  }
  const items = [...seen.values()];
  if (items.length < pairCount) return null;
  const pairs = items.slice(0, pairCount).map((r, i) => {
    const k = 2 + (i % 3);
    return {
      left: `${r.num}/${r.den}`,
      right: `${r.num * k}/${r.den * k}`,
      leftHtml: mathmlFraction(0, r.num, r.den),
      rightHtml: mathmlFraction(0, r.num * k, r.den * k),
    };
  });
  return {
    type: 'matching',
    prompt: '把一樣大的分數連起來',
    pairs,
    generator: 'equivalent-fraction',
    generatorVersion: '1.0.0',
    confidence: 0.8,
  };
}
