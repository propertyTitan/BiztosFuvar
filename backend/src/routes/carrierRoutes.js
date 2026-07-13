// Sofőri útvonal-hirdetések + feladói foglalások.
//
// A fájl neve "carrierRoutes.js", hogy ne keveredjen össze az Express
// "router" fogalmával. Az URL-ekben /carrier-routes és /route-bookings
// formát használunk.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, requireDriverKYC } = require('../middleware/auth');
const { PACKAGE_SIZES, classifyPackage } = require('../constants');
const barion = require('../services/barion');
const { calculateConnectionFee } = require('../services/connectionFee');
const realtime = require('../realtime');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');
const { findJobsAlongRoute } = require('../services/routeAlong');
const {
  sendBookingReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingPaidEmail,
  sendBookingRejectedEmail,
  sendCancellationEmail,
  sendFeeConfirmationEmail,
} = require('../services/email');

const router = express.Router();

// Az :id uuid — nem-uuid érték a query előtt 400-zal elbukik (a PATCH/:id
// saját catch-blokkja egyébként elnyelné a Postgres uuid-hibát 500-ként).
const { uuidParam } = require('../middleware/validateParams');

// Foglalás-scrub — a jobs.js `scrubJobForUser` mintájára. A `delivery_code`
// és a `tracking_token` CSAK a feladóé/adminé: a publikus követőoldal a
// tokenből kiírja az átvételi kódot, így ha a sofőr a tokenhez jutna, a
// kódvédelmet megkerülhetné (a korábbi kód csak a `delivery_code`-ot vette
// ki, a tokent bennhagyta — az volt a lyuk).
function scrubBookingForUser(booking, user) {
  if (!booking) return booking;
  const isShipper = user?.sub === booking.shipper_id;
  const isAdmin = user?.role === 'admin';
  if (isAdmin || isShipper) return booking;
  // Sofőr (vagy bárki más, aki idáig eljut): kód + token nélkül. A címzett
  // elérhetőségét a sofőr látja (kézbesítéskor hívnia kell tudni), a
  // fizetési Barion-mezők a feladó oldalán relevánsak.
  const { delivery_code, tracking_token, ...rest } = booking;
  return rest;
}
router.param('id', uuidParam);

function generateDeliveryCode() {
  return String(100000 + crypto.randomInt(0, 900000));
}

const ALLOWED_SIZES = PACKAGE_SIZES.map((s) => s.id);

/**
 * Betölti egy útvonal összes méret-árát a carrier_route_prices táblából,
 * és hozzácsatolja a route objektumhoz `prices: [{size, price_huf}, ...]`
 * mezőben. A feladói oldal így egyetlen objektumban látja a teljes képet.
 */
async function attachPrices(routes) {
  if (routes.length === 0) return routes;
  const ids = routes.map((r) => r.id);
  const { rows } = await db.query(
    `SELECT route_id, size, price_huf FROM carrier_route_prices WHERE route_id = ANY($1)`,
    [ids],
  );
  const byRoute = new Map();
  for (const row of rows) {
    if (!byRoute.has(row.route_id)) byRoute.set(row.route_id, []);
    byRoute.get(row.route_id).push({ size: row.size, price_huf: row.price_huf });
  }
  return routes.map((r) => ({
    ...r,
    prices: (byRoute.get(r.id) || []).sort(
      (a, b) => ALLOWED_SIZES.indexOf(a.size) - ALLOWED_SIZES.indexOf(b.size),
    ),
  }));
}

// =====================================================================
//  SOFŐR – útvonal hirdetés
// =====================================================================

// POST /carrier-routes
// Új útvonal létrehozása. Sofőr-only. A `prices` tömb minden elemében
// egy (size, price_huf) páros.
router.post('/carrier-routes', authRequired, requireDriverKYC, writeRateLimit, async (req, res) => {
  const {
    title, description, departure_at, waypoints, vehicle_description,
    is_template = false, template_source_id = null, prices, status = 'open',
    is_ride_along = false,
  } = req.body || {};

  if (!title || !departure_at) {
    return res.status(400).json({ error: 'Hiányzó mezők: cím és indulás időpontja' });
  }
  // TC-013/TC-107: útvonalnév trim után 3–100 karakter — a csupa-szóköz és
  // a layout-törő végtelen string kiszűrése
  const titleClean = typeof title === 'string' ? title.trim() : '';
  if (titleClean.length < 3 || titleClean.length > 100) {
    return res.status(400).json({ error: 'Az útvonal neve 3–100 karakter legyen (nem állhat csak szóközből).' });
  }
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return res.status(400).json({ error: 'Legalább egy kiindulópont és egy célpont szükséges (waypoints)' });
  }
  if (!Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: 'Legalább egy méret-kategóriát be kell állítani (prices)' });
  }
  // Létrehozáskor csak 'draft' vagy 'open' értelmes — különben tetszőleges
  // string menne az enum oszlopba (a PATCH-eknél már van ilyen whitelist).
  if (!['draft', 'open'].includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen útvonal státusz (csak draft vagy open)' });
  }
  for (const p of prices) {
    if (!ALLOWED_SIZES.includes(p.size) || !(p.price_huf > 0)) {
      return res.status(400).json({ error: `Érvénytelen ár: ${JSON.stringify(p)}` });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO carrier_routes
        (carrier_id, title, description, departure_at, waypoints,
         vehicle_description, is_template, template_source_id, status, is_ride_along)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.sub, titleClean, description || null, departure_at,
        JSON.stringify(waypoints), vehicle_description || null,
        !!is_template, template_source_id, status, !!is_ride_along,
      ],
    );
    const route = rows[0];

    for (const p of prices) {
      await client.query(
        `INSERT INTO carrier_route_prices (route_id, size, price_huf)
         VALUES ($1, $2, $3)`,
        [route.id, p.size, p.price_huf],
      );
    }

    await client.query('COMMIT');
    const withPrices = (await attachPrices([route]))[0];

    // Csak a publikált útvonalakat hirdetjük real-time-ban
    if (route.status === 'open') {
      realtime.emitGlobal('routes:new', withPrices);
    }
    res.status(201).json(withPrices);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[carrier-routes] POST hiba:', err);
    res.status(500).json({ error: 'Útvonal létrehozás sikertelen' });
  } finally {
    client.release();
  }
});

