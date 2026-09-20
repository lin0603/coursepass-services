import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { config } from './config.mjs';
import { knowledge } from './knowledgeClient.mjs';
import { assemble } from './activities.mjs';
import { buildActivitySet } from './mixer.mjs';
import { groupByTopic, spreadNodes } from './path.mjs';
import { buildNotes, buildReport } from './report.mjs';
import { getLlmVariants } from './llmVariants.mjs';
import { explainQuestion, explainVariant, generateVariant, regenerateExplanation, rewriteQuestion, verifyVariant } from './explain.mjs';
import { renderFigureSvg } from './figures.mjs';
import { store } from './db.mjs';

const app = express();
app.use(cors());
app.use(express.json());

// Optional bearer auth (disabled when COMPANION_API_TOKEN is unset).
app.use((req, res, next) => {
  if (!config.apiToken || req.path === '/healthz') return next();
  if (req.headers.authorization === `Bearer ${config.apiToken}`) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/healthz', (_req, res) => res.json({ ok: true }));
// 審題站簡易登入：驗通行碼（未設 PREVIEW_PASSCODE 則不啟用）
app.get('/v1/login', (_req, res) => res.json({ gate: Boolean(config.previewPasscode || config.adminPasscode) }));
app.post('/v1/login', (req, res) => {
  const code = String((req.body || {}).code || '');
  const user = config.previewPasscode;
  const admin = config.adminPasscode;
  if (!user && !admin) return res.json({ ok: true, gate: false, admin: true });
  const okAdmin = Boolean(admin) && code === admin;
  const okUser = Boolean(user) && code === user;
  res.json({ ok: okAdmin || okUser, gate: true, admin: okAdmin || (!user && okAdmin) });
});
app.get('/version', asyncHandler(async (_req, res) => {
  res.json({ service: 'companion-api', version: '1.0.0', knowledge: await knowledge.version() });
}));

// --- Catalog (proxied, read-only) ---
app.get('/v1/catalog/subjects', asyncHandler(async (_req, res) => res.json({ items: await knowledge.subjects() })));
app.get('/v1/catalog/chapters', asyncHandler(async (req, res) => res.json(await knowledge.chapters(req.query))));
app.get('/v1/catalog/search', asyncHandler(async (req, res) => res.json(await knowledge.search(req.query))));

// --- Units (knowledge nodes) ---
app.get('/v1/units', asyncHandler(async (req, res) => res.json(await knowledge.nodes(req.query))));
app.get('/v1/units/:id', asyncHandler(async (req, res) => res.json(await knowledge.node(req.params.id))));

// --- Activities for a unit (assembled from bound questions) ---
app.get('/v1/units/:id/activities', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  // Default: only teacher-approved questions. Dev can pass allowReviewRequired=1.
  const reviewStatus = req.query.reviewStatus || (req.query.allowReviewRequired === '1' ? undefined : 'approved');
  const data = await knowledge.questions(req.params.id, { limit, offset: Number(req.query.offset) || 0, reviewStatus, type: req.query.type });
  const items = data.items.map((q) => ({ ...q, primaryKnowledgeNodeId: q.primaryKnowledgeNodeId || req.params.id }));
  res.json({ unitId: req.params.id, total: data.total, items: assemble(items, { llmMap, typeOverrides: store.typeOverrides() }) });
}));

// --- Mixed activity set for a unit (Duolingo-style session, activity layer Phase E) ---
app.get('/v1/units/:id/activity-set', asyncHandler(async (req, res) => {
  const count = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);
  const reviewStatus = req.query.reviewStatus || (req.query.allowReviewRequired === '1' ? undefined : 'approved');
  // Pool up to 3 pages so later questions (e.g. fraction answers for matching) are included.
  const pool = [];
  let offset = 0;
  let total = 0;
  for (let page = 0; page < 3; page++) {
    const chunk = await knowledge.questions(req.params.id, { limit: 200, offset, reviewStatus });
    total = chunk.total;
    pool.push(...(chunk.items || []).map((q) => ({ ...q, primaryKnowledgeNodeId: q.primaryKnowledgeNodeId || req.params.id })));
    if (!Array.isArray(chunk.items) || chunk.items.length < 200) break;
    offset += 200;
  }
  res.json({ unitId: req.params.id, count, total, items: buildActivitySet(pool, { count, llmMap, typeOverrides: store.typeOverrides() }) });
}));

// --- Learning path for a unit's subject/grade, with learner status (Phase P1) ---
app.get('/v1/units/:id/path', asyncHandler(async (req, res) => {
  const info = await knowledge.node(req.params.id);
  const node = info && info.node ? info.node : {};
  const [paths, progress] = await Promise.all([
    knowledge.paths({ subject: node.subject, grade: node.grade }),
    Promise.resolve(req.query.learner ? store.getProgress(req.query.learner) : { nodes: [] }),
  ]);
  const progressByNode = Object.fromEntries((progress.nodes || []).map((n) => [n.nodeId, n]));
  const result = groupByTopic(paths.groups || [], progressByNode);
  res.json({ unitId: req.params.id, subject: node.subject, grade: node.grade, ...result });
}));

// --- Lesson notes (重點整理) for a unit (Phase P2) ---
app.get('/v1/units/:id/notes', asyncHandler(async (req, res) => {
  const [info, questions] = await Promise.all([
    knowledge.node(req.params.id),
    knowledge.questions(req.params.id, { limit: 5, reviewStatus: 'approved' }),
  ]);
  const node = info && info.node ? info.node : { id: req.params.id };
  res.json(buildNotes(node, questions.items || []));
}));

// --- Learner report (三問：學會什麼 / 哪裡需要幫忙 / 距離目標) (Phase P2) ---
app.get('/v1/learners/:learnerId/report', asyncHandler(async (req, res) => {
  const unit = req.query.unit || 'N-5-4';
  const info = await knowledge.node(unit);
  const node = info && info.node ? info.node : {};
  const paths = await knowledge.paths({ subject: node.subject, grade: node.grade });
  const nodes = (paths.groups || []).flatMap((g) => g.nodes || []);
  const progress = store.getProgress(req.params.learnerId);
  const wrongbook = store.getWrongbook(req.params.learnerId);
  res.json({
    learnerId: req.params.learnerId,
    subject: node.subject,
    grade: node.grade,
    unit,
    report: buildReport({ progressNodes: progress.nodes || [], wrongbook, nodes }),
  });
}));

// --- Placement: short cross-topic assessment set (Phase P2) ---
app.get('/v1/units/:id/placement', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
  const info = await knowledge.node(req.params.id);
  const node = info && info.node ? info.node : {};
  const paths = await knowledge.paths({ subject: node.subject, grade: node.grade });
  const picked = spreadNodes(paths.groups || [], limit);
  const items = [];
  for (const candidate of picked) {
    if (items.length >= limit) break;
    const q = await knowledge.questions(candidate.id, { limit: 3, reviewStatus: 'approved' });
    for (const item of (q.items || [])) {
      items.push({ ...item, primaryKnowledgeNodeId: item.nodeId || candidate.id });
      if (items.length >= limit) break;
    }
  }
  res.json({ unitId: req.params.id, subject: node.subject, grade: node.grade, items: assemble(items, { llmMap, typeOverrides: store.typeOverrides() }) });
}));

// --- Learner state ---
const answerSchema = z.object({
  sourceQuestionId: z.string().min(1),
  nodeId: z.string().optional(),
  selected: z.union([z.string(), z.array(z.string())]).optional(),
  correct: z.boolean(),
});

