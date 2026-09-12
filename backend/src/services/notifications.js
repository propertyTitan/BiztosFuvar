// Értesítés-létrehozás helper + REST végpontok.
//
// A `createNotification` függvényt hívják a routes (jobs, bids,
// carrierRoutes, photos) az esemény-pillanatukban. Szándékosan soha
// nem dob hibát: ha a notif beszúrás elhasal, azt csak naplózzuk,
// hogy ne törjön meg az eredeti tranzakció (pl. egy licit elfogadás).
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const realtime = require('../realtime');
const { sendPushToUser } = require('./push');

const router = express.Router();

/**
 * Létrehoz egy értesítést a megadott usernek, és ha el van indítva
 * a Socket.IO, azonnal push-olja neki is.
 */
async function createNotification({ user_id, type, title, body = null, link = null }) {
  if (!user_id || !type || !title) {
    console.warn('[notifications] hiányos adat:', { user_id, type, title });
    return null;
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user_id, type, title, body, link],
    );
    const notif = rows[0];
    realtime.emitToUser(user_id, 'notification:new', notif);
    // Push notification: fire-and-forget, nem blokkolja az eredeti hívást
    setImmediate(() => {
      sendPushToUser(user_id, { title, body: body || '', data: { link, type } })
        .catch(() => {});
    });
    return notif;
  } catch (err) {
    // Riasztás (2026-09-11, teljes audit A3): az in-app értesítés a harang és
    // a push forrása — ha a beszúrás elhasal, a felhasználó SEMMIT nem lát
    // az eseményről (fizetés, elfogadás, vita), és eddig ez csak a
    // Railway-logban látszott.
    console.error('[notifications] beszúrás hiba:', err.message);
    try {
      require('@sentry/node').captureException(err, {
        tags: { csatorna: 'notification', tipus: String(type) },
      });
    } catch { /* a riasztás hibája sosem érintheti a hívót */ }
    return null;
  }
}

// ---------- REST végpontok ----------

// GET /notifications – a bejelentkezett user összes értesítése, újak előre
router.get('/notifications', authRequired, async (req, res) => {
  // Lapozás kurzorral (2026-09-11, C2): `?before=<ISO>` a régebbiekhez —
  // eddig a 100. értesítés után a régebbiek elérhetetlenek voltak.
  const before = typeof req.query.before === 'string' && !Number.isNaN(new Date(req.query.before).getTime())
    ? new Date(req.query.before).toISOString() : null;
  const { rows } = await db.query(
    `SELECT * FROM notifications
      WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      ORDER BY created_at DESC
      LIMIT 100`,
    [req.user.sub, before],
  );
  res.json(rows);
});

// GET /notifications/unread-count – gyors badge számláló a header-hez
router.get('/notifications/unread-count', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM notifications
      WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.sub],
  );
  res.json({ count: rows[0].count });
});

// POST /notifications/:id/read – egy értesítés olvasottra állítása
router.post('/notifications/:id/read', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE notifications
        SET read_at = NOW()
      WHERE id = $1 AND user_id = $2
    RETURNING *`,
    [req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található' });
  res.json(rows[0]);
});

// POST /notifications/read-all – összes olvasottra állítása
router.post('/notifications/read-all', authRequired, async (req, res) => {
  await db.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.sub],
  );
  res.json({ ok: true });
});

module.exports = { router, createNotification };
