'use strict';

const state = {
  manifest: null,
  current: null,
  files: [],
  dirs: [],
  prefix: '',
  query: '',
  limit: 300,
};

const FILES_BASE = 'https://resource-files-dev.starxinteractive.com';
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff']);
const PREVIEW_EXTS = new Set(['pdf', 'doc', 'docx', ...IMAGE_EXTS]);

const el = {
  subtitle: document.getElementById('subtitle'),
  archives: document.getElementById('archives'),
  tree: document.getElementById('tree'),
  folders: document.getElementById('folders'),
  files: document.getElementById('files'),
  fileCount: document.getElementById('file-count'),
  stats: document.getElementById('stats'),
  crumbPath: document.getElementById('crumb-path'),
  search: document.getElementById('search'),
  more: document.getElementById('more'),
  home: document.getElementById('home'),
  loginGate: document.getElementById('loginGate'),
  loginCode: document.getElementById('loginCode'),
  loginBtn: document.getElementById('loginBtn'),
  loginMsg: document.getElementById('loginMsg'),
  logoutBtn: document.getElementById('logoutBtn'),
  navDash: document.getElementById('navDash'),
  navBrowse: document.getElementById('navBrowse'),
  dash: document.getElementById('dash'),
  browser: document.getElementById('browser'),
  courseCards: document.getElementById('courseCards'),
  preview: document.getElementById('preview'),
  previewTitle: document.getElementById('preview-title'),
  previewBody: document.getElementById('preview-body'),
  previewNote: document.getElementById('preview-note'),
  previewClose: document.getElementById('preview-close'),
};

function human(num) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = num;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function initBrowser(initialSlug) {
  const res = await fetch('./data/manifest.json');
  state.manifest = await res.json();
  const totalFiles = state.manifest.archives.reduce((sum, a) => sum + a.fileCount, 0);
  const totalSize = state.manifest.archives.reduce((sum, a) => sum + a.totalSize, 0);
  el.subtitle.textContent = `${state.manifest.archives.length} 個資源包 · ${totalFiles.toLocaleString()} 檔 · ${human(totalSize)}`;
  renderArchiveList();
  const wanted = initialSlug || new URLSearchParams(location.search).get('archive');
  const first = (wanted && state.manifest.archives.find((a) => a.slug === wanted))
    || state.manifest.archives.find((a) => a.kind === 'iso')
    || state.manifest.archives[0];
  if (first) selectArchive(first.slug);
}

function renderArchiveList() {
  el.archives.innerHTML = '';
  let lastKind = null;
  for (const archive of state.manifest.archives) {
    if (archive.kind !== lastKind) {
      const sep = document.createElement('div');
      sep.className = 'kind-sep';
      sep.textContent = archive.kind === 'iso' ? '題庫 ISO' : '課程計畫 / 資源 ZIP';
      el.archives.appendChild(sep);
      lastKind = archive.kind;
    }
    const button = document.createElement('button');
    button.className = 'archive';
    button.dataset.slug = archive.slug;
    button.innerHTML = `${escapeHtml(archive.name)}<span class="meta">${archive.fileCount.toLocaleString()} 檔 · ${human(archive.totalSize)}</span>`;
    button.addEventListener('click', () => selectArchive(archive.slug));
    el.archives.appendChild(button);
  }
}

async function selectArchive(slug) {
  if (state.current === slug) return;
  state.current = slug;
  state.prefix = '';
  state.query = '';
  state.limit = 300;
  el.search.value = '';
  for (const node of el.archives.querySelectorAll('.archive')) {
    node.classList.toggle('active', node.dataset.slug === slug);
  }
  const res = await fetch(`./data/${slug}.json`);
  const data = await res.json();
  state.meta = data;
  state.files = data.files;
  state.dirs = buildDirs(data.files);
  renderTree();
  render();
}

function buildDirs(files) {
  const counts = new Map();
  for (const [path] of files) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/');
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count, depth: path.split('/').length }))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hant'));
}