app.get('/v1/learners/:learnerId/progress', asyncHandler(async (req, res) => res.json(store.getProgress(req.params.learnerId))));
app.get('/v1/learners/:learnerId/wrongbook', asyncHandler(async (req, res) => {
  const rows = store.getWrongbook(req.params.learnerId);
  if (req.query.detail !== '1') return res.json({ items: rows });
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const items = await Promise.all(rows.slice(0, limit).map(async (row) => {
    try {
      const q = await knowledge.question(row.sourceQuestionId);
      const activity = assemble([{ ...q, primaryKnowledgeNodeId: q.nodeId || row.nodeId }])[0];
      return { ...row, question: activity };
    } catch {
      return { ...row, question: null };
    }
  }));
  res.json({ items });
}));
app.post('/v1/learners/:learnerId/answers', asyncHandler(async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  res.json(store.recordAnswer({ learnerId: req.params.learnerId, ...parsed.data }));
}));

// --- AI 解題（Gemini 代理；金鑰只在後端）---
const explainSchema = z.object({
  id: z.string().max(64).optional(),
  prompt: z.string().max(4000).optional(),
  answer: z.string().max(2000).optional(),
  type: z.string().max(64).optional(),
  options: z.array(z.string().max(500)).max(8).optional(),
});

const explainVariantSchema = z.object({
  id: z.string().min(1),
  version: z.number().int(),
  prompt: z.string().max(4000),
  options: z.array(z.string().max(500)).max(8).optional(),
  answer: z.string().max(2000).optional(),
  type: z.string().max(64).optional(),
  note: z.string().max(2000).optional(),
  force: z.boolean().optional(),
});
app.post('/v1/explain-variant', asyncHandler(async (req, res) => {
  const parsed = explainVariantSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  res.json(await explainVariant(parsed.data));
}));
app.post('/v1/explain', asyncHandler(async (req, res) => {
  const parsed = explainSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  res.json(await explainQuestion(parsed.data));
}));

// AI 解題「需重審」佇列
app.get('/v1/explanations/queue', (_req, res) => res.json({ items: store.explanationQueue() }));

// 每日重生成 AI 解題（依老師的 需調整 意見）；產生後標記為需重審
app.post('/v1/explanations/refresh', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number((req.body || {}).limit) || 20, 1), 200);
  const queue = store.aiAdjustQueue(limit);
  if (!queue.length) return res.json({ refreshed: 0, remaining: 0 });
  const data = await fetch(config.explainDataUrl).then((r) => r.json()).catch(() => ({ items: [] }));
  const byId = {};
  for (const it of (data.items || [])) byId[it.id] = it;
  let refreshed = 0;
  for (const row of queue) {
    const q = byId[row.sourceQuestionId];
    if (!q) continue;
    try {
      const out = await regenerateExplanation({ prompt: String(q.prompt || '').replace(/<[^>]+>/g, ''), answer: q.answer, type: q.type, options: (q.options || []).map((o) => (typeof o === 'object' ? o.content : o)).filter(Boolean), note: row.aiNote });
      store.upsertExplanation({ sourceQuestionId: row.sourceQuestionId, model: out.model, explanation: out.explanation, reviewStatus: 'needs_review', regeneratedAt: new Date().toISOString() });
      store.clearAiAdjust(row.sourceQuestionId);
      refreshed += 1;
    } catch (e) { console.error('refresh failed', row.sourceQuestionId, e.message); }
  }
  res.json({ refreshed, remaining: store.aiAdjustQueue(1).length ? 1 : 0 });
}));

// 已解題過的清單（前端載入後就不必再按「產生解題」）
app.get('/v1/explanations', (_req, res) => {
  const items = {};
  const models = {};
  for (const r of store.listExplanations()) { items[r.sourceQuestionId] = r.explanation; models[r.sourceQuestionId] = r.model; }
  res.json({ items, models });
});

// --- Question review / comments (persisted) ---
const reviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'adjust', 'rejected']).optional(),
  note: z.string().max(2000).optional(),
  type: z.string().max(32).optional(),
  typeMismatch: z.boolean().optional(),
  nodeId: z.string().max(64).optional(),
  reviewerId: z.string().max(64).optional(),
  courseId: z.string().max(64).optional(),
  aiStatus: z.enum(['', 'approved', 'adjust']).optional(),
  aiNote: z.string().max(2000).optional(),
});

