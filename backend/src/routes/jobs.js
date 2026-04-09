// Fuvar (Job) végpontok – létrehozás, listázás, lekérés.
// Real-time: új fuvar kreálásakor minden kliens értesül (`jobs:new`).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { reviewJobDescription } = require('../services/gemini');
const { distanceMeters } = require('../utils/geo');
const realtime = require('../realtime');

const router = express.Router();

/**
 * 6 számjegyű átvételi kód generálása. Kriptográfiailag erős randommal.
 * 100000–999999 közötti szám, sztringként.
 */
function generateDeliveryCode() {
  // 0–899999 + 100000 → 100000–999999
  return String(100000 + (crypto.randomInt(0, 900000)));
}

/**
 * Egy job sort "tisztít meg" a kérő user szerepéhez.
 * A `delivery_code` CSAK a feladónak és az adminnak látható. Mindenki más
 * (köztük a kijelölt sofőr is) a `delivery_code: null` értéket kapja,
 * hogy ne tudja megkerülni az átadási kódot.
 */
function scrubJobForUser(job, user) {
  if (!job) return job;
  const isShipper = user?.sub === job.shipper_id;
  const isAdmin = user?.role === 'admin';
  if (isShipper || isAdmin) return job;
  const { delivery_code, ...rest } = job;
  return rest;
}

// POST /jobs – bárki feladhat fuvart (a szerepkör szeparálást eltöröltük;
// bárki egyaránt lehet feladó és sofőr is).
router.post('/', authRequired, async (req, res) => {
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

  // Súly kötelező – a sofőr ez alapján tudja, befér-e a járműve össztömegébe
  const weightKg = Number(weight_kg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return res.status(400).json({
      error: 'A csomag súlya kötelező és pozitív kell legyen (kg)',
    });
  }

  // Térfogat automatikus számítása: cm³ → m³
  const volumeM3 = +((L * W * H) / 1_000_000).toFixed(3);

  const distanceKm = +(distanceMeters(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng) / 1000).toFixed(2);

  // 6 jegyű átvételi kód: csak a feladó látja, a sofőrnek az átvevő mondja meg
  const deliveryCode = generateDeliveryCode();

  // FONTOS: a Gemini leírás-ellenőrzést NEM várjuk be a válasz előtt – ez
  // egy 2–5 mp-es külső hívás, ami feleslegesen megfogná a user UI-ját
  // ("network timeout"-ot is okozhat lassú csatolásnál). Először beszúrjuk
  // a job-ot `ai_description_ok = NULL` értékkel, majd fire-and-forget
  // elindítjuk a review-t, és amikor megjön, UPDATE-eljük a sort.
  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       distance_km, weight_kg, volume_m3,
       length_cm, width_cm, height_cm,
       suggested_price_huf,
       pickup_window_start, pickup_window_end,
       status, delivery_code, ai_description_ok, ai_description_notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'bidding',$19,NULL,NULL)
     RETURNING *`,
    [
      req.user.sub, title, description || null,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      distanceKm, weightKg, volumeM3,
      L, W, H,
      suggested_price_huf || null,
      pickup_window_start || null, pickup_window_end || null,
      deliveryCode,
    ],
  );

  const job = rows[0];

  // A real-time `jobs:new` event-ből vegyük ki a kódot, a sofőrök ne lássák
  const { delivery_code: _omit, ...publicJob } = job;
  realtime.emitGlobal('jobs:new', publicJob);

  // Stub "email-küldés": jelenleg csak naplózunk. Éles rendszerben itt
  // küldenénk el emailt / SMS-t a feladónak, de a kód a UI-n is látszik.
  console.log(`[delivery-code] job ${job.id} kódja: ${deliveryCode} (feladó: ${req.user.email})`);

  // A válaszban a kód látszik, mert a feladó most hozta létre a fuvart
  res.status(201).json(job);

  // --- Fire-and-forget AI review ---
  // A válasz már elment a kliensnek, itt már csak a háttérben dolgozunk.
  // Hibát nyugodtan elnyelhetünk, mert az ai_description_ok csak tájékoztató.
  setImmediate(() => {
    reviewJobDescription(title, description)
      .then((review) =>
        db.query(
          `UPDATE jobs SET ai_description_ok = $1, ai_description_notes = $2 WHERE id = $3`,
          [review.ok, review.notes || review.reason || null, job.id],
        ),
      )
      .catch((err) => {
        console.warn('[gemini] description review hiba:', err.message);
      });
  });
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
  // A delivery_code-ot csak a saját feladóra engedjük át
  res.json(jobs.map((j) => scrubJobForUser(j, req.user)));
});

// GET /jobs/:id
router.get('/:id', authRequired, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Nem található' });
  res.json(scrubJobForUser(rows[0], req.user));
});

// GET /jobs/mine/list?as=posted|assigned – saját fuvarok
//   as=posted   → amiket ÉN adtam fel (shipper_id = me)
//   as=assigned → amiket ÉN teljesítek (carrier_id = me)
// Régebben a role alapján volt szűrve, de mióta bárki lehet feladó ÉS sofőr is,
// az `as` paraméter dönti el, milyen szemszögből kérjük a listát.
router.get('/mine/list', authRequired, async (req, res) => {
  const as = (req.query.as === 'assigned') ? 'assigned' : 'posted';
  const col = as === 'assigned' ? 'carrier_id' : 'shipper_id';
  const { rows } = await db.query(
    `SELECT * FROM jobs WHERE ${col} = $1 ORDER BY created_at DESC`,
    [req.user.sub],
  );
  res.json(rows.map((j) => scrubJobForUser(j, req.user)));
});

module.exports = router;
