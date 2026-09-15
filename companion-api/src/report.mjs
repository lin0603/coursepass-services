// Learner report (三問) + lesson notes (重點整理) — activity layer P2 (deterministic, no LLM).

export function buildReport({ progressNodes = [], wrongbook = [], nodes = [], masteryThreshold = 80 } = {}) {
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const wrongByNode = new Map();
  for (const w of wrongbook) {
    if (!w.nodeId) continue;
    wrongByNode.set(w.nodeId, (wrongByNode.get(w.nodeId) || 0) + 1);
  }
  const attempted = progressNodes.filter((p) => p.attempts > 0);
  const learned = attempted
    .filter((p) => p.mastery >= masteryThreshold)
    .map((p) => ({ nodeId: p.nodeId, name: nameOf.get(p.nodeId) || p.nodeId, mastery: p.mastery }))
    .sort((a, b) => b.mastery - a.mastery);
  const needsHelp = attempted
    .filter((p) => p.mastery < masteryThreshold)
    .map((p) => ({ nodeId: p.nodeId, name: nameOf.get(p.nodeId) || p.nodeId, mastery: p.mastery, wrongCount: wrongByNode.get(p.nodeId) || 0 }))
    .sort((a, b) => a.mastery - b.mastery);
  const total = nodes.length;
  const learnedIds = new Set(learned.map((l) => l.nodeId));
  const completed = total ? nodes.filter((n) => learnedIds.has(n.id)).length : learned.length;
  return {
    learned: learned.slice(0, 5),
    needsHelp: needsHelp.slice(0, 3),
    goal: { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 },
  };
}

export function buildNotes(node = {}, questions = []) {
  const examples = questions
    .filter((q) => q && q.prompt)
    .slice(0, 3)
    .map((q) => String(q.prompt).replace(/\s+/g, ' ').slice(0, 60));
  return {
    nodeId: node.id || null,
    name: node.name || '',
    topic: node.topic || '',
    content: node.content_description || '',
    indicator: node.performance_indicator || '',
    examples,
  };
}