// 匯出（給 AI 後續優化題目用）：結構化審查意見
app.get('/v1/reviews/export', (req, res) => {
  const items = store.exportReviews();
  if (req.query.format === 'csv') {
    const cols = ['sourceQuestionId', 'reviewerId', 'reviewerName', 'nodeId', 'status', 'type', 'typeMismatch', 'note', 'updatedAt'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...items.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reviews-export.csv"');
    return res.send('\uFEFF' + csv);
  }
  res.json({ count: items.length, items });
});
app.get('/v1/reviews', (req, res) => res.json({ items: store.listQuestionReviews({ sourceQuestionId: req.query.question, reviewerId: req.query.reviewer }) }));
app.get('/v1/reviews/consensus', (_req, res) => res.json({ items: store.consensus() }));

// ---- 主管指標 ----
app.get('/v1/metrics', (_req, res) => res.json(store.metrics()));

// ---- AI 優化迴路：改寫版本 ----
const rewriteSchema = z.object({
  prompt: z.string().max(4000).optional(),
  options: z.array(z.string().max(500)).max(8).optional(),
  answer: z.string().max(2000).optional(),
  type: z.string().max(64).optional(),
  notes: z.union([z.string().max(4000), z.array(z.string().max(2000))]).optional(),
  courseId: z.string().max(64).optional(),
});
app.get('/v1/rewrites', (req, res) => res.json({ items: store.listRevisions({ sourceQuestionId: req.query.question }) }));

// ---- 變化題（同考點、不同樣貌；原題保留）----
const variantSchema = z.object({
  prompt: z.string().max(4000).optional(),
  options: z.array(z.string().max(500)).max(8).optional(),
  answer: z.string().max(2000).optional(),
  type: z.string().max(64).optional(),
  node: z.string().max(64).optional(),
  nodeName: z.string().max(120).optional(),
  difficulty: z.union([z.string(), z.number()]).optional(),
  hasFigure: z.boolean().optional(),
  courseId: z.string().max(64).optional(),
});
const UNIT = '(公斤|公升|公尺|公分|毫米|毫升|平方公尺|平方公分|個|片|塊|袋|箱|包|條|杯|瓶|本|頁|格|顆|人|元|組|張|盒|盤|把|件|支|枝|朵|次|天|分鐘|小時|週|年|種|份|堆|串|層|列|排|度|歲|樓|元)';
function numVal(x) {
  let t = String(x || '')
    .replace(/^\s*\(([A-Ha-h]|[1-8])\)\s*/, '')
    .replace(/^\s*([A-Ha-h]|[1-8])[.、:：](?![0-9])\s*/, '')
    .trim()
    .replace(/[０-９．／]/g, (c) => '0123456789./'['０１２３４５６７８９．／'.indexOf(c)]);
  let m = t.match(new RegExp(`^(\\d+)\\s+(\\d+)\\s*\\/\\s*(\\d+)\\s*${UNIT}?$`));
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(new RegExp(`^(\\d+)\\s*\\/\\s*(\\d+)\\s*${UNIT}?$`));
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(new RegExp(`^-?\\d+(\\.\\d+)?\\s*${UNIT}?$`));
  if (m) return Number(m[0].match(/^-?\d+(\.\d+)?/)[0]);
  return null;
}
const OPT_L = 'ABCDEFGH';
function answerIndex(ans, opts) {
  const a = String(ans || '').trim();
  const L = a.match(/^\(?([A-Ha-h])\)?[.、]?$/);
  if (L) { const i = OPT_L.indexOf(L[1].toUpperCase()); if (i >= 0 && i < opts.length) return i; }
  const N = a.match(/^\(?([1-8])\)?[.、]?$/);
  if (N && Number(N[1]) - 1 < opts.length) return Number(N[1]) - 1;
  let m = a.match(/^\(([1-8])\)\s*(.+)$/) || a.match(/^([1-8])[.、)]\s+(.+)$/);
  if (m) { const i = Number(m[1]) - 1; if (i >= 0 && i < opts.length) return i; }
  m = a.match(/^([A-Ha-h])[.、)]\s*(.+)$/);
  if (m) { const i = OPT_L.indexOf(m[1].toUpperCase()); if (i >= 0 && i < opts.length) return i; }
  const norm = (z) => String(z || '').replace(/\s+/g, '').replace(/[.。、,，]$/, '');
  const direct = opts.findIndex((o) => norm(o) === norm(a));
  if (direct >= 0) return direct;
  const av = numVal(a);
  if (av !== null) { const i = opts.findIndex((o) => { const v = numVal(o); return v !== null && Math.abs(v - av) < 1e-9; }); if (i >= 0) return i; }
  return -1;
}
function checkVariant(v, originalPrompt) {
  const reasons = [];
  const opts = Array.isArray(v.options) ? v.options.map((x) => String(x)).filter(Boolean) : [];
  if (!v.prompt) reasons.push('no_prompt');
  if (!v.answer) reasons.push('no_answer');
  if (v.type === 'choice') {
    if (opts.length < 2) reasons.push('too_few_options');
    if (new Set(opts).size !== opts.length) reasons.push('dup_options');
    const oddOneOut = /不一樣大|不相等|不同|不正確|錯誤|不是|最簡/.test(String(v.prompt || ''));
    const vals = opts.map(numVal);
    if (!oddOneOut && vals.every((x) => x !== null)) {
      for (let i = 0; i < vals.length; i += 1) for (let j = i + 1; j < vals.length; j += 1) {
        if (Math.abs(vals[i] - vals[j]) < 1e-9) { reasons.push('equal_options'); i = vals.length; break; }
      }
    }
    const idx = answerIndex(v.answer, opts);
    if (idx < 0) reasons.push('answer_not_in_options');
    else if (!oddOneOut && vals.every((x) => x !== null) && vals[idx] !== null) {
      const hits = vals.filter((x) => Math.abs(x - vals[idx]) < 1e-9).length;
      if (hits > 1) reasons.push('multiple_correct');
    }
  }
  if (originalPrompt && v.prompt && String(v.prompt).replace(/\s+/g, '') === String(originalPrompt).replace(/\s+/g, '')) reasons.push('identical_to_source');
  return [...new Set(reasons)];
}
function answerCandidates(ans, opts) {
  const a = String(ans || '').trim();
  const set = new Set();
  const i0 = answerIndex(a, opts);
  if (i0 >= 0) set.add(i0);
  const d = a.match(/^\(?([1-8])\)?[.、]?$/);
  if (d) {
    const n = Number(d[1]);
    if (n - 1 < opts.length) set.add(n - 1);
    if (n < opts.length) set.add(n);
  }
  return [...set];
}
const S2T = { 数: '數', 个: '個', 门: '門', 万: '萬', 与: '與', 为: '為', 众: '眾', 题: '題', 选: '選', 时: '時', 间: '間', 长: '長', 车: '車', 东: '東', 马: '馬', 鸟: '鳥', 龙: '龍', 龟: '龜', 书: '書', 写: '寫', 边: '邊', 发: '發', 会: '會', 点: '點', 线: '線', 张: '張', 颗: '顆', 这: '這', 过: '過', 还: '還', 应: '應', 规: '規', 则: '則', 关: '關', 计: '計', 观: '觀', 圆: '圓', 体: '體', 积: '積', 种: '種', 对: '對', 错: '錯', 义: '義', 复: '複', 简: '簡', 单: '單', 双: '雙', 边: '邊', 无: '無', 开: '開', 买: '買', 卖: '賣', 结: '結', 构: '構', 图: '圖', 么: '麼' };
function t2t(z) { return String(z || '').replace(/[\u4e00-\u9fff]/g, (c) => S2T[c] || c); }
function sameAnswer(a, b, opts) {
  if (!a || !b) return false;
  const ca = answerCandidates(a, opts);
  const cb = answerCandidates(b, opts);
  if (ca.length && cb.length && ca.some((i) => cb.includes(i))) return true;
  const norm = (z) => t2t(z).replace(/\s+/g, '').replace(/[（(][1-8A-Ha-h][）)]/g, '').replace(/[.。、,，;；:：]/g, '');
  if (norm(a) === norm(b)) return true;
  const va = numVal(a); const vb = numVal(b);
  return va !== null && vb !== null && Math.abs(va - vb) < 1e-9;
}
app.get('/v1/variants', (req, res) => res.json({ items: store.listVariants({ sourceQuestionId: req.query.question }) }));
async function generateVariantRow(id, input) {
  const out = await generateVariant(input);
  const payload = out.variant || {};
  if (payload.figure) { const svg = renderFigureSvg(payload.figure); if (svg) payload.figureSvg = svg; }
  const reasons = checkVariant(payload, input.prompt);
  if (input.hasFigure && !payload.figureSvg) reasons.push('figure_missing');
  let verify = null;
  if (payload.prompt && !reasons.length) {
    try {
      const vr = await verifyVariant({ prompt: payload.prompt, options: payload.options, type: payload.type });
      const opts2 = payload.options || [];
      const idxs = [...new Set((vr.allCorrect || []).map((x) => answerIndex(x, opts2)).filter((i) => i >= 0))];
      verify = { answer: vr.answer, allCorrect: vr.allCorrect, matchedCount: idxs.length, reason: vr.reason, model: vr.model };
      if (!sameAnswer(payload.answer, vr.answer, opts2)) reasons.push('self_verify_mismatch');
      const multiQ = /複選|多選|所有|哪些|全部寫出|哪些人|哪幾個/.test(String(payload.prompt || ''));
      const allAbove = opts2.some((o) => /以上皆是|以上都|皆正確|全部都|都正確|以上都對/.test(String(o)));
      if (!multiQ && !allAbove && idxs.length > 1) reasons.push('self_verify_multiple');
    } catch (e) { console.error('verify failed', id, e.message); }
  }
  if (input.targetCell) payload.targetCell = input.targetCell;
  const quality = { status: reasons.length ? 'needs_review' : 'ok', reasons, verify };
  return store.addVariant({ sourceQuestionId: id, nodeId: input.node, courseId: input.courseId, payload, rationale: payload.rationale, model: out.model, quality });
}
// 每日批次：優先重生成「需調整」，再補「尚未產生」的題
const batchSchema = z.object({
  limit: z.number().int().min(1).max(300).optional(),
  courseId: z.string().max(64).optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
});
app.post('/v1/variants/batch', asyncHandler(async (req, res) => {
  const b = batchSchema.safeParse(req.body || {}).data || {};
  const limit = b.limit || config.batchLimit;
  const courseId = b.courseId || config.batchCourseId;
  const [src, appd] = await Promise.all([
    fetch(config.explainDataUrl).then((r) => r.json()).catch(() => ({ items: [] })),
    fetch(config.appDataUrl).then((r) => r.json()).catch(() => ({ items: {} })),
  ]);
  const items = src.items || []; const app = appd.items || {};
  const byId = new Map(items.map((q) => [q.id, q]));
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  const curModel = config.geminiModel;
  const adjust = []; const flagged = []; const legacy = []; const fresh = [];
  for (const q of items) {
    if (!q || !q.id || q.hasFigure) continue;
    const a = app[q.id] || {};
    let type = a.type || q.type;
    if (type === 'multiple_choice') type = 'choice';
    if (type !== 'choice' && type !== 'fill_blank') continue;
    const l = latest[q.id];
    if (l && l.status === 'approved') continue;                 // 已合格不動
    if (l && l.status === 'adjust') adjust.push(q.id);          // 1) 需調整：優先重生成
    else if (l && l.status === 'proposed' && (l.quality || {}).status === 'needs_review') flagged.push(q.id); // 2) 未複核且有疑義
    else if (l && l.status === 'proposed' && l.model && l.model !== curModel) legacy.push(q.id);              // 3) 舊模型生成：升級
    else if (!l) fresh.push(q.id);                              // 4) 尚未產生（新題）
  }
  const picks = [...adjust, ...flagged, ...legacy, ...fresh].slice(0, limit);
  let ok = 0; let nr = 0; let failed = 0;
  const queue = [...picks];
  const run = async (id) => {
    const q = byId.get(id); if (!q) return;
    const a = app[id] || {};
    let type = a.type || q.type;
    if (type === 'multiple_choice') type = 'choice';
    try {
      const row = await generateVariantRow(id, {
        prompt: q.prompt || '', options: (q.options || []).map((o) => (typeof o === 'object' ? o.content : o)),
        answer: String(q.answer || ''), type, node: q.node, nodeName: q.nodeName, difficulty: q.difficulty, hasFigure: false, courseId,
      });
      if ((row.quality || {}).status === 'ok') ok += 1; else nr += 1;
    } catch (e) { failed += 1; console.error('batch failed', id, e.message); }
  };
  const workers = Array.from({ length: b.concurrency || 3 }, async () => { while (queue.length) { const id = queue.shift(); await run(id); } });
  await Promise.all(workers);
  res.json({ processed: picks.length, queuedAdjust: adjust.length, queuedFlagged: flagged.length, queuedLegacy: legacy.length, queuedNew: fresh.length, ok, needs_review: nr, failed, ids: picks });
}));

