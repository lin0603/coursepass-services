import { config } from './config.mjs';
import { store } from './db.mjs';

// 淺顯易懂的解題（Gemini）。金鑰只存在後端；前端呼叫 /v1/explain 代理。
const SYSTEM_PROMPT = [
  '你是台灣國小數學老師，正在幫老師備課審題。',
  '請用「淺顯易懂」的方式解這道題：用國小五年級學生聽得懂的口語、步驟清楚、避免艱深術語。',
  '格式：先一句話點出重點，再用 2–5 個步驟說明，最後用「答案：」給出正解。',
  '使用繁體中文、純文字（可用簡單列點，不要 Markdown 標題）。',
].join('\n');

const cache = new Map(); // key -> explanation（省成本；重啟即清）

function typeHint(type) {
  switch (type) {
    case 'matching': return '這是「連連看」：請先說明判斷依據，再逐組列出正確配對（左→右）。';
    case 'choice': return '這是「選擇題」：請說明每個選項為什麼對或錯，最後指出正解。';
    case 'fill_blank': return '這是「填空／計算題」：請說明算法與為什麼得到這個答案。';
    default: return '';
  }
}

function buildUserText({ prompt, answer, type, options }) {
  const lines = [`題目：${prompt || ''}`];
  if (Array.isArray(options) && options.length) {
    lines.push(`選項：${options.map((o, i) => `${'ABCDEFGH'[i] || i + 1}. ${o}`).join(' / ')}`);
  }
  if (type) lines.push(`題型：${type}`);
  if (answer) lines.push(`（參考答案：${answer}）`);
  return lines.join('\n');
}

export async function explainQuestion(input = {}) {
  if (!config.geminiApiKey) throw new Error('gemini key not configured (set GEMINI_API_KEY)');
  const id = input.id;
  // 已解題過就沿用，不再呼叫 Gemini（避免浪費 token）
  if (id) {
    const row = store.getExplanation(id);
    if (row && row.explanation) return { model: row.model || config.geminiModel, cached: true, explanation: row.explanation };
  }
  const text = buildUserText(input);
  const key = `${config.geminiModel}\u0000${text}`;
  if (cache.has(key)) return { model: config.geminiModel, cached: true, explanation: cache.get(key) };

  const hint = typeHint(input.type);
  const body = {
    systemInstruction: { parts: [{ text: hint ? `${SYSTEM_PROMPT}\n${hint}` : SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const explanation = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  cache.set(key, explanation);
  if (id) store.upsertExplanation({ sourceQuestionId: id, model: config.geminiModel, explanation });
  return { model: config.geminiModel, cached: false, explanation };
}


// ---- AI 優化迴路：依老師審查意見改寫題目 ----
const REWRITE_SYSTEM = [
  '你是台灣國小數學教材編輯。請依「老師審查意見」改寫題目，維持相同考點與難度，',
  '讓敘述更清楚、選項更精準（避免模糊或雙解）。',
  '只輸出 JSON：{"prompt":"...","options":["...","..."],"answer":"...","rationale":"為什麼這樣改（一句話）"}。',
].join('\n');

export async function rewriteQuestion(input = {}) {
  if (!config.geminiApiKey) throw new Error('gemini key not configured (set GEMINI_API_KEY)');
  const notes = Array.isArray(input.notes) ? input.notes.filter(Boolean).join('；') : String(input.notes || '');
  const user = [
    `題目：${input.prompt || ''}`,
    Array.isArray(input.options) && input.options.length ? `選項：${input.options.map((o, i) => `${'ABCDEFGH'[i] || i + 1}. ${o}`).join(' / ')}` : '',
    input.answer ? `答案：${input.answer}` : '',
    input.type ? `題型：${input.type}` : '',
    `老師審查意見：${notes || '（無）'}`,
  ].filter(Boolean).join('\n');
  const body = {
    systemInstruction: { parts: [{ text: REWRITE_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200, responseMimeType: 'application/json' },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { prompt: text, options: [], answer: '', rationale: '' }; }
  return { model: config.geminiModel, revision: parsed };
}


// 依老師對上一版解題的意見，重新產生 AI 解題（不走快取；不覆寫 id 快取）
export async function regenerateExplanation(input = {}) {
  if (!config.geminiApiKey) throw new Error('gemini key not configured (set GEMINI_API_KEY)');
  const text = buildUserText(input) + (input.note ? `\n老師對上一版解題的意見（請據此改進）：${input.note}` : '');
  const hint = typeHint(input.type);
  const body = {
    systemInstruction: { parts: [{ text: hint ? `${SYSTEM_PROMPT}\n${hint}` : SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const explanation = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  return { model: config.geminiModel, explanation };
}


// ---- 變化題產生（同考點、不同樣貌；保留原題）----
const VARIANT_SYSTEM = [
  '你是台灣國小數學教材編輯。請參考「原題」的題型與設計目的，產生 1 道「變化題」。',
  '必須：同知識節點與同考點、同題型、難度相近（±1）、年級適齡、台灣小學用語、繁體中文。',
  '答案必須唯一且正確（請自行驗算）。不要逐字重製原題；不可改變考點。',
  '至少改變 2 個維度：數值/單位、情境、問法、選項與干擾項、呈現形式、順序。',
  '只輸出 JSON：{"prompt":"...","options":["..."],"answer":"...","type":"choice|fill_blank","rationale":"為什麼這樣變（一句話）","figureNote":"若原題含圖，說明圖要怎麼處理"}。',
].join('\n');

export async function generateVariant(input = {}) {
  if (!config.geminiApiKey) throw new Error('gemini key not configured (set GEMINI_API_KEY)');
  const user = [
    `原題內容：${input.prompt || ''}`,
    Array.isArray(input.options) && input.options.length ? `原題選項：${input.options.map((o, i) => `${'ABCDEFGH'[i] || i + 1}. ${o}`).join(' / ')}` : '',
    input.answer ? `原題答案：${input.answer}` : '',
    input.type ? `題型：${input.type}` : '',
    input.node ? `知識節點：${input.node}${input.nodeName ? ' ' + input.nodeName : ''}` : '',
    input.difficulty ? `難度：${input.difficulty}` : '',
    input.hasFigure ? '原題含圖（請在 figureNote 說明圖的處理方式；若無法只靠文字出題，請仍給出文字版並註明）' : '',
  ].filter(Boolean).join('\n');
  const body = {
    systemInstruction: { parts: [{ text: VARIANT_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 1200, responseMimeType: 'application/json' },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { prompt: text, options: [], answer: '', type: 'fill_blank', rationale: '' }; }
  return { model: config.geminiModel, variant: parsed };
}
