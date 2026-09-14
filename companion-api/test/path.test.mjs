import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePathStatuses, groupByTopic } from '../src/path.mjs';

const nodes = [
  { id: 'N-5-1', name: 'a', topic: '數與量' },
  { id: 'N-5-2', name: 'b', topic: '數與量' },
  { id: 'S-5-1', name: 'c', topic: '空間與形狀' },
];

test('computePathStatuses: no progress -> first current, rest locked', () => {
  const out = computePathStatuses(nodes, {});
  assert.deepEqual(out.map((n) => n.status), ['current', 'locked', 'locked']);
  assert.deepEqual(out.map((n) => n.mastery), [0, 0, 0]);
});

test('computePathStatuses: completed and current by mastery threshold', () => {
  const out = computePathStatuses(nodes, { 'N-5-1': { mastery: 90, attempts: 3 } });
  assert.deepEqual(out.map((n) => n.status), ['completed', 'current', 'locked']);
});

test('computePathStatuses: mastery below threshold is not completed', () => {
  const out = computePathStatuses(nodes, { 'N-5-1': { mastery: 60, attempts: 5 } });
  assert.equal(out[0].status, 'current');
});

test('computePathStatuses: attempts 0 with mastery is not completed', () => {
  const out = computePathStatuses(nodes, { 'N-5-1': { mastery: 100, attempts: 0 } });
  assert.equal(out[0].status, 'current');
});

test('computePathStatuses: custom threshold', () => {
  const out = computePathStatuses(nodes, { 'N-5-1': { mastery: 70, attempts: 2 } }, { masteryThreshold: 60 });
  assert.deepEqual(out.map((n) => n.status), ['completed', 'current', 'locked']);
});

test('computePathStatuses: all completed -> no current', () => {
  const p = { 'N-5-1': { mastery: 90, attempts: 1 }, 'N-5-2': { mastery: 90, attempts: 1 }, 'S-5-1': { mastery: 90, attempts: 1 } };
  const out = computePathStatuses(nodes, p);
  assert.deepEqual(out.map((n) => n.status), ['completed', 'completed', 'completed']);
});

test('groupByTopic keeps topics and a single global current', () => {
  const groups = [
    { topic: '數與量', nodes: [nodes[0], nodes[1]] },
    { topic: '空間與形狀', nodes: [nodes[2]] },
  ];
  const result = groupByTopic(groups, { 'N-5-1': { mastery: 90, attempts: 1 } });
  assert.deepEqual(result.groups.map((g) => g.topic), ['數與量', '空間與形狀']);
  assert.equal(result.current, 'N-5-2');
  assert.equal(result.completed, 1);
  assert.equal(result.total, 3);
  assert.equal(result.groups[1].nodes[0].status, 'locked');
});