app.post('/v1/variants/:id/drop', (req, res) => {
  const version = Number((req.body || {}).version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ dropped: store.deleteVariantVersion(req.params.id, version), items: store.listVariants({ sourceQuestionId: req.params.id }) });
});
// ---- 批次複核（Gemini）：對尚未複核的變化題重新驗算，正確→合格、有疑義→需調整 ----
const autoReviewSchema = z.object({
  limit: z.number().int().min(1).max(300).optional(),
  apply: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
});
app.post('/v1/variants/auto-review', asyncHandler(async (req, res) => {
  const b = autoReviewSchema.safeParse(req.body || {}).data || {};
  const limit = b.limit || 50;
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  const pool = Object.entries(latest)
    .filter(([, v]) => v.status === 'proposed' && (v.quality || {}).status === 'ok')
    .map(([id, v]) => ({ id, v }))
    .sort((a, b2) => a.id.localeCompare(b2.id))
    .slice(0, limit);
  let ok = 0; let adjust = 0; let failed = 0;
  const queue = [...pool];
  const run = async ({ id, v }) => {
    const p = v.payload || {};
    try {
      const vr = await verifyVariant({ prompt: p.prompt, options: p.options, type: p.type });
      const good = sameAnswer(p.answer, vr.answer, p.options || []);
      if (b.apply) {
        store.reviewVariant({ sourceQuestionId: id, version: v.version, status: good ? 'approved' : 'adjust', reason: good ? 'Gemini 批次複核：正確' : `Gemini 批次複核：答案疑義（模型解：${vr.answer || '無'}）` });
      }
      if (good) ok += 1; else adjust += 1;
    } catch (e) { failed += 1; console.error('auto-review failed', id, e.message); }
  };
  await Promise.all(Array.from({ length: b.concurrency || 3 }, async () => { while (queue.length) { const x = queue.shift(); await run(x); } }));
  res.json({ processed: pool.length, ok, adjust, failed, applied: !!b.apply, model: config.verifyProvider === 'openai' ? config.verifyModel : config.geminiModel });
}));
app.delete('/v1/variants/:id', (req, res) => {
  res.json({ deleted: store.deleteVariants(req.params.id) });
});
// ---- 缺口補題：依（小節 × 難度）缺口產生變化題 ----
const fillGapsSchema = z.object({
  target: z.number().int().min(1).max(20).optional(),
  courseId: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
  dryRun: z.boolean().optional(),
});
app.post('/v1/variants/fill-gaps', asyncHandler(async (req, res) => {
  const b = fillGapsSchema.safeParse(req.body || {}).data || {};
  const target = b.target || 5;
  const limit = b.limit || 60;
  const courseId = b.courseId || config.batchCourseId;
  const [src, appd] = await Promise.all([
    fetch(config.explainDataUrl).then((r) => r.json()).catch(() => ({ items: [] })),
    fetch(config.appDataUrl).then((r) => r.json()).catch(() => ({ items: {} })),
  ]);
  const items = src.items || []; const app = appd.items || {};
  const allow = (x) => !x.hasFigure && ['multiple_choice', 'choice', 'fill_blank', 'true_false', 'matching'].includes(x.type);
  const byId = new Map(items.map((q) => [q.id, q]));
  // 目前計數（含變化題）
  const counts = new Map();
  for (const x of items) { if (x.chapter && x.difficulty && allow(x)) { const k = `${x.chapter}\u0000${x.difficulty}`; counts.set(k, (counts.get(k) || 0) + 1); } }
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  for (const [qid, v] of Object.entries(latest)) {
    const s2 = byId.get(qid); if (!s2 || !s2.chapter || !s2.difficulty || s2.hasFigure) continue;
    const ok = (v.quality || {}).status === 'ok' || v.status === 'approved'; if (!ok) continue;
    if (!['multiple_choice', 'choice', 'fill_blank', 'true_false', 'matching'].includes((v.payload || {}).type)) continue;
    const k = `${s2.chapter}\u0000${s2.difficulty}`; counts.set(k, (counts.get(k) || 0) + 1);
  }
  // 已貢獻的來源題（最新版本 ok/approved）→ 避免重複產生（同題新版本不會增加覆蓋）
  const occupied = new Set();
  for (const [qid, v] of Object.entries(latest)) {
    const ok = (v.quality || {}).status === 'ok' || v.status === 'approved' || v.status === 'adjust';
    if (ok) occupied.add(qid);
  }
  const contrib = new Map(); // sourceId -> Set(cellKey)
  for (const [qid, v] of Object.entries(latest)) {
    const s2 = byId.get(qid); if (!s2 || !s2.chapter || !s2.difficulty || s2.hasFigure) continue;
    const ok = (v.quality || {}).status === 'ok' || v.status === 'approved'; if (!ok) continue;
    if (!['multiple_choice', 'choice', 'fill_blank', 'true_false', 'matching'].includes((v.payload || {}).type)) continue;
    const tc = (v.payload || {}).targetCell;
    const k2 = `${(tc && tc.chapter) || s2.chapter}\u0000${(tc && tc.difficulty) || s2.difficulty}`;
    if (!contrib.has(qid)) contrib.set(qid, new Set());
    contrib.get(qid).add(k2);
  }
  // 候選來源題（優先同格；不足時用同小節其他難度），排除已對該格貢獻者
  const exact = new Map();
  for (const x of items) {
    if (!x.chapter || !x.difficulty || !allow(x)) continue;
    const k = `${x.chapter}\u0000${x.difficulty}`;
    if (!exact.has(k)) exact.set(k, []);
    exact.get(k).push(x);
  }
  const byLesson = new Map(); const byNode = new Map();
  for (const x of items) {
    if (!allow(x)) continue;
    if (x.chapter) { if (!byLesson.has(x.chapter)) byLesson.set(x.chapter, []); byLesson.get(x.chapter).push(x); }
    if (x.node) { if (!byNode.has(x.node)) byNode.set(x.node, []); byNode.get(x.node).push(x); }
  }
  const lessons = [...new Set(items.map((x) => x.chapter).filter(Boolean))].sort();
  const diffs = [...new Set(items.map((x) => x.difficulty).filter(Boolean))].sort();
  const gaps = [];
  for (const l of lessons) for (const d of diffs) {
    const k = `${l}\u0000${d}`;
    const have = counts.get(k) || 0; const need = target - have;
    if (need <= 0) continue;
    let pool = (exact.get(k) || []).filter((x) => !occupied.has(x.id));
    let same = true;
    if (pool.length < need) {
      same = false;
      const seenIds = new Set(pool.map((x) => x.id));
      const extraL = (byLesson.get(l) || []).filter((x) => !occupied.has(x.id) && !seenIds.has(x.id));
      extraL.forEach((x) => seenIds.add(x.id));
      pool = pool.concat(extraL);
      if (pool.length < need) {
        const node = (exact.get(k) || [])[0] ? (exact.get(k) || [])[0].node : null;
        const nodeQ = node || (items.find((x) => x.chapter === l) || {}).node;
        if (nodeQ) {
          const extraN = (byNode.get(nodeQ) || []).filter((x) => !occupied.has(x.id) && !seenIds.has(x.id));
          pool = pool.concat(extraN);
        }
      }
    }
    if (!pool.length) continue;
    gaps.push({ k, lesson: l, difficulty: d, need, pool: pool.map((x) => x.id), same });
  }
  gaps.sort((a, b) => b.need - a.need || a.k.localeCompare(b.k));
  // 規劃：同格不同來源、全域不重複
  const usedSources = new Set();
  const plan = [];
  for (let round = 0; plan.length < limit; round += 1) {
    let progressed = false;
    for (const g of gaps) {
      if (round >= g.need) continue;
      const id = g.pool.find((x) => !usedSources.has(x));
      if (!id) continue;
      usedSources.add(id);
      plan.push({ cell: g.k, lesson: g.lesson, difficulty: g.difficulty, id, same: g.same });
      progressed = true;
      if (plan.length >= limit) break;
    }
    if (!progressed) break;
  }
  if (b.dryRun) return res.json({ dryRun: true, target, limit, gaps: gaps.slice(0, 12).map((g) => ({ cell: g.k.split('\u0000').join(' × '), need: g.need, sameCell: g.same })), planned: plan.length });
  let ok = 0; let nr = 0; let failed = 0;
  const queue = plan;
  const run = async (p) => {
    const q = byId.get(p.id); if (!q) return;
    const a = app[q.id] || {};
    let type = a.type || q.type; if (type === 'multiple_choice') type = 'choice';
    try {
      const row = await generateVariantRow(p.id, {
        prompt: q.prompt || '', options: (q.options || []).map((o) => (typeof o === 'object' ? o.content : o)),
        answer: String(q.answer || ''), type, node: q.node, nodeName: q.nodeName,
        difficulty: p.difficulty, hasFigure: false, courseId,
        targetCell: { chapter: p.lesson, difficulty: p.difficulty },
      });
      if ((row.quality || {}).status === 'ok') ok += 1; else nr += 1;
    } catch (e) { failed += 1; console.error('fill-gaps failed', p.id, e.message); }
  };
  const q2 = [...queue];
  await Promise.all(Array.from({ length: b.concurrency || 3 }, async () => { while (q2.length) { const p = q2.shift(); await run(p); } }));
  res.json({ target, planned: queue.length, ok, needs_review: nr, failed, gaps: gaps.slice(0, 12).map((g) => ({ cell: g.k.split('\u0000').join(' × '), need: g.need })) });
}));

