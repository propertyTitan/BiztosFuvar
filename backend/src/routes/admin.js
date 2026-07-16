// =====================================================================
//  Admin CRUD végpontok — teljes kontroll a platform felett.
//
//  Minden endpoint admin role-t igényel.
//  Funkciók: userek, fuvarok, licitek, útvonalak, foglalások kezelése.
// =====================================================================

const express = require('express');
const db = require('../db');
const realtime = require('../realtime');
const { createNotification } = require('../services/notifications');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = [authRequired, requireRole('admin')];

// ===================== ÉLŐ JELENLÉT =====================

// GET /admin/live — kik vannak ÉPPEN az oldalon (élő socket-kapcsolatok).
// Olcsó, DB-t nem érint; a frontend pár másodpercenként pollozza.
router.get('/admin/live', ...adminOnly, (req, res) => {
  res.json(realtime.getPresence());
});

// ===================== FOTÓ-MEGŐRZÉSI ZÁROLÁS =====================

// PATCH /admin/photo-hold — fuvar vagy foglalás fotóinak zárolása/feloldása
// (2026-07-16 retenció-szabály: alapból 30 nap; zárolva 5 év). A vita-nyitás
// automatikusan zárol; ez a végpont az "admini utasítás" ága.
// Body: { job_id? , booking_id?, hold: boolean }
router.patch('/admin/photo-hold', ...adminOnly, async (req, res) => {
  const { job_id, booking_id, hold } = req.body || {};
  if (typeof hold !== 'boolean' || (!job_id && !booking_id)) {
    return res.status(400).json({ error: 'Kell: hold (true/false) és job_id VAGY booking_id.' });
  }
  const table = job_id ? 'jobs' : 'route_bookings';
  const id = job_id || booking_id;
  const { rows } = await db.query(
    `UPDATE ${table} SET photo_retention_hold = $1 WHERE id = $2 RETURNING id, photo_retention_hold`,
    [hold, id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található ilyen fuvar/foglalás.' });
  console.log(`[admin] fotó-zárolás ${hold ? 'BE' : 'KI'}: ${table} ${id} (admin: ${req.user.sub})`);
  res.json({ ok: true, entity: table, id: rows[0].id, photo_retention_hold: rows[0].photo_retention_hold });
});

// ===================== FELHASZNÁLÓK =====================

// GET /admin/users — összes felhasználó
router.get('/admin/users', ...adminOnly, async (req, res) => {
  const { search, limit = 50 } = req.query;
  let sql = `SELECT id, email, full_name, phone, role, account_type,
                    identity_kyc_status, driver_kyc_status, company_verification_status,
                    rating_avg, rating_count, trust_score, level, created_at,
                    is_tow_driver, company_name,
                    last_login_at, login_count, last_seen_at, total_active_seconds
               FROM users`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Number(limit), 200)}`;
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

// DELETE /admin/users/:id — felhasználó törlése
router.delete('/admin/users/:id', ...adminOnly, async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// PATCH /admin/users/:id — felhasználó módosítása (role, KYC, ban)
router.patch('/admin/users/:id', ...adminOnly, async (req, res) => {
  const allowed = ['role', 'identity_kyc_status', 'driver_kyc_status',
    'company_verification_status', 'can_bid', 'trust_score', 'level'];
  // A role mindig a 3 ismert érték egyike legyen (a JWT ezzel íródik alá),
  // hogy egy elgépelés ne küldjön érvénytelen stringet az enum oszlopba.
  if (req.body.role !== undefined && !['shipper', 'carrier', 'admin'].includes(req.body.role)) {
    return res.status(400).json({ error: 'Érvénytelen szerepkör' });
  }
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(req.body[key]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nincs módosítandó mező' });
  params.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role`,
    params,
  );
  if (!rows[0]) return res.status(404).json({ error: 'User nem található' });
  res.json(rows[0]);
});

// ===================== FUVAROK =====================

// GET /admin/jobs — összes fuvar
router.get('/admin/jobs', ...adminOnly, async (req, res) => {
  const { status, limit = 50 } = req.query;
  // Whitelist: a job_status enumra nem létező értéket küldve a Postgres
  // "invalid input value for enum" hibát dobna → 500. (Admin-only, de a
  // tiszta 400 itt is jobb, mint az enum-hiba kiszivárgása.)
  const VALID_JOB_STATUSES = [
    'pending', 'bidding', 'accepted', 'in_progress',
    'delivered', 'completed', 'disputed', 'cancelled',
  ];
  if (status && !VALID_JOB_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Érvénytelen státusz: "${status}".` });
  }
  let sql = `SELECT j.*, s.full_name AS shipper_name, c.full_name AS carrier_name
               FROM jobs j
               JOIN users s ON s.id = j.shipper_id
          LEFT JOIN users c ON c.id = j.carrier_id`;
  const params = [];
  if (status) {
    params.push(status);
    sql += ` WHERE j.status = $1`;
  }
  sql += ` ORDER BY j.created_at DESC LIMIT ${Math.min(Number(limit), 200)}`;
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

// DELETE /admin/jobs/:id — fuvar törlése
router.delete('/admin/jobs/:id', ...adminOnly, async (req, res) => {
  await db.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// PATCH /admin/jobs/:id — fuvar státusz módosítása
router.patch('/admin/jobs/:id', ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Státusz kötelező' });
  const { rows } = await db.query(
    `UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
  res.json(rows[0]);
});

// ===================== LICITEK =====================

// GET /admin/bids — licitek egy fuvarhoz
router.get('/admin/bids/:jobId', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, u.full_name AS carrier_name, u.email AS carrier_email
       FROM bids b JOIN users u ON u.id = b.carrier_id
      WHERE b.job_id = $1 ORDER BY b.created_at DESC`,
    [req.params.jobId],
  );
  res.json(rows);
});

// DELETE /admin/bids/:id — licit törlése
router.delete('/admin/bids/:id', ...adminOnly, async (req, res) => {
  await db.query('DELETE FROM bids WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ===================== ÚTVONALAK =====================

// GET /admin/routes — összes útvonal
router.get('/admin/routes', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS carrier_name
       FROM carrier_routes r JOIN users u ON u.id = r.carrier_id
      ORDER BY r.created_at DESC LIMIT 100`,
  );
  res.json(rows);
});