function renderTree() {
  el.tree.innerHTML = '';
  const root = document.createElement('div');
  root.className = `tree-item${state.prefix === '' ? ' active' : ''}`;
  root.innerHTML = `<span>◆ 根目錄</span><span class="count">${state.files.length.toLocaleString()}</span>`;
  root.addEventListener('click', () => setPrefix(''));
  el.tree.appendChild(root);

  const frag = document.createDocumentFragment();
  for (const dir of state.dirs) {
    const node = document.createElement('div');
    node.className = `tree-item${state.prefix === dir.path ? ' active' : ''}`;
    node.style.paddingLeft = `${6 + (dir.depth - 1) * 12}px`;
    node.innerHTML = `<span>${escapeHtml(dir.path.split('/').pop())}</span><span class="count">${dir.count.toLocaleString()}</span>`;
    node.title = dir.path;
    node.addEventListener('click', () => setPrefix(dir.path));
    frag.appendChild(node);
  }
  el.tree.appendChild(frag);
}

function setPrefix(prefix) {
  state.prefix = prefix;
  state.limit = 300;
  renderTree();
  render();
}

function childDirs() {
  const prefix = state.prefix ? `${state.prefix}/` : '';
  return state.dirs
    .filter((dir) => dir.path.startsWith(prefix) && dir.path.slice(prefix.length).split('/').length === 1)
    .slice(0, 40);
}

function filtered() {
  const prefix = state.prefix ? `${state.prefix}/` : '';
  const query = state.query.trim().toLowerCase();
  return state.files.filter(([path]) => {
    if (prefix && !path.startsWith(prefix)) return false;
    if (query && !path.toLowerCase().includes(query)) return false;
    return true;
  });
}

function render() {
  const list = filtered();
  el.crumbPath.textContent = state.current ? state.meta.name + (state.prefix ? ` / ${state.prefix}` : '') : '';
  const size = list.reduce((sum, [, s]) => sum + s, 0);
  el.stats.innerHTML = `
    <span>資源包 <b>${escapeHtml(state.meta.name)}</b></span>
    <span>符合檔案 <b>${list.length.toLocaleString()}</b> / ${state.files.length.toLocaleString()}</span>
    <span>合計 <b>${human(size)}</b></span>
    <span>總大小 <b>${human(state.meta.totalSize)}</b></span>`;

  el.folders.innerHTML = '';
  if (state.prefix) {
    const up = document.createElement('button');
    up.className = 'chip';
    up.textContent = '↑ 上一層';
    up.addEventListener('click', () => setPrefix(state.prefix.includes('/') ? state.prefix.slice(0, state.prefix.lastIndexOf('/')) : ''));
    el.folders.appendChild(up);
  }
  for (const dir of childDirs()) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = `${dir.path.split('/').pop()} (${dir.count.toLocaleString()})`;
    chip.addEventListener('click', () => setPrefix(dir.path));
    el.folders.appendChild(chip);
  }

  el.fileCount.textContent = `${list.length.toLocaleString()} 項`;
  el.files.innerHTML = '';
  if (!list.length) {
    el.files.innerHTML = '<tr><td colspan="3" class="empty">沒有符合的檔案</td></tr>';
    el.more.innerHTML = '';
    return;
  }
  const query = state.query.trim().toLowerCase();
  const slice = list.slice(0, state.limit);
  const frag = document.createDocumentFragment();
  for (const [path, size] of slice) {
    const row = document.createElement('tr');
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    let display = `<span class="dir">${escapeHtml(dir)}</span>${escapeHtml(name)}`;
    if (query) {
      const lower = path.toLowerCase();
      const idx = lower.indexOf(query);
      if (idx >= 0) {
        const before = escapeHtml(path.slice(0, idx));
        const hit = escapeHtml(path.slice(idx, idx + query.length));
        const after = escapeHtml(path.slice(idx + query.length));
        display = `${before}<mark style="background:#2f6fd0;color:#fff;border-radius:3px">${hit}</mark>${after}`;
      }
    }
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    const previewable = PREVIEW_EXTS.has(ext);
    row.innerHTML = `<td class="path">${display}</td><td class="num">${human(size)}</td>`
      + `<td class="act">${previewable ? '<button class="preview-btn">預覽</button>' : ''}</td>`;
    if (previewable) {
      row.querySelector('.preview-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        openPreview(path, name, ext);
      });
    }
    frag.appendChild(row);
  }
  el.files.appendChild(frag);

  el.more.innerHTML = '';
  if (list.length > state.limit) {
    const button = document.createElement('button');
    button.textContent = `顯示更多（還有 ${(list.length - state.limit).toLocaleString()} 項）`;
    button.addEventListener('click', () => { state.limit += 300; render(); });
    el.more.appendChild(button);
  }
}

