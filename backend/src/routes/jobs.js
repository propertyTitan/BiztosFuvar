// Fuvar (Job) végpontok – létrehozás, listázás, lekérés.
// Real-time: új fuvar kreálásakor minden kliens értesül (`jobs:new`).
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { reviewJobDescription } = require('../services/gemini');
const { distanceMeters } = require('../utils/geo');
const realtime = require('../realtime');

const router = express.Router();

// POST /jobs – feladó hirdetést ad fel
router.post('/', authRequired, requireRole('shipper'), async (req, res) => {
  const {
    title, description,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    weight_kg, suggested_price_huf,
    length_cm, width_cm, height_cm,
    pickup_window_start, pickup_window_end,
  } = req.body || {};

  // Alap kötelező mezők
  if (!title || !pickup_address || !dropoff_address ||
      pickup_lat == null || pickup_lng == null ||
      dropoff_lat == null || dropoff_lng == null) {
    return res.status(400).json({ error: 'Hiányzó kötelező mezők (cím / koordináták)' });
  }

  // Csomag-méretek kötelezők és pozitívak kell legyenek
  const L = Number(length_cm), W = Number(width_cm), H = Number(height_cm);
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(H) ||
      L <= 0 || W <= 0 || H <= 0) {
    return res.status(400).json({
      error: 'A csomag mérete kötelező: hosszúság, szélesség és magasság (cm), mind pozitív szám',
    });
  }

  // Térfogat automatikus számítása: cm³ → m³
  const volumeM3 = +((L * W * H) / 1_000_000).toFixed(3);

  const distanceKm = +(distanceMeters(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) / 1000).toFixed(2);

  // AI: leírás-ellenőrzés (nem blokkoló hibára)
  let aiOk = null, aiNotes = null;
  try {
    const review = await reviewJobDescription(title, description);
    aiOk = review.ok;
    aiNotes = review.notes || review.reason || null;
  } catch (err) {
    console.warn('[gemini] description review hiba:', err.message);
  }

  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       distance_km, weight_kg, volume_m3,
       length_cm, width_cm, height_cm,
       suggested_price_huf,
       pickup_window_start, pickup_window_end,
       status, ai_description_ok, ai_description_notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'bidding',$19,$20)
     RETURNING *`,
    [
      req.user.sub, title, description || null,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      distanceKm, weight_kg || null, volumeM3,
      L, W, H,
      suggested_price_huf || null,
      pickup_window_start || null, pickup_window_end || null,
      aiOk, aiNotes,
    ],
  );

  const job = rows[0];
  realtime.emitGlobal('jobs:new', job); // sofőrök azonnal látják
  res.status(201).json(job);
});

// GET /jobs – nyitott fuvarok (sofőröknek), opcionálisan közelség alapján
router.get('/', authRequired, async (req, res) => {
  const { status = 'bidding', lat, lng, radius_km } = req.query;
  const { rows } = await db.query(
    `SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
    [status],
  );
  let jobs = rows;
  if (lat && lng) {
    const la = parseFloat(lat), ln = parseFloat(lng);
    jobs = jobs
      .map((j) => ({
        ...j,
        distance_to_pickup_km: +(distanceMeters(la, ln, j.pickup_lat, j.pickup_lng) / 1000).toFixed(2),
      }))
      .filter((j) => !radius_km || j.distance_to_pickup_km <= parseFloat(radius_km))
      .sort((a, b) => a.distance_to_pickup_km - b.distance_to_pickup_km);
  }
  res.json(jobs);
});

// GET /jobs/:id
router.get('/:id', authRequired, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Nem található' });
  res.json(rows[0]);
});

// GET /jobs/mine/list – saját fuvarok (shipper vagy carrier)
router.get('/mine/list', authRequired, async (req, res) => {
  const col = req.user.role === 'carrier' ? 'carrier_id' : 'shipper_id';
  const { rows } = await db.query(
    `SELECT * FROM jobs WHERE ${col} = $1 ORDER BY created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

module.exports = router;
