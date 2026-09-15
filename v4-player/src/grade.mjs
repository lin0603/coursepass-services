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

export function parseNum(value) {
  const t = normalizeText(value).replace(/[（）()]/g, '');
  let m = t.match(/^-?\d+(\.\d+)?$/);
  if (m) return Number(t);
  m = t.match(/^(-?\d+)\/(-?\d+)$/);
  if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
  return null;
}

function valueEqual(a, b) {
  if (normalizeText(a) === normalizeText(b)) return true;
  const na = parseNum(a);
  const nb = parseNum(b);
  return na !== null && nb !== null && Math.abs(na - nb) < 1e-9;
}

export function splitInput(text) {
  return String(text ?? '').split(/[，,、;；]+/).map((s) => s.trim()).filter(Boolean);
}

export function gradeFillBlank(activity, text) {
  const accepts = activity.accept
    || (activity.answer !== null && activity.answer !== undefined
      ? (Array.isArray(activity.answer) ? activity.answer : [activity.answer])
      : []);
  if (!accepts.length) return false;
  const values = splitInput(text);
  if (!values.length) return false;
  if (accepts.length === 1) return valueEqual(values[0], accepts[0]);
  if (values.length !== accepts.length) return false;
  // 各答案等值（如三個等值分數）→ 順序不拘；否則逐格比對。
  const interchangeable = accepts.every((a) => valueEqual(a, accepts[0]));
  if (interchangeable) return values.every((v) => accepts.some((a) => valueEqual(v, a)));
  return values.every((v, i) => valueEqual(v, accepts[i]));
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
