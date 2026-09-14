import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapHtml } from '../src/map.mjs';

const data = {
  subject: '數學',
  grade: 5,
  current: 'N-5-2',
  completed: 1,
  total: 3,
  groups: [
    { topic: '數與量', nodes: [
      { id: 'N-5-1', name: 'a', status: 'completed', mastery: 90 },
      { id: 'N-5-2', name: 'b', status: 'current', mastery: 0 },
    ] },
    { topic: '空間與形狀', nodes: [{ id: 'S-5-1', name: 'c', status: 'locked', mastery: 0 }] },
  ],
};

test('mapHtml renders groups, topics and per-node status', () => {
  const html = mapHtml(data);
  assert.match(html, /數與量/);
  assert.match(html, /空間與形狀/);
  assert.equal((html.match(/data-node=/g) || []).length, 3);
  assert.match(html, /data-node="N-5-2"[^>]*|path-stop current/);
  assert.match(html, /path-stop completed/);
  assert.match(html, /path-stop locked/);
  assert.match(html, /已完成 1／3 個知識點/);
});

test('mapHtml shows mastery and escapes names', () => {
  const html = mapHtml({ groups: [{ topic: 'T', nodes: [{ id: 'X', name: '<b>n</b>', status: 'current', mastery: 80 }] }] });
  assert.match(html, /精熟 80%/);
  assert.match(html, /&lt;b&gt;n&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>n</b>'));
});

test('mapHtml handles empty data', () => {
  const html = mapHtml();
  assert.match(html, /沒有路徑資料/);
});

test('mapHtml puts a ▶ badge on current and ✓ on completed', () => {
  const html = mapHtml(data);
  assert.match(html, /path-stop current[\s\S]*?▶/);
  assert.match(html, /path-stop completed[\s\S]*?✓/);
});
