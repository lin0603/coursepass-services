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
  res.json({ unitId: req.params.id, total: data.total, items: assemble(items, { llmMap: await getLlmVariants() }) });
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
  res.json({ unitId: req.params.id, count, total, items: buildActivitySet(pool, { count, llmMap: await getLlmVariants() }) });
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
  res.json({ unitId: req.params.id, subject: node.subject, grade: node.grade, items: assemble(items, { llmMap: await getLlmVariants() }) });
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

// --- Question review / comments (persisted) ---
const reviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'adjust', 'rejected']).optional(),
  note: z.string().max(2000).optional(),
  nodeId: z.string().max(64).optional(),
  reviewer: z.string().max(80).optional(),
});

app.get('/v1/reviews', (req, res) => res.json({ items: store.listReviews({ node: req.query.node, status: req.query.status }) }));
app.get('/v1/reviews/:id', (req, res) => {
  const review = store.getReview(req.params.id);
  if (!review) return res.status(404).json({ error: 'not found' });
  res.json(review);
});
app.put('/v1/reviews/:id', (req, res) => {
  const parsed = reviewSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
  res.json(store.upsertReview({ sourceQuestionId: req.params.id, ...parsed.data }));
});
app.delete('/v1/reviews/:id', (req, res) => {
  const deleted = store.deleteReview(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true, sourceQuestionId: req.params.id });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(502).json({ error: 'upstream/service error', message: String(err.message || err) });
});

app.listen(config.port, () => console.log(JSON.stringify({ listening: config.port, knowledge: config.knowledgeBase, auth: Boolean(config.apiToken) })));
