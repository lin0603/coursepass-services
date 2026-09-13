import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-mix-'));
const { buildMatching, parseAnswer } = await import('../src/generate.mjs');
const { buildActivitySet, collectCandidates } = await import('../src/mixer.mjs');

function q(over = {}) {
  return {
    sourceQuestionId: 'Q',
    primaryKnowledgeNodeId: 'N-5-4',
    subject: '數學',
    grade: 5,
    publisher: '康軒',
    prompt: '題目',
    questionType: 'fill_blank',
    answer: '1/2',
    reviewStatus: 'approved',
    ...over,
  };
}

const fracPool = ['1/2', '1/3', '2/5', '3/7', '4/9', '5/11'].map((a, i) =>
  q({ sourceQuestionId: `F${i}`, answer: a, questionType: 'short_answer' }));

test('buildMatching: pairs are value-equivalent, distinct, and use MathML', () => {
  const m = buildMatching(fracPool, { pairCount: 4 });
  assert.equal(m.type, 'matching');
  assert.equal(m.pairs.length, 4);
  const lefts = new Set();
  const rights = new Set();
  for (const p of m.pairs) {
    assert.equal(parseAnswer(p.left).value, parseAnswer(p.right).value);
    assert.match(p.leftHtml, /<mfrac>/);
    lefts.add(p.left);
    rights.add(p.right);
  }
  assert.equal(lefts.size, 4);
  assert.equal(rights.size, 4);
});

test('buildMatching: null when not enough clean fractions', () => {
  assert.equal(buildMatching([q({ answer: '1/2' }), q({ answer: 'x' })], { pairCount: 4 }), null);
});

test('collectCandidates: math short_answer becomes generated choice, one per source', () => {
  const cands = collectCandidates(fracPool);
  assert.equal(cands.length, fracPool.length);
  assert.ok(cands.every((c) => c.type === 'choice'));
  assert.ok(cands.every((c) => c.generator === 'rule-distractor'));
  assert.equal(new Set(cands.map((c) => c.sourceQuestionId)).size, cands.length);
});

test('buildActivitySet: honours count, includes matching, avoids >2 same type in a row', () => {
  const pool = [
    ...fracPool,
    q({ sourceQuestionId: 'M1', questionType: 'multiple_choice', answer: '1', options: ['a', 'b', 'c', 'd'] }),
    q({ sourceQuestionId: 'T1', questionType: 'true_false', answer: '○' }),
  ];
  const set = buildActivitySet(pool, { count: 8 });
  assert.ok(set.length <= 8);
  assert.ok(set.some((a) => a.type === 'matching'));
  let last = null, run = 0;
  for (const a of set) {
    if (a.type === last) run++; else { last = a.type; run = 1; }
    assert.ok(run <= 2, `type ${a.type} ran ${run} times in a row`);
  }
  const sources = set.filter((a) => a.sourceQuestionId).map((a) => a.sourceQuestionId);
  assert.equal(sources.length, new Set(sources).size, 'no duplicate source in a set');
});

test('buildActivitySet: empty input yields empty set', () => {
  assert.deepEqual(buildActivitySet([], { count: 10 }), []);
});
