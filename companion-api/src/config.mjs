import fs from 'node:fs';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 8080),
  knowledgeBase: (process.env.KNOWLEDGE_BASE || 'https://knowledge-api-dev.starxinteractive.com').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR || '/app/data',
  apiToken: process.env.COMPANION_API_TOKEN || '', // optional bearer for non-dev
};

fs.mkdirSync(config.dataDir, { recursive: true });
export const dbPath = path.join(config.dataDir, 'companion.sqlite');
