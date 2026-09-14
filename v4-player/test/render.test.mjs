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
