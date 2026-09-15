'use strict';
const state = { items: [], appdata: {}, reviews: {}, q: '', chapter: '', node: '', type: '', status: '', review: '', imageOnly: false, limit: 100 };
const el = {
  subtitle: document.getElementById('subtitle'),
  search: document.getElementById('search'),
  fChapter: document.getElementById('fChapter'),
  fNode: document.getElementById('fNode'),
  fType: document.getElementById('fType'),
  fStatus: document.getElementById('fStatus'),
  fReview: document.getElementById('fReview'),
  fImage: document.getElementById('fImage'),
  list: document.getElementById('list'),
  more: document.getElementById('more'),
};
const LETTERS = 'ABCDEFGH';
const REVIEW_LABELS = { '': '未設定', approved: '合格', adjust: '需調整', rejected: '不採用', pending: '待審' };
const deFull = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248));
function correctIndex(a, n) {
  const t = deFull(a).trim();
  let m = t.match(/[A-Ha-h]/); if (m) return LETTERS.indexOf(m[0].toUpperCase());
  const cir = '①②③④⑤⑥⑦⑧';
  const ci = [...t].findIndex((c) => cir.includes(c)); if (ci >= 0) return ci;
  m = t.match(/[1-8]/); if (m) return Number(m[0]) - 1;
  if (/[○oO是對√正]/.test(t)) return 0;
  if (/[╳×xX否錯]/.test(t)) return 1;
  return -1;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function optionsOf(it) {
  if (it.type === 'true_false') return ['正確', '錯誤'];
  return (it.options || []).map((o) => (typeof o === 'object' ? o.content : o)).filter(Boolean);
}
function reviewOf(id) { return state.reviews[id] || { status: '', note: '' }; }

// App 實際呈現（來自 companion-api 活動格式）
function appViewHtml(it) {
  const a = state.appdata[it.id];
  if (!a) return `<section class="app-view"><div class="app-head">App 呈現</div><p class="app-none">未進入 App（不在活動集）</p></section>`;
  const label = a.mode === 'choice' ? `點選題 · ${a.options.length} 選項 · ${esc(a.generator || '')}` : `直映 · ${esc(a.type)} · ${esc(a.generator || 'direct')}`;
  let body = '';
  if (a.mode === 'choice') {
    const opts = (a.options || []).map((_, i) => `<div class="app-opt ${i === a.correctIndex ? 'correct' : ''}"><b>${LETTERS[i]}</b>${(a.optionsHtml && a.optionsHtml[i]) || esc(a.options[i])}</div>`).join('');
    body = `<div class="app-opts">${opts}</div><p class="app-correct">正解：${a.correctHtml || esc(a.correctValue)}</p>`;
  } else if (a.type === 'choice') {
    const opts = (a.options || []).map((_, i) => `<div class="app-opt ${i === a.correctIndex ? 'correct' : ''}"><b>${LETTERS[i]}</b>${(a.optionsHtml && a.optionsHtml[i]) || esc(a.options[i])}</div>`).join('');
    body = `<div class="app-opts">${opts}</div>`;
  } else if (a.accept && a.accept.length) {
    body = `<p class="app-correct">填空 ${a.blanks} 格 · 接受：${esc(a.accept.join('、'))}</p>`;
  } else {
    body = `<p class="app-correct">答案：${esc(String(a.answer ?? ''))}</p>`;
  }
  const fig = a.figureUrl ? `<a class="app-fig" href="${esc(a.figureUrl)}" target="_blank"><img loading="lazy" src="${esc(a.figureUrl)}" alt="題圖"></a>` : '';
  return `<section class="app-view"><div class="app-head">App 呈現 <span class="app-label">${label}</span></div>${body}${fig}</section>`;
}

function reviewHtml(it) {
  const r = reviewOf(it.id);
  const opts = ['', 'approved', 'adjust', 'rejected'].map((s) => `<option value="${s}"${r.status === s ? ' selected' : ''}>${REVIEW_LABELS[s]}</option>`).join('');
  return `<section class="review" data-id="${esc(it.id)}">
    <div class="rv-row"><label>審查</label><select class="rv-status">${opts}</select>
      <button type="button" class="rv-save">儲存</button><span class="rv-state">${r.updatedAt ? '已儲存' : ''}</span></div>
    <textarea class="rv-note" rows="2" placeholder="調整註解／原因（會存到雲端）">${esc(r.note || '')}</textarea>
  </section>`;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.items.filter((it) => {
    if (state.chapter && it.unit !== state.chapter) return false;
    if (state.node && it.node !== state.node) return false;
    if (state.type && it.type !== state.type) return false;
    if (state.status && it.status !== state.status) return false;
    if (state.review === 'none') { if (reviewOf(it.id).status) return false; }
    else if (state.review && (reviewOf(it.id).status || '') !== state.review) return false;
    if (state.imageOnly && !it.hasFigure) return false;
    if (q && !(`${it.prompt || ''} ${it.id} ${it.lesson || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
function render() {
  const list = filtered();
  el.list.innerHTML = '';
  const slice = list.slice(0, state.limit);
  const frag = document.createDocumentFragment();
  for (const it of slice) {
    const opts = optionsOf(it);
    const ci = correctIndex(it.answer, opts.length);
    const rev = reviewOf(it.id);
    const card = document.createElement('article');
    card.className = 'card ' + (it.status === 'approved' ? 'ok' : 'warn');
    const rows = opts.map((o, i) => `<div class="opt ${i === ci ? 'correct' : ''}"><b>${LETTERS[i]}</b>${(it.optionsHtml && it.optionsHtml[i]) || esc(o)}</div>`).join('');
    card.innerHTML = `
      <div class="head">
        <span class="no">#${it.n}</span>
        <span class="id">${esc(it.id)}</span>
        <span class="badge type">${esc(it.type)}</span>
        <span class="badge ${it.status === 'approved' ? 'good' : 'bad'}">${esc(it.status)}</span>
        <span class="badge node">${esc(it.node || '未綁定')} ${esc(it.nodeName || '')}</span>
        <span class="badge diff">難度 ${esc(it.difficulty ?? '')}</span>
        <span class="badge rv rv-${esc(rev.status || 'none')}">${REVIEW_LABELS[rev.status || '']}</span>
      </div>
      ${it.chapter ? `<div class="lesson">${esc(it.chapter)}</div>` : (it.lesson ? `<div class="lesson">${esc(it.lesson)}</div>` : '')}
      <div class="prompt">${it.promptHtml || esc(it.prompt)}</div>
      <div class="body">
        <div class="opts">${rows || `<div class="ans">答案：${it.answerHtml || esc(deFull(it.answer))}</div>`}</div>
        ${it.imageUrl ? `<a class="fig" href="${it.imageUrl}" target="_blank"><img loading="lazy" src="${it.imageUrl}" alt="題目原圖"></a>` : '<div class="noimg">無圖</div>'}
      </div>
      ${appViewHtml(it)}
      ${reviewHtml(it)}`;
    frag.appendChild(card);
  }
  el.list.appendChild(frag);
  el.more.innerHTML = '';
  if (list.length > state.limit) {
    const b = document.createElement('button');
    b.textContent = `顯示更多（還有 ${(list.length - state.limit).toLocaleString()} 題）`;
    b.onclick = () => { state.limit += 100; render(); };
    el.more.appendChild(b);
  }
  el.subtitle.textContent = `全部 ${state.items.length.toLocaleString()} 題 · 符合 ${list.length.toLocaleString()} 題`;
}
function fill(sel, values, label) {
  for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = `${v}`; sel.appendChild(o); }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function saveReview(id, nodeId, status, note) {
  const res = await fetch(`${REVIEWS_API}/v1/reviews/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REVIEWS_TOKEN}` },
    body: JSON.stringify({ status, note, nodeId }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

el.list.addEventListener('click', async (event) => {
  const btn = event.target.closest('.rv-save');
  if (!btn) return;
  const section = btn.closest('.review');
  const id = section.dataset.id;
  const status = section.querySelector('.rv-status').value;
  const note = section.querySelector('.rv-note').value;
  const item = state.items.find((i) => i.id === id);
  const stateEl = section.querySelector('.rv-state');
  btn.disabled = true; stateEl.textContent = '儲存中…';
  try {
    const saved = await saveReview(id, item ? item.node : undefined, status, note);
    state.reviews[id] = { status: saved.status, note: saved.note, updatedAt: saved.updatedAt };
    stateEl.textContent = '已儲存 ✓';
    const badge = section.closest('.card').querySelector('.badge.rv');
    badge.textContent = REVIEW_LABELS[saved.status || ''];
    badge.className = `badge rv rv-${saved.status || 'none'}`;
  } catch (e) {
    stateEl.textContent = '儲存失敗：' + e.message;
  } finally { btn.disabled = false; }
});

const params = new URLSearchParams(location.search);
const metaData = document.querySelector('meta[name="preview-data"]');
const metaApp = document.querySelector('meta[name="preview-appdata"]');
const metaApi = document.querySelector('meta[name="reviews-api"]');
const metaToken = document.querySelector('meta[name="reviews-token"]');
const DATA_URL = params.get('data') || (metaData && metaData.content) || 'https://resource-files-dev.starxinteractive.com/preview/knsh-math5.json';
const APP_DATA_URL = params.get('appdata') || (metaApp && metaApp.content) || 'https://resource-files-dev.starxinteractive.com/preview/knsh-math5-appdata.json';
const REVIEWS_API = params.get('api') || (metaApi && metaApi.content) || 'https://companion-api-dev.starxinteractive.com';
const REVIEWS_TOKEN = params.get('token') || (metaToken && metaToken.content) || 'cp-dev-token-change-me';

Promise.all([
  fetch(DATA_URL).then((r) => r.json()),
  fetch(APP_DATA_URL).then((r) => r.json()).catch(() => ({ items: {} })),
  fetch(`${REVIEWS_API}/v1/reviews`, { headers: { Authorization: `Bearer ${REVIEWS_TOKEN}` } }).then((r) => r.json()).catch(() => ({ items: [] })),
]).then(([d, app, rev]) => {
  state.items = d.items;
  state.appdata = app.items || {};
  for (const r of (rev.items || [])) state.reviews[r.sourceQuestionId] = r;
  const units = [...new Set(state.items.map((i) => i.unit).filter(Boolean))];
  const unitNo = (u) => Math.min(...state.items.filter((i) => i.unit === u).map((i) => parseInt(i.section, 10) || 99));
  units.sort((a, b) => unitNo(a) - unitNo(b));
  fill(el.fChapter, units);
  fill(el.fNode, [...new Set(state.items.map((i) => i.node).filter(Boolean))].sort());
  fill(el.fType, [...new Set(state.items.map((i) => i.type).filter(Boolean))].sort());
  fill(el.fStatus, [...new Set(state.items.map((i) => i.status).filter(Boolean))].sort());
  el.search.addEventListener('input', debounce((e) => { state.q = e.target.value; state.limit = 100; render(); }, 150));
  el.fChapter.addEventListener('change', (e) => { state.chapter = e.target.value; state.limit = 100; render(); });
  el.fNode.addEventListener('change', (e) => { state.node = e.target.value; state.limit = 100; render(); });
  el.fType.addEventListener('change', (e) => { state.type = e.target.value; state.limit = 100; render(); });
  el.fStatus.addEventListener('change', (e) => { state.status = e.target.value; state.limit = 100; render(); });
  el.fReview.addEventListener('change', (e) => { state.review = e.target.value; state.limit = 100; render(); });
  el.fImage.addEventListener('change', (e) => { state.imageOnly = e.target.checked; state.limit = 100; render(); });
  render();
}).catch((e) => { el.subtitle.textContent = '載入失敗：' + e.message; });
