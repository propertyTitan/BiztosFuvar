// In-app üzenetváltás feladó ↔ sofőr között.
//
// A "beszélgetés" egy fuvarhoz (job_id) vagy foglaláshoz (booking_id)
// kötődik. Mindkét érintett fél küldhet és olvashat üzeneteket. A
// backend a beérkező üzenetet Socket.IO-n is kiszórja, így a chat
// valós idejű.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const realtime = require('../realtime');
const { writeRateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../services/notifications');

const router = express.Router();

/**
 * Jogosultság-ellenőrzés: a user érintett fél-e az adott
 * job-ban vagy booking-ban.
 */
async function checkAccess(req, jobId, bookingId) {
  if (jobId) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id FROM jobs WHERE id = $1',
      [jobId],
    );
    const j = rows[0];
    if (!j) return null;
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) return null;
    return { jobId, bookingId: null, otherUserId: j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id };
  }
  if (bookingId) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, r.carrier_id
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) return null;
    if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub) return null;
    return { jobId: null, bookingId, otherUserId: b.shipper_id === req.user.sub ? b.carrier_id : b.shipper_id };
  }
  return null;
}

// POST /messages – üzenet küldése
router.post('/messages', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, body } = req.body || {};
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Üres üzenet' });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg job_id-t vagy booking_id-t.' });
  }

  const access = await checkAccess(req, job_id, booking_id);
  if (!access) {
    return res.status(403).json({ error: 'Nincs jogosultságod üzenetet küldeni ezen a fuvaron.' });
  }

  const { rows } = await db.query(
    `INSERT INTO messages (job_id, booking_id, sender_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [access.jobId, access.bookingId, req.user.sub, body.trim()],
  );
  const msg = rows[0];

  // Küldő neve
  const { rows: senderRows } = await db.query(
    'SELECT full_name FROM users WHERE id = $1',
    [req.user.sub],
  );
  const senderName = senderRows[0]?.full_name || 'Valaki';

  // Socket.IO: szórjuk mindkét félnek a szobájukba
  const roomKey = job_id ? `chat:job:${job_id}` : `chat:booking:${booking_id}`;
  realtime.emitGlobal(roomKey, {
    ...msg,
    sender_name: senderName,
  });

  // Értesítés a másik félnek (ha van)
  if (access.otherUserId) {
    try {
      await createNotification({
        user_id: access.otherUserId,
        type: 'chat_message',
        title: `💬 Új üzenet – ${senderName}`,
        body: body.trim().slice(0, 100),
        link: job_id ? `/dashboard/fuvar/${job_id}` : `/dashboard/foglalasaim`,
      });
    } catch {}
  }

  res.status(201).json({ ...msg, sender_name: senderName });
});

// GET /messages?job_id=... vagy ?booking_id=...
router.get('/messages', authRequired, async (req, res) => {
  const { job_id, booking_id } = req.query;
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg job_id-t vagy booking_id-t.' });
  }

  const access = await checkAccess(req, job_id || null, booking_id || null);
  if (!access) {
    return res.status(403).json({ error: 'Nincs jogosultság.' });
  }

  const col = job_id ? 'job_id' : 'booking_id';
  const val = job_id || booking_id;
  const { rows } = await db.query(
    `SELECT m.*, u.full_name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.${col} = $1
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [val],
  );

  res.json(rows);
});

module.exports = router;
