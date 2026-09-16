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

// Gemini（解題用；金鑰只在後端）。預設最新最便宜的 flash-lite。
config.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
config.geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// 審題站簡易登入（通行碼）；未設＝不啟用
config.previewPasscode = process.env.PREVIEW_PASSCODE || '';
// 管理者密碼（可看資源索引／來源資源包）；未設＝沿用通行碼
config.adminPasscode = process.env.ADMIN_PASSCODE || '';

fs.mkdirSync(config.dataDir, { recursive: true });
export const dbPath = path.join(config.dataDir, 'companion.sqlite');
