// Kedvenc sofőrök — a feladó megjelölheti a jó sofőröket.
// Következő fuvar feladásnál a kedvencek prioritásos push-t kapnak.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// POST /favorites/:driverId — kedvencnek jelölés
router.post('/favorites/:driverId', authRequired, writeRateLimit, async (req, res) => {
  if (req.params.driverId === req.user.sub) {
    return res.status(400).json({ error: 'Saját magadat nem jelölheted kedvencnek' });
  }
  try {
    await db.query(
      `INSERT INTO favorite_drivers (user_id, driver_id) VALUES ($1, $2)
       ON CONFLICT (user_id, driver_id) DO NOTHING`,
      [req.user.sub, req.params.driverId],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Hiba a mentésnél' });
  }
});

// DELETE /favorites/:driverId — kedvenc törlése
router.delete('/favorites/:driverId', authRequired, async (req, res) => {
  await db.query(
    `DELETE FROM favorite_drivers WHERE user_id = $1 AND driver_id = $2`,
    [req.user.sub, req.params.driverId],
  );
  res.json({ ok: true });
});

// GET /favorites — a bejelentkezett user kedvenc sofőrjei
router.get('/favorites', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT f.driver_id, f.created_at,
            u.full_name, u.avatar_url, u.vehicle_type,
            u.rating_avg, u.rating_count, u.trust_score
       FROM favorite_drivers f
       JOIN users u ON u.id = f.driver_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// GET /favorites/check/:driverId — kedvenc-e ez a sofőr?
router.get('/favorites/check/:driverId', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT 1 FROM favorite_drivers WHERE user_id = $1 AND driver_id = $2`,
    [req.user.sub, req.params.driverId],
  );
  res.json({ isFavorite: rows.length > 0 });
});

module.exports = router;