// GET /carrier-routes/mine – a sofőr saját útvonalai (publikált + sablon + minden)
router.get('/carrier-routes/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM carrier_routes WHERE carrier_id = $1 ORDER BY is_template ASC, departure_at DESC`,
    [req.user.sub],
  );
  res.json(await attachPrices(rows));
});

// GET /carrier-routes – publikált (open) útvonalak a feladóknak.
// Opcionális szűrés: ?city=Kecskemét — az összes olyan útvonal, aminek a
// waypoints mezőjében szerepel ez a város.
// A saját útvonalait a user is látja — a frontend "Saját poszt" címkével
// jelöli és letiltja rajta a "Helyet foglalok" akciót. Szerver oldalon
// a POST /route-bookings végpont úgyis 403-mal elutasítja, ha a carrier_id
// megegyezik a hívóval.
router.get('/carrier-routes', authRequired, async (req, res) => {
  const { city, from_date, to_date, max_price } = req.query;
  let sql = `SELECT * FROM carrier_routes
              WHERE status = 'open'
                -- BUG-028: indulás után az útvonal tűnjön el a keresésből.
                -- 1 óra türelmi idő marad a kicsit csúszó indulásokra (a
                -- korábbi 12 óra alatt a feladók már elment sofőrökkel
                -- próbáltak egyeztetni).
                AND departure_at >= NOW() - INTERVAL '1 hour'`;
  const params = [];
  if (city) {
    // A JSONB @> operátorral: létezik-e olyan eleme a waypoints tömbnek, amelynek name mezője illeszkedik
    params.push(JSON.stringify([{ name: city }]));
    sql += ` AND waypoints @> $${params.length}::jsonb`;
  }
  if (from_date) {
    params.push(from_date);
    sql += ` AND departure_at >= $${params.length}::date`;
  }
  if (to_date) {
    params.push(to_date);
    sql += ` AND departure_at < ($${params.length}::date + INTERVAL '1 day')`;
  }
  // max_price: a legkisebb ár a prices JSON-ban nem kell nagyobb legyen
  // mint ez az összeg. Ez komplex lenne JSONB-vel, ezért a szűrést a
  // kliensre bízzuk — a backend a to_date/from_date-et csinálja.
  sql += ' ORDER BY departure_at ASC LIMIT 200';
  const { rows } = await db.query(sql, params);
  res.json(await attachPrices(rows));
});

// GET /carrier-routes/:id
router.get('/carrier-routes/:id', authRequired, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM carrier_routes WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Útvonal nem található' });
  res.json((await attachPrices(rows))[0]);
});

// GET /carrier-routes/:id/along-jobs — "Útba eső fuvarok"
// Az útvonal waypoint-jai mentén keresünk nyitott (bidding) fuvarokat,
// amelyeket a sofőr felvehetne kitérő nélkül (vagy minimális kitérővel).
router.get('/carrier-routes/:id/along-jobs', authRequired, async (req, res) => {
  const { rows } = await db.query(
    'SELECT carrier_id, waypoints, status FROM carrier_routes WHERE id = $1',
    [req.params.id],
  );
  const route = rows[0];
  if (!route) return res.status(404).json({ error: 'Útvonal nem található' });
  if (route.carrier_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a saját útvonaladhoz érhető el' });
  }
  if (!['open', 'draft'].includes(route.status)) {
    return res.json({ jobs: [] });
  }

  const waypoints = typeof route.waypoints === 'string'
    ? JSON.parse(route.waypoints)
    : route.waypoints;

  const jobs = await findJobsAlongRoute(waypoints, req.user.sub);
  res.json({ route_id: req.params.id, jobs });
});