function fileUrl(path) {
  const parts = path.split('/').map(encodeURIComponent).join('/');
  return `${FILES_BASE}/${state.meta.kind}/${encodeURIComponent(state.meta.name)}/${parts}`;
}

async function openPreview(path, name, ext) {
  el.previewTitle.textContent = name;
  el.previewNote.textContent = '';
  el.previewBody.innerHTML = '<div class="preview-loading">載入中…</div>';
  el.preview.hidden = false;
  const url = fileUrl(path);

  if (IMAGE_EXTS.has(ext)) {
    el.previewBody.innerHTML = `<div class="preview-image-wrap"><img class="preview-image" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
    const img = el.previewBody.querySelector('.preview-image');
    img.addEventListener('load', () => { el.previewNote.textContent = `${img.naturalWidth}×${img.naturalHeight}`; });
    img.addEventListener('error', () => { el.previewBody.innerHTML = `<div class="preview-error">圖片載入失敗（可能尚未上傳完成）</div>`; });
    return;
  }
  if (ext === 'pdf') {
    el.previewBody.innerHTML = `<iframe class="preview-frame" src="${escapeHtml(url)}" title="PDF"></iframe>`;
    return;
  }
  if (ext === 'docx') {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      el.previewBody.innerHTML = `<article class="doc-preview">${result.value || '<p>（本文件沒有可顯示的文字內容）</p>'}</article>`;
    } catch (error) {
      el.previewBody.innerHTML = `<div class="preview-error">DOCX 預覽失敗：${escapeHtml(error.message)}</div>`;
    }
    return;
  }
  if (ext === 'doc') {
    const viewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    el.previewBody.innerHTML = `<iframe class="preview-frame" src="${escapeHtml(viewer)}" title="DOC"></iframe>`;
    el.previewNote.textContent = '舊版 .doc 由 Office 線上檢視器呈現';
  }
}

function closePreview() {
  el.preview.hidden = true;
  el.previewBody.innerHTML = '';
}

if (el.previewClose) el.previewClose.addEventListener('click', closePreview);
if (el.preview) el.preview.addEventListener('click', (event) => {
  if (event.target === el.preview) closePreview();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.preview.hidden) closePreview();
});

let searchTimer = null;
if (el.search) el.search.addEventListener('input', () => {
  state.query = el.search.value;
  state.limit = 300;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});
if (el.home) el.home.addEventListener('click', () => setPrefix(''));

// ---- 簡易登入 + 課程審題首頁 ----
const params = new URLSearchParams(location.search);
const API = (document.querySelector('meta[name="reviews-api"]') || {}).content || 'https://companion-api-dev.starxinteractive.com';
const TOKEN = (document.querySelector('meta[name="reviews-token"]') || {}).content || '';
const COURSES_URL = (document.querySelector('meta[name="courses-url"]') || {}).content || '';
const REVIEW_SITE = (document.querySelector('meta[name="review-site"]') || {}).content || '';
const H = { Authorization: `Bearer ${TOKEN}` };
const loggedIn = () => localStorage.getItem('cp_pass') === '1';
const isAdmin = () => localStorage.getItem('cp_admin') === '1';
function syncAdminUI() {
  if (el.navBrowse) el.navBrowse.hidden = !isAdmin();
}
function showGate(show) { el.loginGate.hidden = !show; }
async function doLogin() {
  el.loginMsg.textContent = '登入中…';
  try {
    const d = await (await fetch(`${API}/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ code: el.loginCode.value }) })).json();
    if (d.ok) { localStorage.setItem('cp_pass', '1'); if (d.admin) localStorage.setItem('cp_admin', '1'); else localStorage.removeItem('cp_admin'); syncAdminUI(); showGate(false); start(); } else el.loginMsg.textContent = '通行碼錯誤';
  } catch (e) { el.loginMsg.textContent = '登入失敗：' + e.message; }
}
el.loginBtn.addEventListener('click', doLogin);
el.loginCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
el.logoutBtn.addEventListener('click', () => { localStorage.removeItem('cp_pass'); localStorage.removeItem('cp_admin'); location.reload(); });

