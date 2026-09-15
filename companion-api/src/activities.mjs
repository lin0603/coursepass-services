// Map a bound question to a companion activity contract.
import { config } from './config.mjs';
import { escapeHtml, htmlForValue, parseAnswer, splitValues, stripNote, toChoiceVariant, toLlmChoiceVariant } from './generate.mjs';

function fileUrl(rel) {
  if (!rel) return null;
  return `${config.filesBase}/${String(rel).split('/').map(encodeURIComponent).join('/')}`;
}

const ACTIVITY_BY_TYPE = {
  multiple_choice: 'choice',
  true_false: 'choice',
  fill_blank: 'fill_blank',
  short_answer: 'fill_blank',
  essay: 'fill_blank',
  matching: 'matching',
  ordering: 'word_order',
  word_order: 'word_order',
  listening: 'listening',
  speaking: 'speaking',
};

export function activityType(questionType) {
  return ACTIVITY_BY_TYPE[String(questionType || '').trim()] || 'fill_blank';
}

function isTrueAnswer(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/[○oO是對√正]|^1$/.test(text)) return true;
  if (/[╳×xX否錯]|^2$/.test(text)) return false;
  return null;
}

// 選項顯示文字：支援 {label,content,isCorrect} 與純字串兩種來源。
export function optionText(option) {
  if (option && typeof option === 'object') {
    return String(option.content ?? option.text ?? option.label ?? '').trim();
  }
  return String(option ?? '').trim();
}

// 由 option.isCorrect / answer(1-based index、label、選項文字) 推出 0-based correctIndex。
export function resolveCorrectIndex(options, rawOptions, answer) {
  const flagged = rawOptions.findIndex((o) => o && typeof o === 'object' && o.isCorrect === true);
  if (flagged >= 0) return flagged;
  const n = Number(String(answer ?? '').trim());
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  const label = String(answer ?? '').trim().toUpperCase();
  if (/^[A-Z]$/.test(label)) {
    const i = rawOptions.findIndex((o) => o && typeof o === 'object' && String(o.label ?? '').toUpperCase() === label);
    if (i >= 0) return i;
  }
  const text = String(answer ?? '').trim();
  const i = options.findIndex((o) => o === text);
  return i >= 0 ? i : null;
}

export function toActivity(question, { llmMap } = {}) {
  const rawType = String(question.questionType || '').trim();
  let type = activityType(rawType);
  const rawOptions = Array.isArray(question.options) ? question.options : [];
  let options = rawOptions.map(optionText).filter((o) => o !== '');
  let answer = question.answer;

  // 是非題（或答案記成 ○/╳ 但選項空的題）→ 選擇題，合成「正確 / 錯誤」
  const truth = isTrueAnswer(question.answer);
  let synthesized = false;
  if (rawType === 'true_false' || (type === 'choice' && options.length < 2)) {
    if (rawType === 'true_false' || truth !== null) {
      synthesized = true;
      type = 'choice';
      options = ['正確', '錯誤'];
      answer = truth === null ? '' : (truth ? '正確' : '錯誤');
    }
  }

  let correctIndex = null;
  if (type === 'choice') {
    correctIndex = synthesized
      ? (truth === null ? null : (truth ? 0 : 1))
      : resolveCorrectIndex(options, rawOptions, question.answer);
  }

  // 填空：清註記、拆多值（多填空）。
  const accept = type === 'fill_blank' ? splitValues(answer) : [];

  const playable =
    Boolean(question.prompt) &&
    ((type === 'choice' && options.length >= 2 && correctIndex !== null) ||
      (type === 'fill_blank' && accept.length >= 1));

  // 數學選項以 MathML 呈現（分數堆疊），非數學則轉義純文字。
  const optionsHtml = type === 'choice'
    ? options.map((o) => {
        const p = parseAnswer(o);
        return p ? htmlForValue(p) : escapeHtml(o);
      })
    : null;

  // 由短答/填空生成 choice 變體（規則誘答；教育正確顯示）。
  let choiceVariant = toChoiceVariant(question);
  if (!choiceVariant && llmMap && Array.isArray(llmMap[question.sourceQuestionId])) {
    choiceVariant = toLlmChoiceVariant(question.answer, llmMap[question.sourceQuestionId], { generatorVersion: 'gemini-2.5-flash' });
  }

  return {
    activityId: `q:${question.sourceQuestionId}`,
    sourceQuestionId: question.sourceQuestionId,
    nodeId: question.primaryKnowledgeNodeId,
    subject: question.subject,
    grade: question.grade,
    publisher: question.publisher,
    type,
    prompt: question.prompt,
    promptHtml: question.promptHtml || null,
    options,
    optionsHtml,
    correctIndex,
    answer: type === 'fill_blank' ? stripNote(answer) : answer,
    accept: type === 'fill_blank' ? accept : null,
    blanks: type === 'fill_blank' ? accept.length : null,
    answerHtml: question.answerHtml || null,
    placeholder: null,
    words: null,
    pairs: null,
    audioText: null,
    audioLocale: null,
    expectedText: null,
    speechLocale: null,
    variants: choiceVariant ? { choice: choiceVariant } : null,
    // 兩種圖不同，勿混淆：
    //  questionImageUrl = 題目原圖（整題，含文字/算式，康軒 100% 有；僅供核對）
    //  figureUrl        = 題目內的圖（第一張；全部題內圖已內嵌於 promptHtml）
    questionImageUrl: fileUrl(question.imageUrl),
    imageUrl: fileUrl(question.imageUrl), // 舊欄位，保留相容
    figureUrl: question.figureUrl || null,
    hasFigure: Boolean(question.hasFigure),
    chapter: question.chapter || null,
    explanation: question.explanation || '',
    reviewStatus: question.reviewStatus,
    playable,
  };
}

export function assemble(questions, options = {}) {
  return questions.map((q) => toActivity(q, options));
}
