// Rendering helpers -> HTML strings (framework-agnostic).
// 數學以原生 MathML 呈現（promptHtml / optionsHtml），不需 KaTeX/MathJax。
// 注意：題庫 HTML 為內部研究用途，直接注入；正式上線需做 sanitize。

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function promptHtml(activity) {
  return activity.promptHtml || `<p class="plain-prompt">${escapeHtml(activity.prompt)}</p>`;
}

export function optionHtml(activity, index) {
  const html = activity.optionsHtml && activity.optionsHtml[index];
  if (html) return html;
  return escapeHtml(activity.options[index] ?? '');
}

export function figureHtml(activity) {
  const src = activity.figureUrl || activity.imageUrl;
  if (!src) return '';
  return `<figure class="q-figure"><img src="${escapeHtml(src)}" alt="題目附圖" loading="lazy"></figure>`;
}

export function choiceHtml(activity) {
  return `<div class="choices" role="radiogroup">${activity.options
    .map((_, i) => `<button type="button" class="choice" data-choice="${i}" role="radio" aria-checked="false">${optionHtml(activity, i)}</button>`)
    .join('')}</div>`;
}

export function fillBlankHtml(activity) {
  const placeholder = escapeHtml(activity.placeholder || '輸入答案');
  return `<div class="fill-blank"><input type="text" id="fill-input" inputmode="text" autocomplete="off" placeholder="${placeholder}" aria-label="作答區"></div>`;
}

export function matchingHtml(activity, rightOrder) {
  const order = Array.isArray(rightOrder) && rightOrder.length === activity.pairs.length
    ? rightOrder
    : activity.pairs.map((_, i) => i);
  const left = activity.pairs
    .map((p, i) => `<button type="button" class="match-left" data-left="${i}" aria-pressed="false">${escapeHtml(p.left)}</button>`)
    .join('');
  const right = order
    .map((i) => `<button type="button" class="match-right" data-right="${i}">${escapeHtml(activity.pairs[i].right)}</button>`)
    .join('');
  return `<div class="matching"><div class="match-col" aria-label="左欄">${left}</div><div class="match-col" aria-label="右欄">${right}</div></div><p id="match-status" class="small-note">先點左邊，再點右邊配對。</p>`;
}

export function activityCardHtml(activity) {
  let body = '';
  if (activity.type === 'choice') body = choiceHtml(activity);
  else if (activity.type === 'fill_blank') body = fillBlankHtml(activity);
  else if (activity.type === 'matching') body = matchingHtml(activity);
  else body = `<p class="small-note">此題型（${escapeHtml(activity.type)}）尚未支援。</p>`;
  return `<p class="type-tag">${escapeHtml(activity.type)}${activity.generator && activity.generator !== 'direct' ? ` · ${escapeHtml(activity.generator)}` : ''}</p>
    <div class="prompt">${promptHtml(activity)}</div>
    ${figureHtml(activity)}
    ${body}
    ${activity.chapter ? `<p class="small-note">${escapeHtml(activity.chapter)}</p>` : ''}`;
}
