// Learning-path status (activity layer P1): order + learner status for a subject/grade map.

export function computePathStatuses(nodes = [], progressByNode = {}, { masteryThreshold = 80 } = {}) {
  const items = nodes.map((n) => {
    const p = progressByNode[n.id];
    return {
      id: n.id,
      name: n.name,
      grade: n.grade,
      topic: n.topic,
      mastery: p && Number.isFinite(p.mastery) ? p.mastery : 0,
      attempts: p && Number.isFinite(p.attempts) ? p.attempts : 0,
    };
  });
  const done = (n) => n.attempts > 0 && n.mastery >= masteryThreshold;
  const currentIndex = items.findIndex((n) => !done(n));
  return items.map((n, i) => ({
    ...n,
    status: currentIndex === -1 ? 'completed' : i < currentIndex ? 'completed' : i === currentIndex ? 'current' : 'locked',
  }));
}

export function groupByTopic(pathGroups = [], progressByNode = {}, options) {
  const ordered = pathGroups.flatMap((g) => g.nodes || []);
  const withStatus = computePathStatuses(ordered, progressByNode, options);
  const groups = [];
  const map = new Map();
  for (const node of withStatus) {
    if (!map.has(node.topic)) { const g = { topic: node.topic, nodes: [] }; map.set(node.topic, g); groups.push(g); }
    map.get(node.topic).nodes.push(node);
  }
  const current = withStatus.find((n) => n.status === 'current') || null;
  return { groups, current: current ? current.id : null, completed: withStatus.filter((n) => n.status === 'completed').length, total: withStatus.length };
}
