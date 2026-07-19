// Fuvar (Job) végpontok – létrehozás, listázás, lekérés.
// Real-time: új fuvar kreálásakor minden kliens értesül (`jobs:new`).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, requireDriverKYC } = require('../middleware/auth');
const { reviewJobDescription } = require('../services/gemini');
const { distanceMeters } = require('../utils/geo');
const { maskEmail } = require('../utils/mask');
const realtime = require('../realtime');
const paymentProvider = require('../services/paymentProvider');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendJobPaidEmail, sendCancellationEmail, sendFeeConfirmationEmail } = require('../services/email');
const { notifyNearbyCarriersOfInstantJob } = require('../services/instantJobs');
const { findBackhaulCandidates } = require('../services/backhaul');
const { calculateConnectionFee } = require('../services/connectionFee');
const { useVoucherIfAvailable } = require('../services/gamification');
const { maybeGrantReferralReward } = require('../services/referral');

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
 * (köztük a kijelölt szállító is) a `delivery_code: null` értéket kapja,
 * hogy ne tudja megkerülni az átadási kódot.
 *
 * A `tracking_token` szintén csak a feladóé/adminé: a publikus követőoldal
 * (amit a címzett SMS-ben kap) kiírja az átvételi kódot, így ha a szállító
 * hozzájutna a tokenhez, a kódvédelmet teljesen megkerülhetné.
 * A címzett elérhetőségei (PII) és a Barion-azonosítók csak a fuvar
 * feleinek járnak — egy licitálgató kívülállónak nem.
 */
function scrubJobForUser(job, user) {
  if (!job) return job;
  const isShipper = user?.sub === job.shipper_id;
  const isAdmin = user?.role === 'admin';
  if (isAdmin) return job;
  if (isShipper) {
    // Feladó látja a saját vészhelyzeti kódját, de a címzett kódját NEM
    const { delivery_code, ...rest } = job;
    return rest;
  }
  const {
    delivery_code, sender_delivery_code, tracking_token, ...rest
  } = job;
  if (user?.sub === job.carrier_id) {
    // Kijelölt szállító: kódok és token nélkül, de a címzett elérhetőségét
    // látja (kézbesítéskor hívnia kell tudni)
    return rest;
  }
  // Kívülálló (pl. licitálni készülő vagy vesztes szállító): címzett-PII,
  // Barion-adatok ÉS a fizetési státusz sem jár (BUG-038: a vesztes
  // licitálók élőben látták a nyertes tranzakció "Fizetésre vár →
  // FIZETVE" állapotát — semmi közük hozzá).
  const {
    recipient_name, recipient_phone, recipient_email,
    barion_payment_id, barion_gateway_url,
    paid_at, fee_consent_at, connection_fee_huf,
    photo_retention_hold, ...publicFields
  } = rest;
  return publicFields;
}