// PATCH /carrier-routes/:id/status – az útvonal tulajdonosa állítja draft→open stb.
router.patch(
  '/carrier-routes/:id/status',
  authRequired,
  writeRateLimit,
  async (req, res) => {
    const { status } = req.body || {};
    const allowed = ['draft', 'open', 'full', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Érvénytelen státusz' });
    }
    const { rows } = await db.query(
      `UPDATE carrier_routes SET status = $1, updated_at = NOW()
        WHERE id = $2 AND carrier_id = $3 RETURNING *`,
      [status, req.params.id, req.user.sub],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Nem található vagy nincs jogosultság' });
    res.json((await attachPrices(rows))[0]);
  },
);

// PATCH /carrier-routes/:id – teljes szerkesztés (piszkozatok + publikált útvonalak)
// Csak az útvonal tulajdonosa módosíthatja. A `prices` tömb teljesen felülírja
// a meglévő ár-beállításokat (törlés + új beszúrás egy tranzakcióban).
router.patch('/carrier-routes/:id', authRequired, writeRateLimit, async (req, res) => {
  const {
    title, description, departure_at, waypoints, vehicle_description, prices, status,
    is_ride_along,
  } = req.body || {};

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Jogosultság-ellenőrzés + zárolás
    const { rows: existing } = await client.query(
      'SELECT carrier_id FROM carrier_routes WHERE id = $1 FOR UPDATE',
      [req.params.id],
    );
    if (!existing[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Útvonal nem található' });
    }
    if (existing[0].carrier_id !== req.user.sub) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Nincs jogosultság' });
    }

    // Mezőnkénti frissítés — csak a megadottakat írjuk át
    const sets = [];
    const params = [];
    let idx = 1;
    if (title !== undefined)               { sets.push(`title = $${idx++}`);               params.push(title); }
    if (description !== undefined)         { sets.push(`description = $${idx++}`);         params.push(description || null); }
    if (departure_at !== undefined)        { sets.push(`departure_at = $${idx++}`);        params.push(departure_at); }
    if (waypoints !== undefined)           { sets.push(`waypoints = $${idx++}::jsonb`);    params.push(JSON.stringify(waypoints)); }
    if (vehicle_description !== undefined) { sets.push(`vehicle_description = $${idx++}`); params.push(vehicle_description || null); }
    if (is_ride_along !== undefined)      { sets.push(`is_ride_along = $${idx++}`);      params.push(!!is_ride_along); }
    if (status !== undefined) {
      const allowed = ['draft', 'open', 'full', 'cancelled'];
      if (!allowed.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Érvénytelen státusz' });
      }
      sets.push(`status = $${idx++}`);
      params.push(status);
    }
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const updatedSql = `UPDATE carrier_routes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;

    const { rows: updatedRows } = await client.query(updatedSql, params);

    // Árak cseréje, ha megadták
    if (Array.isArray(prices)) {
      for (const p of prices) {
        if (!ALLOWED_SIZES.includes(p.size) || !(p.price_huf > 0)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Érvénytelen ár: ${JSON.stringify(p)}` });
        }
      }
      await client.query('DELETE FROM carrier_route_prices WHERE route_id = $1', [req.params.id]);
      for (const p of prices) {
        await client.query(
          `INSERT INTO carrier_route_prices (route_id, size, price_huf) VALUES ($1, $2, $3)`,
          [req.params.id, p.size, p.price_huf],
        );
      }
    }

    await client.query('COMMIT');
    const withPrices = (await attachPrices(updatedRows))[0];
    res.json(withPrices);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[carrier-routes] PATCH hiba:', err);
    res.status(500).json({ error: 'Útvonal frissítés sikertelen' });
  } finally {
    client.release();
  }
});

// =====================================================================
//  FELADÓ – foglalás egy útvonalra
// =====================================================================