app.post('/v1/variants/:id', asyncHandler(async (req, res) => {
  const parsed = variantSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const row = await generateVariantRow(req.params.id, parsed.data);
  res.status(201).json(row);
}));

// ---- 批次產生變化題解說（AI 解新題）----
const explainVariantsSchema = z.object({
  limit: z.number().int().min(1).max(300).optional(),
  scope: z.enum(['approved', 'all']).optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
  force: z.boolean().optional(),
});
app.post('/v1/explanations/variants', asyncHandler(async (req, res) => {
  const b = explainVariantsSchema.safeParse(req.body || {}).data || {};
  const limit = b.limit || 50;
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  let list = Object.entries(latest).filter(([, v]) => (v.payload || {}).prompt);
  if (b.scope !== 'all') list = list.filter(([, v]) => v.status === 'approved');
  list.sort((a, b2) => a[0].localeCompare(b2[0]));
  if (!b.force) list = list.filter(([id, v]) => !store.getExplanation(`${id}#v${v.version}`));
  const picks = list.slice(0, limit);
  let processed = 0; let skipped = 0; let failed = 0;
  const queue = [...picks];
  const run = async ([id, v]) => {
    const key = `${id}#v${v.version}`;
    if (!b.force && store.getExplanation(key)) { skipped += 1; return; }
    const p = v.payload || {};
    try {
      await explainVariant({ id, version: v.version, prompt: p.prompt || '', options: p.options || [], answer: String(p.answer || ''), type: p.type || '', force: b.force });
      processed += 1;
    } catch (e) { failed += 1; console.error('explain-variant failed', id, e.message); }
  };
  await Promise.all(Array.from({ length: b.concurrency || 3 }, async () => { while (queue.length) { const x = queue.shift(); await run(x); } }));
  res.json({ scope: b.scope || 'approved', candidates: list.length, picked: picks.length, processed, skipped, failed });
}));

