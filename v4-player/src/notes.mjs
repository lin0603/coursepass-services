// Lesson notes (重點整理) — Phase P2.
import { escapeHtml } from './render.mjs';

export function notesHtml(data = {}) {
  const examples = (data.examples || []).map((e) => `<li>${escapeHtml(e)}</li>`).join('');
  return `<h2 class="modal-title">重點整理</h2>
    <p class="small-note">${escapeHtml(data.name || '')}${data.topic ? ` · ${escapeHtml(data.topic)}` : ''}${data.nodeId ? ` · ${escapeHtml(data.nodeId)}` : ''}</p>
    <section class="note-section"><h3>這一課要會什麼</h3><p>${escapeHtml(data.content || '（尚無課綱描述）')}</p></section>
    ${data.indicator ? `<section class="note-section"><h3>學習表現</h3><p>${escapeHtml(data.indicator)}</p></section>` : ''}
    ${examples ? `<section class="note-section"><h3>例題</h3><ul class="note-examples">${examples}</ul></section>` : ''}`;
}

export async function fetchNotes(api, auth, unit) {
  const res = await fetch(`${api}/v1/units/${encodeURIComponent(unit)}/notes`, { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
