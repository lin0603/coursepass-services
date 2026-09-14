// V4 player: fetch a unit's mixed activity set and play it one item at a time.
import { adaptSet, toAnswerRecord } from './adapter.mjs';
import { gradeActivity } from './grade.mjs';
import { activityCardHtml, escapeHtml, matchingHtml } from './render.mjs';

const params = new URLSearchParams(location.search);
const API = (params.get('api') || 'https://companion-api-dev.starxinteractive.com').replace(/\/$/, '');
const TOKEN = params.get('token') || 'cp-dev-token-change-me';
const TOKEN_KEY = 'v4-player:token';
if (params.get('token')) localStorage.setItem(TOKEN_KEY, TOKEN);
const AUTH = localStorage.getItem(TOKEN_KEY) || TOKEN;
const UNIT = params.get('unit') || 'N-5-4';
const LIMIT = Math.min(Math.max(Number(params.get('limit')) || 10, 1), 20);
const LEARNER = params.get('learner') || 'v4-demo';

const root = document.getElementById('app');
const state = { activities: [], index: 0, response: null, checked: false, results: [], selectedLeft: null, assignments: {} };

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function progressHtml() {
  const pct = state.activities.length ? Math.round((state.index / state.activities.length) * 100) : 0;
  return `<div class="lesson-top"><button type="button" class="text-button" data-action="quit" aria-label="離開">×</button>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <span>${state.index + 1}／${state.activities.length}</span></div>`;
}

function feedbackHtml(activity, correct) {
  const explain = activity.explanation ? `<p>${escapeHtml(activity.explanation)}</p>` : '';
  const answerHtml = activity.answerHtml || (activity.answer !== null && activity.answer !== undefined ? escapeHtml(String(activity.answer)) : '');
  const reveal = !correct && answerHtml ? `<p class="small-note">正解：${answerHtml}</p>` : '';
  return `<div class="feedback ${correct ? 'ok' : 'wrong'}" aria-live="polite">
    <strong>${correct ? '✓ 答對了！' : '再想一下，你可以的。'}</strong>${explain}${reveal}
    <button type="button" class="app-button" data-action="next">下一題</button></div>`;
}

function bodyHtml() {
  const activity = state.activities[state.index];
  if (!activity) return '';
  if (activity.type === 'matching') {
    const assigned = activity.pairs.map((p, i) => {
      const selected = state.assignments[p.left] ? state.assignments[p.left] : null;
      const cls = `match-left${state.selectedLeft === p.left ? ' selected' : ''}${selected ? ' assigned' : ''}`;
      return `<button type="button" class="${cls}" data-left="${escapeHtml(p.left)}">${escapeHtml(p.left)}${selected ? `<small>→ ${escapeHtml(selected)}</small>` : ''}</button>`;
    }).join('');
    const order = activity.rightOrder || activity.pairs.map((_, i) => i);
    const used = new Set(Object.values(state.assignments));
    const right = order.map((i) => {
      const text = activity.pairs[i].right;
      return `<button type="button" class="match-right${used.has(text) ? ' used' : ''}" data-right="${escapeHtml(text)}">${escapeHtml(text)}</button>`;
    }).join('');
    return `<p class="type-tag">matching</p><div class="prompt">${activity.promptHtml || escapeHtml(activity.prompt)}</div>
      <div class="matching"><div class="match-col">${assigned}</div><div class="match-col">${right}</div></div>`;
  }
  return activityCardHtml(activity);
}

function renderBody() {
  const activity = state.activities[state.index];
  document.getElementById('card').innerHTML = bodyHtml();
  const footer = document.getElementById('footer');
  if (state.checked) {
    footer.innerHTML = feedbackHtml(activity, state.results[state.index]);
  } else {
    footer.innerHTML = `<button type="button" class="app-button" data-action="check">確認答案</button>`;
    updateCheckable();
  }
}

function updateCheckable() {
  const activity = state.activities[state.index];
  const btn = document.querySelector('[data-action="check"]');
  if (!btn) return;
  let ready = false;
  if (activity.type === 'choice') ready = state.response !== null;
  else if (activity.type === 'fill_blank') ready = String(state.response ?? '').trim().length > 0;
  else if (activity.type === 'matching') ready = activity.pairs.every((p) => state.assignments[p.left]);
  btn.disabled = !ready;
}