// ---- 覆蓋率（依課程自動計算；小節 × 難度）----
const courseCache = new Map(); // url -> { at, data }
async function loadQuestions(url) {
  const hit = courseCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const data = await fetch(url).then((r) => r.json()).catch(() => ({ items: [] }));
  courseCache.set(url, { at: Date.now(), data });
  return data;
}
let coursesCache = { at: 0, data: null };
async function loadCourses() {
  if (coursesCache.data && Date.now() - coursesCache.at < 5 * 60 * 1000) return coursesCache.data;
  const data = await fetch(config.coursesUrl).then((r) => r.json()).catch(() => ({ courses: [] }));
  coursesCache = { at: Date.now(), data };
  return data;
}
const PLAYABLE = new Set(['multiple_choice', 'choice', 'fill_blank', 'true_false', 'matching']);
const coverageSchema = z.object({
  course: z.string().max(64).optional(),
  cell: z.enum(['lesson_difficulty', 'lesson_difficulty_type']).optional(),
  scope: z.enum(['playable_nofigure', 'playable', 'all']).optional(),
  target: z.coerce.number().int().min(1).max(20).optional(),
  countVariants: z.coerce.number().int().min(0).max(1).optional(),
});
app.get('/v1/coverage', asyncHandler(async (req, res) => {
  const q = coverageSchema.parse(req.query || {});
  const target = q.target || 5;
  const cell = q.cell || 'lesson_difficulty';
  const scope = q.scope || 'playable_nofigure';
  const countVariants = q.countVariants === 1;
  const courses = (await loadCourses()).courses || [];
  const found = courses.find((c) => c.courseId === q.course) || null;
  const url = (found && found.data && found.data.questions) || config.explainDataUrl;
  const items = (await loadQuestions(url)).items || [];
  const allow = (x) => {
    if (scope === 'all') return true;
    const p = PLAYABLE.has(x.type);
    if (!p) return false;
    if (scope === 'playable') return true;
    return !x.hasFigure;
  };
  const lessons = [...new Set(items.map((x) => x.chapter).filter(Boolean))].sort();
  const diffs = [...new Set(items.map((x) => x.difficulty).filter(Boolean))].sort();
  const types = [...new Set(items.filter(allow).map((x) => x.type))].sort();
  const cellsOf = (x) => (cell === 'lesson_difficulty_type'
    ? [x.chapter, x.difficulty, x.type] : [x.chapter, x.difficulty]);
  const counts = new Map();
  for (const x of items) {
    if (!x.chapter || !x.difficulty || !allow(x)) continue;
    const k = cellsOf(x).join('\u0000');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (countVariants) {
    const byId = new Map(items.map((x) => [x.id, x]));
    const latest = {};
    for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
    for (const [qid, v] of Object.entries(latest)) {
      const src = byId.get(qid);
      if (!src || !src.chapter || !src.difficulty || src.hasFigure) continue;
      const ok = (v.quality || {}).status === 'ok' || v.status === 'approved';
      if (!ok) continue;
      const vt = (v.payload || {}).type;
      if (!PLAYABLE.has(vt)) continue;
      const tc = (v.payload || {}).targetCell;
      const ch2 = (tc && tc.chapter) || src.chapter;
      const df2 = (tc && tc.difficulty) || src.difficulty;
      const k = cellsOf({ chapter: ch2, difficulty: df2, type: vt }).join('\u0000');
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const allCells = [];
  for (const l of lessons) {
    for (const d of diffs) {
      if (cell === 'lesson_difficulty_type') { for (const t of types) allCells.push([l, d, t]); }
      else allCells.push([l, d]);
    }
  }
  let cellsMet = 0; let questionsNeeded = 0;
  const byLesson = new Map(); const byDifficulty = new Map();
  for (const c of allCells) {
    const have = counts.get(c.join('\u0000')) || 0;
    const met = have >= target;
    if (met) cellsMet += 1; else questionsNeeded += target - have;
    const bump = (map, key) => { const cur = map.get(key) || { key, met: 0, total: 0, gap: 0 }; cur.total += 1; if (met) cur.met += 1; else cur.gap += target - have; map.set(key, cur); };
    bump(byLesson, c[0]);
    bump(byDifficulty, c[1]);
  }
  res.json({
    courseId: (found && found.courseId) || q.course || null,
    courseName: (found && found.name) || '',
    publisher: (found && found.publisher) || '',
    cell, scope, target,
    cellsTotal: allCells.length,
    cellsMet,
    questionsNeeded,
    targetTotal: target * allCells.length,
    countVariants,
    playableCount: items.filter(allow).length,
    totalCount: items.length,
    byDifficulty: [...byDifficulty.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byLesson: [...byLesson.values()].sort((a, b) => b.gap - a.gap),
  });
}));

// 將「已合格」但尚未指派（或不足雙審）的題，自動追加指派（維持雙審、不重複）
app.post('/v1/assignments/sync-approved', (req, res) => {
  const b = req.body || {};
  const reviewers = Array.isArray(b.reviewers) && b.reviewers.length ? b.reviewers.map(String) : ['r_mu5a8ddkq90b', 'r_mu5a8dveklbj', 'r_mu59gcnb1agn'];
  const courseId = b.courseId || config.batchCourseId;
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  const approved = Object.entries(latest).filter(([, v]) => v.status === 'approved').map(([id]) => id).sort();
  const have = new Map();
  for (const a of store.listAssignments({})) {
    if (!have.has(a.sourceQuestionId)) have.set(a.sourceQuestionId, new Set());
    have.get(a.sourceQuestionId).add(a.reviewerId);
  }
  const pairs = [[0, 1], [1, 2], [2, 0]];
  const rows = []; let i = 0; let added = 0;
  for (const id of approved) {
    const set = have.get(id) || new Set();
    if (set.size >= 2) continue;
    const pair = pairs[i % pairs.length]; i += 1;
    for (const k of pair) { const rid = reviewers[k]; if (rid && !set.has(rid)) { rows.push({ sourceQuestionId: id, reviewerId: rid, courseId }); added += 1; } }
  }
  const batchId = `b_${Date.now().toString(36)}`;
  const created = rows.length ? store.createAssignments(rows, batchId) : 0;
  res.json({ approved: approved.length, added: created });
});
app.post('/v1/variants/:id/reverify', asyncHandler(async (req, res) => {
  const items = store.listVariants({ sourceQuestionId: req.params.id });
  if (!items.length) return res.status(404).json({ error: 'no variant' });
  const row = items[0];
  const payload = row.payload || {};
  const reasons = [];
  if (!payload.prompt) reasons.push('no_prompt');
  if (!payload.answer) reasons.push('no_answer');
  let verify = null;
  if (payload.prompt) {
    try {
      const vr = await verifyVariant({ prompt: payload.prompt, options: payload.options, type: payload.type });
      const opts2 = payload.options || [];
      const idxs = [...new Set((vr.allCorrect || []).map((x) => answerIndex(x, opts2)).filter((i) => i >= 0))];
      verify = { answer: vr.answer, allCorrect: vr.allCorrect, matchedCount: idxs.length, reason: vr.reason, model: vr.model };
      if (!sameAnswer(payload.answer, vr.answer, opts2)) reasons.push('self_verify_mismatch');
      const multiQ = /複選|多選|所有|哪些|全部寫出|哪些人|哪幾個/.test(String(payload.prompt || ''));
      const allAbove = opts2.some((o) => /以上皆是|以上都|皆正確|全部都|都正確|以上都對/.test(String(o)));
      if (!multiQ && !allAbove && idxs.length > 1) reasons.push('self_verify_multiple');
    } catch (e) { console.error('reverify failed', req.params.id, e.message); return res.status(502).json({ error: e.message }); }
  }
  const rules = checkVariant(payload, null).filter((r) => r !== 'identical_to_source');
  const all = [...new Set([...rules, ...reasons])];
  const quality = { status: all.length ? 'needs_review' : 'ok', reasons: all, verify };
  const updated = store.updateVariantQuality({ sourceQuestionId: req.params.id, version: row.version, quality });
  res.json({ items: updated });
}));
app.post('/v1/variants/:id/note', (req, res) => {
  const b = req.body || {};
  const version = Number(b.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ items: store.updateVariantReason({ sourceQuestionId: req.params.id, version, reason: b.reason }) });
});
app.post('/v1/variants/:id/review', (req, res) => {
  const b = req.body || {};
  const version = Number(b.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ items: store.reviewVariant({ sourceQuestionId: req.params.id, version, status: b.status === 'approved' ? 'approved' : 'adjust', reason: b.reason }) });
});
app.post('/v1/variants/:id/explain-review', (req, res) => {
  const b = req.body || {};
  const version = Number(b.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  const status = b.status === 'approved' ? 'approved' : (b.status === 'adjust' ? 'adjust' : undefined);
  res.json({ items: store.reviewVariantExplain({ sourceQuestionId: req.params.id, version, status, note: typeof b.note === 'string' ? b.note : undefined }) });
});
app.post('/v1/rewrites/:id', asyncHandler(async (req, res) => {
  const parsed = rewriteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const out = await rewriteQuestion(parsed.data);
  const row = store.addRevision({ sourceQuestionId: req.params.id, courseId: parsed.data.courseId, payload: out.revision, rationale: out.revision.rationale, model: out.model });
  res.status(201).json(row);
}));
app.post('/v1/rewrites/:id/review', (req, res) => {
  const b = req.body || {};
  const version = Number(b.version);
  const status = b.status === 'approved' ? 'approved' : 'adjust';
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ items: store.reviewRevision({ sourceQuestionId: req.params.id, version, status, reason: b.reason }) });
});
app.post('/v1/rewrites/:id/approve', (req, res) => {
  const version = Number((req.body || {}).version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ items: store.approveRevision({ sourceQuestionId: req.params.id, version }) });
});
app.get('/v1/reviews/:id/history', (req, res) => res.json({ items: store.reviewHistory(req.params.id) }));
app.get('/v1/reviews/:id', (req, res) => {
  const items = store.listQuestionReviews({ sourceQuestionId: req.params.id });
  if (!items.length) return res.status(404).json({ error: 'not found' });
  res.json(req.query.reviewer ? (items.find((r) => r.reviewerId === req.query.reviewer) || null) : { items });
});
app.put('/v1/reviews/:id', (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.status === '') delete body.status; // 空字串視為未設定
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const reviewerId = parsed.data.reviewerId || '';
  const saved = store.upsertQuestionReview({ sourceQuestionId: req.params.id, reviewerId, nodeId: parsed.data.nodeId, status: parsed.data.status, note: parsed.data.note, type: parsed.data.type, typeMismatch: parsed.data.typeMismatch, courseId: parsed.data.courseId, aiStatus: parsed.data.aiStatus, aiNote: parsed.data.aiNote });
  if (parsed.data.aiStatus !== undefined) store.setExplanationReviewStatus(req.params.id, parsed.data.aiStatus === 'adjust' ? 'needs_review' : '');
  res.json(saved);
});
app.delete('/v1/reviews/:id', (req, res) => {
  const reviewerId = req.query.reviewer || '';
  const deleted = store.deleteQuestionReview(req.params.id, reviewerId);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true, sourceQuestionId: req.params.id, reviewerId });
});

