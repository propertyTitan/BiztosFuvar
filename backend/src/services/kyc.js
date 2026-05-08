// GoFuvar KYC & Jogosítvány kezelés.
//
// Flow:
//   1) Sofőr feltölti a jogosítványt → kyc_documents (status: pending)
//   2) Admin jóváhagyja → status: approved, lejárat mentve
//   3) 30 nappal lejárat előtt → értesítés ("Frissítsd a jogosítványod!")
//   4) 7 nappal előtt → utolsó figyelmeztetés
//   5) Lejárat napján → can_bid = false, licitálás letiltva
//
// A checkExpiredLicenses() cron job-ként fut naponta.

const db = require('../db');
const { createNotification } = require('./notifications');

/**
 * Jogosítvány feltöltés feldolgozása.
 * A `fileId` a `files` táblába mutató UUID; a tényleges file-bytes
 * privát R2-en él, csak a `/files/:id` endpointon keresztül érhető el.
 */
async function submitLicenseDocument({ userId, fileId, docNumber, fullName, expiryDate }) {
  // Ha volt korábbi (rejected vagy elavult) doksi, annak fájlját töröljük
  // a tárolóból — ne hagyjunk lógó adatot, GDPR-konform „adat-minimalizálás".
  const { rows: oldRows } = await db.query(
    `SELECT file_id FROM kyc_documents WHERE user_id = $1 AND doc_type = 'drivers_license'`,
    [userId],
  );
  const oldFileId = oldRows[0]?.file_id;

  const { rows } = await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_id, doc_number, full_name_on_doc, expiry_date, status)
     VALUES ($1, 'drivers_license', $2, $3, $4, $5, 'pending')
     ON CONFLICT (user_id, doc_type) DO UPDATE SET
       file_id = EXCLUDED.file_id,
       file_url = NULL,
       doc_number = EXCLUDED.doc_number,
       full_name_on_doc = EXCLUDED.full_name_on_doc,
       expiry_date = EXCLUDED.expiry_date,
       status = 'pending',
       reviewed_by = NULL,
       reviewed_at = NULL,
       rejection_reason = NULL,
       expiry_warned_30d = false,
       expiry_warned_7d = false
     RETURNING *`,
    [userId, fileId, docNumber || null, fullName || null, expiryDate || null],
  );

  await db.query(
    `UPDATE users SET kyc_status = 'pending' WHERE id = $1`,
    [userId],
  );

  // Korábbi fájl tényleges törlése R2-ről
  if (oldFileId && oldFileId !== fileId) {
    setImmediate(async () => {
      try {
        const { rows: f } = await db.query(
          `SELECT id, storage_key, storage_backend FROM files WHERE id = $1`,
          [oldFileId],
        );
        if (f[0]) {
          const { deleteObject } = require('./storage');
          await deleteObject(f[0]);
          await db.query(`UPDATE files SET deleted_at = NOW() WHERE id = $1`, [oldFileId]);
        }
      } catch (e) {
        console.warn('[kyc] régi file törlése sikertelen:', e.message);
      }
    });
  }

  return rows[0];
}

/**
 * Admin jóváhagyja a dokumentumot.
 */
async function approveDocument(docId, adminId) {
  const { rows } = await db.query(
    `UPDATE kyc_documents
        SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $1 RETURNING *`,
    [docId, adminId],
  );
  const doc = rows[0];
  if (!doc) return null;

  // User frissítése
  await db.query(
    `UPDATE users
        SET kyc_status = 'verified',
            kyc_verified_at = NOW(),
            license_expiry = $2,
            can_bid = true
      WHERE id = $1`,
    [doc.user_id, doc.expiry_date],
  );

  await createNotification({
    user_id: doc.user_id,
    type: 'kyc_approved',
    title: '✅ Dokumentumod jóváhagyva!',
    body: 'A jogosítványod elfogadásra került. Mostantól licitálhatsz.',
    link: '/profil',
  }).catch(() => {});

  return doc;
}

/**
 * Admin elutasítja.
 */
async function rejectDocument(docId, adminId, reason) {
  const { rows } = await db.query(
    `UPDATE kyc_documents
        SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
      WHERE id = $1 RETURNING *`,
    [docId, adminId, reason],
  );
  const doc = rows[0];
  if (!doc) return null;

  await createNotification({
    user_id: doc.user_id,
    type: 'kyc_rejected',
    title: '⚠️ Dokumentumod elutasítva',
    body: `Indok: ${reason || 'Nem felel meg a követelményeknek.'}. Kérjük töltsd fel újra.`,
    link: '/profil',
  }).catch(() => {});

  return doc;
}

/**
 * Napi cron: lejárt jogosítványok ellenőrzése.
 * - 30 nappal a lejárat előtt: figyelmeztetés
 * - 7 nappal előtt: utolsó figyelmeztetés
 * - Lejárat napján: can_bid = false
 */
async function checkExpiredLicenses() {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  // 30 napos figyelmeztetés
  const { rows: warn30 } = await db.query(
    `SELECT d.*, u.full_name FROM kyc_documents d JOIN users u ON u.id = d.user_id
      WHERE d.doc_type = 'drivers_license' AND d.status = 'approved'
        AND d.expiry_date <= $1 AND d.expiry_date > $2
        AND d.expiry_warned_30d = false`,
    [in30, in7],
  );
  for (const doc of warn30) {
    await createNotification({
      user_id: doc.user_id,
      type: 'license_expiry_warning',
      title: '⚠️ Jogosítványod 30 napon belül lejár!',
      body: `Kérjük frissítsd a jogosítványod a lejárat (${doc.expiry_date}) előtt, különben nem tudsz majd licitálni.`,
      link: '/profil',
    }).catch(() => {});
    await db.query(`UPDATE kyc_documents SET expiry_warned_30d = true WHERE id = $1`, [doc.id]);
  }

  // 7 napos figyelmeztetés
  const { rows: warn7 } = await db.query(
    `SELECT d.*, u.full_name FROM kyc_documents d JOIN users u ON u.id = d.user_id
      WHERE d.doc_type = 'drivers_license' AND d.status = 'approved'
        AND d.expiry_date <= $1 AND d.expiry_date > $2
        AND d.expiry_warned_7d = false`,
    [in7, today],
  );
  for (const doc of warn7) {
    await createNotification({
      user_id: doc.user_id,
      type: 'license_expiry_urgent',
      title: '🔴 Jogosítványod 7 napon belül lejár!',
      body: 'Ha nem frissíted, a lejárat napján automatikusan letiltjuk a licitálási lehetőséget.',
      link: '/profil',
    }).catch(() => {});
    await db.query(`UPDATE kyc_documents SET expiry_warned_7d = true WHERE id = $1`, [doc.id]);
  }

  // Lejárt → letiltás
  const { rows: expired } = await db.query(
    `SELECT d.user_id FROM kyc_documents d
      WHERE d.doc_type = 'drivers_license' AND d.status = 'approved'
        AND d.expiry_date <= $1`,
    [today],
  );
  for (const doc of expired) {
    await db.query(`UPDATE users SET can_bid = false WHERE id = $1`, [doc.user_id]);
    await db.query(`UPDATE kyc_documents SET status = 'expired' WHERE user_id = $1 AND doc_type = 'drivers_license'`, [doc.user_id]);
    await createNotification({
      user_id: doc.user_id,
      type: 'license_expired',
      title: '🚫 Jogosítványod lejárt — licitálás letiltva',
      body: 'Tölts fel új, érvényes jogosítványt a profil oldaladon a licitálás újraengedélyezéséhez.',
      link: '/profil',
    }).catch(() => {});
  }

  console.log(`[kyc] Napi check: ${warn30.length} 30d warn, ${warn7.length} 7d warn, ${expired.length} expired`);
}

/**
 * Adat-minimalizálás: jóváhagyás után 30 nappal a tényleges KYC fájlt
 * törüljük (R2-ről + file table soft delete). A `kyc_documents` sor
 * megmarad: státusz, lejárat, név — ezek elégségesek a licit-gate-hez.
 *
 * Ha a license_expiry közeleg (-30 / -7 nap), a checkExpiredLicenses()
 * újra-uploadot kér a sofőrtől, és onnantól megint van fájl 30 napig.
 */
async function purgeApprovedKycFiles() {
  const { rows: docs } = await db.query(
    `SELECT d.id AS doc_id, d.file_id, f.storage_key, f.storage_backend
       FROM kyc_documents d
       JOIN files f ON f.id = d.file_id
      WHERE d.status = 'approved'
        AND d.reviewed_at < NOW() - INTERVAL '30 days'
        AND f.deleted_at IS NULL`,
  );
  if (docs.length === 0) return 0;

  const { deleteObject } = require('./storage');
  let purged = 0;
  for (const d of docs) {
    try {
      await deleteObject({ storage_key: d.storage_key, storage_backend: d.storage_backend });
      await db.query(`UPDATE files SET deleted_at = NOW() WHERE id = $1`, [d.file_id]);
      // A doksi sor is kapjon egy file_id = NULL-t, hogy a UI tudja:
      // a fotó már nincs, csak a metaadat
      await db.query(`UPDATE kyc_documents SET file_id = NULL WHERE id = $1`, [d.doc_id]);
      purged++;
    } catch (e) {
      console.warn('[kyc] purge hiba:', e.message);
    }
  }
  console.log(`[kyc] purgeApprovedKycFiles: ${purged} fájl törölve adat-minimalizálásból`);
  return purged;
}

/**
 * Right-to-be-forgotten: a user MINDEN feltöltött fájlját töröljük R2-ről,
 * a `files` táblában soft-delete-eljük, majd a user-rekordot anonimizáljuk.
 * Ez NEM törli a jogi okból megőrzendő naplókat (file_access_log, payment_events,
 * data_consent_log) — azok személyazonosítás nélkül megmaradnak.
 */
async function purgeUserData(userId) {
  const { rows: files } = await db.query(
    `SELECT id, storage_key, storage_backend FROM files
      WHERE owner_id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const { deleteObject } = require('./storage');
  for (const f of files) {
    try { await deleteObject(f); } catch (e) { console.warn('[purge] R2 hiba:', e.message); }
    await db.query(`UPDATE files SET deleted_at = NOW() WHERE id = $1`, [f.id]);
  }

  // KYC dokumentumok teljes törlése
  await db.query(`DELETE FROM kyc_documents WHERE user_id = $1`, [userId]);

  // User-rekord anonimizálása — id megmarad külső kulcsokhoz, de a PII nem
  await db.query(
    `UPDATE users
        SET email = CONCAT('deleted-', id, '@gofuvar.invalid'),
            password_hash = '',
            full_name = '[törölt felhasználó]',
            phone = NULL, bio = NULL,
            vehicle_type = NULL, vehicle_plate = NULL,
            avatar_url = NULL, avatar_file_id = NULL,
            kyc_status = 'none', kyc_verified_at = NULL, license_expiry = NULL,
            can_bid = false,
            updated_at = NOW()
      WHERE id = $1`,
    [userId],
  );
  return { purged_files: files.length };
}

module.exports = {
  submitLicenseDocument,
  approveDocument,
  rejectDocument,
  checkExpiredLicenses,
  purgeApprovedKycFiles,
  purgeUserData,
};
