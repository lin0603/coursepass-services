import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, promptHtml, optionHtml, figureHtml, choiceHtml, matchingHtml, activityCardHtml,
} from '../src/render.mjs';

const frac = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mrow><mn>6</mn></mrow><mrow><mn>11</mn></mrow></mfrac></math>';

test('promptHtml prefers MathML, falls back to escaped plain text', () => {
  assert.match(promptHtml({ promptHtml: frac, prompt: 'x' }), /<mfrac>/);
  assert.match(promptHtml({ promptHtml: null, prompt: '<b>a</b>' }), /&lt;b&gt;a&lt;\/b&gt;/);
});

test('optionHtml uses optionsHtml when present', () => {
  const a = { options: ['6/11'], optionsHtml: [frac] };
  assert.match(optionHtml(a, 0), /<mfrac>/);
  assert.equal(optionHtml({ options: ['x'], optionsHtml: null }, 0), 'x');
});

test('figureHtml renders svg figureUrl', () => {
  const html = figureHtml({ figureUrl: 'https://x/figures-drawn/a.svg' });
  assert.match(html, /<img src="https:\/\/x\/figures-drawn\/a\.svg"/);
  assert.equal(figureHtml({}), '');
});

test('figureHtml skips a separate figure when promptHtml already embeds one', () => {
  const html = figureHtml({ promptHtml: '題幹<img class="q-fig" src="https://x/fig.svg">', figureUrl: 'https://x/fig.svg', imageUrl: 'https://x/q.png' });
  assert.equal(html, '');
});

test('figureHtml does not show the whole-question image when promptHtml exists', () => {
  assert.equal(figureHtml({ promptHtml: '純文字題', imageUrl: 'https://x/q.png' }), '');
});

test('figureHtml falls back to imageUrl only without promptHtml (legacy)', () => {
  const html = figureHtml({ promptHtml: null, imageUrl: 'https://x/q.png' });
  assert.match(html, /題目原圖/);
});

test('choiceHtml emits one button per option with indices', () => {
  const html = choiceHtml({ options: ['a', 'b', 'c'], optionsHtml: null });
  assert.equal((html.match(/data-choice=/g) || []).length, 3);
  assert.match(html, /data-choice="2"/);
});

test('matchingHtml honours a shuffled right order', () => {
  const a = { pairs: [{ left: '1/2', right: '2/4' }, { left: '1/3', right: '2/6' }] };
  const html = matchingHtml(a, [1, 0]);
  const rights = [...html.matchAll(/data-right="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(rights, ['1', '0']);
});

test('activityCardHtml embeds MathML options for a MathML choice', () => {
  const html = activityCardHtml({ type: 'choice', prompt: 'p', promptHtml: frac, options: ['6/11', '6/12'], optionsHtml: [frac, frac], correctIndex: 0, generator: 'direct' });
  assert.match(html, /<mfrac>/);
  assert.match(html, /data-choice="0"/);
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});
