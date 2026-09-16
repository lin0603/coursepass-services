import Database from 'better-sqlite3';
import { dbPath } from './config.mjs';

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS learners (learnerId TEXT PRIMARY KEY, createdAt TEXT);
CREATE TABLE IF NOT EXISTS progress (
  learnerId TEXT, nodeId TEXT, attempts INTEGER DEFAULT 0, correct INTEGER DEFAULT 0,
  mastery REAL DEFAULT 0, updatedAt TEXT, PRIMARY KEY (learnerId, nodeId)
);
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, learnerId TEXT, sourceQuestionId TEXT, nodeId TEXT,
  selected TEXT, correct INTEGER, createdAt TEXT
);
CREATE TABLE IF NOT EXISTS wrongbook (
  learnerId TEXT, sourceQuestionId TEXT, nodeId TEXT, wrongCount INTEGER DEFAULT 0,
  lastWrongAt TEXT, PRIMARY KEY (learnerId, sourceQuestionId)
);
CREATE TABLE IF NOT EXISTS reviews (
  sourceQuestionId TEXT PRIMARY KEY, nodeId TEXT, status TEXT, note TEXT, reviewer TEXT, updatedAt TEXT
);
CREATE TABLE IF NOT EXISTS explanations (
  sourceQuestionId TEXT PRIMARY KEY, model TEXT, explanation TEXT, updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS ix_answers_learner ON answers(learnerId, createdAt);
CREATE INDEX IF NOT EXISTS ix_wrongbook_learner ON wrongbook(learnerId, lastWrongAt);
CREATE INDEX IF NOT EXISTS ix_reviews_node ON reviews(nodeId, status);
`);

// 舊資料庫補欄位：reviews.type（老師選定的題型）
const reviewCols = db.prepare('PRAGMA table_info(reviews)').all().map((c) => c.name);
if (!reviewCols.includes('type')) db.exec('ALTER TABLE reviews ADD COLUMN type TEXT');

const now = () => new Date().toISOString();

export const store = {
  ensureLearner(learnerId) {
    db.prepare('INSERT OR IGNORE INTO learners (learnerId, createdAt) VALUES (?, ?)').run(learnerId, now());
  },
  recordAnswer({ learnerId, sourceQuestionId, nodeId, selected, correct }) {
    this.ensureLearner(learnerId);
    db.prepare('INSERT INTO answers (learnerId, sourceQuestionId, nodeId, selected, correct, createdAt) VALUES (?,?,?,?,?,?)')
      .run(learnerId, sourceQuestionId, nodeId || null, String(selected ?? ''), correct ? 1 : 0, now());
    if (nodeId) {
      const row = db.prepare('SELECT attempts, correct FROM progress WHERE learnerId=? AND nodeId=?').get(learnerId, nodeId) || { attempts: 0, correct: 0 };
      const attempts = row.attempts + 1;
      const correctCount = row.correct + (correct ? 1 : 0);
      const mastery = Math.round((correctCount / attempts) * 1000) / 10;
      db.prepare(`INSERT INTO progress (learnerId, nodeId, attempts, correct, mastery, updatedAt) VALUES (?,?,?,?,?,?)
                  ON CONFLICT(learnerId, nodeId) DO UPDATE SET attempts=excluded.attempts, correct=excluded.correct, mastery=excluded.mastery, updatedAt=excluded.updatedAt`)
        .run(learnerId, nodeId, attempts, correctCount, mastery, now());
    }
    if (!correct && sourceQuestionId) {
      db.prepare(`INSERT INTO wrongbook (learnerId, sourceQuestionId, nodeId, wrongCount, lastWrongAt) VALUES (?,?,?,?,?)
                  ON CONFLICT(learnerId, sourceQuestionId) DO UPDATE SET wrongCount=wrongbook.wrongCount+1, lastWrongAt=excluded.lastWrongAt`)
        .run(learnerId, sourceQuestionId, nodeId || null, 1, now());
    }
    return this.getProgress(learnerId);
  },
  getProgress(learnerId) {
    this.ensureLearner(learnerId);
    const nodes = db.prepare('SELECT nodeId, attempts, correct, mastery, updatedAt FROM progress WHERE learnerId=? ORDER BY updatedAt DESC').all(learnerId);
    const overall = nodes.length
      ? Math.round((nodes.reduce((sum, n) => sum + n.mastery, 0) / nodes.length) * 10) / 10
      : 0;
    return { learnerId, overallMastery: overall, nodeCount: nodes.length, nodes };
  },
  getWrongbook(learnerId) {
    return db.prepare('SELECT sourceQuestionId, nodeId, wrongCount, lastWrongAt FROM wrongbook WHERE learnerId=? ORDER BY lastWrongAt DESC').all(learnerId);
  },
  getReview(sourceQuestionId) {
    return db.prepare('SELECT sourceQuestionId, nodeId, status, note, type, reviewer, updatedAt FROM reviews WHERE sourceQuestionId=?').get(sourceQuestionId) || null;
  },
  listReviews({ node, status } = {}) {
    const where = [];
    const params = [];
    if (node) { where.push('nodeId = ?'); params.push(node); }
    if (status) { where.push('status = ?'); params.push(status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`SELECT sourceQuestionId, nodeId, status, note, type, reviewer, updatedAt FROM reviews ${clause} ORDER BY updatedAt DESC`).all(...params);
  },
  upsertReview({ sourceQuestionId, nodeId, status, note, type, reviewer }) {
    const existing = this.getReview(sourceQuestionId);
    const row = {
      sourceQuestionId,
      nodeId: nodeId ?? (existing ? existing.nodeId : null),
      status: status ?? (existing ? existing.status : 'pending'),
      note: note ?? (existing ? existing.note : ''),
      type: type ?? (existing ? existing.type : null),
      reviewer: reviewer ?? (existing ? existing.reviewer : null),
      updatedAt: now(),
    };
    db.prepare(`INSERT INTO reviews (sourceQuestionId,nodeId,status,note,type,reviewer,updatedAt) VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(sourceQuestionId) DO UPDATE SET nodeId=excluded.nodeId, status=excluded.status, note=excluded.note, type=excluded.type, reviewer=excluded.reviewer, updatedAt=excluded.updatedAt`)
      .run(row.sourceQuestionId, row.nodeId, row.status, row.note, row.type, row.reviewer, row.updatedAt);
    return row;
  },
  deleteReview(sourceQuestionId) {
    return db.prepare('DELETE FROM reviews WHERE sourceQuestionId=?').run(sourceQuestionId).changes > 0;
  },
  getExplanation(sourceQuestionId) {
    return db.prepare('SELECT sourceQuestionId, model, explanation, updatedAt FROM explanations WHERE sourceQuestionId=?').get(sourceQuestionId) || null;
  },
  listExplanations() {
    return db.prepare('SELECT sourceQuestionId, model, explanation, updatedAt FROM explanations ORDER BY updatedAt').all();
  },
  upsertExplanation({ sourceQuestionId, model, explanation }) {
    const row = { sourceQuestionId, model: model || null, explanation: explanation || '', updatedAt: now() };
    db.prepare(`INSERT INTO explanations (sourceQuestionId,model,explanation,updatedAt) VALUES (?,?,?,?)
                ON CONFLICT(sourceQuestionId) DO UPDATE SET model=excluded.model, explanation=excluded.explanation, updatedAt=excluded.updatedAt`)
      .run(row.sourceQuestionId, row.model, row.explanation, row.updatedAt);
    return row;
  },
};