// POST /jobs – bárki feladhat fuvart (a szerepkör szeparálást eltöröltük;
// bárki egyaránt lehet feladó és szállító is). Rate limit: percenként max 30
// írás a `writeRateLimit`-en keresztül — bőven elég normál használatra,
// de botokat / spamet kilő.
// FELADÓI KYC KIVÉVE (2026-07-19, user-döntés): a feladónak nem kell
// személyi igazolvány — a spam ellen a kapcsolatfelvételi díj véd (aki
// fizet, az nem bot), az azonosítást a banki fizetés adja (QVIK/kártya).
// A szállítói oldal kapuja (requireDriverKYC a licitnél) változatlan.
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
    // Számlakérés
    invoice_requested,
    // Címzett adatai
    recipient_name,
    recipient_phone,
    recipient_email,
    // Forrás-bolt (Hozasd el): csak ismert boltnevet fogadunk el
    source_store,
    // Forrás termékkép (Hozasd el): a hirdetés OG-előnézeti képe
    source_image_url,
  } = req.body || {};

  // Forrás-bolt engedélylista — bármi mást figyelmen kívül hagyunk
  const ALLOWED_SOURCE_STORES = ['IKEA', 'OBI', 'Praktiker', 'Jófogás'];
  const sourceStoreClean = ALLOWED_SOURCE_STORES.includes(source_store) ? source_store : null;

  // Forrás termékkép: CSAK ismert bolti kép-CDN-ek https-URL-jét fogadjuk el.
  // Így nem lehet a mezőn keresztül tetszőleges / tracking / kártékony képet
  // beinjektálni, ami a szállító böngészőjében töltődne be.
  const ALLOWED_IMAGE_HOST_SUFFIXES = ['ikea.com', 'obi.hu', 'praktiker.hu', 'jofogas.hu'];
  let sourceImageClean = null;
  if (typeof source_image_url === 'string' && source_image_url.length <= 2000) {
    try {
      const iu = new URL(source_image_url);
      const host = iu.hostname.toLowerCase();
      const allowed = ALLOWED_IMAGE_HOST_SUFFIXES.some(
        (s) => host === s || host.endsWith('.' + s),
      );
      if (iu.protocol === 'https:' && allowed) sourceImageClean = iu.toString();
    } catch { /* érvénytelen URL → null marad */ }
  }

  // Alap kötelező mezők
  if (!title || !pickup_address || !dropoff_address ||
      pickup_lat == null || pickup_lng == null ||
      dropoff_lat == null || dropoff_lng == null) {
    return res.status(400).json({ error: 'Hiányzó kötelező mezők (cím / koordináták)' });
  }
  // Cím: trim után 3–120 karakter (TC-013/107 család: a csupa-szóköz és a
  // layout-törő végtelen string kiszűrése)
  const titleClean = typeof title === 'string' ? title.trim() : '';
  if (titleClean.length < 3 || titleClean.length > 120) {
    return res.status(400).json({ error: 'A fuvar címe 3–120 karakter legyen (nem állhat csak szóközből).' });
  }

  // Szolgáltatási terület ellenőrzés: legalább az egyik pontnak (pickup vagy dropoff)
  // aktív zónában kell lennie. Így Budapest → vidék is működik.
  const { isInCoverageZone } = require('../utils/coverage');
  if (!isInCoverageZone(pickup_lat, pickup_lng) && !isInCoverageZone(dropoff_lat, dropoff_lng)) {
    return res.status(403).json({
      error: 'Ez a cím Magyarországon kívül van. A GoFuvar jelenleg csak Magyarország területén működik.',
      code: 'OUTSIDE_COVERAGE',
    });
  }

  // Csomag-méretek kötelezők és pozitívak kell legyenek
  const L = Number(length_cm), W = Number(width_cm), H = Number(height_cm);
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(H) ||
      L <= 0 || W <= 0 || H <= 0) {
    return res.status(400).json({
      error: 'A csomag mérete kötelező: hosszúság, szélesség és magasság (cm), mind pozitív szám',
    });
  }
  // Felső korlát: efölött a volume_m3 (NUMERIC(8,2)) túlcsordulna a DB-ben és
  // 500-as szerverhiba lenne. 2000 cm = 20 m / oldal bőven elég bármilyen
  // valós csomaghoz; ennél nagyobb szám valószínűleg elgépelés vagy rossz egység.
  const MAX_DIM_CM = 2000;
  if (L > MAX_DIM_CM || W > MAX_DIM_CM || H > MAX_DIM_CM) {
    return res.status(400).json({
      error: 'A megadott méret irreálisan nagy. Add meg centiméterben — oldalanként legfeljebb 2000 cm (20 m).',
    });
  }

  // Súly kötelező – a szállító ez alapján tudja, befér-e a járműve össztömegébe
  const weightKg = Number(weight_kg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return res.status(400).json({
      error: 'A csomag súlya kötelező és pozitív kell legyen (kg)',
    });
  }
  // Felső korlát: a weight_kg NUMERIC(8,2), efölött túlcsordulna → 500. 100 tonna
  // bőven minden valós fuvar fölött van; ennél nagyobb szám elgépelés (pl. gramm).
  const MAX_WEIGHT_KG = 100000;
  if (weightKg > MAX_WEIGHT_KG) {
    return res.status(400).json({
      error: 'A megadott súly irreálisan nagy. Add meg kilogrammban — legfeljebb 100 000 kg.',
    });
  }

  // Ár / deklarált érték felső korlátja: ezek INTEGER oszlopok, irreálisan nagy
  // szám "value out of range for integer" 500-at okozna. 100 millió Ft bőven elég.
  const MAX_HUF = 100000000;
  const priceNum = suggested_price_huf != null && suggested_price_huf !== '' ? Number(suggested_price_huf) : null;
  if (priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > MAX_HUF)) {
    return res.status(400).json({
      error: 'A megadott ár érvénytelen vagy irreálisan magas (legfeljebb 100 000 000 Ft).',
    });
  }
  const declaredNum = declared_value_huf != null && declared_value_huf !== '' ? Number(declared_value_huf) : null;
  if (declaredNum != null && (!Number.isFinite(declaredNum) || declaredNum < 0 || declaredNum > MAX_HUF)) {
    return res.status(400).json({
      error: 'A megadott csomagérték irreálisan magas (legfeljebb 100 000 000 Ft).',
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

  // 6 jegyű átvételi kód: csak a feladó látja, a szállítónak az átvevő mondja meg
  const deliveryCode = generateDeliveryCode();
  // Feladó vészhelyzeti kód — eltérő a címzett kódjától
  let senderCode = generateDeliveryCode();
  while (senderCode === deliveryCode) senderCode = generateDeliveryCode();

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

  // Tracking token: egyedi, nem kitalálható, a címzett ezzel követi a fuvart
  const trackingToken = crypto.randomBytes(24).toString('base64url');

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
       declared_value_huf, invoice_requested,
       recipient_name, recipient_phone, recipient_email, tracking_token,
       sender_delivery_code, source_store, source_image_url
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'bidding',$19,NULL,NULL,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
     RETURNING *`,
    [
      req.user.sub, titleClean, description || null,
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
      declaredValueClean, !!invoice_requested,
      recipient_name || null, recipient_phone || null, recipient_email || null, trackingToken,
      senderCode, sourceStoreClean, sourceImageClean,
    ],
  );

  const job = rows[0];

  // A real-time `jobs:new` MINDEN csatlakozott kliensnek megy (io.emit),
  // beleértve a be nem jelentkezett vendégeket is — ezért a payloadot a
  // KÍVÜLÁLLÓ nézetére kell scrubbolni. A korábbi `{ delivery_code, ...rest }`
  // csak a kódot vette ki, de bennhagyta a címzett PII-ját (név/telefon/email),
  // a `tracking_token`-t (amivel a publikus követőoldalról kiolvasható lett
  // volna a kód) és a `sender_delivery_code`-ot. A `scrubJobForUser(job, null)`
  // ugyanazt a határt adja, mint a REST kívülálló-ág.
  realtime.emitGlobal('jobs:new', scrubJobForUser(job, null));

  console.log(`[delivery-code] job ${job.id}: átvételi kód generálva (feladó: ${maskEmail(req.user.email)})`);

  // A válaszban a kód látszik, mert a feladó most hozta létre a fuvart
  res.status(201).json(job);

  // --- Szállító útvonal-figyelők értesítése (email + in-app, SMS nincs) ---
  // Fire-and-forget: a választ már elküldtük, ez nem foghatja meg a UI-t.
  setImmediate(() => {
    const { notifyMatchingAlerts } = require('../services/laneAlerts');
    notifyMatchingAlerts(job).catch((e) => console.warn('[laneAlerts] hiba:', e.message));
  });

  // --- Címzett értesítése (CSAK email) a tracking linkkel ---
  // SMS-MODELL (2026-07-13, user-döntés): a címzett EGYETLEN SMS-t kap, a
  // csomag FELVÉTELEKOR (kód + szállító elérhetősége — photos.js pickup ág).
  // Feladáskor SMS nincs (szállító sincs még); email mehet, az ingyen van.
  if (recipient_email) {
    const baseUrl = process.env.PUBLIC_URL || 'https://gofuvar.hu';
    const trackingUrl = `${baseUrl}/nyomon-kovetes/${trackingToken}`;

    setImmediate(async () => {
      // Email küldés (ha van email + Resend API kulcs)
      if (recipient_email) {
        try {
          const { sendRecipientTrackingEmail } = require('../services/email');
          await sendRecipientTrackingEmail({
            to: recipient_email,
            recipientName: recipient_name,
            jobTitle: title,
            trackingUrl,
            deliveryCode,
          });
          console.log(`[recipient] értesítő email elküldve: ${maskEmail(recipient_email)}`);
        } catch (e) {
          console.warn('[recipient] email hiba:', e.message);
        }
      }
    });
  }

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

  // --- Azonnali fuvar: közeli szállítók push értesítése ---
  if (wantsInstant) {
    setImmediate(() => {
      notifyNearbyCarriersOfInstantJob(job).catch(() => {});
    });
  } else {
    // --- Klasszikus fuvarhoz: visszafuvar-push a passzoló szállítóknak ---
    // Az új fuvar pickup-ja lehet pont valakinek a visszaútja. Nézzük meg,
    // van-e olyan aktív szállító, akinek a jelenlegi (carrier_id=me) A→B
    // fuvarához ez visszafuvar lenne, és push-oljuk neki. Fire-and-forget.
    setImmediate(async () => {
      try {
        // Keresünk aktív szállítókat, akiknek a dropoff-ja közel van az új
        // fuvar pickup-jához ÉS a pickup-juk közel van az új fuvar dropoff-
        // jához. Ezt egyetlen SQL-lel: a meglévő findBackhaulCandidates
        // fordítottját implementáljuk itt, mivel az új job mondja ki a
        // "jelölt" állapotot, és mi a passzoló SZÁLLÍTÓKAT keressük.
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

// GET /jobs – nyitott fuvarok (szállítóknak), opcionálisan közelség alapján.
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
// A job_status enum összes érvényes értéke (db/schema.sql). Az enum oszlopra
// nem létező értéket (pl. ?status=open) küldve a Postgres "invalid input value
// for enum" hibát dob → 500 + Sentry-zaj. Ezért előbb whitelist-eljük.
const VALID_JOB_STATUSES = [
  'pending', 'bidding', 'accepted', 'in_progress',
  'delivered', 'completed', 'disputed', 'cancelled',
];

router.get('/', authRequired, async (req, res) => {
  const {
    status = 'bidding', lat, lng, radius_km,
    min_price, max_price, max_weight_kg, instant,
    pickup_city, dropoff_city,
  } = req.query;
  if (!VALID_JOB_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Érvénytelen státusz: "${status}".` });
  }
  let sql = `SELECT j.*,
       u.account_type AS shipper_account_type,
       u.company_name AS shipper_company_name,
       u.company_verification_status AS shipper_company_verified
  FROM jobs j
  JOIN users u ON u.id = j.shipper_id
  WHERE j.status = $1`;
  const params = [status];

  if (min_price) {
    params.push(Number(min_price));
    sql += ` AND j.suggested_price_huf >= $${params.length}`;
  }
  if (max_price) {
    params.push(Number(max_price));
    sql += ` AND j.suggested_price_huf <= $${params.length}`;
  }
  if (max_weight_kg) {
    params.push(Number(max_weight_kg));
    sql += ` AND j.weight_kg <= $${params.length}`;
  }

  // Város-szűrők: részszöveg-keresés a címmezőkön (ILIKE — "szeged" is
  // találja a "Szeged"-et). A % / _ LIKE-joker karaktereket kiszedjük,
  // hogy a minta csak azt találja, amit a user tényleg beírt.
  const cityPattern = (v) => `%${String(v).trim().slice(0, 80).replace(/[%_]/g, '')}%`;
  if (pickup_city && String(pickup_city).trim()) {
    params.push(cityPattern(pickup_city));
    sql += ` AND j.pickup_address ILIKE $${params.length}`;
  }
  if (dropoff_city && String(dropoff_city).trim()) {
    params.push(cityPattern(dropoff_city));
    sql += ` AND j.dropoff_address ILIKE $${params.length}`;
  }

  // ?instant=true → csak azonnali, még élő fuvarok (nem lejárt)
  // ?instant=false → csak licites (hagyományos) fuvarok
  if (instant === 'true') {
    sql += ` AND j.is_instant = TRUE AND (j.instant_expires_at IS NULL OR j.instant_expires_at > NOW())`;
  } else if (instant === 'false') {
    sql += ` AND j.is_instant = FALSE`;
  }

  sql += ' ORDER BY j.is_instant DESC, j.created_at DESC LIMIT 200';
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
    console.log(`[delivery-code] lusta generálás: job ${job.id} (kód nem naplózva)`);
  }

  const scrubbed = scrubJobForUser(job, req.user);

  // KONTAKT-FELFEDÉS — ez az, amit a kapcsolatfelvételi díj megvesz.
  // A másik fél neve + telefonszáma + emailje CSAK a díj megfizetése
  // (paid_at) UTÁN kerül a válaszba. Enélkül a felek csak a platformon
  // belüli chatben beszélhetnek (ahol a contactGuard szűri a számokat).
  if (job.paid_at && job.carrier_id) {
    const isShipper = req.user.sub === job.shipper_id;
    const isCarrier = req.user.sub === job.carrier_id;
    if (isShipper || isCarrier) {
      const otherId = isShipper ? job.carrier_id : job.shipper_id;
      const { rows: contactRows } = await db.query(
        `SELECT full_name, phone, email FROM users WHERE id = $1`,
        [otherId],
      );
      if (contactRows[0]) {
        scrubbed.contact = {
          role: isShipper ? 'carrier' : 'shipper',
          name: contactRows[0].full_name,
          phone: contactRows[0].phone,
          email: contactRows[0].email,
        };
      }
    }
  }

  res.json(scrubbed);
});

