// Fuvar (Job) végpontok – létrehozás, listázás, lekérés.
// Real-time: új fuvar kreálásakor minden kliens értesül (`jobs:new`).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { reviewJobDescription } = require('../services/gemini');
const { distanceMeters } = require('../utils/geo');
const realtime = require('../realtime');
const barion = require('../services/barion');
const { createNotification } = require('../services/notifications');

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
// A válasz tartalmazza a Barion gateway_url-t is (az escrow_transactions
// táblából JOIN-olva), hogy a frontend egyszerűen eldönthesse, van-e már
// aktív fizetés-lehetőség. A `paid_at` pedig eleve a jobs soron van.
router.get('/:id', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            e.barion_gateway_url,
            e.barion_payment_id
       FROM jobs j
  LEFT JOIN escrow_transactions e ON e.job_id = j.id
      WHERE j.id = $1`,
    [req.params.id],
  );
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

// POST /jobs/:id/pay
//
// Lusta Barion reservation a licites fuvarhoz. Akkor hívjuk, amikor a
// feladó a "Fizetés Barionnal" gombra kattint a fuvar részletek oldalon.
//   - Ha már létezik escrow_transactions sor gateway_url-lel, azt adjuk
//     vissza (idempotens).
//   - Ha nincs (pl. az accept régebbi kóddal futott, amikor még nem volt
//     reservation), MOST hozzuk létre, eltároljuk az escrow sorra, és
//     visszaadjuk az új URL-t.
//
// Ugyanaz a minta, mint a `/route-bookings/:id/pay`-nél.
router.post('/:id/pay', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            e.barion_gateway_url,
            e.barion_payment_id,
            s.email AS shipper_email,
            c.email AS carrier_email
       FROM jobs j
  LEFT JOIN escrow_transactions e ON e.job_id = j.id
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
      WHERE j.id = $1`,
    [req.params.id],
  );
  const j = rows[0];
  if (!j) return res.status(404).json({ error: 'Fuvar nem található' });
  if (j.shipper_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a fuvar feladója fizethet' });
  }
  if (j.status !== 'accepted') {
    return res.status(409).json({
      error: 'Csak elfogadott licit után fizethető (státusz: ' + j.status + ')',
    });
  }
  const totalHuf = j.accepted_price_huf;
  if (!totalHuf) {
    return res.status(409).json({ error: 'Hiányzik az elfogadott ár' });
  }

  // Idempotens: ha már van gateway_url, csak visszaadjuk.
  if (j.barion_gateway_url) {
    return res.json({
      payment_id: j.barion_payment_id,
      gateway_url: j.barion_gateway_url,
      is_stub: String(j.barion_gateway_url).startsWith('stub:'),
      reused: true,
    });
  }

  let barionRes;
  try {
    barionRes = await barion.reservePayment({
      jobId: j.id,
      totalHuf,
      shipperEmail: j.shipper_email,
      carrierEmail: j.carrier_email,
    });
  } catch (err) {
    console.error('[barion] lusta reservePayment (job) hiba:', err.message);
    return res.status(502).json({ error: 'Barion foglalás sikertelen', detail: err.message });
  }

  const carrierShare = Math.round(totalHuf * (1 - barion.COMMISSION_PCT));
  const platformShare = totalHuf - carrierShare;

  await db.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
        carrier_share_huf, platform_share_huf)
     VALUES ($1,$2,'held',$3,$4,$5,$6)
     ON CONFLICT (job_id) DO UPDATE SET
       amount_huf         = EXCLUDED.amount_huf,
       barion_payment_id  = EXCLUDED.barion_payment_id,
       barion_gateway_url = EXCLUDED.barion_gateway_url,
       carrier_share_huf  = EXCLUDED.carrier_share_huf,
       platform_share_huf = EXCLUDED.platform_share_huf,
       held_at            = NOW()`,
    [j.id, totalHuf, barionRes.paymentId, barionRes.gatewayUrl, carrierShare, platformShare],
  );

  res.json({
    payment_id: barionRes.paymentId,
    gateway_url: barionRes.gatewayUrl,
    is_stub: !!barionRes.stub,
    reused: false,
  });
});

// POST /jobs/:id/confirm-payment
//
// Sikeres fizetés nyugtázása. STUB módban a `/fizetes-stub` oldal
// "Fizetek most" gombja hívja; valódi Barion mellett a callback fogja.
// Idempotens. Mit csinál:
//   1) `paid_at` beállítása a jobs soron
//   2) Értesítés a sofőrnek: "Péter kifizette a fuvarodat"
//   3) Realtime event mindkét félnek (`job:paid`), hogy a UI frissüljön
router.post('/:id/confirm-payment', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
      WHERE j.id = $1`,
    [req.params.id],
  );
  const j = rows[0];
  if (!j) return res.status(404).json({ error: 'Fuvar nem található' });
  if (j.shipper_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a fuvar feladója nyugtázhatja a fizetést' });
  }
  if (j.status !== 'accepted') {
    return res.status(409).json({
      error: 'Csak elfogadott licit után fizethető (státusz: ' + j.status + ')',
    });
  }

  if (j.paid_at) {
    return res.json({ ok: true, already_paid: true, paid_at: j.paid_at });
  }

  const { rows: upd } = await db.query(
    `UPDATE jobs SET paid_at = NOW() WHERE id = $1 RETURNING paid_at`,
    [j.id],
  );
  const paidAt = upd[0].paid_at;

  // Értesítés a sofőrnek (a licitet nyert carrier)
  if (j.carrier_id) {
    try {
      await createNotification({
        user_id: j.carrier_id,
        type: 'job_paid',
        title: '💰 Kifizették a fuvarodat!',
        body: `${j.shipper_name || 'A feladó'} kifizette a(z) "${j.title}" fuvart ${j.accepted_price_huf.toLocaleString('hu-HU')} Ft értékben.`,
        link: `/sofor/fuvar/${j.id}`,
      });
    } catch (e) {
      console.warn('[notifications] job_paid hiba:', e.message);
    }
    realtime.emitToUser(j.carrier_id, 'job:paid', {
      job_id: j.id,
      paid_at: paidAt,
    });
  }
  realtime.emitToUser(j.shipper_id, 'job:paid', {
    job_id: j.id,
    paid_at: paidAt,
  });

  res.json({ ok: true, paid_at: paidAt });
});

module.exports = router;
