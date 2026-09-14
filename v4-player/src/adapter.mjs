// Adapter: companion-api activity -> stable player model (V4c contract).
// 保留 MathML 欄位（promptHtml/optionsHtml）為一等公民，並把 activityId 正規化為 id。

export function toPlayerActivity(raw = {}, index = 0) {
  const id = raw.activityId || raw.id || `activity-${index}`;
  return {
    id,
    sourceQuestionId: raw.sourceQuestionId || null,
    nodeId: raw.nodeId || null,
    subject: raw.subject || null,
    grade: raw.grade ?? null,
    publisher: raw.publisher || null,
    type: raw.type || 'fill_blank',
    prompt: raw.prompt || '',
    promptHtml: raw.promptHtml || null,
    options: Array.isArray(raw.options) ? raw.options : [],
    optionsHtml: Array.isArray(raw.optionsHtml) ? raw.optionsHtml : null,
    correctIndex: Number.isInteger(raw.correctIndex) ? raw.correctIndex : null,
    answer: raw.answer ?? null,
    pairs: Array.isArray(raw.pairs) ? raw.pairs : null,
    words: Array.isArray(raw.words) ? raw.words : null,
    audioText: raw.audioText || null,
    audioLocale: raw.audioLocale || null,
    expectedText: raw.expectedText || null,
    speechLocale: raw.speechLocale || null,
    figureUrl: raw.figureUrl || null,
    imageUrl: raw.imageUrl || null,
    hasFigure: Boolean(raw.hasFigure),
    chapter: raw.chapter || null,
    explanation: raw.explanation || '',
    generator: raw.generator || 'direct',
    reviewStatus: raw.reviewStatus || null,
    playable: raw.playable !== false,
  };
}

export function adaptSet(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.map((raw, i) => toPlayerActivity(raw, i)).filter((a) => a.playable && a.prompt);
}

// 取可作答的最小欄位集合（供記錄回 companion-api）。
export function toAnswerRecord(activity, response, correct) {
  return {
    sourceQuestionId: activity.sourceQuestionId || activity.id,
    nodeId: activity.nodeId || undefined,
    selected: response,
    correct: Boolean(correct),
  };
}
