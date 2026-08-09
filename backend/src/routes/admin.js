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
const { userHasBlockingDealings } = require('../utils/activePaid');
const { purgeUserFiles, collectUserFileKeys } = require('../utils/userFiles');
const { logAdminAccess } = require('../utils/adminAudit');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = [authRequired, requireRole('admin')];

// ── Adatvesztés-védelem az admin törlő-műveletekhez (2026-08-08) ──
// A törlések kaszkádolnak: egy fizetett, folyamatban lévő ügyletet ne lehessen
// egy admin-kattintással megsemmisíteni (a route törlése a foglalásait, a
// user törlése a járatait → foglalásait viszi). A guard konzervatív: CSAK az
// aktív + FIZETETT eseteket zárja; terminál/fizetetlen ügylet szabadon
// törölhető. Ha az admin tényleg törölni akar, előbb zárja le a tranzakciót
// (kézbesítés / lemondás / vita).
const ACTIVE_PAID_MSG = 'Ez az elem folyamatban lévő, kifizetett ügylethez tartozik. '
  + 'Előbb zárd le (kézbesítés / lemondás / vita), utána törölhető.';

/** Aktív + fizetett fuvar-e ez a job? */
async function jobIsActivePaid(jobId) {
  const { rows } = await db.query(
    `SELECT 1 FROM jobs WHERE id = $1 AND paid_at IS NOT NULL
        AND status NOT IN ('delivered', 'completed', 'cancelled')`,
    [jobId],
  );
  return rows.length > 0;
}
/** Aktív + fizetett foglalás-e ez a booking? */
async function bookingIsActivePaid(bookingId) {
  const { rows } = await db.query(
    `SELECT 1 FROM route_bookings WHERE id = $1 AND paid_at IS NOT NULL
        AND status NOT IN ('delivered', 'cancelled', 'rejected')`,
    [bookingId],
  );
  return rows.length > 0;
}
/** Van-e a járaton aktív + fizetett foglalás (amit a route-törlés elvinne)? */
async function routeHasActivePaidBooking(routeId) {
  const { rows } = await db.query(
    `SELECT 1 FROM route_bookings WHERE route_id = $1 AND paid_at IS NOT NULL
        AND status NOT IN ('delivered', 'cancelled', 'rejected')`,
    [routeId],
  );
  return rows.length > 0;
}

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

// GET /admin/users/:id — EGY felhasználó teljes profilja (részletnézet).
//
// Ami SZÁNDÉKOSAN kimarad (adat-minimalizálás, 2026-08-08 user-döntés):
//  - DAC7-adatok (personal_tax_id, birth_date) — csak a NAV-jelentéshez
//    kellenek, az admin-felületen elég a "megadta-e" tény (has_tax_data);
//  - titkok (password_hash, token-hash-ek).
router.get('/admin/users/:id', ...adminOnly, async (req, res) => {
  // Elszámoltathatóság: a teljes felhasználói részletnézet megnyitása naplózva
  // (GDPR 5. cikk (2) — a tájékoztató „hozzáférési audit log" ígérete).
  logAdminAccess(req, 'user_detail', { type: 'user', id: req.params.id });
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.email_verified, u.full_name, u.phone, u.role,
            u.account_type, u.locale, u.bio, u.avatar_url,
            u.created_at, u.updated_at,
            -- céges / számlázási adatok
            u.company_name, u.tax_id, u.company_reg_number, u.eu_vat_number,
            u.billing_address, u.billing_country, u.company_verification_status,
            u.nav_taxpayer_checked_at, u.nav_taxpayer_name, u.nav_taxpayer_valid,
            -- szállítói profil
            u.vehicle_type, u.vehicle_plate, u.service_categories,
            u.identity_kyc_status, u.driver_kyc_status, u.driver_terms_accepted_at,
            u.is_tow_driver, u.tow_services, u.tow_vehicle_description,
            u.level, u.level_name, u.total_deliveries,
            u.rating_avg, u.rating_count, u.trust_score,
            -- aktivitás
            u.last_login_at, u.login_count, u.last_seen_at, u.total_active_seconds,
            -- ajánlói program
            u.referral_code, u.referred_by, u.referral_reward_granted_at,
            ref.full_name AS referred_by_name, ref.email AS referred_by_email,
            -- DAC7: csak a TÉNY, nem az adat
            (u.personal_tax_id IS NOT NULL) AS has_tax_data,
            u.tax_data_requested_at,
            -- forgalmi számok
            (SELECT COUNT(*)::int FROM jobs j WHERE j.shipper_id = u.id) AS jobs_as_shipper,
            (SELECT COUNT(*)::int FROM jobs j WHERE j.carrier_id = u.id) AS jobs_as_carrier,
            (SELECT COUNT(*)::int FROM route_bookings b WHERE b.shipper_id = u.id) AS bookings_as_shipper,
            (SELECT COUNT(*)::int FROM carrier_routes r WHERE r.carrier_id = u.id) AS routes_as_carrier,
            (SELECT COUNT(*)::int FROM disputes d WHERE d.opened_by = u.id OR d.against_user = u.id) AS dispute_count
       FROM users u
       LEFT JOIN users ref ON ref.id = u.referred_by
      WHERE u.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });
  res.json(rows[0]);
});

