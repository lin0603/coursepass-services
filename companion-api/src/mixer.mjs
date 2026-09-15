// Per-node activity mixer (activity layer Phase E).
// 把單一節點的題目組成「多鄰國式」一輪：型別交錯、同型不連續 >2、每個來源至多一題。
import { assemble } from './activities.mjs';
import { buildMatching } from './generate.mjs';

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 由短答/填空的 choice 變體，組成一個獨立的活動物件。
function variantToActivity(base, v) {
  return {
    ...base,
    activityId: `a:${base.sourceQuestionId}:choice:${v.generator}@${v.generatorVersion}`,
    type: 'choice',
    options: v.options,
    optionsHtml: v.optionsHtml,
    correctIndex: v.correctIndex,
    answer: v.correctValue,
    answerHtml: v.correctHtml,
    variants: null,
    generator: v.generator,
    generatorVersion: v.generatorVersion,
    confidence: v.confidence,
    reviewStatus: 'generated',
    playable: true,
  };
}

// 每題產生一個候選活動：數學短答優先轉 choice 變體，其餘用直映。
export function collectCandidates(questions, options = {}) {
  const out = [];
  for (const q of questions || []) {
    const base = assemble([q], options)[0];
    if (base.variants && base.variants.choice) {
      out.push(variantToActivity(base, base.variants.choice));
    } else if (base.playable) {
      out.push({ ...base, generator: base.generator || 'direct' });
    }
  }
  return out;
}

export function buildActivitySet(questions, { count = 10, pairCount = 4, llmMap, matchingMap } = {}) {
  const candidates = collectCandidates(questions, { llmMap, matchingMap });

  const nodeId = questions?.[0]?.primaryKnowledgeNodeId || null;
  const matching = buildMatching(questions, { pairCount });
  if (matching) {
    candidates.push({
      activityId: `m:${nodeId || 'unknown'}:equivalent-fraction@1.0.0`,
      sourceQuestionId: null,
      nodeId,
      publisher: questions?.[0]?.publisher || null,
      subject: questions?.[0]?.subject || null,
      grade: questions?.[0]?.grade || null,
      ...matching,
      options: null,
      optionsHtml: null,
      correctIndex: null,
      playable: true,
      reviewStatus: 'generated',
    });
  }

  const byType = new Map();
  for (const c of candidates) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  }
  const order = shuffle([...byType.keys()]);

  const out = [];
  let lastType = null;
  let run = 0;
  let cursor = 0;
  while (out.length < count) {
    let placed = false;
    for (let k = 0; k < order.length; k++) {
      const type = order[(cursor + k) % order.length];
      const list = byType.get(type);
      if (!list.length) continue;
      if (type === lastType && run >= 2) continue; // 同型不連續超過 2
      const item = list.shift();
      out.push(item);
      if (type === lastType) run += 1;
      else { lastType = type; run = 1; }
      cursor = (cursor + k + 1) % order.length;
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return out;
}