let browserInited = false;
function showView(which, archiveSlug) {
  if (which === 'browse' && !isAdmin()) which = 'dash';
  el.dash.hidden = which !== 'dash';
  el.browser.hidden = which !== 'browse';
  el.navDash.classList.toggle('on', which === 'dash');
  el.navBrowse.classList.toggle('on', which === 'browse');
  if (which === 'browse') {
    if (!browserInited) {
      browserInited = true;
      initBrowser(archiveSlug).catch((e) => { el.subtitle.textContent = `載入失敗：${e.message}`; });
    } else if (archiveSlug && typeof selectArchive === 'function') {
      selectArchive(archiveSlug);
    }
  }
}
el.navDash.addEventListener('click', () => showView('dash'));
const helpModal = document.getElementById('helpModal');
function showHelp(show) { if (helpModal) helpModal.hidden = !show; }
const helpBtn = document.getElementById('helpBtn');
const helpClose = document.getElementById('helpClose');
if (helpBtn) helpBtn.addEventListener('click', () => showHelp(true));
if (helpClose) helpClose.addEventListener('click', () => showHelp(false));
if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) showHelp(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && helpModal && !helpModal.hidden) showHelp(false); });
el.navBrowse.addEventListener('click', () => showView('browse'));

const ARTIFACT_LABELS = { questions: '題庫', appdata: 'App活動', explanations: 'AI解題', quality: '品質', matching: '連連看' };
let RES = { keys: ['questions', 'appdata', 'explanations', 'quality', 'matching'], items: [] };
let progressByCourse = {};

