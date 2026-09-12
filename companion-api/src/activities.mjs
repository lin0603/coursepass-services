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

export function toActivity(question) {
  const type = activityType(question.questionType);
  const options = (question.options || []).map((o) => o.content ?? o).filter(Boolean);
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
    answer: question.answer,
    explanation: question.explanation || '',
    reviewStatus: question.reviewStatus,
  };
}

export function assemble(questions) {
  return questions.map((q) => {
    const activity = toActivity(q);
    return { ...activity, playable: activity.prompt && (activity.type === 'choice' ? activity.options.length >= 2 : true) };
  });
}
