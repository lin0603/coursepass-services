import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-test-'));
process.env.FILES_BASE = 'https://files.example.com';
const { toActivity, activityType, resolveCorrectIndex, optionText } = await import('../src/activities.mjs');

const base = {
  sourceQuestionId: 'Q1',
  primaryKnowledgeNodeId: 'N-5-4',
  subject: '數學',
  grade: 5,
  publisher: '康軒',
  prompt: '下面哪一個分數最大？',
  reviewStatus: 'approved',
};

test('activityType maps source types', () => {
  assert.equal(activityType('multiple_choice'), 'choice');
  assert.equal(activityType('true_false'), 'choice');
  assert.equal(activityType('short_answer'), 'fill_blank');
  assert.equal(activityType('ordering'), 'word_order');
  assert.equal(activityType('matching'), 'matching');
  assert.equal(activityType('unknown'), 'fill_blank');
});

test('optionText handles objects and strings', () => {
  assert.equal(optionText({ label: 'A', content: '8/9', isCorrect: true }), '8/9');
  assert.equal(optionText('5/8'), '5/8');
  assert.equal(optionText({ text: 'x' }), 'x');
});

test('resolveCorrectIndex prefers isCorrect flag', () => {
  const raw = [{ content: 'a' }, { content: 'b', isCorrect: true }, { content: 'c' }];
  assert.equal(resolveCorrectIndex(raw.map(optionText), raw, '1'), 1);
});

test('resolveCorrectIndex from 1-based numeric answer (string options)', () => {
  assert.equal(resolveCorrectIndex(['89', '58', '25', '13'], ['89', '58', '25', '13'], '1'), 0);
  assert.equal(resolveCorrectIndex(['89', '58', '25', '13'], ['89', '58', '25', '13'], '4'), 3);
});

test('resolveCorrectIndex from label and from text', () => {
  const raw = [{ label: 'A', content: 'x' }, { label: 'B', content: 'y' }];
  assert.equal(resolveCorrectIndex(raw.map(optionText), raw, 'B'), 1);
  assert.equal(resolveCorrectIndex(['x', 'y'], [], 'y'), 1);
  assert.equal(resolveCorrectIndex(['x', 'y'], [], 'zzz'), null);
});

test('multiple_choice with object options derives correctIndex', () => {
  const a = toActivity({
    ...base,
    questionType: 'multiple_choice',
    options: [
      { label: 'A', content: '8/9', isCorrect: true },
      { label: 'B', content: '5/8', isCorrect: false },
      { label: 'C', content: '2/5', isCorrect: false },
      { label: 'D', content: '1/3', isCorrect: false },
    ],
    answer: '1',
  });
  assert.equal(a.type, 'choice');
  assert.deepEqual(a.options, ['8/9', '5/8', '2/5', '1/3']);
  assert.equal(a.correctIndex, 0);
  assert.equal(a.playable, true);
});

test('multiple_choice with string options falls back to answer index', () => {
  const a = toActivity({
    ...base,
    questionType: 'multiple_choice',
    options: ['89', '58', '25', '13'],
    answer: '1',
  });
  assert.equal(a.correctIndex, 0);
  assert.equal(a.playable, true);
});

test('true_false synthesizes 正確/錯誤 with correctIndex', () => {
  const yes = toActivity({ ...base, questionType: 'true_false', options: [], answer: '○' });
  assert.equal(yes.type, 'choice');
  assert.deepEqual(yes.options, ['正確', '錯誤']);
  assert.equal(yes.correctIndex, 0);
  assert.equal(yes.playable, true);

  const no = toActivity({ ...base, questionType: 'true_false', options: [], answer: '╳' });
  assert.equal(no.correctIndex, 1);
  assert.equal(no.playable, true);
});

