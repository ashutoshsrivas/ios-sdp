// Deletes chat files older than 30 days from disk and flags the message row.
// Runs on boot and every 6 hours inside the API process.
const fs = require('fs');
const path = require('path');
const { q } = require('./db');

const RETENTION_DAYS = 30;

async function runOnce(chatDir) {
  const rows = await q(
    `SELECT id, file_path FROM chat_messages
     WHERE file_path IS NOT NULL AND file_expired = 0
       AND created_at < (NOW() - INTERVAL ? DAY)`,
    [RETENTION_DAYS]
  );
  let removed = 0;
  for (const r of rows) {
    try {
      const abs = path.join(chatDir, path.basename(r.file_path));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch { /* ignore a missing/locked file */ }
    await q('UPDATE chat_messages SET file_path = NULL, file_expired = 1 WHERE id = ?', [r.id]);
    removed += 1;
  }
  return removed;
}

function start(chatDir) {
  const tick = () =>
    runOnce(chatDir)
      .then((n) => { if (n) console.log(`[chat] expired ${n} file(s) older than ${RETENTION_DAYS} days`); })
      .catch((e) => console.error('[chat cleanup]', e.message));
  tick();
  setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = { start, runOnce, RETENTION_DAYS };
