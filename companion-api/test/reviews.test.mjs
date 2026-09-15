import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-rev-'));
const { store } = await import('../src/db.mjs');

test('upsert / get / list reviews', () => {
  const created = store.upsertReview({ sourceQuestionId: 'EMA1', nodeId: 'N-5-4', status: 'adjust', note: '答案需確認', reviewer: 'teacher' });
  assert.equal(created.status, 'adjust');
  assert.equal(store.getReview('EMA1').note, '答案需確認');
  assert.equal(store.listReviews({ node: 'N-5-4' }).length, 1);
  assert.equal(store.listReviews({ status: 'adjust' }).length, 1);
  assert.equal(store.getReview('NOPE'), null);
});

test('upsert preserves unspecified fields', () => {
  store.upsertReview({ sourceQuestionId: 'EMA2', nodeId: 'S-5-1', status: 'adjust', note: 'n', reviewer: 'r' });
  store.upsertReview({ sourceQuestionId: 'EMA2', status: 'approved', note: '' });
  const r = store.getReview('EMA2');
  assert.equal(r.status, 'approved');
  assert.equal(r.nodeId, 'S-5-1'); // preserved
  assert.equal(r.reviewer, 'r'); // preserved
});