// GET /jobs/mine/list?as=posted|assigned – saját fuvarok
//   as=posted   → amiket ÉN adtam fel (shipper_id = me)
//   as=assigned → amiket ÉN teljesítek (carrier_id = me)
// Régebben a role alapján volt szűrve, de mióta bárki lehet feladó ÉS szállító is,
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
// Kapcsolatfelvételi díj fizetésének (lusta) indítása. Akkor hívjuk, amikor
// a feladó a fizetés gombra kattint a fuvar részletek oldalon.
//   - Ha már létezik escrow_transactions sor gateway_url-lel, azt adjuk
//     vissza (idempotens).
//   - Ha nincs, MOST hozzuk létre és eltároljuk.
// A díj a megállapodott ár sávja szerint számolódik (connectionFee service);
// a fuvardíj magát NEM itt fizetik — az készpénzben megy a szállítónak.
// Feladói KYC-kapu kivéve (2026-07-19) — a fizetés maga az azonosítás.
router.post('/:id/pay', authRequired, writeRateLimit, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            e.barion_gateway_url,
            e.barion_payment_id,
            s.email AS shipper_email
       FROM jobs j
  LEFT JOIN escrow_transactions e ON e.job_id = j.id
       JOIN users s ON s.id = j.shipper_id
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
      error: 'Csak elfogadott ajánlat után fizethető (státusz: ' + j.status + ')',
    });
  }
  if (j.paid_at) {
    return res.status(409).json({ error: 'A kapcsolatfelvételi díj már ki van fizetve ehhez a fuvarhoz.' });
  }

  // FOGYASZTÓVÉDELMI KAPU a fizetés INDÍTÁSAKOR: a feladó kifejezetten kéri
  // az azonnali teljesítést és tudomásul veszi az elállási jog elvesztését
  // (45/2014. 29. § (1) a)). Élesben a tényleges fizetés a Barion oldalán
  // történik, ezért a nyilatkozatot MÉG A REDIRECT ELŐTT rögzítjük.
  if (!j.fee_consent_at) {
    if (req.body?.consent !== true) {
      return res.status(400).json({
        error: 'A fizetéshez kérned kell az azonnali teljesítést és tudomásul venned, hogy a kapcsolatfelvételi adatok átadása után elállási jogod elvész.',
        code: 'CONSENT_REQUIRED',
      });
    }
    await db.query(
      `UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1 AND fee_consent_at IS NULL`,
      [j.id],
    );
  }

  const feeHuf = j.connection_fee_huf
    || calculateConnectionFee(j.accepted_price_huf || j.suggested_price_huf || 0);

  // Idempotens: ha már van gateway_url, csak visszaadjuk.
  if (j.barion_gateway_url) {
    return res.json({
      payment_id: j.barion_payment_id,
      gateway_url: j.barion_gateway_url,
      fee_huf: feeHuf,
      is_stub: String(j.barion_gateway_url).startsWith('stub:'),
      reused: true,
    });
  }

  // ── INGYEN FELADÁS: kupon beváltása (ajánlói program / szint-kupon) ──
  // Ha a feladónak van felhasználható kupon, és a díj a kupon plafonja
  // alatt van, a Barion-fizetést KIHAGYJUK: a kupon a teljes díjat
  // elengedi, a kontakt felfedődik, mintha fizetett volna (paid_at).
  const voucherUsed = await useVoucherIfAvailable(req.user.sub, { jobId: j.id, feeHuf });
  if (voucherUsed) {
    // Ingyen feladás: nincs pénzmozgás, ezért NEM keletkezik escrow-sor
    // (az amount_huf > 0 CHECK amúgy sem engedne 0 Ft-os díj-sort). A
    // kontakt-felfedés a paid_at-en múlik, a díj pedig 0.
    const { rows: upd } = await db.query(
      `UPDATE jobs SET connection_fee_huf = 0, paid_at = NOW()
        WHERE id = $1 AND paid_at IS NULL RETURNING paid_at`,
      [j.id],
    );
    if (upd[0] && j.carrier_id) {
      createNotification({
        user_id: j.carrier_id,
        type: 'job_paid',
        title: '🤝 A feladó megnyitotta a kapcsolatot',
        body: 'A feladó rendezte a kapcsolatfelvételi díjat — mostantól látjátok egymás elérhetőségét.',
        link: `/sofor/fuvar/${j.id}`,
      }).catch(() => {});
    }
    // A meghívott→ajánló jutalom-trigger (a feladó teljesítette az első díját).
    maybeGrantReferralReward(j.shipper_id, { role: 'shipper', jobId: j.id }).catch(() => {});
    return res.json({ ok: true, paid_via_voucher: true, fee_huf: 0, gateway_url: null });
  }

  let barionRes;
  try {
    barionRes = await paymentProvider.startFeePayment({
      jobId: j.id,
      feeHuf,
      shipperEmail: j.shipper_email,
    });
  } catch (err) {
    console.error('[barion] lusta startFeePayment (job) hiba:', err.message);
    return res.status(502).json({ error: 'A díjfizetés indítása sikertelen', detail: err.message });
  }

  await db.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
        carrier_share_huf, platform_share_huf)
     VALUES ($1,$2,'held',$3,$4,0,$2)
     ON CONFLICT (job_id) DO UPDATE SET
       amount_huf         = EXCLUDED.amount_huf,
       barion_payment_id  = EXCLUDED.barion_payment_id,
       barion_gateway_url = EXCLUDED.barion_gateway_url,
       carrier_share_huf  = 0,
       platform_share_huf = EXCLUDED.platform_share_huf,
       held_at            = NOW()`,
    [j.id, feeHuf, barionRes.paymentId, barionRes.gatewayUrl],
  );
  await db.query(
    `UPDATE jobs SET connection_fee_huf = $1 WHERE id = $2 AND connection_fee_huf IS NULL`,
    [feeHuf, j.id],
  );

  res.json({
    payment_id: barionRes.paymentId,
    gateway_url: barionRes.gatewayUrl,
    fee_huf: feeHuf,
    is_stub: !!barionRes.stub,
    reused: false,
  });
});

// POST /jobs/:id/confirm-payment
//
// A kapcsolatfelvételi díj sikeres fizetésének nyugtázása. CSAK STUB
// módban él (a `/fizetes-stub` oldal "Fizetek most" gombja hívja) — éles
// Barionnál a fizetés hiteles forrása a webhook (payments.js), ez a
// végpont ott 409-et ad, különben bárki fizetés nélkül nyithatná meg a
// kontaktot. Idempotens. Mit csinál:
//   1) Guard: a fizetés-indításkor rögzített beleegyezés (fee_consent_at)
//      megléte kötelező (45/2014. 29. § (1) a) — a /pay rögzíti)
//   2) `paid_at` beállítása, a díj-sor 'released'
//   3) Értesítés + díj-visszaigazoló email a feladónak
router.post('/:id/confirm-payment', authRequired, writeRateLimit, async (req, res) => {
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name,
            s.email AS shipper_email,
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
      error: 'Csak elfogadott ajánlat után fizethető (státusz: ' + j.status + ')',
    });
  }

  if (j.paid_at) {
    return res.json({ ok: true, already_paid: true, paid_at: j.paid_at });
  }

  // Éles Barion mellett a webhook a fizetés hiteles forrása — ezt a
  // kézi nyugtázást csak stub (teszt) módban engedjük.
  if (!paymentProvider.isStub()) {
    return res.status(409).json({
      error: 'A fizetést a Barion igazolja vissza automatikusan — kérjük, a fizetési oldalon fejezd be a fizetést.',
    });
  }

  if (!j.fee_consent_at) {
    return res.status(400).json({
      error: 'A fizetéshez kérned kell az azonnali teljesítést és tudomásul venned, hogy a kapcsolatfelvételi adatok átadása után elállási jogod elvész.',
      code: 'CONSENT_REQUIRED',
    });
  }

  const { rows: upd } = await db.query(
    `UPDATE jobs SET paid_at = NOW() WHERE id = $1 RETURNING paid_at`,
    [j.id],
  );
  const paidAt = upd[0].paid_at;

  // Ajánlói jutalom-trigger: a feladó most fizette az első kapcsolatfelvételi
  // díját → ha ő egy meghívott, az ajánlója kap egy ingyen-feladás kupont.
  maybeGrantReferralReward(j.shipper_id, { role: 'shipper', jobId: j.id }).catch(() => {});

  // A díj beérkezett és a szolgáltatás (kontakt-átadás) azonnal teljesül —
  // a könyvelési sor végleges ('released'), visszatérítés nincs.
  await db.query(
    `UPDATE escrow_transactions
        SET status = 'released', released_at = NOW()
      WHERE job_id = $1 AND status = 'held'`,
    [j.id],
  );

  // Díj-visszaigazolás a FELADÓNAK tartós adathordozón (45/2014. 18. §):
  // a megfizetett díj + a fizetéskor tett elállási nyilatkozat szövege.
  if (j.shipper_email) {
    setImmediate(() => {
      sendFeeConfirmationEmail({
        to: j.shipper_email,
        shipperName: j.shipper_name,
        jobTitle: j.title,
        feeHuf: j.connection_fee_huf || 0,
        cashHuf: j.accepted_price_huf,
        paidAtIso: paidAt,
        detailsPath: `/dashboard/fuvar/${j.id}`,
      }).catch((e) => console.warn('[email] fee_confirmation hiba:', e.message));
    });
  }

  // Értesítés a szállítónak (a licitet nyert carrier): in-app + email
  if (j.carrier_id) {
    try {
      await createNotification({
        user_id: j.carrier_id,
        type: 'job_paid',
        title: '🤝 Indulhat a fuvar!',
        body: `${j.shipper_name || 'A feladó'} kifizette a kapcsolatfelvételi díjat a(z) "${j.title}" fuvarhoz. Mostantól látjátok egymás elérhetőségét — a fuvardíjat (${(j.accepted_price_huf || 0).toLocaleString('hu-HU')} Ft) készpénzben kapod.`,
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

// A fuvar díjmentes újranyitása, amikor a KIVÁLASZTOTT SZÁLLÍTÓVAL hiúsul meg
// a fuvar (a szállító lemondja, vagy a feladó cseréli, mert nem elérhető).
// Készpénzes modell szabálya (ÁSZF): a kapcsolatfelvételi díj a FUVARRA
// szól — újraválasztásnál nem kell újra fizetni, de másik fuvarra nem
// vihető át. Mit csinál:
//   - a fuvar vissza 'bidding'-re, carrier_id törölve
//   - a meghiúsult szállító licitje 'rejected'
//   - az elfogadáskor tömegesen elutasított licitek vissza 'pending'-re,
//     hogy a feladó választhasson közülük
//   - paid_at + connection_fee_huf MARAD (a díj már teljesített kontakt-
//     átadást fedez, az újraválasztás díjmentes)
async function reopenJobForNewDriver(j, { failedCarrierId, reason }) {
  await db.query(
    `UPDATE jobs
        SET status = 'bidding',
            carrier_id = NULL,
            accepted_price_huf = NULL,
            reopened_count = reopened_count + 1,
            updated_at = NOW()
      WHERE id = $1 AND status = 'accepted'`,
    [j.id],
  );
  if (failedCarrierId) {
    await db.query(
      `UPDATE bids SET status = 'rejected' WHERE job_id = $1 AND carrier_id = $2`,
      [j.id, failedCarrierId],
    );
  }
  await db.query(
    `UPDATE bids SET status = 'pending'
      WHERE job_id = $1 AND status = 'rejected' AND carrier_id <> $2`,
    [j.id, failedCarrierId || '00000000-0000-0000-0000-000000000000'],
  );
  realtime.emitToJob(j.id, 'job:reopened', { job_id: j.id, reason: reason || null });
  realtime.emitGlobal('jobs:reopened', { job_id: j.id });
}

// POST /jobs/:id/cancel
//
// Licites fuvar lemondása. Bárki hívhatja, aki érdekelt fél:
//   - a feladó (shipper_id = me) VAGY
//   - a kijelölt szállító (carrier_id = me), ha már elfogadtuk a licitet.
//
// Készpénzes modell szabályai (2026-07-03):
//   - Ha a fuvar már `in_progress`/`delivered`/`completed`/`cancelled` →
//     nem lehet lemondani (későn érkezett).
//   - Pénzmozgás NINCS: a platform nem kezeli a fuvardíjat, a
//     kapcsolatfelvételi díj pedig nem visszatérítendő (ÁSZF + 45/2014.
//     Korm. r. 29. § (1) a) — a szolgáltatás a kontakt-átadással teljesült).
//   - Ha a SZÁLLÍTÓ mondja le az elfogadott fuvart → a fuvar NEM vész el:
//     díjmentesen újranyílik, a feladó a korábbi ajánlatokból választhat.
//   - Ha a FELADÓ mondja le → a fuvar 'cancelled'; a már befizetett díj
//     nem jár vissza és másik fuvarra nem vihető át.
router.post('/:id/cancel', authRequired, writeRateLimit, async (req, res) => {
  const { reason } = req.body || {};
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name, s.email AS shipper_email,
            c.full_name AS carrier_name, c.email AS carrier_email
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
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

  // === SZÁLLÍTÓ-LEMONDÁS elfogadott fuvaron → díjmentes újranyitás ===
  if (iAmCarrier && j.status === 'accepted') {
    await reopenJobForNewDriver(j, { failedCarrierId: j.carrier_id, reason });
    try {
      await createNotification({
        user_id: j.shipper_id,
        type: 'job_reopened',
        title: '🔁 A szállító visszalépett — válassz másikat!',
        body: `A szállító lemondta a(z) "${j.title}" fuvart. A korábbi ajánlatok újra elérhetők — díjmentesen választhatsz másik szállítót erre a fuvarra${paid ? ' (a befizetett kapcsolatfelvételi díjad erre a fuvarra érvényes marad)' : ''}.`,
        link: `/dashboard/fuvar/${j.id}`,
      });
    } catch (e) {
      console.warn('[notifications] job_reopened hiba:', e.message);
    }
    return res.json({ ok: true, status: 'bidding', reopened: true });
  }

  // === FELADÓ-LEMONDÁS (vagy szállító-lemondás nem-elfogadott állapotban) ===
  await db.query(
    `UPDATE jobs
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = $1,
            cancel_reason = $2,
            cancellation_fee_huf = 0,
            refund_huf = 0,
            updated_at = NOW()
      WHERE id = $3`,
    [req.user.sub, reason || null, j.id],
  );

  // Ha a díj-fizetés még függőben volt ('held' = elindított, de be nem
  // fejezett Barion-fizetés), zárjuk le refunded-ként, hogy a főkönyv ne
  // mutasson nyitott tételt. A már 'released' (befizetett) díjhoz nem
  // nyúlunk — az nem visszatérítendő.
  await db.query(
    `UPDATE escrow_transactions
        SET status = 'refunded', refunded_at = NOW()
      WHERE job_id = $1 AND status = 'held'`,
    [j.id],
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
          : `A szállító lemondta a(z) "${j.title}" fuvart.`,
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
          refundHuf: 0,
          feeHuf: 0,
          recipientIsShipper: !iAmShipper, // a "másik" fél, szóval ha én szállító vagyok, ő a feladó
        }).catch((e) => console.warn('[email] job_cancelled hiba:', e.message));
      });
    }
  }

  realtime.emitGlobal('jobs:cancelled', { job_id: j.id, cancelled_by: cancelledByRole });

  res.json({
    ok: true,
    status: 'cancelled',
    cancellation_fee_huf: 0,
    refund_huf: 0,
    // Őszinte visszajelzés a feladónak: a befizetett díj nem jár vissza
    fee_kept: paid && iAmShipper,
  });
});

// POST /jobs/:id/reopen — a FELADÓ szállítót cserél az elfogadott fuvaron
// (pl. a szállító nem elérhető / nem jelent meg). Díjmentes: a befizetett
// kapcsolatfelvételi díj erre a fuvarra érvényben marad, a korábbi licitek
// újra választhatók. Csak 'accepted' állapotban (in_progress-től már a
// vitarendezés a helyes út).
router.post('/:id/reopen', authRequired, writeRateLimit, async (req, res) => {
  const { reason } = req.body || {};
  const { rows } = await db.query(
    `SELECT j.*, c.full_name AS carrier_name
       FROM jobs j
  LEFT JOIN users c ON c.id = j.carrier_id
      WHERE j.id = $1`,
    [req.params.id],
  );
  const j = rows[0];
  if (!j) return res.status(404).json({ error: 'Fuvar nem található' });
  if (j.shipper_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a fuvar feladója cserélhet szállítót' });
  }
  if (j.status !== 'accepted') {
    return res.status(409).json({
      error: j.status === 'in_progress'
        ? 'A fuvar már folyamatban van — probléma esetén nyiss vitás esetet.'
        : `Szállító-csere csak elfogadott fuvaron lehetséges (státusz: ${j.status}).`,
    });
  }

  const failedCarrierId = j.carrier_id;
  await reopenJobForNewDriver(j, { failedCarrierId, reason });

  // A leváltott szállító értesítése
  if (failedCarrierId) {
    try {
      await createNotification({
        user_id: failedCarrierId,
        type: 'job_reopened',
        title: 'ℹ️ A feladó másik szállítót választ',
        body: `A feladó újranyitotta a(z) "${j.title}" fuvart${reason ? ` (indok: ${reason})` : ''}. Az ajánlatod lezárult.`,
        link: `/sofor/licitjeim`,
      });
    } catch (e) {
      console.warn('[notifications] job_reopened (carrier) hiba:', e.message);
    }
  }

  res.json({ ok: true, status: 'bidding', reopened: true });
});

// POST /jobs/:id/instant-accept
//
// Azonnali fuvar elfogadása. Nincs licit — a feladó fix árat ad meg, a
// jobs.suggested_price_huf lesz a végleges. Az ELSŐ szállító, aki elhívja ezt
// a végpontot, NYER, a többi 409-et kap.
//
// Ugyanazt csinálja, mint a licites elfogadás (escrow indítás, carrier_id
// beállítás, notifikációk), csak bid sor nélkül.
router.post('/:id/instant-accept', authRequired, requireDriverKYC, writeRateLimit, async (req, res) => {
  // Jogosítvány-követelmény megszűnt (2026-07-07): a requireDriverKYC
  // (személyi igazolvány + szállítói nyilatkozat) elég; a can_bid-kapu kivéve.

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
      if (!j.is_instant) return res.status(409).json({ error: 'Ez nem azonnali fuvar — tegyél ajánlatot helyette.' });
      if (j.shipper_id === req.user.sub) return res.status(403).json({ error: 'A saját fuvarodat nem fogadhatod el' });
      if (j.carrier_id) return res.status(409).json({ error: 'Sajnos elkelt — valaki más gyorsabb volt.' });
      if (j.instant_expires_at && new Date(j.instant_expires_at) < new Date()) {
        return res.status(410).json({ error: 'Az azonnali fuvar lejárt.' });
      }
      return res.status(409).json({ error: 'Nem fogadható el (állapot: ' + j.status + ')' });
    }

    const job = upd[0];

    // Ugyanaz a díj-flow, mint a licit elfogadásnál: kapcsolatfelvételi díj
    // a feladótól; a fuvardíj készpénzben megy a szállítónak.
    const { rows: partyRows } = await client.query(
      `SELECT s.email AS shipper_email, s.full_name AS shipper_name,
              c.email AS carrier_email, c.full_name AS carrier_name
         FROM users s, users c
        WHERE s.id = $1 AND c.id = $2`,
      [job.shipper_id, job.carrier_id],
    );
    const parties = partyRows[0] || {};

    const feeHuf = calculateConnectionFee(job.accepted_price_huf);
    let barionRes = { paymentId: null, gatewayUrl: null };
    try {
      barionRes = await paymentProvider.startFeePayment({
        jobId: job.id,
        feeHuf,
        shipperEmail: parties.shipper_email,
      });
    } catch (err) {
      console.error('[barion] instant startFeePayment hiba:', err.message);
      await client.query('ROLLBACK');
      return res.status(502).json({ error: 'A díjfizetés indítása sikertelen', detail: err.message });
    }

    await client.query(
      `UPDATE jobs SET connection_fee_huf = $1 WHERE id = $2`,
      [feeHuf, job.id],
    );
    await client.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
          carrier_share_huf, platform_share_huf)
       VALUES ($1,$2,'held',$3,$4,0,$2)
       ON CONFLICT (job_id) DO UPDATE SET
         amount_huf         = EXCLUDED.amount_huf,
         status             = 'held',
         barion_payment_id  = EXCLUDED.barion_payment_id,
         barion_gateway_url = EXCLUDED.barion_gateway_url,
         carrier_share_huf  = 0,
         platform_share_huf = EXCLUDED.platform_share_huf,
         held_at            = NOW()`,
      [job.id, feeHuf, barionRes.paymentId, barionRes.gatewayUrl],
    );

    await client.query('COMMIT');

    // Realtime: szóljon a feladónak és a globális feednek is, hogy a többi
    // szállító UI-ja azonnal ki tudja venni a listából az azonnali fuvart.
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
        title: '⚡ Szállító vállalta az azonnali fuvart!',
        body: `${parties.carrier_name || 'Egy szállító'} elvállalta a(z) "${job.title}" azonnali fuvart. Fizesd meg a kapcsolatfelvételi díjat — a fuvardíjat készpénzben adod a szállítónak.`,
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
      connection_fee_huf: feeHuf,
      barion: {
        payment_id: barionRes.paymentId,
        gateway_url: barionRes.gatewayUrl,
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
// A `jobs:new` socket-broadcast és a REST kívülálló-ág ezt a scrubot használja
// — exportáljuk, hogy a biztonsági tesztek közvetlenül őrizhessék a határt.
module.exports.scrubJobForUser = scrubJobForUser;
