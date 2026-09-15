import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, gradeChoice, gradeFillBlank, gradeMatching, gradeActivity } from '../src/grade.mjs';

test('normalizeText handles full/half width, spaces, case', () => {
  assert.equal(normalizeText('Ａ Ｂ'), 'ab');
  assert.equal(normalizeText(' 3 6'), '36');
  assert.equal(normalizeText('），'), '),');
});

test('gradeChoice compares 0-based index', () => {
  const a = { type: 'choice', correctIndex: 2 };
  assert.equal(gradeChoice(a, 2), true);
  assert.equal(gradeChoice(a, '2'), true);
  assert.equal(gradeChoice(a, 1), false);
  assert.equal(gradeChoice({ type: 'choice', correctIndex: null }, 0), false);
});

test('gradeFillBlank accepts variants and normalizes', () => {
  const a = { type: 'fill_blank', answer: '  ６／１１ ' };
  assert.equal(gradeFillBlank(a, '6/11'), true);
  assert.equal(gradeFillBlank(a, '6 / 11'), true);
  assert.equal(gradeFillBlank(a, '7/11'), false);
});

test('gradeFillBlank accepts equivalent fractions for single blank', () => {
  assert.equal(gradeFillBlank({ type: 'fill_blank', accept: ['12/30'] }, '2/5'), true);
  assert.equal(gradeFillBlank({ type: 'fill_blank', accept: ['2/5'] }, '12/30'), true);
  assert.equal(gradeFillBlank({ type: 'fill_blank', accept: ['2/5'] }, '1/2'), false);
});

test('gradeFillBlank handles multi blank (order-insensitive when interchangeable)', () => {
  const a = { type: 'fill_blank', accept: ['12/30', '8/20', '4/10'] };
  assert.equal(gradeFillBlank(a, '12/30，8/20，4/10'), true);
  assert.equal(gradeFillBlank(a, '4/10，8/20，12/30'), true);  // 等值 → 順序不拘
  assert.equal(gradeFillBlank(a, '12/30，8/20'), false);       // 數量不足
  const ordered = { type: 'fill_blank', accept: ['8', '8', '40'] };
  assert.equal(gradeFillBlank(ordered, '8，8，40'), true);
  assert.equal(gradeFillBlank(ordered, '40，8，8'), false);    // 非同值 → 逐格
});

test('gradeMatching requires all pairs correct', () => {
  const a = { type: 'matching', pairs: [{ left: '1/2', right: '2/4' }, { left: '1/3', right: '2/6' }] };
  assert.equal(gradeMatching(a, { 0: '2/4', 1: '2/6' }), true);
  assert.equal(gradeMatching(a, { 0: '2/4', 1: '2/4' }), false);
  assert.equal(gradeMatching(a, {}), false);
});

test('gradeActivity dispatches by type', () => {
  assert.equal(gradeActivity({ type: 'choice', correctIndex: 1 }, { index: 1 }), true);
  assert.equal(gradeActivity({ type: 'fill_blank', answer: 'x' }, { text: 'X' }), true);
  assert.equal(gradeActivity({ type: 'matching', pairs: [{ left: 'a', right: 'b' }] }, { assignments: { 0: 'b' } }), true);
  assert.equal(gradeActivity({ type: 'listening' }, {}), false);
});
