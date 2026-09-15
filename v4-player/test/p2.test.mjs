import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesHtml } from '../src/notes.mjs';
import { reportHtml } from '../src/report.mjs';

test('notesHtml renders curriculum content, indicator and examples', () => {
  const html = notesHtml({ nodeId: 'N-5-4', name: '異分母分數', topic: '數與量', content: '用約分、擴分處理等值分數。', indicator: 'n-III-4', examples: ['將5/6和5/16通分'] });
  assert.match(html, /重點整理/);
  assert.match(html, /異分母分數/);
  assert.match(html, /等值分數/);
  assert.match(html, /n-III-4/);
  assert.match(html, /將5\/6和5\/16通分/);
});

test('notesHtml escapes and handles empty', () => {
  const html = notesHtml({ name: '<b>x</b>' });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /尚無課綱描述/);
});

test('reportHtml answers the three questions', () => {
  const html = reportHtml({
    learned: [{ nodeId: 'N-5-1', name: '十進位', mastery: 90 }],
    needsHelp: [{ nodeId: 'N-5-2', name: '多步驟', mastery: 50, wrongCount: 2 }],
    goal: { completed: 1, total: 3, percent: 33 },
  });
  assert.match(html, /這週學會什麼/);
  assert.match(html, /哪裡需要幫忙/);
  assert.match(html, /距離目標/);
  assert.match(html, /十進位（精熟 90%）/);
  assert.match(html, /多步驟（精熟 50%、錯 2 題）/);
  assert.match(html, /已達標 1／3 個知識點（33%）/);
});

test('reportHtml renders empty states', () => {
  const html = reportHtml({ learned: [], needsHelp: [], goal: { completed: 0, total: 0, percent: 0 } });
  assert.match(html, /還沒有足夠資料/);
  assert.match(html, /目前沒有明顯卡關/);
});