test('fill_blank keeps answer and has null contract fields', () => {
  const a = toActivity({ ...base, questionType: 'fill_blank', options: [], answer: '8，8，40' });
  assert.equal(a.type, 'fill_blank');
  assert.equal(a.answer, '8，8，40');
  assert.equal(a.correctIndex, null);
  assert.equal(a.pairs, null);
  assert.equal(a.playable, true);
});

test('choice without resolvable correct answer is not playable', () => {  const a = toActivity({
    ...base,
    questionType: 'multiple_choice',
    options: ['x', 'y'],
    answer: 'zzz',
  });
  assert.equal(a.correctIndex, null);
  assert.equal(a.playable, false);
});

test('fill_blank splits multi-value answers and strips note', () => {
  const a = toActivity({ ...base, questionType: 'fill_blank', options: [], answer: '12/30，8/20，4/10(本題答案僅供參考)' });
  assert.equal(a.answer, '12/30，8/20，4/10');
  assert.deepEqual(a.accept, ['12/30', '8/20', '4/10']);
  assert.equal(a.blanks, 3);
  assert.equal(a.playable, true);
  const noteOnly = toActivity({ ...base, questionType: 'fill_blank', options: [], answer: '(本題答案僅供參考)' });
  assert.equal(noteOnly.blanks, 0);
  assert.equal(noteOnly.playable, false);
});

test('toActivity builds pairs from matchingMap (unique lefts required)', () => {
  const a = toActivity(
    { ...base, sourceQuestionId: 'M1', questionType: 'matching', options: [], answer: '' },
    { matchingMap: { M1: { pairs: [{ left: '48÷7', right: '不整除' }, { left: '48÷12', right: '整除' }] } } },
  );
  assert.equal(a.type, 'matching');
  assert.equal(a.pairs.length, 2);
  assert.equal(a.playable, true);
  assert.equal(a.pairs[0].right, '不整除');
});

test('toActivity rejects matching pairs with duplicate lefts', () => {
  const a = toActivity(
    { ...base, sourceQuestionId: 'M2', questionType: 'matching', options: [], answer: '' },
    { matchingMap: { M2: { pairs: [{ left: 'x', right: 'a' }, { left: 'x', right: 'b' }] } } },
  );
  assert.equal(a.pairs, null);
  assert.equal(a.playable, false);
});

test('toActivity uses llmMap fallback for unconvertible answers', () => {
  const a = toActivity(
    { ...base, questionType: 'fill_blank', options: [], answer: '德倫' },
    { llmMap: { Q1: ['小明', '阿華', '小美', '大雄'] } },
  );
  assert.ok(a.variants && a.variants.choice);
  assert.equal(a.variants.choice.options.length, 5);
  assert.equal(a.variants.choice.generator, 'llm-distractor');
});

test('matching/word_order placeholders are emitted as nulls (Phase C/D)', () => {
  const m = toActivity({ ...base, questionType: 'matching', options: [], answer: '' });
  assert.equal(m.type, 'matching');
  assert.equal(m.pairs, null);
  assert.equal(m.playable, false);
  const w = toActivity({ ...base, questionType: 'ordering', options: [], answer: '' });
  assert.equal(w.type, 'word_order');
  assert.equal(w.words, null);
});

test('imageUrl is absolutized and figure passthrough works', () => {
  const a = toActivity({
    ...base,
    questionType: 'fill_blank',
    answer: '1',
    imageUrl: 'iso/knsh/quesdoc1MA/Single/15090404/EMA1.png',
    hasFigure: true,
    figureUrl: 'https://files.example.com/figures-drawn/x.svg',
    chapter: '五上 ・ 第四單元 ・ 4-4',
  });
  assert.equal(a.imageUrl, 'https://files.example.com/iso/knsh/quesdoc1MA/Single/15090404/EMA1.png');
  assert.equal(a.hasFigure, true);
  assert.equal(a.figureUrl, 'https://files.example.com/figures-drawn/x.svg');
  assert.equal(a.chapter, '五上 ・ 第四單元 ・ 4-4');
});
