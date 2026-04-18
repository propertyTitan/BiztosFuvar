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
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendJobPaidEmail, sendCancellationEmail } = require('../services/email');
const { notifyNearbyCarriersOfInstantJob } = require('../services/instantJobs');
const { findBackhaulCandidates } = require('../services/backhaul');

const router = express.Router();

// Azonnali fuvar (is_instant) lejárati ideje alapból: most + 30 perc.
// A feladó felülírhatja, de 5 perc alatt és 4 óra felett nem engedjük.
const INSTANT_DEFAULT_MINUTES = 30;
const INSTANT_MIN_MINUTES = 5;
const INSTANT_MAX_MINUTES = 240;

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
// bárki egyaránt lehet feladó és sofőr is). Rate limit: percenként max 30
// írás a `writeRateLimit`-en keresztül — bőven elég normál használatra,
// de botokat / spamet kilő.
router.post('/', authRequired, writeRateLimit, async (req, res) => {
  const {
    title, description,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    weight_kg, suggested_price_huf,
    length_cm, width_cm, height_cm,
    pickup_window_start, pickup_window_end,
    // Azonnali fuvar paraméterek (opcionális)
    is_instant,
    instant_radius_km,
    instant_duration_minutes,
    // Bepakolás / cipelés infó
    pickup_needs_carrying,
    pickup_floor,
    pickup_has_elevator,
    dropoff_needs_carrying,
    dropoff_floor,
    dropoff_has_elevator,
    // Csomag deklarált értéke
    declared_value_huf,
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

  // --- Azonnali fuvar (is_instant) validáció ---
  // Az instant fuvarnál nincs licit: a suggested_price_huf a VÉGSŐ ár.
  // Ezért ezeknél kötelező egy értelmes összeg.
  const wantsInstant = !!is_instant;
  let instantExpiresAt = null;
  let instantRadiusKm = null;
  if (wantsInstant) {
    const price = Number(suggested_price_huf);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({
        error: 'Azonnali fuvarnál a fix ár (suggested_price_huf) kötelező és pozitív kell legyen.',
      });
    }
    const minutes = Number.isFinite(Number(instant_duration_minutes))
      ? Math.max(INSTANT_MIN_MINUTES, Math.min(INSTANT_MAX_MINUTES, Number(instant_duration_minutes)))
      : INSTANT_DEFAULT_MINUTES;
    instantExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const rKm = Number(instant_radius_km);
    instantRadiusKm = Number.isFinite(rKm) && rKm > 0 && rKm <= 100 ? Math.round(rKm) : 20;
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
  // Bepakolás/cipelés mezők: floor 0-10, boolean-ök.
  const pCarry = !!pickup_needs_carrying;
  const pFloor = pCarry ? Math.max(0, Math.min(10, Number(pickup_floor) || 0)) : 0;
  const pLift  = pCarry ? !!pickup_has_elevator : false;
  const dCarry = !!dropoff_needs_carrying;
  const dFloor = dCarry ? Math.max(0, Math.min(10, Number(dropoff_floor) || 0)) : 0;
  const dLift  = dCarry ? !!dropoff_has_elevator : false;

  const declaredVal = Number(declared_value_huf);
  const declaredValueClean = Number.isFinite(declaredVal) && declaredVal > 0 ? Math.round(declaredVal) : null;

  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       distance_km, weight_kg, volume_m3,
       length_cm, width_cm, height_cm,
       suggested_price_huf,
       pickup_window_start, pickup_window_end,
       status, delivery_code, ai_description_ok, ai_description_notes,
       is_instant, instant_radius_km, instant_expires_at,
       pickup_needs_carrying, pickup_floor, pickup_has_elevator,
       dropoff_needs_carrying, dropoff_floor, dropoff_has_elevator,
       declared_value_huf
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'bidding',$19,NULL,NULL,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
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
      wantsInstant, instantRadiusKm, instantExpiresAt,
      pCarry, pFloor, pLift,
      dCarry, dFloor, dLift,
      declaredValueClean,
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

  // --- Azonnali fuvar: közeli sofőrök push értesítése ---
  if (wantsInstant) {
    setImmediate(() => {
      notifyNearbyCarriersOfInstantJob(job).catch(() => {});
    });
  } else {
    // --- Klasszikus fuvarhoz: visszafuvar-push a passzoló sofőröknek ---
    // Az új fuvar pickup-ja lehet pont valakinek a visszaútja. Nézzük meg,
    // van-e olyan aktív sofőr, akinek a jelenlegi (carrier_id=me) A→B
    // fuvarához ez visszafuvar lenne, és push-oljuk neki. Fire-and-forget.
    setImmediate(async () => {
      try {
        // Keresünk aktív sofőröket, akiknek a dropoff-ja közel van az új
        // fuvar pickup-jához ÉS a pickup-juk közel van az új fuvar dropoff-
        // jához. Ezt egyetlen SQL-lel: a meglévő findBackhaulCandidates
        // fordítottját implementáljuk itt, mivel az új job mondja ki a
        // "jelölt" állapotot, és mi a passzoló SOFŐRÖKET keressük.
        const { rows: activeTrips } = await db.query(
          `SELECT DISTINCT carrier_id,
                  pickup_lat, pickup_lng,
                  dropoff_lat, dropoff_lng
             FROM jobs
            WHERE carrier_id IS NOT NULL
              AND status IN ('accepted', 'in_progress')`,
        );
        // JS oldali távolság-szűrés — aktív fuvar ritkán több száz, ez
        // tökéletes. Nagyobb skálán ebből SQL-alapú geo query lesz.
        const { distanceMeters } = require('../utils/geo');
        const RADIUS_KM = 30;
        const notified = new Set();
        for (const t of activeTrips) {
          if (notified.has(t.carrier_id)) continue;
          const pickupNearB_km = distanceMeters(
            t.dropoff_lat, t.dropoff_lng, job.pickup_lat, job.pickup_lng,
          ) / 1000;
          const dropNearA_km = distanceMeters(
            t.pickup_lat, t.pickup_lng, job.dropoff_lat, job.dropoff_lng,
          ) / 1000;
          if (pickupNearB_km <= RADIUS_KM && dropNearA_km <= RADIUS_KM) {
            await createNotification({
              user_id: t.carrier_id,
              type: 'backhaul_match',
              title: '🔄 Visszafuvar lehetőség!',
              body: `Egy új fuvar passzol a visszaútadra: "${job.title}".`,
              link: `/sofor/visszafuvar`,
            }).catch(() => {});
            notified.add(t.carrier_id);
          }
        }
      } catch (err) {
        console.warn('[backhaul] új-fuvar push hiba:', err.message);
      }
    });
  }
});

// GET /jobs – nyitott fuvarok (sofőröknek), opcionálisan közelség alapján.
// A saját feladások is megjelennek a listában — de a frontend letiltja
// rajtuk a licit-akciót és "Saját poszt" címkével látja el őket, hogy
// egyértelmű legyen. (A szerver oldali védelem a `POST /jobs/:id/bids`
// végpontban: saját fuvarra nem lehet licitálni.)
//
// Szűrők (query paraméterek):
//   ?status=bidding (default)
//   ?lat=...&lng=...&radius_km=...
//   ?min_price=...&max_price=...   — javasolt ár szűrés
//   ?max_weight_kg=...             — max csomag súly
//   ?max_size=S|M|L|XL            — max méret kategória (TODO)
router.get('/', authRequired, async (req, res) => {
  const { status = 'bidding', lat, lng, radius_km, min_price, max_price, max_weight_kg, instant } = req.query;
  let sql = 'SELECT * FROM jobs WHERE status = $1';
  const params = [status];

  if (min_price) {
    params.push(Number(min_price));
    sql += ` AND suggested_price_huf >= $${params.length}`;
  }
  if (max_price) {
    params.push(Number(max_price));
    sql += ` AND suggested_price_huf <= $${params.length}`;
  }
  if (max_weight_kg) {
    params.push(Number(max_weight_kg));
    sql += ` AND weight_kg <= $${params.length}`;
  }

  // ?instant=true → csak azonnali, még élő fuvarok (nem lejárt)
  // ?instant=false → csak licites (hagyományos) fuvarok
  if (instant === 'true') {
    sql += ` AND is_instant = TRUE AND (instant_expires_at IS NULL OR instant_expires_at > NOW())`;
  } else if (instant === 'false') {
    sql += ` AND is_instant = FALSE`;
  }

  sql += ' ORDER BY is_instant DESC, created_at DESC LIMIT 200';
  const { rows } = await db.query(sql, params);
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
  const job = rows[0];

  // Ha a fuvarnak NINCS delivery_code-ja (régebbi fuvarnál előfordulhat),
  // és a status accepted+ → most generálunk egyet és elmentjük. Így a
  // feladó MINDIG lát egy 6 jegyű kódot amint a licit elfogadva van.
  if (!job.delivery_code && ['accepted', 'in_progress'].includes(job.status)) {
    const newCode = generateDeliveryCode();
    await db.query(
      `UPDATE jobs SET delivery_code = $1 WHERE id = $2 AND delivery_code IS NULL`,
      [newCode, job.id],
    );
    job.delivery_code = newCode;
    console.log(`[delivery-code] lusta generálás: job ${job.id} → ${newCode}`);
  }

  res.json(scrubJobForUser(job, req.user));
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
router.post('/:id/pay', authRequired, writeRateLimit, async (req, res) => {
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
router.post('/:id/confirm-payment', authRequired, writeRateLimit, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name,
            c.full_name AS carrier_name,
            c.email AS carrier_email
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
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

  // Értesítés a sofőrnek (a licitet nyert carrier): in-app + email
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
    if (j.carrier_email) {
      setImmediate(() => {
        sendJobPaidEmail({
          to: j.carrier_email,
          carrierName: j.carrier_name,
          jobTitle: j.title,
          jobId: j.id,
          amountHuf: j.accepted_price_huf,
          shipperName: j.shipper_name,
        }).catch((e) => console.warn('[email] job_paid hiba:', e.message));
      });
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

// POST /jobs/:id/cancel
//
// Licites fuvar lemondása. Bárki hívhatja, aki érdekelt fél:
//   - a feladó (shipper_id = me) VAGY
//   - a kijelölt sofőr (carrier_id = me), ha már elfogadtuk a licitet.
//
// Szabályok:
//   - Ha a fuvar már `in_progress`/`delivered`/`completed`/`cancelled` →
//     nem lehet lemondani (későn érkezett).
//   - Ha még nincs kifizetve, egyszerűen `status='cancelled'` + notif.
//   - Ha ki van fizetve és a FELADÓ mondja le → 10% díj (max 1000 Ft),
//     a maradék refund Barion-on keresztül.
//   - Ha a SOFŐR mondja le → 100% refund a feladónak.
router.post('/:id/cancel', authRequired, writeRateLimit, async (req, res) => {
  const { reason } = req.body || {};
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name, s.email AS shipper_email,
            c.full_name AS carrier_name, c.email AS carrier_email,
            e.barion_payment_id
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
  LEFT JOIN escrow_transactions e ON e.job_id = j.id
      WHERE j.id = $1`,
    [req.params.id],
  );
  const j = rows[0];
  if (!j) return res.status(404).json({ error: 'Fuvar nem található' });

  const iAmShipper = j.shipper_id === req.user.sub;
  const iAmCarrier = j.carrier_id && j.carrier_id === req.user.sub;
  if (!iAmShipper && !iAmCarrier) {
    return res.status(403).json({ error: 'Nincs jogosultság a lemondáshoz' });
  }

  const blockedStatuses = ['in_progress', 'delivered', 'completed', 'cancelled'];
  if (blockedStatuses.includes(j.status)) {
    return res.status(409).json({
      error:
        j.status === 'cancelled'
          ? 'Ez a fuvar már le van mondva.'
          : `Ez a fuvar már nem mondható le (státusz: ${j.status}). Vitás esetben nyiss egy reklamációt.`,
    });
  }

  const cancelledByRole = iAmShipper ? 'shipper' : 'carrier';
  const paid = !!j.paid_at;
  const total = j.accepted_price_huf || 0;
  const { fee, refund } = barion.computeCancellationSettlement({
    totalHuf: total,
    paid,
    cancelledByRole,
  });

  // Ha már volt fizetés és a sofőr már dolgozik rajta: Barion refund.
  // STUB módban ez csak log, éles üzemben a Payment/Refund API.
  if (paid && refund > 0 && j.barion_payment_id) {
    try {
      await barion.refundPayment({
        paymentId: j.barion_payment_id,
        jobId: j.id,
        refundAmountHuf: refund,
        reason: reason || `Fuvar lemondva (${cancelledByRole})`,
      });
    } catch (err) {
      console.error('[barion] refund hiba:', err.message);
      return res.status(502).json({ error: 'A visszatérítés sikertelen, próbáld később.' });
    }
  }

  await db.query(
    `UPDATE jobs
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = $1,
            cancel_reason = $2,
            cancellation_fee_huf = $3,
            refund_huf = $4,
            updated_at = NOW()
      WHERE id = $5`,
    [req.user.sub, reason || null, fee, refund, j.id],
  );

  // Notifikáció a másik félnek (in-app + email)
  const otherUserId = iAmShipper ? j.carrier_id : j.shipper_id;
  const otherEmail = iAmShipper ? j.carrier_email : j.shipper_email;
  const otherName = iAmShipper ? j.carrier_name : j.shipper_name;
  if (otherUserId) {
    try {
      await createNotification({
        user_id: otherUserId,
        type: 'job_cancelled',
        title: '❌ Fuvar lemondva',
        body: iAmShipper
          ? `A feladó lemondta a(z) "${j.title}" fuvart.`
          : `A sofőr lemondta a(z) "${j.title}" fuvart. A teljes fuvardíj visszajár.`,
        link: `/dashboard/fuvar/${j.id}`,
      });
    } catch (e) {
      console.warn('[notifications] job_cancelled hiba:', e.message);
    }
    if (otherEmail) {
      setImmediate(() => {
        sendCancellationEmail({
          to: otherEmail,
          recipientName: otherName,
          jobTitle: j.title,
          cancelledByRole,
          refundHuf: refund,
          feeHuf: fee,
          recipientIsShipper: !iAmShipper, // a "másik" fél, szóval ha én sofőr vagyok, ő a feladó
        }).catch((e) => console.warn('[email] job_cancelled hiba:', e.message));
      });
    }
  }

  // A user saját magának is kaphasson visszajelzést (pl. a feladó
  // visszalátja mennyit kap vissza)
  if (paid && iAmShipper && refund > 0) {
    try {
      await createNotification({
        user_id: j.shipper_id,
        type: 'refund_issued',
        title: '💸 Visszatérítés folyamatban',
        body: `${refund.toLocaleString('hu-HU')} Ft visszautalás indult${fee > 0 ? ` (${fee.toLocaleString('hu-HU')} Ft lemondási díj levonva)` : ''}.`,
        link: `/hirdeteseim`,
      });
    } catch {}
  }

  realtime.emitGlobal('jobs:cancelled', { job_id: j.id, cancelled_by: cancelledByRole });

  res.json({
    ok: true,
    status: 'cancelled',
    cancellation_fee_huf: fee,
    refund_huf: refund,
  });
});

// POST /jobs/:id/instant-accept
//
// Azonnali fuvar elfogadása. Nincs licit — a feladó fix árat ad meg, a
// jobs.suggested_price_huf lesz a végleges. Az ELSŐ sofőr, aki elhívja ezt
// a végpontot, NYER, a többi 409-et kap.
//
// Ugyanazt csinálja, mint a licites elfogadás (escrow indítás, carrier_id
// beállítás, notifikációk), csak bid sor nélkül.
router.post('/:id/instant-accept', authRequired, writeRateLimit, async (req, res) => {
  // KYC: lejárt jogosítvány → nem fogadhatja el
  const { rows: kyc } = await db.query(
    `SELECT can_bid FROM users WHERE id = $1`, [req.user.sub],
  );
  if (kyc[0] && kyc[0].can_bid === false) {
    return res.status(403).json({
      error: 'A jogosítványod lejárt vagy nincs jóváhagyva. Frissítsd a profilodon.',
      code: 'LICENSE_EXPIRED',
    });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Atomi FIRST-WINS: csak akkor frissítünk, ha még senki nem fogadta el.
    // Több feltétel a WHERE-ben: is_instant=TRUE, status=bidding, még nincs
    // carrier_id, és nincs lejárva. Ha 0 sor frissült → valaki megelőzte.
    const { rows: upd } = await client.query(
      `UPDATE jobs
          SET status             = 'accepted',
              carrier_id         = $1,
              accepted_price_huf = suggested_price_huf,
              instant_accepted_at = NOW(),
              updated_at         = NOW()
        WHERE id = $2
          AND is_instant = TRUE
          AND status = 'bidding'
          AND carrier_id IS NULL
          AND shipper_id <> $1
          AND (instant_expires_at IS NULL OR instant_expires_at > NOW())
      RETURNING *`,
      [req.user.sub, req.params.id],
    );

    if (!upd[0]) {
      await client.query('ROLLBACK');
      // Megnézzük: egyáltalán létezik-e az azonnali fuvar és miért nem ment?
      const { rows: check } = await db.query(
        `SELECT id, is_instant, status, carrier_id, shipper_id, instant_expires_at
           FROM jobs WHERE id = $1`,
        [req.params.id],
      );
      const j = check[0];
      if (!j) return res.status(404).json({ error: 'Fuvar nem található' });
      if (!j.is_instant) return res.status(409).json({ error: 'Ez nem azonnali fuvar — licitálj helyette.' });
      if (j.shipper_id === req.user.sub) return res.status(403).json({ error: 'A saját fuvarodat nem fogadhatod el' });
      if (j.carrier_id) return res.status(409).json({ error: 'Sajnos elkelt — valaki más gyorsabb volt.' });
      if (j.instant_expires_at && new Date(j.instant_expires_at) < new Date()) {
        return res.status(410).json({ error: 'Az azonnali fuvar lejárt.' });
      }
      return res.status(409).json({ error: 'Nem fogadható el (állapot: ' + j.status + ')' });
    }

    const job = upd[0];

    // Ugyanaz az escrow init, mint a licit elfogadásnál: Barion Reservation.
    const { rows: partyRows } = await client.query(
      `SELECT s.email AS shipper_email, s.full_name AS shipper_name,
              c.email AS carrier_email, c.full_name AS carrier_name
         FROM users s, users c
        WHERE s.id = $1 AND c.id = $2`,
      [job.shipper_id, job.carrier_id],
    );
    const parties = partyRows[0] || {};

    let barionRes = { paymentId: null, gatewayUrl: null };
    try {
      barionRes = await barion.reservePayment({
        jobId: job.id,
        totalHuf: job.accepted_price_huf,
        shipperEmail: parties.shipper_email,
        carrierEmail: parties.carrier_email,
      });
    } catch (err) {
      console.error('[barion] instant reservePayment hiba:', err.message);
      await client.query('ROLLBACK');
      return res.status(502).json({ error: 'Barion foglalás sikertelen', detail: err.message });
    }

    const carrierShare = Math.round(job.accepted_price_huf * (1 - barion.COMMISSION_PCT));
    const platformShare = job.accepted_price_huf - carrierShare;

    await client.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
          carrier_share_huf, platform_share_huf)
       VALUES ($1,$2,'held',$3,$4,$5,$6)
       ON CONFLICT (job_id) DO UPDATE SET
         amount_huf         = EXCLUDED.amount_huf,
         status             = 'held',
         barion_payment_id  = EXCLUDED.barion_payment_id,
         barion_gateway_url = EXCLUDED.barion_gateway_url,
         carrier_share_huf  = EXCLUDED.carrier_share_huf,
         platform_share_huf = EXCLUDED.platform_share_huf,
         held_at            = NOW()`,
      [job.id, job.accepted_price_huf, barionRes.paymentId, barionRes.gatewayUrl, carrierShare, platformShare],
    );

    await client.query('COMMIT');

    // Realtime: szóljon a feladónak és a globális feednek is, hogy a többi
    // sofőr UI-ja azonnal ki tudja venni a listából az azonnali fuvart.
    realtime.emitToUser(job.shipper_id, 'job:accepted', {
      job_id: job.id,
      carrier_id: job.carrier_id,
      amount_huf: job.accepted_price_huf,
      barion_gateway_url: barionRes.gatewayUrl,
      is_instant: true,
    });
    realtime.emitGlobal('jobs:instant-taken', {
      job_id: job.id,
      carrier_id: job.carrier_id,
    });

    // Értesítés a feladónak (in-app)
    try {
      await createNotification({
        user_id: job.shipper_id,
        type: 'instant_accepted',
        title: '⚡ Sofőr vállalta az azonnali fuvart!',
        body: `${parties.carrier_name || 'Egy sofőr'} elvállalta a(z) "${job.title}" azonnali fuvart. Fizess a Barion oldalon.`,
        link: `/dashboard/fuvar/${job.id}`,
      });
    } catch (e) {
      console.warn('[notifications] instant_accepted hiba:', e.message);
    }

    res.json({
      ok: true,
      job_id: job.id,
      carrier_id: job.carrier_id,
      amount_huf: job.accepted_price_huf,
      barion: {
        payment_id: barionRes.paymentId,
        gateway_url: barionRes.gatewayUrl,
        carrier_share_huf: carrierShare,
        platform_share_huf: platformShare,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
