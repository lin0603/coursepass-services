// Map a bound question to a companion activity contract.
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

  // 是非題 → 選擇題（合成「正確 / 錯誤」選項）
  if (rawType === 'true_false') {
    const truth = isTrueAnswer(question.answer);
    type = 'choice';
    options = ['正確', '錯誤'];
    answer = truth === null ? '' : (truth ? '正確' : '錯誤');
  }

  const playable =
    Boolean(question.prompt) &&
    (type === 'choice' ? options.length >= 2 && Boolean(answer) : type === 'matching' ? false : true);

  return {
    activityId: `q:${question.sourceQuestionId}`,
    sourceQuestionId: question.sourceQuestionId,
    nodeId: question.primaryKnowledgeNodeId,
    subject: question.subject,
    grade: question.grade,
    publisher: question.publisher,
    type,
    prompt: question.prompt,
    options,
    answer,
    explanation: question.explanation || '',
    reviewStatus: question.reviewStatus,
    playable,
  };
}

export function assemble(questions) {
  return questions.map(toActivity);
}
