'use strict';
const state = { items: [], q: '', chapter: '', node: '', type: '', status: '', imageOnly: false, limit: 100 };
const el = {
  subtitle: document.getElementById('subtitle'),
  search: document.getElementById('search'),
  fChapter: document.getElementById('fChapter'),
  fNode: document.getElementById('fNode'),
  fType: document.getElementById('fType'),
  fStatus: document.getElementById('fStatus'),
  fImage: document.getElementById('fImage'),
  list: document.getElementById('list'),
  more: document.getElementById('more'),
};
const LETTERS = 'ABCDEFGH';
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
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.items.filter((it) => {
    if (state.chapter && it.unit !== state.chapter) return false;
    if (state.node && it.node !== state.node) return false;
    if (state.type && it.type !== state.type) return false;
    if (state.status && it.status !== state.status) return false;
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
      </div>
      ${it.chapter ? `<div class="lesson">${esc(it.chapter)}</div>` : (it.lesson ? `<div class="lesson">${esc(it.lesson)}</div>` : '')}
      <div class="prompt">${it.promptHtml || esc(it.prompt)}</div>
      <div class="body">
        <div class="opts">${rows || `<div class="ans">答案：${it.answerHtml || esc(deFull(it.answer))}</div>`}</div>
        ${it.imageUrl ? `<a class="fig" href="${it.imageUrl}" target="_blank"><img loading="lazy" src="${it.imageUrl}" alt="題目附圖"></a>` : '<div class="noimg">無圖</div>'}
      </div>`;
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

const params = new URLSearchParams(location.search);
const metaData = document.querySelector('meta[name="preview-data"]');
const DATA_URL = params.get('data') || (metaData && metaData.content) || 'https://resource-files-dev.starxinteractive.com/preview/knsh-math5.json';
fetch(DATA_URL).then((r) => r.json()).then((d) => {
  state.items = d.items;
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
  el.fImage.addEventListener('change', (e) => { state.imageOnly = e.target.checked; state.limit = 100; render(); });
  render();
}).catch((e) => { el.subtitle.textContent = '載入失敗：' + e.message; });
