import fs from 'node:fs';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 8080),
  knowledgeBase: (process.env.KNOWLEDGE_BASE || 'https://knowledge-api-dev.starxinteractive.com').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR || '/app/data',
  apiToken: process.env.COMPANION_API_TOKEN || '', // optional bearer for non-dev
  filesBase: (process.env.FILES_BASE || 'https://resource-files-dev.starxinteractive.com').replace(/\/$/, ''),
};

// LLM 誘答變體（離線生成、放 resource-files）。
config.llmVariantsUrl = process.env.LLM_VARIANTS_URL || `${config.filesBase}/preview/llm-variants.json`;

fs.mkdirSync(config.dataDir, { recursive: true });
export const dbPath = path.join(config.dataDir, 'companion.sqlite');
