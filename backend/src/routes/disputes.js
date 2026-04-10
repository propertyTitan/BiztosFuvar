// Dispute (vita / reklamáció) végpontok.
//
// Bármelyik fél nyithat disputot egy fuvarra vagy foglalásra:
//   POST /disputes         — megnyitás (description + opcionális evidence_url)
//   GET  /disputes/mine    — a saját nyitott viták
//   GET  /disputes/:id     — egy vita részletei
//   PATCH /disputes/:id    — admin döntés (resolve)
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const realtime = require('../realtime');
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendEmail, wrapHtml, formatHuf } = require('../services/email');

const router = express.Router();

// POST /disputes — vita megnyitása
router.post('/disputes', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, description, evidence_url } = req.body || {};
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'A vita leírása kötelező.' });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg egy fuvar (job_id) vagy foglalás (booking_id) azonosítót.' });
  }

  // Jogosultság: a vitát csak az érintett felek nyithatják
  let againstUser = null;
  if (job_id) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id FROM jobs WHERE id = $1',
      [job_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
    const j = rows[0];
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultságod vitát nyitni ezen a fuvaron.' });
    }
    againstUser = j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id;
  }
  if (booking_id) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, r.carrier_id
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [booking_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foglalás nem található' });
    const b = rows[0];
    if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultságod vitát nyitni ezen a foglaláson.' });
    }
    againstUser = b.shipper_id === req.user.sub ? b.carrier_id : b.shipper_id;
  }

  // Duplázat-ellenőrzés: ne lehessen ugyanarra az entitásra kétszer nyitni
  const existingCheck = job_id
    ? await db.query(
        `SELECT id FROM disputes WHERE job_id = $1 AND status NOT IN ('resolved_refund','resolved_no_action','resolved_partial','closed')`,
        [job_id],
      )
    : await db.query(
        `SELECT id FROM disputes WHERE booking_id = $1 AND status NOT IN ('resolved_refund','resolved_no_action','resolved_partial','closed')`,
        [booking_id],
      );
  if (existingCheck.rows.length > 0) {
    return res.status(409).json({
      error: 'Erre az entitásra már van nyitott vita. Várd meg az admin döntését.',
      existing_dispute_id: existingCheck.rows[0].id,
    });
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO disputes (job_id, booking_id, opened_by, against_user, description, evidence_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [job_id || null, booking_id || null, req.user.sub, againstUser, description.trim(), evidence_url || null],
  );
  const dispute = inserted[0];

  // Ha a fuvar/booking státuszát is "disputed"-re állítjuk
  if (job_id) {
    await db.query(`UPDATE jobs SET status = 'disputed', updated_at = NOW() WHERE id = $1`, [job_id]);
  }
  if (booking_id) {
    await db.query(`UPDATE route_bookings SET status = 'disputed' WHERE id = $1`, [booking_id]);
  }

  // Értesítés a másik félnek
  if (againstUser) {
    try {
      const { rows: opener } = await db.query(
        'SELECT full_name FROM users WHERE id = $1',
        [req.user.sub],
      );
      await createNotification({
        user_id: againstUser,
        type: 'dispute_opened',
        title: '⚖️ Vitás eset megnyitva',
        body: `${opener[0]?.full_name || 'Egy felhasználó'} vitát indított: "${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"`,
        link: `/ertesitesek`,
      });
    } catch (e) {
      console.warn('[notifications] dispute_opened hiba:', e.message);
    }
  }

  res.status(201).json(dispute);
});

// GET /disputes/mine — a saját nyitott viták
router.get('/disputes/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*,
            j.title AS job_title,
            r.title AS route_title,
            u.full_name AS against_name
       FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN route_bookings rb ON rb.id = d.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
  LEFT JOIN users u ON u.id = d.against_user
      WHERE d.opened_by = $1 OR d.against_user = $1
      ORDER BY d.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// GET /disputes/:id
router.get('/disputes/:id', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*,
            j.title AS job_title,
            r.title AS route_title,
            opener.full_name AS opened_by_name,
            against.full_name AS against_name
       FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN route_bookings rb ON rb.id = d.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
  LEFT JOIN users opener ON opener.id = d.opened_by
  LEFT JOIN users against ON against.id = d.against_user
      WHERE d.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vita nem található' });
  const d = rows[0];
  // Jogosultság: érintett felek + admin
  if (d.opened_by !== req.user.sub && d.against_user !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  res.json(d);
});

// PATCH /disputes/:id — admin döntés
// body: { status, resolution_note, refund_huf }
router.patch('/disputes/:id', authRequired, writeRateLimit, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak admin oldhatja meg a vitákat.' });
  }
  const { status, resolution_note, refund_huf } = req.body || {};
  const allowed = ['under_review', 'resolved_refund', 'resolved_no_action', 'resolved_partial', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen státusz' });
  }

  const isResolved = status.startsWith('resolved_') || status === 'closed';
  const { rows } = await db.query(
    `UPDATE disputes
        SET status = $1,
            resolution_note = COALESCE($2, resolution_note),
            refund_huf = COALESCE($3, refund_huf),
            resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
            resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
            updated_at = NOW()
      WHERE id = $6
    RETURNING *`,
    [status, resolution_note || null, refund_huf || 0, isResolved, req.user.sub, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vita nem található' });
  const d = rows[0];

  // Notifikáció mindkét félnek
  const users = [d.opened_by, d.against_user].filter(Boolean);
  for (const uid of users) {
    try {
      await createNotification({
        user_id: uid,
        type: isResolved ? 'dispute_resolved' : 'dispute_updated',
        title: isResolved ? '⚖️ Vitás eset lezárva' : '⚖️ Vitás eset frissítve',
        body: resolution_note
          ? `Admin döntés: ${resolution_note.slice(0, 120)}`
          : `A vita státusza: ${status}`,
        link: `/ertesitesek`,
      });
    } catch {}
  }

  res.json(d);
});

module.exports = router;
