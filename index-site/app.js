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

async function init() {
  const res = await fetch('./data/manifest.json');
  state.manifest = await res.json();
  const totalFiles = state.manifest.archives.reduce((sum, a) => sum + a.fileCount, 0);
  const totalSize = state.manifest.archives.reduce((sum, a) => sum + a.totalSize, 0);
  el.subtitle.textContent = `${state.manifest.archives.length} 個資源包 · ${totalFiles.toLocaleString()} 檔 · ${human(totalSize)}`;
  renderArchiveList();
  const wanted = new URLSearchParams(location.search).get('archive');
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

el.previewClose.addEventListener('click', closePreview);
el.preview.addEventListener('click', (event) => {
  if (event.target === el.preview) closePreview();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.preview.hidden) closePreview();
});

let searchTimer = null;
el.search.addEventListener('input', () => {
  state.query = el.search.value;
  state.limit = 300;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});
el.home.addEventListener('click', () => setPrefix(''));

init().catch((error) => {
  el.subtitle.textContent = `載入失敗：${error.message}`;
});
