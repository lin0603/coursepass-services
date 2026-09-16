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
CREATE TABLE IF NOT EXISTS reviewers (
  id TEXT PRIMARY KEY, name TEXT, active INTEGER DEFAULT 1, createdAt TEXT
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceQuestionId TEXT, reviewerId TEXT, batchId TEXT, status TEXT DEFAULT 'pending',
  assignedAt TEXT, doneAt TEXT, UNIQUE(sourceQuestionId, reviewerId)
);
CREATE TABLE IF NOT EXISTS question_reviews (
  sourceQuestionId TEXT, reviewerId TEXT, nodeId TEXT, status TEXT, note TEXT,
  type TEXT, typeMismatch INTEGER DEFAULT 0, updatedAt TEXT,
  PRIMARY KEY (sourceQuestionId, reviewerId)
);
CREATE INDEX IF NOT EXISTS ix_assign_reviewer ON assignments(reviewerId, status);
CREATE INDEX IF NOT EXISTS ix_assign_question ON assignments(sourceQuestionId);
CREATE INDEX IF NOT EXISTS ix_qreview_question ON question_reviews(sourceQuestionId);
CREATE TABLE IF NOT EXISTS review_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sourceQuestionId TEXT, reviewerId TEXT, reviewerName TEXT,
  fromStatus TEXT, toStatus TEXT, fromType TEXT, toType TEXT, typeMismatch INTEGER, note TEXT, at TEXT
);
CREATE INDEX IF NOT EXISTS ix_rhist_question ON review_history(sourceQuestionId);
CREATE INDEX IF NOT EXISTS ix_answers_learner ON answers(learnerId, createdAt);
CREATE INDEX IF NOT EXISTS ix_wrongbook_learner ON wrongbook(learnerId, lastWrongAt);
CREATE INDEX IF NOT EXISTS ix_reviews_node ON reviews(nodeId, status);
`);

// 舊資料庫補欄位：reviews.type（老師選定的題型）、reviews.typeMismatch（題型不適合）
const reviewCols = db.prepare('PRAGMA table_info(reviews)').all().map((c) => c.name);
if (!reviewCols.includes('type')) db.exec('ALTER TABLE reviews ADD COLUMN type TEXT');
if (!reviewCols.includes('typeMismatch')) db.exec('ALTER TABLE reviews ADD COLUMN typeMismatch INTEGER DEFAULT 0');
// 課程欄位（多課程）
for (const [table, col] of [['question_reviews', 'courseId'], ['assignments', 'courseId']]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
}
// 舊 reviews（單筆）遷移成 question_reviews（可多審查人；legacy 以 reviewerId='' 表示）
try {
  db.exec(`INSERT OR IGNORE INTO question_reviews (sourceQuestionId, reviewerId, nodeId, status, note, type, typeMismatch, updatedAt)
           SELECT sourceQuestionId, '', nodeId, status, note, type, typeMismatch, updatedAt FROM reviews`);
} catch { /* ignore migration errors */ }

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
    const r = db.prepare('SELECT sourceQuestionId, nodeId, status, note, type, typeMismatch, reviewer, updatedAt FROM reviews WHERE sourceQuestionId=?').get(sourceQuestionId);
    return r ? { ...r, typeMismatch: !!r.typeMismatch } : null;
  },
  listReviews({ node, status } = {}) {
    const where = [];
    const params = [];
    if (node) { where.push('nodeId = ?'); params.push(node); }
    if (status) { where.push('status = ?'); params.push(status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`SELECT sourceQuestionId, nodeId, status, note, type, typeMismatch, reviewer, updatedAt FROM reviews ${clause} ORDER BY updatedAt DESC`)
      .all(...params).map((r) => ({ ...r, typeMismatch: !!r.typeMismatch }));
  },
  upsertReview({ sourceQuestionId, nodeId, status, note, type, typeMismatch, reviewer }) {
    const existing = this.getReview(sourceQuestionId);
    const row = {
      sourceQuestionId,
      nodeId: nodeId ?? (existing ? existing.nodeId : null),
      status: status ?? (existing ? existing.status : 'pending'),
      note: note ?? (existing ? existing.note : ''),
      type: type ?? (existing ? existing.type : null),
      typeMismatch: (typeMismatch ?? (existing ? existing.typeMismatch : false)) ? 1 : 0,
      reviewer: reviewer ?? (existing ? existing.reviewer : null),
      updatedAt: now(),
    };
    db.prepare(`INSERT INTO reviews (sourceQuestionId,nodeId,status,note,type,typeMismatch,reviewer,updatedAt) VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(sourceQuestionId) DO UPDATE SET nodeId=excluded.nodeId, status=excluded.status, note=excluded.note, type=excluded.type, typeMismatch=excluded.typeMismatch, reviewer=excluded.reviewer, updatedAt=excluded.updatedAt`)
      .run(row.sourceQuestionId, row.nodeId, row.status, row.note, row.type, row.typeMismatch, row.reviewer, row.updatedAt);
    return { ...row, typeMismatch: !!row.typeMismatch };
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

  // ---- 審查人 ----
  listReviewers() {
    return db.prepare('SELECT id, name, active, createdAt FROM reviewers ORDER BY createdAt').all();
  },
  getReviewer(id) {
    return db.prepare('SELECT id, name, active, createdAt FROM reviewers WHERE id=?').get(id) || null;
  },
  addReviewer({ id, name }) {
    db.prepare('INSERT OR IGNORE INTO reviewers (id, name, active, createdAt) VALUES (?,?,?,?)').run(id, name, 1, now());
    return this.getReviewer(id);
  },
  deleteReviewer(id) {
    db.prepare('DELETE FROM assignments WHERE reviewerId=?').run(id);
    return db.prepare('DELETE FROM reviewers WHERE id=?').run(id).changes > 0;
  },

  // ---- 指派 ----
  createAssignments(rows, batchId) {
    const stmt = db.prepare("INSERT OR IGNORE INTO assignments (sourceQuestionId, reviewerId, batchId, status, assignedAt, courseId) VALUES (?,?,?,'pending',?,?)");
    const tx = db.transaction((rs) => { for (const r of rs) stmt.run(r.sourceQuestionId, r.reviewerId, batchId, now(), r.courseId || null); });
    tx(rows);
    return rows.length;
  },
  listAssignments({ reviewerId, status } = {}) {
    const where = [];
    const params = [];
    if (reviewerId) { where.push('a.reviewerId = ?'); params.push(reviewerId); }
    if (status) { where.push('a.status = ?'); params.push(status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`SELECT a.sourceQuestionId, a.reviewerId, a.status, a.assignedAt, a.doneAt, r.name AS reviewerName
                       FROM assignments a LEFT JOIN reviewers r ON r.id = a.reviewerId ${clause}
                       ORDER BY a.id`).all(...params);
  },
  assignedQuestionIds() {
    return db.prepare('SELECT DISTINCT sourceQuestionId FROM assignments').all().map((r) => r.sourceQuestionId);
  },
  markAssignmentDone(sourceQuestionId, reviewerId) {
    db.prepare("UPDATE assignments SET status='done', doneAt=? WHERE sourceQuestionId=? AND reviewerId=?").run(now(), sourceQuestionId, reviewerId);
  },
  reassign({ from, to, limit = 1000 }) {
    const rows = db.prepare("SELECT id FROM assignments WHERE reviewerId=? AND status='pending' LIMIT ?").all(from, limit);
    const upd = db.prepare("UPDATE OR IGNORE assignments SET reviewerId=?, batchId='reassigned' WHERE id=?");
    const del = db.prepare('DELETE FROM assignments WHERE id=?');
    const tx = db.transaction((ids) => {
      for (const r of ids) { const res = upd.run(to, r.id); if (res.changes === 0) del.run(r.id); }
    });
    tx(rows);
    return rows.length;
  },
  reviewProgress() {
    return db.prepare(`SELECT a.reviewerId, r.name AS reviewerName, COUNT(*) AS total,
                              SUM(CASE WHEN a.status='done' THEN 1 ELSE 0 END) AS done
                       FROM assignments a LEFT JOIN reviewers r ON r.id = a.reviewerId
                       GROUP BY a.reviewerId`).all();
  },

  // ---- 逐審查人審查意見（雙審）----
  getQuestionReview(sourceQuestionId, reviewerId) {
    const r = db.prepare('SELECT sourceQuestionId, reviewerId, nodeId, status, note, type, typeMismatch, updatedAt FROM question_reviews WHERE sourceQuestionId=? AND reviewerId=?').get(sourceQuestionId, reviewerId);
    return r ? { ...r, typeMismatch: !!r.typeMismatch } : null;
  },
  listQuestionReviews({ sourceQuestionId, reviewerId } = {}) {
    const where = [];
    const params = [];
    if (sourceQuestionId) { where.push('sourceQuestionId = ?'); params.push(sourceQuestionId); }
    if (reviewerId) { where.push('reviewerId = ?'); params.push(reviewerId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`SELECT sourceQuestionId, reviewerId, nodeId, status, note, type, typeMismatch, updatedAt
                       FROM question_reviews ${clause} ORDER BY updatedAt DESC`)
      .all(...params).map((r) => ({ ...r, typeMismatch: !!r.typeMismatch }));
  },
  upsertQuestionReview({ sourceQuestionId, reviewerId, nodeId, status, note, type, typeMismatch, courseId }) {
    const existing = this.getQuestionReview(sourceQuestionId, reviewerId);
    const row = {
      sourceQuestionId, reviewerId,
      nodeId: nodeId ?? (existing ? existing.nodeId : null),
      status: status ?? (existing ? existing.status : 'pending'),
      note: note ?? (existing ? existing.note : ''),
      type: type ?? (existing ? existing.type : null),
      typeMismatch: (typeMismatch ?? (existing ? existing.typeMismatch : false)) ? 1 : 0,
      courseId: courseId ?? (existing ? existing.courseId : null),
      updatedAt: now(),
    };
    db.prepare(`INSERT INTO question_reviews (sourceQuestionId,reviewerId,nodeId,status,note,type,typeMismatch,courseId,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(sourceQuestionId, reviewerId) DO UPDATE SET nodeId=excluded.nodeId, status=excluded.status, note=excluded.note, type=excluded.type, typeMismatch=excluded.typeMismatch, courseId=excluded.courseId, updatedAt=excluded.updatedAt`)
      .run(row.sourceQuestionId, row.reviewerId, row.nodeId, row.status, row.note, row.type, row.typeMismatch, row.courseId, row.updatedAt);
    if (reviewerId) this.markAssignmentDone(sourceQuestionId, reviewerId);
    const changed = !existing
      || String(existing.status ?? '') !== String(row.status ?? '')
      || String(existing.type ?? '') !== String(row.type ?? '')
      || !!existing.typeMismatch !== !!row.typeMismatch
      || String(existing.note ?? '') !== String(row.note ?? '');
    if (changed) this.logReviewHistory({ sourceQuestionId, reviewerId, from: existing, to: row });
    return { ...row, typeMismatch: !!row.typeMismatch };
  },
  logReviewHistory({ sourceQuestionId, reviewerId, from, to }) {
    const name = (this.getReviewer(reviewerId) || {}).name || reviewerId || '';
    db.prepare(`INSERT INTO review_history (sourceQuestionId, reviewerId, reviewerName, fromStatus, toStatus, fromType, toType, typeMismatch, note, at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(sourceQuestionId, reviewerId || '', name, from ? from.status : null, to.status, from ? from.type : null, to.type, to.typeMismatch ? 1 : 0, to.note || '', now());
  },
  reviewHistory(sourceQuestionId) {
    return db.prepare('SELECT sourceQuestionId, reviewerId, reviewerName, fromStatus, toStatus, fromType, toType, typeMismatch, note, at FROM review_history WHERE sourceQuestionId=? ORDER BY id DESC')
      .all(sourceQuestionId).map((r) => ({ ...r, typeMismatch: !!r.typeMismatch }));
  },
  deleteQuestionReview(sourceQuestionId, reviewerId) {
    return db.prepare('DELETE FROM question_reviews WHERE sourceQuestionId=? AND reviewerId=?').run(sourceQuestionId, reviewerId).changes > 0;
  },
  // 各課程審題進度（審查站首頁用）
  courseProgress() {
    const map = {};
    for (const r of db.prepare(`SELECT courseId, sourceQuestionId, COUNT(*) n FROM question_reviews
                                WHERE courseId IS NOT NULL AND courseId <> '' GROUP BY courseId, sourceQuestionId`).all()) {
      const c = (map[r.courseId] = map[r.courseId] || { courseId: r.courseId, questions: 0, reviews: 0, done: 0 });
      c.questions += 1; c.reviews += r.n; if (r.n >= 2) c.done += 1;
    }
    for (const a of db.prepare(`SELECT courseId, COUNT(*) total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done
                                FROM assignments WHERE courseId IS NOT NULL AND courseId <> '' GROUP BY courseId`).all()) {
      const c = (map[a.courseId] = map[a.courseId] || { courseId: a.courseId, questions: 0, reviews: 0, done: 0 });
      c.assigned = a.total; c.assignedDone = a.done;
    }
    return Object.values(map);
  },

  // 老師改選的題型（供活動組裝覆寫）
  typeOverrides() {
    const rows = db.prepare("SELECT sourceQuestionId, type FROM question_reviews WHERE type IS NOT NULL AND type <> '' ORDER BY updatedAt DESC").all();
    const map = {};
    for (const r of rows) if (!map[r.sourceQuestionId]) map[r.sourceQuestionId] = r.type;
    return map;
  },
  // 給 AI 後續優化：結構化匯出（含審查人、意見、建議題型）
  exportReviews() {
    return db.prepare(`SELECT q.sourceQuestionId, q.reviewerId, r.name AS reviewerName, q.nodeId, q.status, q.note, q.type, q.typeMismatch, q.updatedAt
                       FROM question_reviews q LEFT JOIN reviewers r ON r.id = q.reviewerId
                       ORDER BY q.sourceQuestionId`).all().map((r) => ({ ...r, typeMismatch: !!r.typeMismatch }));
  },
};
