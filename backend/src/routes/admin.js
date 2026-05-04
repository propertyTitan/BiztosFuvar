// =====================================================================
//  Admin CRUD végpontok — teljes kontroll a platform felett.
//
//  Minden endpoint admin role-t igényel.
//  Funkciók: userek, fuvarok, licitek, útvonalak, foglalások kezelése.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = [authRequired, requireRole('admin')];

// ===================== FELHASZNÁLÓK =====================

// GET /admin/users — összes felhasználó
router.get('/admin/users', ...adminOnly, async (req, res) => {
  const { search, limit = 50 } = req.query;
  let sql = `SELECT id, email, full_name, phone, role, account_type,
                    identity_kyc_status, driver_kyc_status, company_verification_status,
                    rating_avg, rating_count, trust_score, level, created_at,
                    is_tow_driver, company_name
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
  res.json(rows);
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
