import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlayerActivity, adaptSet, toAnswerRecord } from '../src/adapter.mjs';

test('toPlayerActivity normalizes activityId to id and keeps MathML fields', () => {
  const a = toPlayerActivity({
    activityId: 'q:EMA1',
    sourceQuestionId: 'EMA1',
    type: 'choice',
    prompt: 'p',
    promptHtml: '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
    options: ['1/2', '1/3'],
    optionsHtml: ['<math>a</math>', '<math>b</math>'],
    correctIndex: 0,
    nodeId: 'N-5-4',
  });
  assert.equal(a.id, 'q:EMA1');
  assert.equal(a.correctIndex, 0);
  assert.equal(a.optionsHtml.length, 2);
  assert.equal(a.nodeId, 'N-5-4');
});

test('toPlayerActivity defaults are safe', () => {
  const a = toPlayerActivity({ type: 'fill_blank', prompt: 'x' }, 3);
  assert.equal(a.id, 'activity-3');
  assert.deepEqual(a.options, []);
  assert.equal(a.optionsHtml, null);
  assert.equal(a.correctIndex, null);
  assert.equal(a.playable, true);
});

test('adaptSet filters out non-playable and prompt-less items', () => {
  const set = adaptSet({ items: [
    { activityId: 'a', type: 'choice', prompt: 'ok', options: ['1', '2'], correctIndex: 0 },
    { activityId: 'b', type: 'choice', prompt: '', options: ['1', '2'], correctIndex: 0 },
    { activityId: 'c', type: 'choice', prompt: 'no', playable: false },
  ] });
  assert.deepEqual(set.map((a) => a.id), ['a']);
});

test('adaptSet tolerates missing items', () => {
  assert.deepEqual(adaptSet({}), []);
  assert.deepEqual(adaptSet(), []);
});

test('toAnswerRecord shapes the companion-api payload', () => {
  const rec = toAnswerRecord(toPlayerActivity({ sourceQuestionId: 'EMA1', nodeId: 'N-5-4', prompt: 'p' }), 2, true);
  assert.deepEqual(rec, { sourceQuestionId: 'EMA1', nodeId: 'N-5-4', selected: 2, correct: true });
});
