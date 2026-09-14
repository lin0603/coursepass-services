import { config } from './config.mjs';

const cache = new Map();
const TTL = 60_000;

async function get(pathname, { cacheTtl = TTL } = {}) {
  const url = `${config.knowledgeBase}${pathname}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < cacheTtl) return hit.value;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`knowledge service ${response.status} for ${pathname}`);
  const value = await response.json();
  cache.set(url, { at: Date.now(), value });
  return value;
}

const qs = (params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const knowledge = {
  version: () => get('/version'),
  subjects: () => get('/v1/subjects'),
  nodes: (params) => get(`/v1/nodes${qs(params)}`),
  node: (id) => get(`/v1/nodes/${encodeURIComponent(id)}`),
  questions: (id, params) => get(`/v1/nodes/${encodeURIComponent(id)}/questions${qs(params)}`),
  question: (sourceQuestionId) => get(`/v1/questions/${encodeURIComponent(sourceQuestionId)}`),
  paths: (params) => get(`/v1/paths${qs(params)}`),
  chapters: (params) => get(`/v1/chapters${qs(params)}`),
  coverage: (params) => get(`/v1/coverage${qs(params)}`),
  search: (params) => get(`/v1/search${qs(params)}`),
};
