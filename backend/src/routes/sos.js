// =====================================================================
//  SOS vészhelyzet végpontok.
//
//  Bármelyik fél (feladó vagy sofőr) egy gombnyomással jelezhet
//  vészhelyzetet. A rendszer logolja a GPS pozíciót, értesíti az
//  admint, és opcionálisan a fuvar másik résztvevőjét is.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../services/notifications');
const realtime = require('../realtime');

const router = express.Router();

// POST /sos — vészjelzés küldése
router.post('/sos', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, lat, lng, message } = req.body || {};

  const { rows } = await db.query(
    `INSERT INTO sos_events (user_id, job_id, booking_id, lat, lng, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      req.user.sub,
      job_id || null,
      booking_id || null,
      lat || null,
      lng || null,
      message || null,
    ],
  );
  const sos = rows[0];

  // Admin értesítés
  try {
    const { rows: admins } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 10`,
    );
    const { rows: userInfo } = await db.query(
      `SELECT full_name, phone FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const who = userInfo[0]?.full_name || 'Ismeretlen';
    const phone = userInfo[0]?.phone ? ` (${userInfo[0].phone})` : '';

    for (const admin of admins) {
      await createNotification({
        user_id: admin.id,
        type: 'sos_alert',
        title: '🚨 SOS VÉSZJELZÉS!',
        body: `${who}${phone} segítséget kér!${message ? ` Üzenet: "${message}"` : ''}${lat ? ` GPS: ${lat.toFixed(5)},${lng.toFixed(5)}` : ''}`,
        link: `/admin`,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[sos] admin notify hiba:', e.message);
  }

  // Ha van fuvar, értesítsük a másik felet is
  if (job_id) {
    try {
      const { rows: jobRows } = await db.query(
        `SELECT shipper_id, carrier_id, title FROM jobs WHERE id = $1`,
        [job_id],
      );
      const job = jobRows[0];
      if (job) {
        const otherId = job.shipper_id === req.user.sub ? job.carrier_id : job.shipper_id;
        if (otherId) {
          await createNotification({
            user_id: otherId,
            type: 'sos_partner_alert',
            title: '🚨 A partnered segítséget kér!',
            body: `A(z) "${job.title}" fuvarhoz kapcsolódó partnered vészjelzést küldött.${message ? ` Üzenet: "${message}"` : ''}`,
            link: job.shipper_id === req.user.sub
              ? `/sofor/fuvar/${job_id}`
              : `/dashboard/fuvar/${job_id}`,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[sos] partner notify hiba:', e.message);
    }
  }

  realtime.emitGlobal('sos:new', {
    sos_id: sos.id,
    user_id: req.user.sub,
    job_id: job_id || null,
    created_at: sos.created_at,
  });

  res.status(201).json({ ok: true, sos_id: sos.id });
});

// GET /sos/mine — saját SOS események
router.get('/sos/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM sos_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.sub],
  );
  res.json(rows);
});

module.exports = router;
