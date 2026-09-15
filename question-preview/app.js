'use strict';
const state = { items: [], appdata: {}, matching: {}, reviews: {}, q: '', chapter: '', node: '', type: '', status: '', review: '', imageOnly: false, limit: 100 };
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

// 以 CSS 從原圖裁切出元件（box = [ymin,xmin,ymax,xmax], 0–1000）
function cropBg(img, box) {
  const [y1, x1, y2, x2] = box;
  const W = Math.max(1, x2 - x1);
  const H = Math.max(1, y2 - y1);
  const sizeW = (1000 / W) * 100;
  const sizeH = (1000 / H) * 100;
  const posX = (1000 - W) > 0 ? (x1 / (1000 - W)) * 100 : 0;
  const posY = (1000 - H) > 0 ? (y1 / (1000 - H)) * 100 : 0;
  return `background-image:url('${img}');background-size:${sizeW}% ${sizeH}%;background-position:${posX}% ${posY}%;`;
}

// 連連看：裁切各元件，依原圖座標（絕對定位）排列；同色＝同一配對（依答案）。
function matchingView(it) {
  const m = state.matching[it.id];
  if (!m || !m.image || !Array.isArray(m.boxes) || m.boxes.length < 2) {
    return '<p class="app-none">連連看：尚無座標資料（請用下方審查標註或重跑抽取）。</p>';
  }
  const W = m.width || 1000;
  const H = m.height || 1000;
  const group = {};
  (m.pairs || []).forEach((p, gi) => { group['a' + p.a] = gi; group['b' + p.b] = gi; });
  const tiles = m.boxes.map((b, i) => {
    const [y1, x1, y2, x2] = b.box;
    const style = `left:${(x1 / 1000 * 100).toFixed(2)}%;top:${(y1 / 1000 * 100).toFixed(2)}%;width:${((x2 - x1) / 1000 * 100).toFixed(2)}%;height:${((y2 - y1) / 1000 * 100).toFixed(2)}%;${cropBg(m.image, b.box)}`;
    const g = group['a' + i] !== undefined ? group['a' + i] : group['b' + i];
    const cls = g === undefined ? '' : `pair-${g % 8}`;
    return `<div class="app-tile ${cls}" style="${style}" title="${esc(b.label || '')}"></div>`;
  }).join('');
  return `<div class="app-canvas" style="aspect-ratio:${W} / ${H}">${tiles}</div>
    <p class="app-correct">依原圖位置裁切元件；同色＝同一配對（依答案）。</p>`;
}

// App 實際呈現（手機畫面模擬；來自 companion-api 活動格式）
function appViewHtml(it) {
  const a = state.appdata[it.id];
  const prompt = it.promptHtml || `<p>${esc(it.prompt)}</p>`;
  if (!a) {
    return `<section class="app-view"><div class="app-head">App 呈現</div>
      <div class="app-phone"><div class="app-prompt">${prompt}</div><p class="app-none">未進入 App（不在活動集）</p></div></section>`;
  }
  const label = a.mode === 'choice' ? `點選題 · ${a.options.length} 選項 · ${esc(a.generator || '')}` : `直映 · ${esc(a.type)} · ${esc(a.generator || 'direct')}`;
  let body = '';
  if (a.mode === 'choice' || a.type === 'choice') {
    const opts = (a.options || []).map((_, i) => `<button type="button" class="app-btn ${i === a.correctIndex ? 'correct' : ''}" disabled><b>${LETTERS[i]}</b><span>${(a.optionsHtml && a.optionsHtml[i]) || esc(a.options[i])}</span></button>`).join('');
    body = `<div class="app-opts">${opts}</div>`;
  } else if (a.type === 'matching') {
    body = matchingView(it);
  } else if (a.accept && a.accept.length) {
    body = `<div class="app-fill">${a.accept.map(() => '<span class="app-input"></span>').join('')}</div><p class="app-correct">接受：${esc(a.accept.join('、'))}</p>`;
  } else {
    body = `<p class="app-correct">答案：${esc(String(a.answer ?? ''))}</p>`;
  }
  const fig = a.figureUrl ? `<div class="app-fig"><img loading="lazy" src="${esc(a.figureUrl)}" alt="題圖"></div>` : '';
  return `<section class="app-view"><div class="app-head">App 呈現 <span class="app-label">${label}</span></div>
    <div class="app-phone"><div class="app-prompt">${prompt}</div>${fig}${body}</div></section>`;
}