// DELETE /admin/users/:id — felhasználó törlése
router.delete('/admin/users/:id', ...adminOnly, async (req, res) => {
  const targetId = req.params.id;

  // (1) Ön-törlés tiltása — az admin ne zárja ki magát véletlenül.
  if (targetId === req.user.sub) {
    return res.status(400).json({ error: 'Saját admin-fiókodat nem törölheted.' });
  }

  // (2) Aktív, FIZETETT vagy VITATOTT ügylet védelme (2026-08-08, átvizsgálás;
  // 2026-08-09-től a self-delete-tel közös helper). A user törlése kaszkádol:
  // a jobs.carrier_id SET NULL (a feladó fuvarja megmarad), DE a
  // carrier_routes.carrier_id CASCADE → a route_bookings.route_id CASCADE,
  // vagyis egy szállító törlése MÁS feladók fizetett foglalásait is törölné;
  // a vitás ügylet bizonyíték-zárolását pedig kiürítené. Előbb le kell zárni
  // (kézbesítés / lemondás / vita); terminál/fizetetlen ügyletnél szabad.
  if (await userHasBlockingDealings(targetId)) {
    return res.status(409).json({
      error: 'Ez a felhasználó folyamatban lévő, kifizetett vagy vitatott ügyletben szerepel. '
        + 'Előbb zárd le (kézbesítés / lemondás / vita), utána törölhető.',
      code: 'USER_HAS_ACTIVE_PAID',
    });
  }

  // ⚠️ SORREND (2026-08-09, audit): a fájl-kulcsokat a DB-sorok megléte
  // mellett gyűjtjük ki, a tényleges (visszafordíthatatlan) tárolóból-törlés
  // viszont csak a SIKERES DB-törlés után fut. Fordítva egy elhasalt DELETE
  // úgy hagyná ott a fiókot, hogy közben az okmányfotója már megsemmisült.
  const fileKeys = await collectUserFileKeys(targetId);

  const del = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [targetId]);
  if (del.rowCount === 0) return res.status(404).json({ error: 'Felhasználó nem található' });

  // GDPR 17. cikk — az R2-objektumok különben örökre árván maradnának.
  await purgeUserFiles(targetId, { keys: fileKeys });
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
  const { search } = req.query;
  let sql = `SELECT j.*, s.full_name AS shipper_name, s.email AS shipper_email,
                    c.full_name AS carrier_name
               FROM jobs j
               JOIN users s ON s.id = j.shipper_id
          LEFT JOIN users c ON c.id = j.carrier_id`;
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`j.status = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const i = params.length;
    where.push(`(j.title ILIKE $${i} OR s.email ILIKE $${i} OR s.full_name ILIKE $${i} OR c.full_name ILIKE $${i} OR j.id::text ILIKE $${i})`);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY j.created_at DESC LIMIT ${Math.min(Number(limit) || 50, 200)}`;
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

// DELETE /admin/jobs/:id — fuvar törlése
router.delete('/admin/jobs/:id', ...adminOnly, async (req, res) => {
  if (await jobIsActivePaid(req.params.id)) {
    return res.status(409).json({ error: ACTIVE_PAID_MSG, code: 'HAS_ACTIVE_PAID' });
  }
  const del = await db.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [req.params.id]);
  if (del.rowCount === 0) return res.status(404).json({ error: 'Fuvar nem található' });
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

// POST /admin/users/:id/force-logout — azonnali kijelentkeztetés minden
// eszközről: a token_version léptetése a user MINDEN kiadott JWT-jét
// érvényteleníti (048-as session-invalidáció mechanizmus).
router.post('/admin/users/:id/force-logout', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE users SET token_version = COALESCE(token_version, 0) + 1
      WHERE id = $1 RETURNING id, email`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'User nem található' });
  console.log(`[admin] force-logout: ${rows[0].id} (admin: ${req.user.sub})`);
  res.json({ ok: true });
});

// GET /admin/messages?job_id=|booking_id= — egy ügylet chatje (vitarendezési
// bizonyíték). Csak admin — a normál /messages végpont a feleké.
router.get('/admin/messages', ...adminOnly, async (req, res) => {
  const { job_id, booking_id } = req.query;
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Kell: job_id vagy booking_id.' });
  }
  // A felek PRIVÁT levelezésébe való betekintés — a legérzékenyebb admin-
  // művelet a KYC-fotó mellett. Naplózzuk, ki melyik ügylet chatjét nyitotta.
  logAdminAccess(req, 'chat_read', job_id
    ? { type: 'job', id: job_id }
    : { type: 'booking', id: booking_id });
  const { rows } = await db.query(
    `SELECT m.id, m.body, m.created_at, m.sender_id, u.full_name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE ${job_id ? 'm.job_id = $1' : 'm.booking_id = $1'}
      ORDER BY m.created_at ASC LIMIT 500`,
    [job_id || booking_id],
  );
  res.json(rows);
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
  if (await routeHasActivePaidBooking(req.params.id)) {
    return res.status(409).json({ error: ACTIVE_PAID_MSG, code: 'HAS_ACTIVE_PAID' });
  }
  const del = await db.query('DELETE FROM carrier_routes WHERE id = $1 RETURNING id', [req.params.id]);
  if (del.rowCount === 0) return res.status(404).json({ error: 'Járat nem található' });
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
  if (await bookingIsActivePaid(req.params.id)) {
    return res.status(409).json({ error: ACTIVE_PAID_MSG, code: 'HAS_ACTIVE_PAID' });
  }
  const del = await db.query('DELETE FROM route_bookings WHERE id = $1 RETURNING id', [req.params.id]);
  if (del.rowCount === 0) return res.status(404).json({ error: 'Foglalás nem található' });
  res.json({ ok: true });
});

// ===================== KYC DOKUMENTUMOK =====================

// GET /admin/kyc-documents — összes KYC dokumentum
router.get('/admin/kyc-documents', ...adminOnly, async (req, res) => {
  const { status = 'pending' } = req.query;
  // A válasz rövid életű ALÁÍRT linkeket ad a személyi igazolvány fotóihoz —
  // ez a legérzékenyebb hozzáférés a rendszerben, ezért naplózzuk.
  logAdminAccess(req, 'kyc_documents_list');
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
