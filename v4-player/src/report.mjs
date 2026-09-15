// Learner report (三問) — Phase P2.
import { escapeHtml } from './render.mjs';

export function reportHtml(data = {}) {
  const learned = data.learned || [];
  const needs = data.needsHelp || [];
  const goal = data.goal || {};
  const learnedList = learned.length
    ? `<ul class="note-examples">${learned.map((l) => `<li>${escapeHtml(l.name)}（精熟 ${l.mastery}%）</li>`).join('')}</ul>`
    : '<p>還沒有足夠資料。</p>';
  const needsList = needs.length
    ? `<ul class="note-examples">${needs.map((n) => `<li>${escapeHtml(n.name)}（精熟 ${n.mastery}%${n.wrongCount ? `、錯 ${n.wrongCount} 題` : ''}）</li>`).join('')}</ul>`
    : '<p>目前沒有明顯卡關。</p>';
  return `<h2 class="modal-title">學習報告</h2>
    <p class="small-note">只回答三個問題；資料來自你的作答。</p>
    <div class="report-item"><small>01　這週學會什麼</small>${learnedList}</div>
    <div class="report-item"><small>02　哪裡需要幫忙</small>${needsList}</div>
    <div class="report-item"><small>03　距離目標</small><p>已達標 ${goal.completed || 0}／${goal.total || 0} 個知識點（${goal.percent || 0}%）</p></div>`;
}

export async function fetchReport(api, auth, learner, unit) {
  const res = await fetch(`${api}/v1/learners/${encodeURIComponent(learner)}/report?unit=${encodeURIComponent(unit)}`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
