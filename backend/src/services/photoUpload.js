const crypto = require('crypto');
const db = require('../db');
const storage = require('./storage');
const queue = require('./fileDeletionQueue');
const keyHash = key => crypto.createHash('sha256').update(key).digest('hex');

// A tárhelyre kerülő fotónak a bájtok írása előtt tartós nyoma van.
// A commitPhoto a saját tranzakciójában fogyasztja el ezt a feladatot.
async function withPhotoUpload(userId, file, finish) {
  const allocated = new Set();
  let uploadClient;
  let registrationFailed = false;
  try {
    let url;
    try {
      url = await storage.saveFile(file.buffer, file.originalname, file.mimetype, {
        beforeSave: async key => {
          try {
            const hash = keyHash(key);
            allocated.add(hash);
            await queue.enqueueFileDeletions(db, userId, [key], { delaySeconds: 3600 });
            if (!uploadClient) {
              uploadClient = await db.pool.connect();
              await uploadClient.query('BEGIN');
            }
            const pending = await uploadClient.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [hash]);
            if (!pending.rows.length) throw new Error('A fotó feltöltése lejárt. Töltsd fel újra.');
          } catch (err) { registrationFailed = true; throw err; }
        },
      });
    } catch (err) {
      // A DB-nyilvántartás hibáját nem kerülheti meg a tárolási fallback.
      if (registrationFailed) throw err;
      // Meglévő végső fallback: a kép a fotótranzakcióban, a DB-be kerül.
      console.warn('[photos] storage save failed, falling back to data URL:', err.message);
      url = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    }
    if (uploadClient) {
      await uploadClient.query('COMMIT');
      uploadClient.release();
      uploadClient = null;
    }
    return await finish(url);
  } finally {
    if (uploadClient) {
      let releaseError;
      try { await uploadClient.query('ROLLBACK'); } catch (err) { releaseError = err; }
      uploadClient.release(releaseError);
    }
    if (allocated.size) {
      // Bizonytalan COMMIT-nál is csak a még létező feladat takaríthat.
      // DB-kieséskor az eredeti, egyórás határidő továbbra is megmarad.
      await db.query('UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE key_hash = ANY($1::text[])', [[...allocated]])
        .catch(() => {});
      // Más feltöltések korábbi tárhelyhibái nem késleltethetik ezt a választ.
      await queue.processFileDeletionQueue({ batchId: userId, keyHashes: [...allocated] }).catch(() => {});
    }
  }
}

module.exports = { withPhotoUpload };