// --- 審查人 ---
app.get('/v1/reviewers', (_req, res) => res.json({ items: store.listReviewers() }));
app.post('/v1/reviewers', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = (req.body && req.body.id) || `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  res.status(201).json(store.addReviewer({ id, name }));
});
app.delete('/v1/reviewers/:id', (req, res) => {
  const deleted = store.deleteReviewer(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true, id: req.params.id });
});

// --- 指派（雙審：每題 2 位不同審查人；各人題數可不相等）---
const assignSchema = z.object({
  ids: z.array(z.string()).min(1),
  targets: z.array(z.object({ reviewerId: z.string(), count: z.number().int().min(0) })).min(1),
  copies: z.number().int().min(2).max(3).default(2),
  courseId: z.string().max(64).optional(),
  preview: z.boolean().optional(),
  excludeAssigned: z.boolean().optional(),
});

function planAssignments(ids, targets, copies, exclude, courseId) {
  const seq = [];
  const t = targets.map((x) => ({ id: x.reviewerId, left: x.count }));
  let remaining = t.reduce((s, x) => s + x.left, 0);
  while (remaining > 0) {
    for (const x of t) { if (x.left > 0) { seq.push(x.id); x.left--; remaining--; } }
  }
  // 決定性洗牌，讓配對混合（避免每題都是同兩人）
  for (let i = seq.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [seq[i], seq[j]] = [seq[j], seq[i]]; }
  const used = new Array(seq.length).fill(false);
  const pairs = [];
  for (let i = 0; i < seq.length; i++) {
    if (used[i]) continue;
    for (let j = i + 1; j < seq.length; j++) {
      if (!used[j] && seq[j] !== seq[i]) { pairs.push([seq[i], seq[j]]); used[i] = used[j] = true; break; }
    }
  }
  const picks = exclude ? ids.filter((id) => !exclude.has(id)) : ids;
  const rows = [];
  for (let k = 0; k < pairs.length && k < picks.length; k++) {
    rows.push({ sourceQuestionId: picks[k], reviewerId: pairs[k][0], courseId });
    rows.push({ sourceQuestionId: picks[k], reviewerId: pairs[k][1], courseId });
  }
  return rows;
}

app.post('/v1/assignments', (req, res) => {
  const parsed = assignSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const { ids, targets, copies, preview, excludeAssigned, courseId } = parsed.data;
  const exclude = excludeAssigned === false ? null : new Set(store.assignedQuestionIds());
  const rows = planAssignments(ids, targets, copies, exclude, courseId);
  const questions = new Set(rows.map((r) => r.sourceQuestionId)).size;
  if (preview) return res.json({ preview: true, questions, assignments: rows.length, rows });
  const batchId = `b_${Date.now().toString(36)}`;
  const created = store.createAssignments(rows, batchId);
  res.status(201).json({ batchId, questions, assignments: created });
});
app.get('/v1/assignments', (req, res) => res.json({ items: store.listAssignments({ reviewerId: req.query.reviewer, status: req.query.status }) }));
const assignAddSchema = z.object({
  reviewerId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1),
  courseId: z.string().max(64).optional(),
});
app.post('/v1/assignments/add', (req, res) => {
  const parsed = assignAddSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const { reviewerId, ids, courseId } = parsed.data;
  const rows = ids.map((sourceQuestionId) => ({ sourceQuestionId, reviewerId, courseId }));
  const batchId = `b_${Date.now().toString(36)}`;
  const created = store.createAssignments(rows, batchId);
  res.status(201).json({ batchId, questions: ids.length, assignments: created });
});
// ---- 階段指派：先以知識點覆蓋為主（廣度優先），每人固定題數 ----
const planStageSchema = z.object({
  perReviewer: z.number().int().min(1).max(500).optional(),
  reviewers: z.array(z.string()).min(1).optional(),
  by: z.enum(['node', 'lesson']).optional(),
  courseId: z.string().max(64).optional(),
  double: z.boolean().optional(),
  replace: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
// ---- 自動階段指派：第1階段廣度覆蓋（每人待審上限）、第2階段雙審（前一輪完成後）----
const autoAssignSchema = z.object({
  perReviewer: z.number().int().min(1).max(500).optional(),
  reviewers: z.array(z.string()).min(1).optional(),
  by: z.enum(['node', 'lesson']).optional(),
  courseId: z.string().max(64).optional(),
  dryRun: z.boolean().optional(),
});
app.post('/v1/assignments/auto', asyncHandler(async (req, res) => {
  const b = autoAssignSchema.safeParse(req.body || {}).data || {};
  const cap = b.perReviewer || 100;
  const by = b.by || 'node';
  const courseId = b.courseId || config.batchCourseId;
  const reviewers = Array.isArray(b.reviewers) && b.reviewers.length ? b.reviewers.map(String)
    : (config.assignReviewers && config.assignReviewers.length ? config.assignReviewers : store.listReviewers().filter((r) => r.active !== 0).map((r) => r.id));
  if (!reviewers.length) return res.json({ reviewers: 0, stage1: 0, stage2: 0 });
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  const approved = Object.entries(latest).filter(([, v]) => v.status === 'approved').map(([id]) => id).sort();
  const src = await fetch(config.explainDataUrl).then((r) => r.json()).catch(() => ({ items: [] }));
  const byId = new Map((src.items || []).map((q) => [q.id, q]));
  // 現況
  const qMap = new Map(); const pending = new Map();
  for (const r of reviewers) pending.set(r, 0);
  for (const a of store.listAssignments({})) {
    if (!qMap.has(a.sourceQuestionId)) qMap.set(a.sourceQuestionId, []);
    qMap.get(a.sourceQuestionId).push(a);
    if (a.status !== 'done' && pending.has(a.reviewerId)) pending.set(a.reviewerId, pending.get(a.reviewerId) + 1);
  }
  // 廣度優先排序（依群組由小到大輪替）
  const groups = new Map();
  for (const id of approved) {
    const q = byId.get(id) || {};
    const key = (by === 'lesson' ? (q.chapter || '未分類') : (q.node || '未綁定')) || '未分類';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const ordered = [];
  const keys = [...groups.keys()].sort((a, b2) => groups.get(a).length - groups.get(b2).length || a.localeCompare(b2));
  for (let round = 0; ; round += 1) {
    let progressed = false;
    for (const k of keys) { const arr = groups.get(k); if (round < arr.length) { ordered.push(arr[round]); progressed = true; } }
    if (!progressed) break;
  }
  const rows = [];
  const pickReviewer = (exclude) => {
    const cands = reviewers.filter((r) => !exclude.includes(r)).map((r) => ({ r, p: pending.get(r) })).filter((x) => x.p < cap);
    if (!cands.length) return null;
    cands.sort((a, b2) => a.p - b2.p);
    return cands[0].r;
  };
  let stage1 = 0; let stage2 = 0;
  for (const id of ordered) {
    const rowsQ = qMap.get(id) || [];
    if (rowsQ.length === 0) {
      const r = pickReviewer([]);
      if (!r) continue;
      rows.push({ sourceQuestionId: id, reviewerId: r, courseId });
      pending.set(r, pending.get(r) + 1); stage1 += 1;
      if (!qMap.has(id)) qMap.set(id, []);
      qMap.get(id).push({ sourceQuestionId: id, reviewerId: r, status: 'pending' });
    } else if (rowsQ.length === 1 && rowsQ[0].status === 'done') {
      const r = pickReviewer([rowsQ[0].reviewerId]);
      if (!r) continue;
      rows.push({ sourceQuestionId: id, reviewerId: r, courseId });
      pending.set(r, pending.get(r) + 1); stage2 += 1;
      qMap.get(id).push({ sourceQuestionId: id, reviewerId: r, status: 'pending' });
    }
  }
  if (b.dryRun) return res.json({ dryRun: true, reviewers: reviewers.length, perReviewer: cap, stage1, stage2, rows: rows.length, pending: Object.fromEntries(pending) });
  const batchId = `b_${Date.now().toString(36)}`;
  const created = rows.length ? store.createAssignments(rows, batchId) : 0;
  res.status(201).json({ reviewers: reviewers.length, perReviewer: cap, stage1, stage2, assignments: created });
}));
app.post('/v1/assignments/plan-stage', asyncHandler(async (req, res) => {
  const b = planStageSchema.safeParse(req.body || {}).data || {};
  const per = b.perReviewer || 100;
  const reviewers = b.reviewers && b.reviewers.length ? b.reviewers : ['r_mu5a8ddkq90b', 'r_mu5a8dveklbj', 'r_mu59gcnb1agn'];
  const by = b.by || 'node';
  const courseId = b.courseId || config.batchCourseId;
  // 已合格的變化題（最新版本）
  const latest = {};
  for (const v of store.listVariants({})) { const c = latest[v.sourceQuestionId]; if (!c || v.version > c.version) latest[v.sourceQuestionId] = v; }
  const approvedIds = Object.entries(latest).filter(([, v]) => v.status === 'approved').map(([id]) => id).sort();
  // 題目屬性（node / lesson）
  const src = await fetch(config.explainDataUrl).then((r) => r.json()).catch(() => ({ items: [] }));
  const byId = new Map((src.items || []).map((q) => [q.id, q]));
  const groups = new Map();
  for (const id of approvedIds) {
    const q = byId.get(id) || {};
    const key = (by === 'lesson' ? (q.chapter || '未分類') : (q.node || '未綁定')) || '未分類';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  // 廣度優先：依群組大小由小到大輪替，讓少數知識點先被涵蓋
  const ordered = [];
  const keys = [...groups.keys()].sort((a, b2) => groups.get(a).length - groups.get(b2).length || a.localeCompare(b2));
  let round = 0; let progressed = true;
  while (progressed) {
    progressed = false;
    for (const k of keys) {
      const arr = groups.get(k);
      if (round < arr.length) { ordered.push({ id: arr[round], group: k }); progressed = true; }
    }
    round += 1;
  }
  const total = per * reviewers.length;
  const picks = ordered.slice(0, total);
  const rows = [];
  picks.forEach((p, i) => {
    const r1 = reviewers[i % reviewers.length];
    rows.push({ sourceQuestionId: p.id, reviewerId: r1, courseId });
    if (b.double) rows.push({ sourceQuestionId: p.id, reviewerId: reviewers[(i + 1) % reviewers.length], courseId });
  });
  const coveredGroups = new Set(picks.map((p) => p.group)).size;
  if (b.dryRun) return res.json({ dryRun: true, students: reviewers.length, perReviewer: per, questions: picks.length, coveredGroups, totalGroups: groups.size, rows: rows.length });
  if (b.replace !== false) store.pruneAssignments({ reviewers });
  const batchId = `b_${Date.now().toString(36)}`;
  const created = store.createAssignments(rows, batchId);
  res.status(201).json({ stage: 1, perReviewer: per, questions: picks.length, coveredGroups, totalGroups: groups.size, assignments: created });
}));
app.post('/v1/assignments/prune', (req, res) => {
  const b = req.body || {};
  const keep = Array.isArray(b.keep) ? b.keep.map(String) : [];
  const reviewers = Array.isArray(b.reviewers) ? b.reviewers.map(String) : [];
  if (!keep.length && !reviewers.length) return res.status(400).json({ error: 'keep or reviewers required' });
  const removed = store.pruneAssignments({ keep, reviewers });
  res.json({ removed, remaining: store.listAssignments({}).length });
});
app.post('/v1/assignments/reassign', (req, res) => {
  const body = req.body || {};
  if (!body.from || !body.to) return res.status(400).json({ error: 'from/to required' });
  res.json({ moved: store.reassign({ from: body.from, to: body.to, limit: Number(body.limit) || 1000 }) });
});
app.get('/v1/review-progress', (_req, res) => res.json({ items: store.reviewProgress() }));
app.get('/v1/course-progress', (_req, res) => res.json({ items: store.courseProgress() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(502).json({ error: 'upstream/service error', message: String(err.message || err) });
});

app.listen(config.port, () => console.log(JSON.stringify({ listening: config.port, knowledge: config.knowledgeBase, auth: Boolean(config.apiToken) })));
