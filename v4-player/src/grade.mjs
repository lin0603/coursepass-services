// Grading for the V4c player (client-side, mirrors server expectations).
// 正規化：全形→半形、去空白、大小寫；數學分數以字串等值比對（正解已由後端決定）。

const FULLWIDTH_OFFSET = 0xfee0;

export function normalizeText(value) {
  let text = String(value ?? '');
  // 全形英數/標點 -> 半形
  text = text.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET));
  text = text.replace(/\u3000/g, ' ');
  text = text.replace(/\s+/g, '');
  return text.trim().toLowerCase();
}

export function gradeChoice(activity, selectedIndex) {
  if (activity.correctIndex === null || selectedIndex === null || selectedIndex === undefined) return false;
  return Number(selectedIndex) === Number(activity.correctIndex);
}

export function gradeFillBlank(activity, text) {
  const expected = activity.answer;
  if (expected === null || expected === undefined) return false;
  const list = Array.isArray(expected) ? expected : [expected];
  const got = normalizeText(text);
  if (!got) return false;
  return list.some((e) => normalizeText(e) === got);
}

export function gradeMatching(activity, assignments = {}) {
  const pairs = activity.pairs || [];
  if (!pairs.length) return false;
  return pairs.every((pair, i) => normalizeText(assignments[i]) === normalizeText(pair.right));
}

export function gradeActivity(activity, response) {
  switch (activity.type) {
    case 'choice':
      return gradeChoice(activity, response && response.index);
    case 'fill_blank':
      return gradeFillBlank(activity, response && response.text);
    case 'matching':
      return gradeMatching(activity, response && response.assignments);
    default:
      return false;
  }
}
