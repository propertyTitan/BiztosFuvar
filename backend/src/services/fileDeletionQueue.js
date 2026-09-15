// A DB-törléssel együtt mentett feladatok túlélik a fiókot és a folyamatot.
const crypto = require('crypto');
const db = require('../db');
const storage = require('./storage');

async function enqueueFileDeletions(client, batchId, keys, { delaySeconds = 0 } = {}) {
  for (const key of new Set(keys)) {
    await client.query(
      `INSERT INTO file_deletion_queue(key_hash, file_key, batch_id, next_attempt_at)
       VALUES($1, $2, $3, NOW() + make_interval(secs => $4))
       ON CONFLICT (key_hash) DO NOTHING`,
      [crypto.createHash('sha256').update(key).digest('hex'), key, batchId, delaySeconds],
    );
  }
}

async function processFileDeletionQueue({ batchId = null, limit = 100 } = {}) {
  const client = await db.pool.connect();
  let deleted = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT key_hash, file_key FROM file_deletion_queue
        WHERE next_attempt_at <= NOW() AND ($1::uuid IS NULL OR batch_id = $1)
        ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [batchId, limit],
    );
    for (const row of rows) {
      // A hibás kulcs nem akadályozza a többi fájl törlését. A kulcsot nem
      // naplózzuk: privát okmányhoz vagy személyes fotóhoz vezethet.
      const ok = await storage.deleteFile(row.file_key).catch(() => false);
      if (ok) {
        await client.query('DELETE FROM file_deletion_queue WHERE key_hash = $1', [row.key_hash]);
        deleted += 1;
      } else {
        await client.query(`UPDATE file_deletion_queue SET attempts = attempts + 1,
          next_attempt_at = NOW() + INTERVAL '15 minutes' WHERE key_hash = $1`, [row.key_hash]);
        failed += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  if (failed) {
    require('@sentry/node').captureMessage(`[file-deletion] ${failed} fájl törlése újrapróbálásra vár`, 'error');
    // A napi retenció naplója sem mutathat teljes sikert tárolóhiba mellett.
    throw new Error(`Fájltörlés: ${failed} tárolóművelet sikertelen, a tartós feladat megmaradt`);
  }
  return deleted;
}

module.exports = { enqueueFileDeletions, processFileDeletionQueue };
