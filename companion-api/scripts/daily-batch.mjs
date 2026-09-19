// 每日批次：由 Coolify 排程呼叫
//   node /app/scripts/daily-batch.mjs          -> 產生/重生成變化題（優先需調整，再補新題）
//   node /app/scripts/daily-batch.mjs assign   -> 把已合格但未指派的題追加指派（維持雙審）
const base = process.env.SELF_BASE || 'http://127.0.0.1:8080';
const token = process.env.COMPANION_API_TOKEN || '';
const arg = process.argv[2] || 'batch';

async function post(path, body) {
  try {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    console.log(new Date().toISOString(), path, res.status, text.slice(0, 800));
  } catch (e) {
    console.error(new Date().toISOString(), path, 'ERROR', String(e));
    process.exitCode = 1;
  }
}

if (arg === 'assign') {
  await post('/v1/assignments/sync-approved', {});
} else if (arg === 'review') {
  await post('/v1/variants/auto-review', { limit: Number(process.env.REVIEW_LIMIT || 60), apply: true, concurrency: 3 });
} else if (arg === 'gaps') {
  await post('/v1/variants/fill-gaps', { target: Number(process.env.GAP_TARGET || 5), limit: Number(process.env.GAP_LIMIT || 30), concurrency: 3 });
} else {
  await post('/v1/variants/batch', { limit: Number(process.env.BATCH_LIMIT || 100), concurrency: 3 });
}