// POST /carrier-routes/:id/bookings – bárki foglalhat egy útvonalon, kivéve
// az útvonal saját hirdetője
router.post(
  '/carrier-routes/:id/bookings',
  authRequired,
  writeRateLimit,
  async (req, res) => {
    const routeId = req.params.id;
    const {
      length_cm, width_cm, height_cm, weight_kg,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      notes,
      recipient_name, recipient_phone, recipient_email,
    } = req.body || {};

    if (
      !pickup_address || !dropoff_address ||
      pickup_lat == null || pickup_lng == null ||
      dropoff_lat == null || dropoff_lng == null
    ) {
      return res.status(400).json({ error: 'Hiányzó felvételi / lerakodási koordináták' });
    }
    const L = Number(length_cm), W = Number(width_cm), H = Number(height_cm), kg = Number(weight_kg);
    if (!(L > 0 && W > 0 && H > 0 && kg > 0)) {
      return res.status(400).json({ error: 'A csomag méretei és súlya kötelezőek' });
    }

    // Csomag kategória besorolása
    const size = classifyPackage(L, W, H, kg);
    if (!size) {
      return res.status(400).json({
        error: 'A csomagod egyik méret-kategóriába sem fér bele (max 150×100×80 cm / 50 kg).',
      });
    }

    // Útvonal + ár lekérdezése
    const { rows: routeRows } = await db.query(
      'SELECT * FROM carrier_routes WHERE id = $1',
      [routeId],
    );
    const route = routeRows[0];
    if (!route) return res.status(404).json({ error: 'Útvonal nem található' });
    if (route.carrier_id === req.user.sub) {
      return res.status(403).json({ error: 'A saját útvonaladon nem foglalhatsz helyet.' });
    }
    if (route.status !== 'open') {
      return res.status(409).json({ error: 'Ez az útvonal már nem fogad foglalást' });
    }

    const { rows: priceRows } = await db.query(
      'SELECT price_huf FROM carrier_route_prices WHERE route_id = $1 AND size = $2',
      [routeId, size],
    );
    if (!priceRows[0]) {
      return res.status(409).json({
        error: `A sofőr nem szállít "${size}" méretű csomagot ezen az útvonalon.`,
      });
    }
    const priceHuf = priceRows[0].price_huf;
    const deliveryCode = generateDeliveryCode();
    const trackingToken = crypto.randomBytes(24).toString('base64url');

    const { rows: insertRows } = await db.query(
      `INSERT INTO route_bookings
         (route_id, shipper_id, package_size,
          length_cm, width_cm, height_cm, weight_kg,
          pickup_address, pickup_lat, pickup_lng,
          dropoff_address, dropoff_lat, dropoff_lng,
          price_huf, delivery_code, notes,
          recipient_name, recipient_phone, recipient_email, tracking_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        routeId, req.user.sub, size,
        L, W, H, kg,
        pickup_address, pickup_lat, pickup_lng,
        dropoff_address, dropoff_lat, dropoff_lng,
        priceHuf, deliveryCode, notes || null,
        recipient_name || null, recipient_phone || null, recipient_email || null, trackingToken,
      ],
    );
    const booking = insertRows[0];

    // Real-time értesítés a sofőrnek — KIZÁRÓLAG a sofőr saját szobájába
    // (`emitToUser`), NEM globálisan. A korábbi `emitGlobal('...:${carrier_id}')`
    // minden csatlakozott klienshez elment; a carrier_id a publikus
    // útvonal-listából megszerezhető, így bárki lehallgathatta az új foglalás
    // átvételi kódját, tracking tokenjét és a címzett PII-ját. A payload is
    // minimális, nem-érzékeny (a részleteket a sofőr a REST-en, scrubbolva kéri le).
    realtime.emitToUser(route.carrier_id, 'route-bookings:new', {
      booking_id: booking.id,
      route_id: booking.route_id,
      pickup_address: booking.pickup_address,
      dropoff_address: booking.dropoff_address,
      package_size: booking.package_size,
      price_huf: booking.price_huf,
      created_at: booking.created_at,
    });

    // Értesítés a sofőrnek: új foglalás érkezett (in-app + email)
    try {
      const { rows: partyRows } = await db.query(
        `SELECT s.full_name AS shipper_name,
                c.full_name AS carrier_name, c.email AS carrier_email
           FROM users s, users c
          WHERE s.id = $1 AND c.id = $2`,
        [req.user.sub, route.carrier_id],
      );
      const info = partyRows[0] || {};
      await createNotification({
        user_id: route.carrier_id,
        type: 'booking_received',
        title: '📦 Új foglalás az útvonaladon!',
        body: `${info.shipper_name || 'Egy feladó'} helyet foglalt (${size}, ${priceHuf.toLocaleString('hu-HU')} Ft) a(z) "${route.title}" útvonaladon.`,
        link: `/sofor/utvonal/${routeId}`,
      });
      if (info.carrier_email) {
        setImmediate(() => {
          sendBookingReceivedEmail({
            to: info.carrier_email,
            carrierName: info.carrier_name,
            routeTitle: route.title,
            routeId,
            shipperName: info.shipper_name,
            priceHuf,
          }).catch((e) => console.warn('[email] booking_received hiba:', e.message));
        });
      }
    } catch (e) {
      console.warn('[notifications] booking_received hiba:', e.message);
    }

    res.status(201).json(booking);

    // Címzett értesítése (email + SMS log)
    if (recipient_phone || recipient_email) {
      const baseUrl = process.env.PUBLIC_URL || 'https://gofuvar.hu';
      const trackUrl = `${baseUrl}/nyomon-kovetes/${trackingToken}`;
      setImmediate(async () => {
        if (recipient_email) {
          try {
            const { sendRecipientTrackingEmail } = require('../services/email');
            await sendRecipientTrackingEmail({
              to: recipient_email,
              recipientName: recipient_name,
              jobTitle: route.title,
              trackingUrl: trackUrl,
              deliveryCode,
            });
          } catch (e) { console.warn('[recipient] email hiba:', e.message); }
        }
        // SMS-MODELL (2026-07-13): foglaláskor SMS nincs — a címzett a
        // felvételkor kapja az egyetlen SMS-t (photos.js booking pickup ág).
      });
    }
  },
);

// GET /carrier-routes/:id/bookings – az útvonal tulajdonosa látja a beérkezett foglalásokat
router.get(
  '/carrier-routes/:id/bookings',
  authRequired,
  async (req, res) => {
    // jogosultság
    const { rows: rr } = await db.query(
      'SELECT carrier_id FROM carrier_routes WHERE id = $1',
      [req.params.id],
    );
    if (!rr[0] || rr[0].carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    const { rows } = await db.query(
      `SELECT b.*, u.full_name AS shipper_name
         FROM route_bookings b
         JOIN users u ON u.id = b.shipper_id
        WHERE b.route_id = $1
        ORDER BY b.created_at DESC`,
      [req.params.id],
    );
    // A sofőr a saját útvonala foglalásait látja — de a `delivery_code` és a
    // `tracking_token` tőle is elrejtendő (kód-megkerülés elleni védelem).
    res.json(rows.map((b) => scrubBookingForUser(b, req.user)));
  },
);

// GET /route-bookings/mine – a bejelentkezett user saját foglalásai
router.get('/route-bookings/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, r.title AS route_title, r.departure_at, r.waypoints, r.carrier_id,
            u.full_name AS carrier_name
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users u ON u.id = r.carrier_id
      WHERE b.shipper_id = $1
      ORDER BY b.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// GET /route-bookings/:id
router.get('/route-bookings/:id', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, r.title AS route_title, r.departure_at, r.waypoints, r.carrier_id
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
      WHERE b.id = $1`,
    [req.params.id],
  );
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Foglalás nem található' });

  // Jogosultság: csak a foglalás feladója vagy a sofőr látja
  if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }

  // A sofőrtől a `delivery_code` ÉS a `tracking_token` is elrejtendő
  // (a token → publikus követőoldal → kód-megkerülés). A scrub a
  // feladónak/adminnak mindent visszaad.
  res.json(scrubBookingForUser(b, req.user));
});

