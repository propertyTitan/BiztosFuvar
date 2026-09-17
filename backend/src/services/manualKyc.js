const crypto = require('crypto');
const db = require('../db');

const KYC_DOC_FIELD = {
  id_card: 'identity_kyc_status',
  drivers_license: 'driver_kyc_status',
  company_document: 'company_verification_status',
};
// A nyers tárhelykulcsot nem adjuk vissza: az admin a szerver által aláírt,
// megtekintett dokumentum- és névállapothoz tartozó tokent küldi vissza.
function reviewToken(doc) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify([
    doc.id, doc.user_id, doc.doc_type, doc.file_url, doc.uploaded_at,
    doc.reviewed_at, doc.status, doc.full_name, doc.doc_number_hash, doc.pending_doc_number_hash,
  ])).digest('hex');
}

async function reviewDocument({ id, adminId, action, reason, expectedToken }) {
  const owner = await db.query('SELECT user_id FROM kyc_documents WHERE id = $1', [id]);
  if (!owner.rows[0]) return { missing: true };
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // A feltöltés és fióktörlés sorrendje: előbb user, utána dokumentum.
    const user = await client.query('SELECT id, full_name FROM users WHERE id = $1 FOR UPDATE', [owner.rows[0].user_id]);
    const current = await client.query('SELECT * FROM kyc_documents WHERE id = $1 FOR UPDATE', [id]);
    if (!user.rows[0] || !current.rows[0]) return { missing: true };
    const doc = { ...current.rows[0], full_name: user.rows[0].full_name };
    if (typeof expectedToken !== 'string' || expectedToken !== reviewToken(doc)) return { changed: true };
    const docStatus = action === 'approve' ? 'approved' : 'rejected';
    const userStatus = action === 'approve' ? 'verified' : 'rejected';
    const rejectionReason = action === 'reject' ? String(reason).trim() : null;
    await client.query(
      `UPDATE kyc_documents
          SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3,
              -- A FUGGO LENYOMAT ELOLEP (2026-08-11, 10. meres F5).
              -- Jovahagyaskor a duplikatum-gyanus feltoltes lenyomata bekerul az
              -- eles oszlopba, tehat az "egy okmany = egy fiok" vedelem
              -- visszaall. Ha a masik fiok ugye NINCS rendezve, a parcialis
              -- UNIQUE index utkozik - ezt az admin latja, es elobb azt kell
              -- rendeznie. Elutasitasnal a fuggo lenyomat marad, hogy egy kesobbi
              -- jovahagyas meg elolephessen.
              doc_number_hash = CASE WHEN $1 = 'approved'
                                     THEN COALESCE(doc_number_hash, pending_doc_number_hash)
                                     ELSE doc_number_hash END,
              pending_doc_number_hash = CASE WHEN $1 = 'approved'
                                             THEN NULL ELSE pending_doc_number_hash END,
              hash_algo = CASE WHEN $1 = 'approved' AND doc_number_hash IS NULL
                                    AND pending_doc_number_hash IS NOT NULL
                               THEN 'hmac-sha256' ELSE hash_algo END
        WHERE id = $4`,
      [docStatus, adminId, rejectionReason, id],
    );

    const field = KYC_DOC_FIELD[doc.doc_type];
    if (field) await client.query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [userStatus, doc.user_id]);
    await client.query('COMMIT');
    committed = true;
    return { doc, docStatus, rejectionReason };
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

module.exports = { reviewToken, reviewDocument };
