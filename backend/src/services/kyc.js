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
 * A lejárati dátumot manuálisan adja meg a sofőr (OCR opcionális).
 */
async function submitLicenseDocument({ userId, fileUrl, docNumber, fullName, expiryDate }) {
  const { rows } = await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, doc_number, full_name_on_doc, expiry_date, status)
     VALUES ($1, 'drivers_license', $2, $3, $4, $5, 'pending')
     ON CONFLICT (user_id, doc_type) DO UPDATE SET
       file_url = EXCLUDED.file_url,
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
    [userId, fileUrl, docNumber || null, fullName || null, expiryDate || null],
  );

  await db.query(
    `UPDATE users SET kyc_status = 'pending' WHERE id = $1`,
    [userId],
  );

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

module.exports = {
  submitLicenseDocument,
  approveDocument,
  rejectDocument,
  checkExpiredLicenses,
};
