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
import { explainQuestion, generateVariant, regenerateExplanation, rewriteQuestion, verifyVariant } from './explain.mjs';
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
function stripLabel(x) {
  return String(x || '')
    .replace(/^\s*\(([A-Ha-h]|[1-8])\)\s*/, '')
    .replace(/^\s*([A-Ha-h]|[1-8])[.、:：](?![0-9])\s*/, '')
    .trim();
}
function numVal(x) {
  let t = stripLabel(x).replace(/[０-９．／－]/g, (c) => '0123456789./-'['０１２３４５６７８９．／－'.indexOf(c)] || c);
  t = t.replace(/[^0-9./\-\s]/g, '').trim();
  let m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(/^-?\d+(\.\d+)?$/);
  if (m) return Number(m[0]);
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
function sameAnswer(a, b, opts) {
  if (!a || !b) return false;
  const ia = answerIndex(a, opts);
  const ib = answerIndex(b, opts);
  if (ia >= 0 && ib >= 0) return ia === ib;
  const norm = (z) => String(z || '').replace(/\s+/g, '').replace(/[（(][1-8A-Ha-h][）)]/g, '').replace(/[.。、,，]$/, '');
  if (norm(a) === norm(b)) return true;
  const va = numVal(a); const vb = numVal(b);
  return va !== null && vb !== null && Math.abs(va - vb) < 1e-9;
}
app.get('/v1/variants', (req, res) => res.json({ items: store.listVariants({ sourceQuestionId: req.query.question }) }));
app.post('/v1/variants/:id', asyncHandler(async (req, res) => {
  const parsed = variantSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  const out = await generateVariant(parsed.data);
  const payload = out.variant || {};
  if (payload.figure) { const svg = renderFigureSvg(payload.figure); if (svg) payload.figureSvg = svg; }
  const reasons = checkVariant(payload, parsed.data.prompt);
  if (parsed.data.hasFigure && !payload.figureSvg) reasons.push('figure_missing');
  let verify = null;
  if (payload.prompt && !reasons.length) {
    try {
      const vr = await verifyVariant({ prompt: payload.prompt, options: payload.options, type: payload.type });
      verify = { answer: vr.answer, reason: vr.reason, model: vr.model };
      if (!sameAnswer(payload.answer, vr.answer, payload.options || [])) reasons.push('self_verify_mismatch');
    } catch (e) { console.error('verify failed', req.params.id, e.message); }
  }
  const quality = { status: reasons.length ? 'needs_review' : 'ok', reasons, verify };
  const row = store.addVariant({ sourceQuestionId: req.params.id, nodeId: parsed.data.node, courseId: parsed.data.courseId, payload, rationale: payload.rationale, model: out.model, quality });
  res.status(201).json(row);
}));
app.post('/v1/variants/:id/review', (req, res) => {
  const b = req.body || {};
  const version = Number(b.version);
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'version required' });
  res.json({ items: store.reviewVariant({ sourceQuestionId: req.params.id, version, status: b.status === 'approved' ? 'approved' : 'adjust', reason: b.reason }) });
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