function renderResRows() {
  const fp = document.getElementById('fPublisher').value;
  const fe = document.getElementById('fEdition').value;
  const fst = document.getElementById('fStage').value;
  const fg = document.getElementById('fGrade').value;
  const fs = document.getElementById('fSubject').value;
  const rows = RES.items.filter((r) => (!fp || r.publisher === fp) && (!fe || String(r.edition) === fe) && (!fst || r.stage === fst) && (!fg || String(r.grade) === fg) && (!fs || r.subject === fs));
  const ready = rows.filter((r) => r.artifacts && r.artifacts.questions).length;
  document.getElementById('resSummary').textContent = `${rows.length} 個資源 · 已備題庫 ${ready} 個`;
  document.getElementById('resRows').innerHTML = rows.map((r) => {
    const p = progressByCourse[r.courseId] || {};
    const done = p.done || 0; const qn = r.questionCount || 0;
    const pct = qn ? Math.round((done / qn) * 100) : 0;
    const chips = RES.keys.map((k) => {
      const has = r.artifacts && r.artifacts[k];
      return `<span class="chip ${has ? 'yes' : 'no'}">${ARTIFACT_LABELS[k] || k}${has ? '✓' : '–'}</span>`;
    }).join('');
    const n = RES.keys.filter((k) => r.artifacts && r.artifacts[k]).length;
    const cpct = Math.round((n / (RES.keys.length || 1)) * 100);
    const entry = (r.courseId && r.artifacts && r.artifacts.questions)
      ? `<a class="mini-btn on" href="${REVIEW_SITE}/?course=${encodeURIComponent(r.courseId)}" target="_blank" rel="noopener">進入審題站</a>`
      : '<span class="muted">尚未建置</span>';
    return `<tr>
      <td>${escapeHtml(r.publisherName || r.publisher || '')}</td>
      <td>${escapeHtml(String(r.edition || ''))}</td>
      <td>${escapeHtml(r.gradeName || String(r.grade || ''))}</td>
      <td>${escapeHtml(String(r.subject || ''))}</td>
      <td><div class="chips">${chips}</div><div class="cpct">${n}/${RES.keys.length}（${cpct}%）</div></td>
      <td>${qn ? `${done} / ${qn}（${pct}%）` : '<span class="muted">—</span>'}</td>
      <td class="act">${entry}${(r.archiveSlug && isAdmin()) ? ` <button class="mini-btn" data-archive="${escapeHtml(r.archiveSlug)}">資源包</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">無符合資源</td></tr>';
  document.querySelectorAll('#resRows [data-archive]').forEach((b) => b.addEventListener('click', () => showView('browse', b.dataset.archive)));
}

function renderMetrics(m) {
  const el2 = document.getElementById('metrics');
  if (!el2) return;
  if (!m || (!m.multiReviewed && !(m.reviewers || []).length)) { el2.innerHTML = ''; return; }
  const divIds = (m.divergent || []).slice(0, 12).map((d) => `<span class="chip no" title="${escapeHtml((d.statuses || []).join('/'))}">${escapeHtml(d.sourceQuestionId)}</span>`).join(' ');
  const rows = (m.reviewers || []).map((r) => `<tr><td>${escapeHtml(r.reviewerName || r.reviewerId || '未署名')}</td><td>${r.total || 0}</td><td>${r.approved || 0}</td><td>${r.adjust || 0}</td><td>${r.rejected || 0}</td><td>${r.disagree || 0}</td></tr>`).join('');
  el2.innerHTML = `<div class="metric-heads">
      <div class="metric"><div class="m-num">${m.consensusRate || 0}%</div><div class="m-lbl">共識率（雙審一致）</div><div class="m-sub">${m.consensus || 0} / ${m.multiReviewed || 0} 題</div></div>
      <div class="metric"><div class="m-num">${m.divergentCount || 0}</div><div class="m-lbl">待處理分歧題</div><div class="m-sub">雙審結果不一致</div></div>
      <div class="metric"><div class="m-num">${(m.reviewers || []).length}</div><div class="m-lbl">審查老師</div><div class="m-sub">有審查紀錄</div></div>
    </div>
    ${divIds ? `<div class="metric-block"><b>分歧題（前 12）</b><div class="chips">${divIds}</div></div>` : ''}
    <div class="metric-block"><b>每位老師產能與品質</b>
      <table class="res-table"><thead><tr><th>老師</th><th>已審</th><th>合格</th><th>需調整</th><th>不採用</th><th>分歧</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">尚無審查紀錄</td></tr>'}</tbody></table>
    </div>`;
}

async function renderDash() {
  const RES_URL = (document.querySelector('meta[name="resources-url"]') || {}).content || '';
  RES = { keys: ['questions', 'appdata', 'explanations', 'quality', 'matching'], items: [] };
  try {
    const d = await (await fetch(RES_URL)).json();
    RES.keys = d.artifactKeys || RES.keys;
    RES.items = d.items || [];
  } catch { /* ignore */ }
  try {
    progressByCourse = {};
    const dp = await (await fetch(`${API}/v1/course-progress`, { headers: H })).json();
    for (const p of (dp.items || [])) progressByCourse[p.courseId] = p;
  } catch { /* ignore */ }
  const pubs = [];
  for (const r of RES.items) { if (r.publisher && !pubs.some((x) => x.v === r.publisher)) pubs.push({ v: r.publisher, t: r.publisherName || r.publisher }); }
  const eds = [...new Set(RES.items.map((r) => r.edition).filter(Boolean))];
  const sts = [...new Set(RES.items.map((r) => r.stage).filter(Boolean))];
  const gradeName = {};
  for (const r of RES.items) gradeName[r.grade] = r.gradeName || String(r.grade);
  const grs = [...new Set(RES.items.map((r) => r.grade).filter(Boolean))].sort((a, b) => a - b);
  const subs = [...new Set(RES.items.map((r) => r.subject).filter(Boolean))];
  const fillSel = (id, opts) => { const sel = document.getElementById(id); sel.innerHTML = '<option value="">全部</option>' + opts.map((o) => `<option value="${escapeHtml(String(o.v))}">${escapeHtml(String(o.t))}</option>`).join(''); };
  fillSel('fPublisher', pubs);
  fillSel('fEdition', eds.map((v) => ({ v, t: v })));
  fillSel('fStage', sts.map((v) => ({ v, t: v })));
  fillSel('fGrade', grs.map((v) => ({ v, t: gradeName[v] || v })));
  fillSel('fSubject', subs.map((v) => ({ v, t: v })));
  el.subtitle.textContent = `${RES.items.length} 個資源 · 資料完整度總覽`;
  ['fPublisher', 'fEdition', 'fStage', 'fGrade', 'fSubject'].forEach((id) => { document.getElementById(id).onchange = renderResRows; });
  renderResRows();
  try {
    const dm = await (await fetch(`${API}/v1/metrics`, { headers: H })).json();
    renderMetrics(dm);
  } catch { /* ignore */ }
}

async function start() {
  syncAdminUI();
  if (params.get('archive') && isAdmin()) { showView('browse'); return; }
  showView('dash');
  await renderDash();
}

(async () => {
  try {
    const g = await (await fetch(`${API}/v1/login`, { headers: H })).json();
    if (g.gate && !loggedIn()) { showGate(true); return; }
  } catch { /* API 掛掉時不擋 */ }
  showGate(false);
  syncAdminUI();
  start();
})();