// POST /route-bookings/:id/confirm – az útvonal tulajdonosa elfogadja a foglalást
router.post(
  '/route-bookings/:id/confirm',
  authRequired,
  writeRateLimit,
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: bRows } = await client.query(
        `SELECT b.*, r.carrier_id, s.email AS shipper_email, c.email AS carrier_email
           FROM route_bookings b
           JOIN carrier_routes r ON r.id = b.route_id
           JOIN users s ON s.id = b.shipper_id
           JOIN users c ON c.id = r.carrier_id
          WHERE b.id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const b = bRows[0];
      if (!b) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Foglalás nem található' });
      }
      if (b.carrier_id !== req.user.sub) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Nincs jogosultság' });
      }
      if (b.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A foglalás már nem megerősíthető' });
      }

      // Kapcsolatfelvételi díj indítása (készpénzes modell: a fuvardíjat a
      // feladó készpénzben adja a sofőrnek, a platform csak a díjat szedi)
      const feeHuf = calculateConnectionFee(b.price_huf);
      let barionRes = { paymentId: null, gatewayUrl: null };
      try {
        barionRes = await barion.startFeePayment({
          jobId: b.id, // itt a booking id-t használjuk
          feeHuf,
          shipperEmail: b.shipper_email,
          redirectPath: '/dashboard/foglalasaim',
        });
      } catch (err) {
        console.error('[barion] startFeePayment hiba:', err.message);
        await client.query('ROLLBACK');
        return res.status(502).json({ error: 'A díjfizetés indítása sikertelen', detail: err.message });
      }

      await client.query(
        `UPDATE route_bookings
            SET status              = 'confirmed',
                confirmed_at        = NOW(),
                barion_payment_id   = $1,
                barion_gateway_url  = $2,
                connection_fee_huf  = $3,
                carrier_share_huf   = 0,
                platform_share_huf  = $3
          WHERE id = $4`,
        [barionRes.paymentId, barionRes.gatewayUrl, feeHuf, b.id],
      );

      await client.query('COMMIT');
      realtime.emitGlobal(`route-bookings:confirmed:${b.shipper_id}`, {
        booking_id: b.id,
        barion_gateway_url: barionRes.gatewayUrl,
      });

      // Értesítés a feladónak: a sofőr megerősítette a foglalást (in-app + email)
      try {
        const { rows: partyRows } = await db.query(
          `SELECT c.full_name AS carrier_name,
                  s.full_name AS shipper_name, s.email AS shipper_email,
                  r.title AS route_title
             FROM route_bookings rb
             JOIN carrier_routes r ON r.id = rb.route_id
             JOIN users c ON c.id = $1
             JOIN users s ON s.id = $2
            WHERE rb.id = $3`,
          [b.carrier_id, b.shipper_id, b.id],
        );
        const info = partyRows[0] || {};
        await createNotification({
          user_id: b.shipper_id,
          type: 'booking_confirmed',
          title: '✅ A sofőr megerősítette a foglalásod!',
          body: `${info.carrier_name || 'A sofőr'} elfogadta a foglalásodat ${b.price_huf.toLocaleString('hu-HU')} Ft-ért. Fizesd meg a kapcsolatfelvételi díjat — a fuvardíjat készpénzben adod a sofőrnek.`,
          link: `/dashboard/foglalasaim`,
        });
        if (info.shipper_email) {
          setImmediate(() => {
            sendBookingConfirmedEmail({
              to: info.shipper_email,
              shipperName: info.shipper_name,
              routeTitle: info.route_title,
              bookingId: b.id,
              carrierName: info.carrier_name,
              priceHuf: b.price_huf,
            }).catch((e) => console.warn('[email] booking_confirmed hiba:', e.message));
          });
        }
      } catch (e) {
        console.warn('[notifications] booking_confirmed hiba:', e.message);
      }

      res.json({
        ok: true,
        booking_id: b.id,
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
  },
);

// POST /route-bookings/:id/pay – lusta Barion foglalás létrehozás.
//
// Akkor hívjuk, amikor a feladó a "Fizetés Barionnal" gombra kattint.
//   - Ha a foglaláshoz már tartozik `barion_gateway_url`, azt adjuk vissza.
//   - Ha nincs (pl. régebbi kóddal erősítette meg a sofőr, amikor még nem
//     volt Barion integráció), MOST hozzuk létre a reservation-t, eltároljuk
//     a paymentId + gatewayUrl-t, és azt adjuk vissza.
//
// Így az "Elfogadva, de nincs fizetés gomb" állapot mostantól öngyógyul:
// a kattintás triggereli a hiányzó reservation-t.
router.post('/route-bookings/:id/pay', authRequired, writeRateLimit, async (req, res) => {
  const { rows: bRows } = await db.query(
    `SELECT b.*, s.email AS shipper_email, c.email AS carrier_email
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users s ON s.id = b.shipper_id
       JOIN users c ON c.id = r.carrier_id
      WHERE b.id = $1`,
    [req.params.id],
  );
  const b = bRows[0];
  if (!b) return res.status(404).json({ error: 'Foglalás nem található' });
  if (b.shipper_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a foglalás feladója fizethet' });
  }
  if (b.status !== 'confirmed') {
    return res.status(409).json({
      error: 'Csak megerősített foglalást lehet fizetni (státusz: ' + b.status + ')',
    });
  }
  if (b.paid_at) {
    return res.status(409).json({ error: 'A kapcsolatfelvételi díj már ki van fizetve ehhez a foglaláshoz.' });
  }

  // Fogyasztóvédelmi kapu a fizetés INDÍTÁSAKOR (45/2014. 29. § (1) a)) —
  // ugyanaz a minta, mint a /jobs/:id/pay-nél.
  if (!b.fee_consent_at) {
    if (req.body?.consent !== true) {
      return res.status(400).json({
        error: 'A fizetéshez kérned kell az azonnali teljesítést és tudomásul venned, hogy a kapcsolatfelvételi adatok átadása után elállási jogod elvész.',
        code: 'CONSENT_REQUIRED',
      });
    }
    await db.query(
      `UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1 AND fee_consent_at IS NULL`,
      [b.id],
    );
  }

  // Idempotens: ha már megvan, csak visszaadjuk.
  if (b.barion_gateway_url) {
    return res.json({
      payment_id: b.barion_payment_id,
      gateway_url: b.barion_gateway_url,
      is_stub: String(b.barion_gateway_url).startsWith('stub:'),
      reused: true,
    });
  }

  // Nincs még fizetés → most hozzuk létre, és mentsük el a sorra.
  const feeHuf = b.connection_fee_huf || calculateConnectionFee(b.price_huf);
  let barionRes;
  try {
    barionRes = await barion.startFeePayment({
      jobId: b.id,
      feeHuf,
      shipperEmail: b.shipper_email,
      redirectPath: '/dashboard/foglalasaim',
    });
  } catch (err) {
    console.error('[barion] lusta startFeePayment hiba:', err.message);
    return res.status(502).json({ error: 'A díjfizetés indítása sikertelen', detail: err.message });
  }

  await db.query(
    `UPDATE route_bookings
        SET barion_payment_id   = $1,
            barion_gateway_url  = $2,
            connection_fee_huf  = COALESCE(connection_fee_huf, $3),
            carrier_share_huf   = 0,
            platform_share_huf  = COALESCE(platform_share_huf, $3)
      WHERE id = $4`,
    [barionRes.paymentId, barionRes.gatewayUrl, feeHuf, b.id],
  );

  res.json({
    payment_id: barionRes.paymentId,
    gateway_url: barionRes.gatewayUrl,
    is_stub: !!barionRes.stub,
    reused: false,
  });
});

// POST /route-bookings/:id/confirm-payment
//
// A sikeres fizetés NYUGTÁZÁSA. STUB módban a `/fizetes-stub` oldal
// "Fizetek most" gombja hívja (nincs valódi Barion callback); éles
// Barion esetén a `payments.js` IPN callback-je fogja. Idempotens:
// ha a foglalás már `paid_at`-tal rendelkezik, csak visszaadja.
//
// Mit csinál:
//   1) `paid_at` beállítása NOW()-ra
//   2) Értesítés küldése a SOFŐRnek (hirdetés létrehozója): "Péter
//      kifizette a foglalását"
//   3) Realtime event a feladónak, hogy a Foglalásaim oldala frissüljön
//      és a Fizetés gomb helyén a "FIZETVE" címke megjelenjen
router.post('/route-bookings/:id/confirm-payment', authRequired, writeRateLimit, async (req, res) => {
  const { rows: bRows } = await db.query(
    `SELECT b.*, r.carrier_id, r.title AS route_title,
            s.full_name AS shipper_name, s.email AS shipper_email,
            c.full_name AS carrier_name, c.email AS carrier_email
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users s ON s.id = b.shipper_id
       JOIN users c ON c.id = r.carrier_id
      WHERE b.id = $1`,
    [req.params.id],
  );
  const b = bRows[0];
  if (!b) return res.status(404).json({ error: 'Foglalás nem található' });
  if (b.shipper_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a foglalás feladója nyugtázhatja a fizetést' });
  }
  if (b.status !== 'confirmed') {
    return res.status(409).json({
      error: 'Csak megerősített foglaláshoz tartozhat fizetés (státusz: ' + b.status + ')',
    });
  }

  // Idempotens: ha már fizetve van, nem küldünk új notifikációt és realtime-ot.
  if (b.paid_at) {
    return res.json({ ok: true, already_paid: true, paid_at: b.paid_at });
  }

  // Éles Barion mellett a webhook a fizetés hiteles forrása — a kézi
  // nyugtázás csak stub (teszt) módban él.
  if (!barion.isStub()) {
    return res.status(409).json({
      error: 'A fizetést a Barion igazolja vissza automatikusan — kérjük, a fizetési oldalon fejezd be a fizetést.',
    });
  }

  // A beleegyezést a fizetés indítása (/pay) rögzítette — enélkül nincs nyugtázás.
  if (!b.fee_consent_at) {
    return res.status(400).json({
      error: 'A fizetéshez kérned kell az azonnali teljesítést és tudomásul venned, hogy a kapcsolatfelvételi adatok átadása után elállási jogod elvész.',
      code: 'CONSENT_REQUIRED',
    });
  }

  const { rows: updated } = await db.query(
    `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 RETURNING paid_at`,
    [b.id],
  );
  const paidAt = updated[0].paid_at;

  // Díj-visszaigazolás a FELADÓNAK tartós adathordozón (45/2014. 18. §)
  if (b.shipper_email) {
    setImmediate(() => {
      sendFeeConfirmationEmail({
        to: b.shipper_email,
        shipperName: b.shipper_name,
        jobTitle: b.route_title,
        feeHuf: b.connection_fee_huf || 0,
        cashHuf: b.price_huf,
        paidAtIso: paidAt,
        detailsPath: '/dashboard/foglalasaim',
      }).catch((e) => console.warn('[email] fee_confirmation hiba:', e.message));
    });
  }

  // 1) Értesítés a sofőrnek (a hirdetés létrehozójának): in-app + email
  try {
    await createNotification({
      user_id: b.carrier_id,
      type: 'booking_paid',
      title: '🤝 Indulhat a foglalás!',
      body: `${b.shipper_name || 'A feladó'} kifizette a kapcsolatfelvételi díjat a(z) "${b.route_title}" foglaláshoz. A fuvardíjat (${b.price_huf.toLocaleString('hu-HU')} Ft) készpénzben kapod.`,
      link: `/sofor/utvonal/${b.route_id}`,
    });
  } catch (e) {
    console.warn('[notifications] booking_paid hiba:', e.message);
  }
  if (b.carrier_email) {
    setImmediate(() => {
      sendBookingPaidEmail({
        to: b.carrier_email,
        carrierName: b.carrier_name,
        routeTitle: b.route_title,
        bookingId: b.id,
        priceHuf: b.price_huf,
        shipperName: b.shipper_name,
      }).catch((e) => console.warn('[email] booking_paid hiba:', e.message));
    });
  }

  // 2) Realtime event a feladónak – a Foglalásaim oldala ebből tudja
  //    azonnal újratölteni és lecserélni a gombot "FIZETVE" címkére.
  realtime.emitToUser(b.shipper_id, 'route-booking:paid', {
    booking_id: b.id,
    paid_at: paidAt,
  });
  // És a sofőrnek is, hogy a route részletek oldal frissüljön.
  realtime.emitToUser(b.carrier_id, 'route-booking:paid', {
    booking_id: b.id,
    paid_at: paidAt,
  });

  res.json({ ok: true, paid_at: paidAt });
});

// POST /route-bookings/:id/reject – az útvonal tulajdonosa elutasítja
router.post(
  '/route-bookings/:id/reject',
  authRequired,
  writeRateLimit,
  async (req, res) => {
    const { rows: bRows } = await db.query(
      `SELECT b.*, r.carrier_id, r.title AS route_title,
              s.email AS shipper_email, s.full_name AS shipper_name
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
         JOIN users s ON s.id = b.shipper_id
        WHERE b.id = $1`,
      [req.params.id],
    );
    const b = bRows[0];
    if (!b) return res.status(404).json({ error: 'Nem található' });
    if (b.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    if (b.status !== 'pending') {
      return res.status(409).json({ error: 'A foglalás már nem utasítható el' });
    }
    await db.query(
      `UPDATE route_bookings SET status = 'rejected' WHERE id = $1`,
      [b.id],
    );
    realtime.emitGlobal(`route-bookings:rejected:${b.shipper_id}`, { booking_id: b.id });

    // Értesítés a feladónak: sajnos a sofőr elutasította (in-app + email)
    try {
      await createNotification({
        user_id: b.shipper_id,
        type: 'booking_rejected',
        title: '😕 A sofőr elutasította a foglalásod',
        body: 'Sajnos a sofőr nem tudja vállalni ezt a csomagot. Keress másik útvonalat vagy fuvart.',
        link: `/dashboard/foglalasaim`,
      });
    } catch (e) {
      console.warn('[notifications] booking_rejected hiba:', e.message);
    }
    if (b.shipper_email) {
      setImmediate(() => {
        sendBookingRejectedEmail({
          to: b.shipper_email,
          shipperName: b.shipper_name,
          routeTitle: b.route_title,
        }).catch((e) => console.warn('[email] booking_rejected hiba:', e.message));
      });
    }

    res.json({ ok: true });
  },
);

// POST /route-bookings/:id/cancel
//
// Fix áras foglalás lemondása. Bárki hívhatja, aki érdekelt fél:
//   - a feladó (shipper_id = me) → lemondási díj ha már fizetett (8 000 Ft-ig 400 Ft, felette 5%)
//   - a sofőr (route.carrier_id = me) → 100% refund a feladónak
//
// Tiltott állapotok: in_progress, delivered, cancelled, rejected.
router.post('/route-bookings/:id/cancel', authRequired, writeRateLimit, async (req, res) => {
  const { reason } = req.body || {};
  const { rows } = await db.query(
    `SELECT b.*, r.carrier_id, r.title AS route_title,
            s.full_name AS shipper_name, s.email AS shipper_email,
            c.full_name AS carrier_name, c.email AS carrier_email
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users s ON s.id = b.shipper_id
       JOIN users c ON c.id = r.carrier_id
      WHERE b.id = $1`,
    [req.params.id],
  );
  const b = rows[0];
  if (!b) return res.status(404).json({ error: 'Foglalás nem található' });

  const iAmShipper = b.shipper_id === req.user.sub;
  const iAmCarrier = b.carrier_id === req.user.sub;
  if (!iAmShipper && !iAmCarrier) {
    return res.status(403).json({ error: 'Nincs jogosultság a lemondáshoz' });
  }

  const blocked = ['in_progress', 'delivered', 'cancelled', 'rejected'];
  if (blocked.includes(b.status)) {
    return res.status(409).json({
      error:
        b.status === 'cancelled'
          ? 'Ez a foglalás már le van mondva.'
          : `Ez a foglalás már nem mondható le (státusz: ${b.status}).`,
    });
  }

  const cancelledByRole = iAmShipper ? 'shipper' : 'carrier';
  const paid = !!b.paid_at;
  // Készpénzes modell: a platform nem kezeli a fuvardíjat, így visszatérítés
  // és lemondási díj sincs. A kapcsolatfelvételi díj nem visszatérítendő
  // (a szolgáltatás — kontakt-átadás — a fizetéssel teljesült, ÁSZF).
  const fee = 0;
  const refund = 0;

  await db.query(
    `UPDATE route_bookings
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = $1,
            cancel_reason = $2,
            cancellation_fee_huf = $3,
            refund_huf = $4
      WHERE id = $5`,
    [req.user.sub, reason || null, fee, refund, b.id],
  );

  const otherUserId = iAmShipper ? b.carrier_id : b.shipper_id;
  const otherEmail = iAmShipper ? b.carrier_email : b.shipper_email;
  const otherName = iAmShipper ? b.carrier_name : b.shipper_name;
  if (otherUserId) {
    try {
      await createNotification({
        user_id: otherUserId,
        type: 'booking_cancelled',
        title: '❌ Foglalás lemondva',
        body: iAmShipper
          ? `A feladó lemondta a foglalását a(z) "${b.route_title}" útvonalon.`
          : `A sofőr lemondta a foglalásodat a(z) "${b.route_title}" útvonalon. Keress másik útvonalat vagy adj fel fuvart — ha már fizettél kapcsolatfelvételi díjat, jelezz a panasz@gofuvar.hu címen.`,
        link: iAmShipper ? `/sofor/utvonal/${b.route_id}` : `/dashboard/foglalasaim`,
      });
    } catch (e) {
      console.warn('[notifications] booking_cancelled hiba:', e.message);
    }
    if (otherEmail) {
      setImmediate(() => {
        sendCancellationEmail({
          to: otherEmail,
          recipientName: otherName,
          jobTitle: b.route_title,
          cancelledByRole,
          refundHuf: refund,
          feeHuf: fee,
          recipientIsShipper: !iAmShipper,
        }).catch((e) => console.warn('[email] booking_cancelled hiba:', e.message));
      });
    }
  }

  if (paid && iAmShipper && refund > 0) {
    try {
      await createNotification({
        user_id: b.shipper_id,
        type: 'refund_issued',
        title: '💸 Visszatérítés folyamatban',
        body: `${refund.toLocaleString('hu-HU')} Ft visszautalás indult${fee > 0 ? ` (${fee.toLocaleString('hu-HU')} Ft lemondási díj levonva)` : ''}.`,
        link: `/dashboard/foglalasaim`,
      });
    } catch {}
  }

  realtime.emitToUser(b.shipper_id, 'route-booking:cancelled', { booking_id: b.id });
  realtime.emitToUser(b.carrier_id, 'route-booking:cancelled', { booking_id: b.id });

  res.json({
    ok: true,
    status: 'cancelled',
    cancellation_fee_huf: fee,
    refund_huf: refund,
  });
});

module.exports = router;
