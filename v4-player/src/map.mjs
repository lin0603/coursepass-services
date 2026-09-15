// Learning map (V4c 學習地圖): renders GET /v1/units/:id/path as a Duolingo-style path.
import { escapeHtml } from './render.mjs';
import { fetchReport, reportHtml } from './report.mjs';
import { openModal } from './modal.mjs';

function nodeHtml(node) {
  const icon = node.status === 'completed' ? '✓' : node.status === 'current' ? '▶' : '○';
  const mastery = node.mastery ? ` · 精熟 ${node.mastery}%` : '';
  return `<button type="button" class="path-stop ${escapeHtml(node.status)}" data-node="${escapeHtml(node.id)}" aria-label="${escapeHtml(node.name)}，${escapeHtml(node.status)}">
    <span class="path-badge" aria-hidden="true">${icon}</span>
    <span class="path-name">${escapeHtml(node.name)}<small>${escapeHtml(node.id)}${mastery}</small></span></button>`;
}

export function mapHtml(data = {}) {
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const total = data.total != null ? data.total : groups.reduce((sum, g) => sum + (g.nodes || []).length, 0);
  const completed = data.completed != null ? data.completed : 0;
  const head = `<div class="map-head"><div class="map-head-row"><h2>${escapeHtml(data.subject || '學習地圖')}${data.grade ? ` · ${escapeHtml(String(data.grade))} 年級` : ''}</h2>
    <div class="map-actions"><button type="button" class="notes-mini" data-action="placement">即時評估</button>
    <button type="button" class="notes-mini" data-action="report">學習報告</button></div></div>
    <p class="small-note">已完成 ${completed}／${total} 個知識點${data.current ? ` · 目前：${escapeHtml(data.current)}` : ''}</p></div>`;
  const body = groups
    .map((group) => `<section class="map-group"><h3 class="map-topic">${escapeHtml(group.topic || '')}</h3>
      <div class="path">${(group.nodes || []).map(nodeHtml).join('')}</div></section>`)
    .join('');
  return head + (body || '<p class="small-note">沒有路徑資料。</p>');
}

export async function renderMap(root, { api, auth, learner = 'v4-demo', unit = 'N-5-4', onSelect, onPlacement } = {}) {
  root.innerHTML = `<div class="phone"><div class="phone-content card center"><h2>載入地圖…</h2></div></div>`;
  let data;
  try {
    const res = await fetch(`${api}/v1/units/${encodeURIComponent(unit)}/path?learner=${encodeURIComponent(learner)}`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    data = await res.json();
  } catch (error) {
    root.innerHTML = `<div class="phone"><div class="phone-content card center"><h2>無法載入地圖</h2>
      <p class="small-note">${escapeHtml(String(error.message || error))}</p></div></div>`;
    return;
  }
  root.innerHTML = `<div class="phone"><div class="device-status"><span>9:41</span><span>● ● ▰</span></div>
    <div class="phone-content"><div class="map">${mapHtml(data)}</div></div></div>`;
  root.onclick = (event) => {
    const placement = event.target.closest('[data-action="placement"]');
    if (placement) { if (typeof onPlacement === 'function') onPlacement(unit); return; }
    const report = event.target.closest('[data-action="report"]');
    if (report) {
      fetchReport(api, auth, learner, unit)
        .then((payload) => openModal(reportHtml(payload.report || {})))
        .catch((error) => openModal(`<p class="small-note">無法載入報告：${escapeHtml(String(error.message || error))}</p>`));
      return;
    }
    const button = event.target.closest('[data-node]');
    if (button && typeof onSelect === 'function') onSelect(button.dataset.node);
  };
}
