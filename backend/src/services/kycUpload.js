const db = require('../db');
const crypto = require('crypto');
const storage = require('./storage');
const queue = require('./fileDeletionQueue');
const history = require('../utils/kycHistory');
const keyHash = key => crypto.createHash('sha256').update(key).digest('hex');
const UPLOAD_CLEANUP_DELAY_SECONDS = 60 * 60;

// Az előzetes törlési feladat túléli a feltöltést, az AI-kérést és a fiókot.
// Sikeres véglegesítéskor ugyanabban a tranzakcióban eltűnik, mint amelyik
// beírja az okmányt. Bizonytalan COMMIT-válasznál sincs találomra fájltörlés.
async function withKycUpload(userId, file, finish) {
  let allocatedKey;
  let uploadClient;
  try {
    const url = await storage.savePrivateFile(file.buffer, file.originalname, file.mimetype, {
      beforeSave: async key => {
        await queue.enqueueFileDeletions(db, userId, [key], { delaySeconds: UPLOAD_CLEANUP_DELAY_SECONDS });
        allocatedKey = key;
        // A tartós feladat már commitolt. Csak a fájlírás idejére zároljuk:
        // a takarító SKIP LOCKED miatt nem törölhet egy még nem létező fájlt,
        // majd annak utolsó nyomát, miközben a feltöltés még dolgozik.
        uploadClient = await db.pool.connect();
        await uploadClient.query('BEGIN');
        const pending = await uploadClient.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [keyHash(key)]);
        if (!pending.rows.length) throw new Error('A feltöltés lejárt. Töltsd fel újra az okmányt.');
      },
    });
    if (uploadClient) {
      await uploadClient.query('COMMIT');
      uploadClient.release();
      uploadClient = null;
    }
    return await finish(url);
  } finally {
    if (uploadClient) {
      await uploadClient.query('ROLLBACK').catch(() => {});
      uploadClient.release();
    }
    if (allocatedKey) {
      // Véglegesített képnek már nincs feladata. Hibánál az élő feladatot
      // előrehozzuk; DB-kiesésnél a korábban mentett határidő akkor is él.
      await db.query('UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE key_hash = $1', [keyHash(allocatedKey)])
        .catch(() => {});
      await queue.processFileDeletionQueue({ batchId: userId }).catch(() => {});
    }
  }
}

async function finalizeKycUpload({ userId, docType, url, docStatus, kycStatus, rejectionReason, docNumberHash, duplicate, verifiedFullName }) {
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // Azonos sorrend a fióktörléssel: user, majd okmány/fájlfeladat.
    const user = await client.query('SELECT id, full_name FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rows[0]) return { missing: true };
    // Pending profil neve közben módosítható. Csak arra a névre igazolunk,
    // amelyet ténylegesen összevetettünk az okmánnyal; a PATCH /auth/me
    // ugyanezen záron vár, és verified állapotban már tiltja a névcserét.
    if (kycStatus === 'verified' && (typeof verifiedFullName !== 'string' || user.rows[0].full_name !== verifiedFullName)) {
      return { profileChanged: true };
    }
    const pending = await client.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [keyHash(url)]);
    // A félbehagyott feltöltést időközben már eltakaríthatta a napi kör.
    if (!pending.rows.length) return { expired: true };
    const previous = await client.query('SELECT file_url FROM kyc_documents WHERE user_id = $1 AND doc_type = $2 FOR UPDATE', [userId, docType]);
    await client.query(
      `INSERT INTO kyc_documents(user_id, doc_type, file_url, status, rejection_reason,
          doc_number_hash, pending_doc_number_hash, hash_algo, uploaded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN COALESCE($6::text,$7::text) IS NULL THEN NULL ELSE 'hmac-sha256' END,NOW())
       ON CONFLICT(user_id, doc_type) DO UPDATE SET
          file_url = EXCLUDED.file_url, status = EXCLUDED.status, rejection_reason = EXCLUDED.rejection_reason,
          doc_number_hash = EXCLUDED.doc_number_hash, pending_doc_number_hash = EXCLUDED.pending_doc_number_hash,
          hash_algo = EXCLUDED.hash_algo, uploaded_at = EXCLUDED.uploaded_at, reviewed_by = NULL, reviewed_at = NOW()`,
      [userId, docType, url, docStatus, rejectionReason, duplicate ? null : docNumberHash, duplicate ? docNumberHash : null],
    );
    await history.rogzitLenyomat(docNumberHash, client);
    await client.query('UPDATE users SET identity_kyc_status = $1 WHERE id = $2', [kycStatus, userId]);
    const oldUrl = previous.rows[0]?.file_url;
    if (oldUrl && oldUrl !== url) await queue.enqueueFileDeletions(client, userId, [oldUrl]);
    await client.query('DELETE FROM file_deletion_queue WHERE key_hash = $1', [keyHash(url)]);
    await client.query('COMMIT');
    committed = true;
    return { saved: true };
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

module.exports = { withKycUpload, finalizeKycUpload, UPLOAD_CLEANUP_DELAY_SECONDS };
