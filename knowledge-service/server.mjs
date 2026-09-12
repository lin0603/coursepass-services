import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8080);
const DATA = process.env.DATA || fileURLToPath(new URL('./data/knowledge.sqlite', import.meta.url));

const db = new Database(DATA, { readonly: true, fileMustExist: true });
const app = express();
app.use(cors());
app.use(express.json());

const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));

function int(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return max ? Math.min(n, max) : n;
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/version', (_req, res) => res.json(meta));

app.get('/v1/subjects', (_req, res) => {
  res.json(meta.subjects ? meta.subjects.split(',') : []);
});

app.get('/v1/nodes', (req, res) => {
  const { subject, grade } = req.query;
  const limit = int(req.query.limit, 100, 1000);
  const offset = int(req.query.offset, 0);
  const where = [];
  const params = [];
  if (subject) { where.push('subject = ?'); params.push(subject); }
  if (grade) { where.push('grade = ?'); params.push(String(grade)); }
  if (req.query.q) { where.push('(name LIKE ? OR content_description LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT id, subject, grade, name, topic, main_topic FROM nodes ${clause} ORDER BY subject, grade, id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM nodes ${clause}`).get(...params).n;
  res.json({ total, limit, offset, items: rows });
});

app.get('/v1/nodes/:id', (req, res) => {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'node not found' });
  const edges = db.prepare('SELECT src, dst, type FROM edges WHERE src = ? OR dst = ?').all(node.id, node.id);
  const coverage = db.prepare('SELECT publisher, total, bound, approved FROM coverage WHERE nodeId = ?').all(node.id);
  res.json({ node, edges, coverage });
});

app.get('/v1/nodes/:id/questions', (req, res) => {
  const limit = int(req.query.limit, 20, 200);
  const offset = int(req.query.offset, 0);
  const where = ['primaryKnowledgeNodeId = ?'];
  const params = [req.params.id];
  if (req.query.type) { where.push('questionType = ?'); params.push(req.query.type); }
  if (req.query.reviewStatus) { where.push('reviewStatus = ?'); params.push(req.query.reviewStatus); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`SELECT sourceQuestionId, publisher, subject, grade, questionType, difficulty, prompt, answer, options_json, reviewStatus FROM questions ${clause} ORDER BY publisher, grade LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM questions ${clause}`).get(...params).n;
  res.json({ total, limit, offset, items: rows.map((r) => ({ ...r, options: JSON.parse(r.options_json || '[]'), options_json: undefined })) });
});

app.get('/v1/chapters', (req, res) => {
  const { publisher, subject, grade } = req.query;
  const where = [];
  const params = [];
  if (publisher) { where.push('publisher = ?'); params.push(publisher); }
  if (subject) { where.push('subject = ?'); params.push(subject); }
  if (grade) { where.push('grade = ?'); params.push(String(grade)); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ items: db.prepare(`SELECT publisher, subject, grade, unit_title, lesson_code, question_count FROM chapters ${clause} ORDER BY publisher, subject, grade, lesson_code`).all(...params) });
});

app.get('/v1/coverage', (req, res) => {
  const { subject, grade, publisher } = req.query;
  const where = [];
  const params = [];
  if (subject) { where.push('subject = ?'); params.push(subject); }
  if (grade) { where.push('grade = ?'); params.push(String(grade)); }
  if (publisher) { where.push('publisher = ?'); params.push(publisher); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ items: db.prepare(`SELECT publisher, subject, grade, nodeId, total, bound, approved FROM coverage ${clause} ORDER BY subject, grade, publisher`).all(...params) });
});

app.get('/v1/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  const params = [`%${q}%`, `%${q}%`];
  let clause = '(n.name LIKE ? OR n.content_description LIKE ?)';
  if (req.query.subject) { clause += ' AND n.subject = ?'; params.push(req.query.subject); }
  res.json({ items: db.prepare(`SELECT n.id, n.subject, n.grade, n.name FROM nodes n WHERE ${clause} LIMIT 50`).all(...params) });
});

app.listen(PORT, () => console.log(JSON.stringify({ listening: PORT, data: DATA, version: meta.version })));
