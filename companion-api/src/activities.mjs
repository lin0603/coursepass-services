// Map a bound question to a companion activity contract.
import { config } from './config.mjs';

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

export function toActivity(question) {
  const rawType = String(question.questionType || '').trim();
  let type = activityType(rawType);
  let options = (question.options || []).map((o) => o.content ?? o).filter((o) => String(o).trim());
  let answer = question.answer;

  // 是非題（或多數把答案記成 ○/╳ 但選項空的題）→ 選擇題，合成「正確 / 錯誤」
  if (rawType === 'true_false' || (type === 'choice' && options.length < 2)) {
    const truth = isTrueAnswer(question.answer);
    if (rawType === 'true_false' || truth !== null) {
      type = 'choice';
      options = ['正確', '錯誤'];
      answer = truth === null ? '' : (truth ? '正確' : '錯誤');
    }
  }

  const playable =
    Boolean(question.prompt) &&
    ((type === 'choice' && options.length >= 2 && Boolean(answer)) ||
      (type === 'fill_blank' && Boolean(String(answer ?? '').trim())));

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
    answer,
    answerHtml: question.answerHtml || null,
    imageUrl: fileUrl(question.imageUrl),
    figureUrl: question.figureUrl || null,
    hasFigure: Boolean(question.hasFigure),
    chapter: question.chapter || null,
    explanation: question.explanation || '',
    reviewStatus: question.reviewStatus,
    playable,
  };
}

export function assemble(questions) {
  return questions.map(toActivity);
}