function record(activity, response, correct) {
  api(`/v1/learners/${encodeURIComponent(LEARNER)}/answers`, {
    method: 'POST',
    body: JSON.stringify(toAnswerRecord(activity, response, correct)),
  }).catch(() => {});
}

function checkAnswer() {
  const activity = state.activities[state.index];
  const correct = gradeActivity(activity, {
    index: activity.type === 'choice' ? state.response : undefined,
    text: activity.type === 'fill_blank' ? state.response : undefined,
    assignments: activity.type === 'matching'
      ? activity.pairs.map((p) => state.assignments[p.left] || '')
      : undefined,
  });
  state.checked = true;
  state.results[state.index] = correct;
  record(activity, state.response, correct);
  renderBody();
}

function next() {
  if (state.index < state.activities.length - 1) {
    state.index += 1;
    state.response = null; state.checked = false; state.selectedLeft = null; state.assignments = {};
    const a = state.activities[state.index];
    if (a.type === 'matching') a.rightOrder = shuffle(a.pairs.map((_, i) => i));
    render();
  } else {
    finish();
  }
}

function finish() {
  const correct = state.results.filter(Boolean).length;
  const total = state.activities.length;
  root.innerHTML = `<div class="card center"><div class="result-symbol">✓</div><h2>這輪完成了。</h2>
    <p>答對 <strong>${correct}</strong>／${total} 題。</p>
    <button type="button" class="app-button" data-action="replay">再來一輪</button>
    <p class="small-note">作答已回報到 companion-api（若可用）。</p></div>`;
}

function render() {
  const activity = state.activities[state.index];
  if (!activity) { finish(); return; }
  root.innerHTML = `<div class="phone"><div class="device-status"><span>9:41</span><span>● ● ▰</span></div>
    ${progressHtml()}<div class="phone-content"><div id="card"></div></div><div id="footer" class="lesson-bottom"></div></div>`;
  renderBody();
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const activity = state.activities[state.index];
  if (button.dataset.choice !== undefined && !state.checked) {
    state.response = Number(button.dataset.choice);
    document.querySelectorAll('[data-choice]').forEach((b) => {
      const on = b === button;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
    });
    updateCheckable(); return;
  }
  if (button.dataset.left !== undefined && !state.checked) {
    state.selectedLeft = state.selectedLeft === button.dataset.left ? null : button.dataset.left;
    renderBody(); return;
  }
  if (button.dataset.right !== undefined && !state.checked && state.selectedLeft) {
    state.assignments[state.selectedLeft] = button.dataset.right;
    state.selectedLeft = null;
    renderBody(); return;
  }
  switch (button.dataset.action) {
    case 'check': checkAnswer(); break;
    case 'next': next(); break;
    case 'replay': init(); break;
    case 'quit': location.reload(); break;
  }
});

root.addEventListener('input', (event) => {
  if (event.target.id === 'fill-input') { state.response = event.target.value; updateCheckable(); }
});

root.addEventListener('keydown', (event) => {
  if (event.target.id === 'fill-input' && event.key === 'Enter') {
    const btn = document.querySelector('[data-action="check"]');
    if (btn && !btn.disabled) checkAnswer();
  }
});

async function init() {
  root.innerHTML = `<div class="card center"><h2>載入中…</h2><p class="small-note">${escapeHtml(UNIT)} · ${LIMIT} 題</p></div>`;
  try {
    const payload = await api(`/v1/units/${encodeURIComponent(UNIT)}/activity-set?limit=${LIMIT}`);
    state.activities = adaptSet(payload);
    if (!state.activities.length) throw new Error('no playable activities');
    state.index = 0; state.response = null; state.checked = false; state.results = []; state.selectedLeft = null; state.assignments = {};
    const first = state.activities[0];
    if (first.type === 'matching') first.rightOrder = shuffle(first.pairs.map((_, i) => i));
    render();
  } catch (error) {
    root.innerHTML = `<div class="card center"><h2>無法載入活動</h2><p class="small-note">${escapeHtml(String(error.message || error))}</p>
      <p class="small-note">API：${escapeHtml(API)}</p></div>`;
  }
}

init();
