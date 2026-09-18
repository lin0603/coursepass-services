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

// 獨立驗算模型（OpenAI 相容；預設 DeepSeek flash-lite）。未設 key＝回退 Gemini。
config.verifyBaseUrl = (process.env.VERIFY_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
config.verifyApiKey = process.env.VERIFY_API_KEY || '';
config.verifyModel = process.env.VERIFY_MODEL || 'deepseek-flash';
config.verifyProvider = process.env.VERIFY_PROVIDER || 'openai';

// 審題站簡易登入（通行碼）；未設＝不啟用
config.previewPasscode = process.env.PREVIEW_PASSCODE || '';
// 管理者密碼（可看資源索引／來源資源包）；未設＝沿用通行碼
config.adminPasscode = process.env.ADMIN_PASSCODE || '';
// 每日重生成 AI 解題：題庫資料來源（id → 題目內容）
config.explainDataUrl = process.env.EXPLAIN_DATA_URL || `${config.filesBase}/preview/knsh-math5.json`;
// 每日批次：題庫活動格式（type/正確答案）
config.appDataUrl = process.env.APP_DATA_URL || `${config.filesBase}/preview/knsh-math5-appdata.json`;
// 課程清單（含各課程題庫資料 URL），用於覆蓋率等跨課程計算
config.coursesUrl = process.env.COURSES_URL || `${config.filesBase}/preview/courses.json`;
// 每日批次：預設課程與每次題數
config.batchCourseId = process.env.BATCH_COURSE_ID || 'knsh-g5-math-115a';
config.batchLimit = Number(process.env.BATCH_LIMIT || 100);

fs.mkdirSync(config.dataDir, { recursive: true });
export const dbPath = path.join(config.dataDir, 'companion.sqlite');
