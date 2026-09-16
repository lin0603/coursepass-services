import { config } from './config.mjs';

// 淺顯易懂的解題（Gemini）。金鑰只存在後端；前端呼叫 /v1/explain 代理。
const SYSTEM_PROMPT = [
  '你是台灣國小數學老師，正在幫老師備課審題。',
  '請用「淺顯易懂」的方式解這道題：用國小五年級學生聽得懂的口語、步驟清楚、避免艱深術語。',
  '格式：先一句話點出重點，再用 2–5 個步驟說明，最後用「答案：」給出正解。',
  '使用繁體中文、純文字（可用簡單列點，不要 Markdown 標題）。',
].join('\n');

const cache = new Map(); // key -> explanation（省成本；重啟即清）

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
  const text = buildUserText(input);
  const key = `${config.geminiModel}\u0000${text}`;
  if (cache.has(key)) return { model: config.geminiModel, cached: true, explanation: cache.get(key) };

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
  return { model: config.geminiModel, cached: false, explanation };
}
