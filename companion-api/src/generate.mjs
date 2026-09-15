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

// 去除參考註記：任何位置的「(或…)」替代，與開頭／結尾的「(…參考/答案/註…)」。
export function stripNote(text) {
  let t = String(text ?? '').trim().replace(/[（(][^）)]*或[^）)]*[）)]/g, '');
  const note = '[（(][^）)]*(?:參考|答案|註)[^）)]*[）)]';
  let prev;
  do {
    prev = t;
    t = t.replace(new RegExp(`^${note}\\s*`), '').replace(new RegExp(`\\s*${note}$`), '').trim();
  } while (t !== prev);
  return t.replace(/\s+/g, ' ').trim();
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

// --- 關係符號（＝ ＞ ＜ ≥ ≤ ≠）---
const RELOP_CANON = { '＝': '=', '=': '=', '＞': '>', '>': '>', '＜': '<', '<': '<', '≥': '≥', '≤': '≤', '≠': '≠' };
const RELOP_DISPLAY = { '=': '＝', '>': '＞', '<': '＜', '≥': '≥', '≤': '≤', '≠': '≠' };
const RELOP_POOL = ['=', '>', '<', '≥', '≤', '≠'];

export function parseRelop(raw) {
  const t = stripNote(raw).trim();
  if (t.length !== 1) return null;
  return RELOP_CANON[t] || null;
}

// 答案是否含需轉點選題的特殊符號。
const SPECIAL_RE = /[＝=＞><＜≥≤≠√×÷±°∠，,、;；]/;
export function hasSpecialSymbols(answer) {
  return SPECIAL_RE.test(String(answer ?? ''));
}

// 多值集合的干擾項：針對某一格做數值擾動，確保整組不同。
function setDistractors(values, correctKey, count) {
  const parsedValues = values.map(parseAnswer);
  if (parsedValues.some((p) => !p)) return [];
  const out = [];
  const seen = new Set([correctKey]);
  for (let idx = 0; idx < values.length && out.length < count; idx++) {
    for (const d of buildDistractors(parsedValues[idx], count)) {
      const mutated = values.map((v, i) => (i === idx ? formatValue(d) : v));
      const joined = mutated.join('、');
      if (seen.has(joined)) continue;
      seen.add(joined);
      out.push({ joined, html: mutated.map((v) => htmlForValue(parseAnswer(v))).join('、') });
      if (out.length >= count) break;
    }
  }
  return out;
}

function choiceResult(mixed, meta) {
  const correctIndex = mixed.findIndex((o) => o.isCorrect);
  return {
    type: 'choice',
    generator: 'rule-distractor',
    generatorVersion: '1.2.0',
    confidence: 0.7,
    unit: meta.unit || null,
    options: mixed.map((o) => o.label),
    optionsHtml: mixed.map((o) => o.html),
    correctIndex,
    correctValue: mixed[correctIndex].label,
    correctHtml: mixed[correctIndex].html,
  };
}

// --- 文字近似法：中文分數、內含數字、運算詞 ---
const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_ARR = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function cnToNum(s) {
  s = String(s);
  let m;
  if (s === '十') return 10;
  if ((m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])$/))) return CN_DIGIT[m[1]] * 10 + CN_DIGIT[m[2]];
  if ((m = s.match(/^([一二三四五六七八九])十$/))) return CN_DIGIT[m[1]] * 10;
  if ((m = s.match(/^十([一二三四五六七八九])$/))) return 10 + CN_DIGIT[m[1]];
  if (CN_DIGIT[s]) return CN_DIGIT[s];
  return null;
}

