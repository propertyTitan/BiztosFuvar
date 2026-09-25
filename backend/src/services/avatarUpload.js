const crypto = require('crypto');
const db = require('../db');
const storage = require('./storage');
const queue = require('./fileDeletionQueue');
const keyHash = key => crypto.createHash('sha256').update(key).digest('hex');

async function saveAvatar(userId, file) {
  file = await require('./publicImage').sanitizePublicImage(file);
  const allocated = new Set();
  let uploadClient;
  try {
    const url = await storage.saveFile(file.buffer, file.originalname, file.mimetype, {
      beforeSave: async key => {
        // R2-hiba utáni disk-fallback esetén mindkét kulcs követhető marad.
        await queue.enqueueFileDeletions(db, userId, [key], { delaySeconds: 3600 });
        allocated.add(keyHash(key));
        if (!uploadClient) {
          uploadClient = await db.pool.connect();
          await uploadClient.query('BEGIN');
        }
        const pending = await uploadClient.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [keyHash(key)]);
        if (!pending.rows.length) throw new Error('A profilkép feltöltése lejárt.');
      },
    });
    await uploadClient.query('COMMIT');
    uploadClient.release();
    uploadClient = null;
    return await finalizeAvatar(userId, url);
  } finally {
    if (uploadClient) {
      await uploadClient.query('ROLLBACK').catch(() => {});
      uploadClient.release();
    }
    if (allocated.size) {
      // Bizonytalan COMMIT-válasznál csak a még létező feladat dolgozhat;
      // a véglegesített profilképet nem töröljük találomra.
      await db.query('UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE key_hash = ANY($1::text[])', [[...allocated]])
        .catch(() => {});
      await queue.processFileDeletionQueue({ batchId: userId }).catch(() => {});
    }
  }
}

async function finalizeAvatar(userId, url) {
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT avatar_url FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rows.length) return { missing: true };
    const pending = await client.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [keyHash(url)]);
    if (!pending.rows.length) return { expired: true };
    await client.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [url, userId]);
    const previous = user.rows[0].avatar_url;
    if (previous && previous !== url) await queue.enqueueFileDeletions(client, userId, [previous]);
    await client.query('DELETE FROM file_deletion_queue WHERE key_hash = $1', [keyHash(url)]);
    await client.query('COMMIT');
    committed = true;
    return { url };
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

module.exports = { saveAvatar };
