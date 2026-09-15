import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-gen-'));
const {
  parseAnswer, buildDistractors, toChoiceVariant, mathmlFraction, formatValue, htmlForValue, stripNote, splitValues,
} = await import('../src/generate.mjs');

test('parseAnswer: fraction, mixed, integer, decimal with unit', () => {
  assert.deepEqual(parseAnswer('6/11'), { kind: 'fraction', whole: 0, num: 6, den: 11, value: 6 / 11, unit: '', raw: '6/11' });
  assert.equal(parseAnswer('12 2/5').value, 12.4);
  assert.equal(parseAnswer('108').kind, 'integer');
  assert.equal(parseAnswer('4.0902').kind, 'decimal');
  const withUnit = parseAnswer('6/11公升');
  assert.equal(withUnit.unit, '公升');
  assert.equal(withUnit.num, 6);
});

test('parseAnswer: multi-value / empty return null', () => {
  assert.equal(parseAnswer('8，8，40，3，3，15'), null);
  assert.equal(parseAnswer(''), null);
  assert.equal(parseAnswer('＝'), null);
});

test('stripNote removes trailing reference note', () => {
  assert.equal(stripNote('4.0902(本題答案僅供參考)'), '4.0902');
  assert.equal(stripNote('12/30，8/20（本題答案僅供參考）'), '12/30，8/20');
  assert.equal(stripNote('(本題答案僅供參考)'), '');
});

test('splitValues splits multi-value answers but keeps fraction slashes', () => {
  assert.deepEqual(splitValues('12/30，8/20，4/10(本題答案僅供參考)'), ['12/30', '8/20', '4/10']);
  assert.deepEqual(splitValues('8、8、40'), ['8', '8', '40']);
  assert.deepEqual(splitValues('5/6'), ['5/6']);
  assert.deepEqual(splitValues(''), []);
});

test('parseAnswer ignores trailing note', () => {
  assert.equal(parseAnswer('4.0902(本題答案僅供參考)').kind, 'decimal');
});

test('stripNote also strips leading notes and (或...) alternatives', () => {
  assert.equal(stripNote('(本題答案僅供參考)6/13，12/26'), '6/13，12/26');
  assert.equal(stripNote('1 8/32(或40/32)公斤'), '1 8/32公斤');
});

test('toChoiceVariant: Chinese fraction answer via text approximation', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '五分之四小時' });
  assert.equal(v.type, 'choice');
  assert.equal(v.options.length, 5);
  assert.equal(v.options[v.correctIndex], '五分之四小時');
  assert.ok(v.options.some((o) => o === '五分之三小時'));
});

test('toChoiceVariant: embedded-number text answer', () => {
  const v = toChoiceVariant({ questionType: 'short_answer', answer: '加上9' });
  assert.equal(v.options.length, 5);
  assert.equal(v.options[v.correctIndex], '加上9');
});

test('toChoiceVariant: alternative-note fraction becomes numeric choice', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '1 8/32(或40/32)公斤' });
  assert.equal(v.options.length, 5);
  assert.match(v.options[v.correctIndex], /1 8\/32/);
});

test('toChoiceVariant: pure name answers stay unconverted', () => {
  assert.equal(toChoiceVariant({ questionType: 'fill_blank', answer: '德倫' }), null);
});

test('mathmlFraction / htmlForValue render stacked fractions', () => {
  assert.match(mathmlFraction(3, 10, 12), /<mn>3<\/mn><mfrac><mrow><mn>10<\/mn>/);
  assert.match(htmlForValue(parseAnswer('5/6')), /<mfrac><mrow><mn>5<\/mn><\/mrow><mrow><mn>6<\/mn>/);
  assert.equal(formatValue(parseAnswer('3 10/12')), '3 10/12');
});

test('buildDistractors: 3 distinct plausible values, none equal to correct', () => {
  const p = parseAnswer('6/11');
  const d = buildDistractors(p, 3);
  assert.equal(d.length, 3);
  const values = new Set(d.map((x) => Math.round(x.value * 1e6)));
  assert.equal(values.size, 3);
  for (const x of d) assert.ok(Math.abs(x.value - p.value) > 1e-9);
});

test('toChoiceVariant: fill_blank fraction becomes 5-option MathML choice', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '6/11公升' });
  assert.equal(v.type, 'choice');
  assert.equal(v.options.length, 5);
  assert.equal(v.options[v.correctIndex], '6/11');
  assert.match(v.optionsHtml[v.correctIndex], /<mfrac>/);
  assert.equal(v.generator, 'rule-distractor');
  assert.equal(v.unit, '公升');
});

test('toChoiceVariant: integer and decimal answers get 5 options', () => {
  const i = toChoiceVariant({ questionType: 'short_answer', answer: '108' });
  assert.equal(i.options.length, 5);
  assert.equal(i.options[i.correctIndex], '108');
  const dec = toChoiceVariant({ questionType: 'fill_blank', answer: '4.0902' });
  assert.equal(dec.options[dec.correctIndex], '4.0902');
});

test('toChoiceVariant: relational operator answer becomes 5-option choice', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '＝' });
  assert.equal(v.type, 'choice');
  assert.equal(v.options.length, 5);
  assert.equal(v.options[v.correctIndex], '＝');
  assert.equal(new Set(v.options).size, 5);
});

test('toChoiceVariant: multi-value answer becomes 5-option set choice', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '12/30，8/20，4/10(本題答案僅供參考)' });
  assert.equal(v.type, 'choice');
  assert.equal(v.options.length, 5);
  assert.equal(v.options[v.correctIndex], '12/30、8/20、4/10');
  assert.match(v.optionsHtml[v.correctIndex], /<mfrac>/);
});

test('toChoiceVariant: null for multiple-choice and unconvertible text', () => {
  assert.equal(toChoiceVariant({ questionType: 'multiple_choice', answer: '1' }), null);
  assert.equal(toChoiceVariant({ questionType: 'short_answer', answer: '不一樣多' }), null);
});

test('distractors are non-equivalent (value differs, not just notation)', () => {
  const v = toChoiceVariant({ questionType: 'fill_blank', answer: '1/2' });
  const correct = 0.5;
  for (const [i, opt] of v.options.entries()) {
    if (i === v.correctIndex) continue;
    const p = parseAnswer(opt);
    if (p) assert.ok(Math.abs(p.value - correct) > 1e-9, `option ${opt} must not equal 1/2`);
  }
});