function numToCn(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  if (n < 10) return CN_ARR[n];
  if (n === 10) return '十';
  if (n < 20) return `十${CN_ARR[n - 10]}`;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${CN_ARR[t]}十${o ? CN_ARR[o] : ''}`;
}

function textCandidates(answer) {
  const cands = [];
  const cf = answer.match(/^([一二三四五六七八九十]+)分之([一二三四五六七八九十]+)(.*)$/);
  if (cf) {
    const den = cnToNum(cf[1]);
    const num = cnToNum(cf[2]);
    const rest = cf[3] || '';
    if (den && num) {
      const forms = [[num, den + 1], [num, den - 1], [num + 1, den], [num - 1, den], [den, num]];
      for (const [n, d] of forms) {
        if (n < 1 || d < 2) continue;
        const cnN = numToCn(n);
        const cnD = numToCn(d);
        if (cnN && cnD) cands.push(`${cnD}分之${cnN}${rest}`);
      }
    }
  }
  for (const m of answer.matchAll(/\d+(?:\.\d+)?/g)) {
    const v = Number(m[0]);
    for (const nv of [v + 1, v - 1, v + 10, v * 2, v % 2 === 0 ? v / 2 : null]) {
      if (nv == null || nv <= 0 || nv === v) continue;
      cands.push(answer.replace(m[0], String(nv)));
    }
  }
  for (const [word, alts] of [['加上', ['減掉', '乘上', '除以']], ['減掉', ['加上', '乘上', '除以']]]) {
    if (answer.includes(word)) for (const alt of alts) cands.push(answer.replace(word, alt));
  }
  return [...new Set(cands)].filter((s) => s && s !== answer);
}

function buildTextDistractors(answer, count) {
  return textCandidates(answer).slice(0, count);
}

// 由 fill_blank / short_answer 產生「點選題」變體（預設 5 選項＝正解＋4 誘答）。
// 適用：關係符號、多值集合、單一數值/分數、文字近似（中文分數／內含數字）。
export function toChoiceVariant(question, { count = 4 } = {}) {
  const type = String(question.questionType || '').trim();
  if (!['fill_blank', 'short_answer'].includes(type)) return null;
  const raw = stripNote(question.answer);
  if (!raw) return null;

  // 1) 關係符號（＝ ＞ ＜ …）
  const relop = parseRelop(raw);
  if (relop) {
    const distract = RELOP_POOL.filter((s) => s !== relop).slice(0, count);
    if (distract.length < count) return null;
    const mixed = shuffle([relop, ...distract].map((s) => ({
      label: RELOP_DISPLAY[s], html: escapeHtml(RELOP_DISPLAY[s]), isCorrect: s === relop,
    })));
    return choiceResult(mixed, {});
  }

  // 2) 多值集合（多填空）
  const values = splitValues(raw);
  if (values.length > 1) {
    const correctKey = values.join('、');
    const ds = setDistractors(values, correctKey, count);
    if (ds.length < count) return null;
    const correct = { label: correctKey, html: values.map((v) => htmlForValue(parseAnswer(v))).join('、'), isCorrect: true };
    const opts = [correct, ...ds.slice(0, count).map((d) => ({ label: d.joined, html: d.html, isCorrect: false }))];
    return choiceResult(shuffle(opts), {});
  }

  // 3) 單一數值 / 分數
  const parsed = parseAnswer(raw);
  if (parsed) {
    const distractors = buildDistractors(parsed, count);
    if (distractors.length >= count) {
      const correct = { label: formatValue(parsed), html: htmlForValue(parsed), isCorrect: true };
      const opts = [correct, ...distractors.slice(0, count).map((d) => ({ label: formatValue(d), html: htmlForValue(d), isCorrect: false }))];
      return choiceResult(shuffle(opts), { unit: parsed.unit });
    }
  }

  // 4) 文字近似法（中文分數、內含數字、運算詞）；跳過含 OMML 殘留者。
  if (!/[　]|\(\(/.test(raw) && raw.length <= 26) {
    const ds = buildTextDistractors(raw, count);
    if (ds.length >= count) {
      const opts = [
        { label: raw, html: escapeHtml(raw), isCorrect: true },
        ...ds.slice(0, count).map((s) => ({ label: s, html: escapeHtml(s), isCorrect: false })),
      ];
      return choiceResult(shuffle(opts), {});
    }
  }
  return null;
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