// DELETE /admin/routes/:id — útvonal törlése
router.delete('/admin/routes/:id', ...adminOnly, async (req, res) => {
  await db.query('DELETE FROM carrier_routes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ===================== FOGLALÁSOK =====================

// GET /admin/bookings — összes foglalás
router.get('/admin/bookings', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, r.title AS route_title,
            s.full_name AS shipper_name, c.full_name AS carrier_name
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users s ON s.id = b.shipper_id
       JOIN users c ON c.id = r.carrier_id
      ORDER BY b.created_at DESC LIMIT 100`,
  );
  res.json(rows);
});

// DELETE /admin/bookings/:id — foglalás törlése
router.delete('/admin/bookings/:id', ...adminOnly, async (req, res) => {
  await db.query('DELETE FROM route_bookings WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ===================== KYC DOKUMENTUMOK =====================

// GET /admin/kyc-documents — összes KYC dokumentum
router.get('/admin/kyc-documents', ...adminOnly, async (req, res) => {
  const { status = 'pending' } = req.query;
  const { rows } = await db.query(
    `SELECT k.*, u.full_name, u.email
       FROM kyc_documents k JOIN users u ON u.id = k.user_id
      WHERE k.status = $1
      ORDER BY k.created_at DESC LIMIT 50`,
    [status],
  );
  // Privát tárolású fotókhoz (private:<kulcs>) rövid életű aláírt URL megy
  // az admin-felületnek — a régi, publikus URL-es sorok változatlanul
  // átmennek (a migrációs szkript költözteti őket).
  const { getSignedPrivateUrl } = require('../services/storage');
  const out = await Promise.all(rows.map(async (r) => (
    r.file_url && r.file_url.startsWith('private:')
      ? { ...r, file_url: await getSignedPrivateUrl(r.file_url) }
      : r
  )));
  res.json(out);
});

// PATCH /admin/kyc-documents/:id — KYC dokumentum kézi jóváhagyása/elutasítása.
// Frissíti a dokumentum státuszát ÉS a felhasználó megfelelő KYC-mezőjét a
// doc_type alapján, majd értesíti a felhasználót a döntésről.
const KYC_DOC_FIELD = {
  id_card: 'identity_kyc_status',
  drivers_license: 'driver_kyc_status',
  company_document: 'company_verification_status',
};
router.patch('/admin/kyc-documents/:id', ...adminOnly, async (req, res) => {
  const { action, reason } = req.body || {};
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Érvénytelen művelet (approve / reject).' });
  }
  if (action === 'reject' && (!reason || !String(reason).trim())) {
    return res.status(400).json({ error: 'Elutasításhoz indoklás szükséges.' });
  }

  const { rows } = await db.query(
    'SELECT user_id, doc_type, status FROM kyc_documents WHERE id = $1',
    [req.params.id],
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'KYC dokumentum nem található.' });

  const docStatus = action === 'approve' ? 'approved' : 'rejected';
  const userStatus = action === 'approve' ? 'verified' : 'rejected';
  const rejectionReason = action === 'reject' ? String(reason).trim() : null;

  await db.query(
    `UPDATE kyc_documents
        SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
      WHERE id = $4`,
    [docStatus, req.user.sub, rejectionReason, req.params.id],
  );

  // A felhasználó megfelelő KYC-mezője a doc_type alapján (fix whitelist —
  // a mezőnév sosem a kérésből jön, így nincs SQL-injekció).
  const field = KYC_DOC_FIELD[doc.doc_type];
  if (field) {
    await db.query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [userStatus, doc.user_id]);
  }

  // Értesítés a felhasználónak a döntésről
  await createNotification({
    user_id: doc.user_id,
    type: action === 'approve' ? 'kyc_approved' : 'kyc_rejected',
    title: action === 'approve' ? '✅ Azonosítás jóváhagyva' : '❌ Azonosítás elutasítva',
    body: action === 'approve'
      ? 'Az adminisztrátor jóváhagyta a dokumentumodat. Mostantól használhatod a platformot.'
      : `Az adminisztrátor elutasította a dokumentumodat. Indok: ${rejectionReason}`,
    link: '/profil',
  }).catch(() => {});

  res.json({ ok: true, status: docStatus });
});

// ===================== COVERAGE ZÓNÁK =====================

// PATCH /admin/coverage/:zoneId — zóna aktiválás/deaktiválás
router.patch('/admin/coverage/:zoneId', ...adminOnly, (req, res) => {
  const { ZONES } = require('../utils/coverage');
  const zone = ZONES.find((z) => z.id === req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zóna nem található' });
  zone.active = !!req.body.active;
  res.json({ ok: true, zone });
});

module.exports = router;
