import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, buildNotes } from '../src/report.mjs';

const nodes = [
  { id: 'N-5-1', name: '十進位' },
  { id: 'N-5-2', name: '多步驟' },
  { id: 'N-5-3', name: '公因數' },
];

test('buildReport splits learned vs needs-help and computes goal progress', () => {
  const r = buildReport({
    progressNodes: [
      { nodeId: 'N-5-1', attempts: 4, mastery: 90 },
      { nodeId: 'N-5-2', attempts: 3, mastery: 50 },
    ],
    wrongbook: [{ nodeId: 'N-5-2', sourceQuestionId: 'Q1' }, { nodeId: 'N-5-2', sourceQuestionId: 'Q2' }],
    nodes,
  });
  assert.deepEqual(r.learned.map((x) => x.nodeId), ['N-5-1']);
  assert.deepEqual(r.needsHelp.map((x) => x.nodeId), ['N-5-2']);
  assert.equal(r.needsHelp[0].wrongCount, 2);
  assert.deepEqual(r.goal, { completed: 1, total: 3, percent: 33 });
});

test('buildReport ignores nodes with no attempts', () => {
  const r = buildReport({ progressNodes: [{ nodeId: 'N-5-1', attempts: 0, mastery: 0 }], nodes });
  assert.equal(r.learned.length, 0);
  assert.equal(r.needsHelp.length, 0);
  assert.equal(r.goal.completed, 0);
});

test('buildReport resolves names and caps lists', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ nodeId: `N-${i}`, attempts: 1, mastery: i * 10 }));
  const r = buildReport({ progressNodes: many, nodes: [] });
  assert.ok(r.learned.length <= 5);
  assert.ok(r.needsHelp.length <= 3);
});

test('buildNotes pulls curriculum content and example prompts', () => {
  const n = buildNotes(
    { id: 'N-5-4', name: '異分母分數', topic: '數與量', content_description: '用約分、擴分處理等值分數。', performance_indicator: 'n-III-4' },
    [{ prompt: '將5/6和5/16通分　' }, { prompt: '' }, { prompt: '比較大小' }],
  );
  assert.equal(n.nodeId, 'N-5-4');
  assert.match(n.content, /等值分數/);
  assert.equal(n.indicator, 'n-III-4');
  assert.equal(n.examples.length, 2);
});

test('buildNotes handles empty node', () => {
  const n = buildNotes();
  assert.equal(n.nodeId, null);
  assert.deepEqual(n.examples, []);
});
