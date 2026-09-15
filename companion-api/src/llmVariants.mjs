// Loads offline LLM-generated distractor variants (served from resource-files).
import { config } from './config.mjs';

let cache = { at: 0, map: {} };
const TTL = 5 * 60 * 1000;

export async function getLlmVariants() {
  if (Date.now() - cache.at < TTL) return cache.map;
  try {
    const res = await fetch(config.llmVariantsUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      cache = { at: Date.now(), map: (data && data.items) || {} };
    } else {
      cache = { at: Date.now(), map: cache.map };
    }
  } catch {
    cache = { at: Date.now(), map: cache.map };
  }
  return cache.map;
}
