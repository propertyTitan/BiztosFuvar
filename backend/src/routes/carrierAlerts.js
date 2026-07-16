// =====================================================================
//  Szállító útvonal-figyelők (lane alerts) CRUD.
//  A szállító beállíthat figyelőket; új illeszkedő fuvarnál email + in-app
//  értesítést kap (lásd services/laneAlerts.js).
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { geocodeAddress } = require('../services/geocode');

const router = express.Router();

const MAX_ALERTS_PER_CARRIER = 10;

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GET /carrier-alerts — a bejelentkezett szállító figyelői
router.get('/carrier-alerts', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM carrier_alerts WHERE carrier_id = $1 ORDER BY created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// POST /carrier-alerts — új figyelő
router.post('/carrier-alerts', authRequired, writeRateLimit, async (req, res) => {
  const {
    label, from_lat, from_lng, from_label,
    to_lat, to_lng, to_label, radius_km,
    min_price_huf, max_weight_kg,
  } = req.body || {};

  // Felvételi környék: elsődlegesen a klienstől kapott koordináta (cím-
  // kiegészítőből). Kényelmi tartalék: ha csak szöveget írt be (from_label)
  // koordináta nélkül, szerveroldalon geokódoljuk.
  let fromLat = num(from_lat);
  let fromLng = num(from_lng);
  let fromLabelFinal = from_label || null;
  if (fromLat == null || fromLng == null) {
    if (!from_label || !String(from_label).trim()) {
      return res.status(400).json({ error: 'A felvételi környék megadása kötelező (írj be egy várost vagy válassz a listából).' });
    }
    const g = await geocodeAddress(from_label);
    if (!g) {
      return res.status(400).json({ error: `Nem ismertük fel a felvételi helyet ("${from_label}"). Próbáld a listából kiválasztani.` });
    }
    fromLat = g.lat; fromLng = g.lng;
    fromLabelFinal = from_label;
  }

  // Célterület: opcionális. Ha csak szöveget kaptunk koordináta nélkül,
  // azt is geokódoljuk; ha nem ismerjük fel, szólunk (nem dobjuk el némán).
  let toLat = num(to_lat);
  let toLng = num(to_lng);
  let toLabelFinal = to_label || null;
  if ((toLat == null || toLng == null) && to_label && String(to_label).trim()) {
    const g = await geocodeAddress(to_label);
    if (!g) {
      return res.status(400).json({ error: `Nem ismertük fel a célterületet ("${to_label}"). Próbáld a listából kiválasztani, vagy hagyd üresen.` });
    }
    toLat = g.lat; toLng = g.lng;
    toLabelFinal = to_label;
  }

  const radius = Math.max(1, Math.min(300, num(radius_km) || 25));

  // Darabszám-korlát: ne lehessen vég nélkül figyelőt gyártani
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM carrier_alerts WHERE carrier_id = $1`,
    [req.user.sub],
  );
  if (countRows[0].n >= MAX_ALERTS_PER_CARRIER) {
    return res.status(400).json({ error: `Legfeljebb ${MAX_ALERTS_PER_CARRIER} útvonal-figyelőd lehet. Törölj egyet előbb.` });
  }

  const { rows } = await db.query(
    `INSERT INTO carrier_alerts
       (carrier_id, label, from_lat, from_lng, from_label, to_lat, to_lng, to_label,
        radius_km, min_price_huf, max_weight_kg)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      req.user.sub, label || null, fromLat, fromLng, fromLabelFinal,
      toLat, toLng, toLabelFinal,
      radius, num(min_price_huf), num(max_weight_kg),
    ],
  );
  res.status(201).json(rows[0]);
});

// PATCH /carrier-alerts/:id — ki-/bekapcsolás (active)
router.patch('/carrier-alerts/:id', authRequired, async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Csak az "active" mező módosítható (true/false).' });
  }
  const { rows } = await db.query(
    `UPDATE carrier_alerts SET active = $1
      WHERE id = $2 AND carrier_id = $3
      RETURNING *`,
    [active, req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Figyelő nem található.' });
  res.json(rows[0]);
});

// DELETE /carrier-alerts/:id
router.delete('/carrier-alerts/:id', authRequired, async (req, res) => {
  const { rowCount } = await db.query(
    `DELETE FROM carrier_alerts WHERE id = $1 AND carrier_id = $2`,
    [req.params.id, req.user.sub],
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Figyelő nem található.' });
  res.json({ ok: true });
});

module.exports = router;