function reviewHtml(it) {
  const r = reviewOf(it.id);
  const opts = ['', 'approved', 'adjust', 'rejected'].map((s) => `<option value="${s}"${r.status === s ? ' selected' : ''}>${REVIEW_LABELS[s]}</option>`).join('');
  return `<section class="review" data-id="${esc(it.id)}">
    <div class="rv-row"><label>審查</label><select class="rv-status">${opts}</select>
      <button type="button" class="rv-save">儲存</button>
      <button type="button" class="rv-clear">清除</button>
      <span class="rv-state">${r.updatedAt ? '已儲存' : ''}</span></div>
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
      <div class="card-cols">
        <div class="col-left">
          <div class="prompt">${it.promptHtml || esc(it.prompt)}</div>
          <div class="opts">${rows || `<div class="ans">答案：${it.answerHtml || esc(deFull(it.answer))}</div>`}</div>
          <div class="fig-block">
            <div class="fig-cap">題目原圖</div>
            ${it.imageUrl ? `<a class="fig" href="${it.imageUrl}" target="_blank"><img loading="lazy" src="${it.imageUrl}" alt="題目原圖"></a>` : '<div class="noimg">無圖</div>'}
          </div>
        </div>
        <div class="col-right">
          ${appViewHtml(it)}
          ${reviewHtml(it)}
        </div>
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
  const saveBtn = event.target.closest('.rv-save');
  const clearBtn = event.target.closest('.rv-clear');
  if (!saveBtn && !clearBtn) return;
  const section = (saveBtn || clearBtn).closest('.review');
  const id = section.dataset.id;
  const item = state.items.find((i) => i.id === id);
  const stateEl = section.querySelector('.rv-state');
  const badge = section.closest('.card').querySelector('.badge.rv');
  try {
    if (clearBtn) {
      stateEl.textContent = '清除中…';
      const res = await fetch(`${REVIEWS_API}/v1/reviews/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${REVIEWS_TOKEN}` } });
      if (!res.ok && res.status !== 404) throw new Error(`${res.status}`);
      delete state.reviews[id];
      section.querySelector('.rv-status').value = '';
      section.querySelector('.rv-note').value = '';
      badge.textContent = REVIEW_LABELS[''];
      badge.className = 'badge rv rv-none';
      stateEl.textContent = '已清除';
      return;
    }
    const status = section.querySelector('.rv-status').value;
    const note = section.querySelector('.rv-note').value;
    saveBtn.disabled = true; stateEl.textContent = '儲存中…';
    const saved = await saveReview(id, item ? item.node : undefined, status, note);
    state.reviews[id] = { status: saved.status, note: saved.note, updatedAt: saved.updatedAt };
    stateEl.textContent = '已儲存 ✓';
    badge.textContent = REVIEW_LABELS[saved.status || ''];
    badge.className = `badge rv rv-${saved.status || 'none'}`;
  } catch (e) {
    stateEl.textContent = '失敗：' + e.message;
  } finally { if (saveBtn) saveBtn.disabled = false; }
});

const params = new URLSearchParams(location.search);
const metaData = document.querySelector('meta[name="preview-data"]');
const metaApp = document.querySelector('meta[name="preview-appdata"]');
const metaMatch = document.querySelector('meta[name="preview-matching"]');
const metaApi = document.querySelector('meta[name="reviews-api"]');
const metaToken = document.querySelector('meta[name="reviews-token"]');
const DATA_URL = params.get('data') || (metaData && metaData.content) || 'https://resource-files-dev.starxinteractive.com/preview/knsh-math5.json';
const APP_DATA_URL = params.get('appdata') || (metaApp && metaApp.content) || 'https://resource-files-dev.starxinteractive.com/preview/knsh-math5-appdata.json';
const MATCHING_URL = params.get('matching') || (metaMatch && metaMatch.content) || 'https://resource-files-dev.starxinteractive.com/preview/matching-pairs.json';
const REVIEWS_API = params.get('api') || (metaApi && metaApi.content) || 'https://companion-api-dev.starxinteractive.com';
const REVIEWS_TOKEN = params.get('token') || (metaToken && metaToken.content) || 'cp-dev-token-change-me';

Promise.all([
  fetch(DATA_URL).then((r) => r.json()),
  fetch(APP_DATA_URL).then((r) => r.json()).catch(() => ({ items: {} })),
  fetch(MATCHING_URL).then((r) => r.json()).catch(() => ({ items: {} })),
  fetch(`${REVIEWS_API}/v1/reviews`, { headers: { Authorization: `Bearer ${REVIEWS_TOKEN}` } }).then((r) => r.json()).catch(() => ({ items: [] })),
]).then(([d, app, match, rev]) => {
  state.items = d.items;
  state.appdata = app.items || {};
  state.matching = match.items || {};
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
