// Sofőri útvonal-hirdetések + feladói foglalások.
//
// A fájl neve "carrierRoutes.js", hogy ne keveredjen össze az Express
// "router" fogalmával. Az URL-ekben /carrier-routes és /route-bookings
// formát használunk.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { PACKAGE_SIZES, classifyPackage } = require('../constants');
const barion = require('../services/barion');
const realtime = require('../realtime');
const { createNotification } = require('../services/notifications');

const router = express.Router();

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
router.post('/carrier-routes', authRequired, async (req, res) => {
  const {
    title, description, departure_at, waypoints, vehicle_description,
    is_template = false, template_source_id = null, prices, status = 'open',
  } = req.body || {};

  if (!title || !departure_at) {
    return res.status(400).json({ error: 'Hiányzó mezők: cím és indulás időpontja' });
  }
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return res.status(400).json({ error: 'Legalább egy kiindulópont és egy célpont szükséges (waypoints)' });
  }
  if (!Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: 'Legalább egy méret-kategóriát be kell állítani (prices)' });
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
         vehicle_description, is_template, template_source_id, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.sub, title, description || null, departure_at,
        JSON.stringify(waypoints), vehicle_description || null,
        !!is_template, template_source_id, status,
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
    res.status(500).json({ error: 'Útvonal létrehozás sikertelen', detail: err.message });
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
  const { city } = req.query;
  let sql = `SELECT * FROM carrier_routes
              WHERE status = 'open' AND departure_at >= NOW() - INTERVAL '12 hours'`;
  const params = [];
  if (city) {
    // A JSONB @> operátorral: létezik-e olyan eleme a waypoints tömbnek, amelynek name mezője illeszkedik
    params.push(JSON.stringify([{ name: city }]));
    sql += ` AND waypoints @> $${params.length}::jsonb`;
  }
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

// PATCH /carrier-routes/:id/status – az útvonal tulajdonosa állítja draft→open stb.
router.patch(
  '/carrier-routes/:id/status',
  authRequired,
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
router.patch('/carrier-routes/:id', authRequired, async (req, res) => {
  const {
    title, description, departure_at, waypoints, vehicle_description, prices, status,
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
    res.status(500).json({ error: 'Útvonal frissítés sikertelen', detail: err.message });
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
  async (req, res) => {
    const routeId = req.params.id;
    const {
      length_cm, width_cm, height_cm, weight_kg,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      notes,
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

    const { rows: insertRows } = await db.query(
      `INSERT INTO route_bookings
         (route_id, shipper_id, package_size,
          length_cm, width_cm, height_cm, weight_kg,
          pickup_address, pickup_lat, pickup_lng,
          dropoff_address, dropoff_lat, dropoff_lng,
          price_huf, delivery_code, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        routeId, req.user.sub, size,
        L, W, H, kg,
        pickup_address, pickup_lat, pickup_lng,
        dropoff_address, dropoff_lat, dropoff_lng,
        priceHuf, deliveryCode, notes || null,
      ],
    );
    const booking = insertRows[0];

    // Real-time értesítés a sofőrnek
    realtime.emitGlobal(`route-bookings:new:${route.carrier_id}`, booking);

    // Értesítés a sofőrnek: új foglalás érkezett
    try {
      const { rows: shipperRows } = await db.query(
        'SELECT full_name FROM users WHERE id = $1',
        [req.user.sub],
      );
      await createNotification({
        user_id: route.carrier_id,
        type: 'booking_received',
        title: '📦 Új foglalás az útvonaladon!',
        body: `${shipperRows[0]?.full_name || 'Egy feladó'} helyet foglalt (${size}, ${priceHuf.toLocaleString('hu-HU')} Ft) a(z) "${route.title}" útvonaladon.`,
        link: `/sofor/utvonal/${routeId}`,
      });
    } catch (e) {
      console.warn('[notifications] booking_received hiba:', e.message);
    }

    res.status(201).json(booking);
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
    res.json(rows);
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

  // delivery_code kiszűrése a sofőr oldalán
  if (b.shipper_id !== req.user.sub && req.user.role !== 'admin') {
    delete b.delivery_code;
  }
  res.json(b);
});

// POST /route-bookings/:id/confirm – az útvonal tulajdonosa elfogadja a foglalást
router.post(
  '/route-bookings/:id/confirm',
  authRequired,
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

      // Barion foglalás a teljes árra
      let barionRes = { paymentId: null, gatewayUrl: null };
      try {
        barionRes = await barion.reservePayment({
          jobId: b.id, // itt a booking id-t használjuk
          totalHuf: b.price_huf,
          shipperEmail: b.shipper_email,
          carrierEmail: b.carrier_email,
        });
      } catch (err) {
        console.error('[barion] reservePayment hiba:', err.message);
        await client.query('ROLLBACK');
        return res.status(502).json({ error: 'Barion foglalás sikertelen', detail: err.message });
      }

      // 90/10 split – a mentésnél is tároljuk, hogy a lezáráskor elő tudjuk venni
      const carrierShare = Math.round(b.price_huf * (1 - barion.COMMISSION_PCT));
      const platformShare = b.price_huf - carrierShare;

      await client.query(
        `UPDATE route_bookings
            SET status              = 'confirmed',
                confirmed_at        = NOW(),
                barion_payment_id   = $1,
                barion_gateway_url  = $2,
                carrier_share_huf   = $3,
                platform_share_huf  = $4
          WHERE id = $5`,
        [barionRes.paymentId, barionRes.gatewayUrl, carrierShare, platformShare, b.id],
      );

      await client.query('COMMIT');
      realtime.emitGlobal(`route-bookings:confirmed:${b.shipper_id}`, {
        booking_id: b.id,
        barion_gateway_url: barionRes.gatewayUrl,
      });

      // Értesítés a feladónak: a sofőr megerősítette a foglalást
      try {
        const { rows: carrierRows } = await db.query(
          'SELECT full_name FROM users WHERE id = $1',
          [b.carrier_id],
        );
        await createNotification({
          user_id: b.shipper_id,
          type: 'booking_confirmed',
          title: '✅ A sofőr megerősítette a foglalásod!',
          body: `${carrierRows[0]?.full_name || 'A sofőr'} elfogadta a foglalásodat ${b.price_huf.toLocaleString('hu-HU')} Ft-ért. Fizess a Barion oldalon.`,
          link: `/dashboard/foglalasaim`,
        });
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
router.post('/route-bookings/:id/pay', authRequired, async (req, res) => {
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

  // Idempotens: ha már megvan, csak visszaadjuk.
  if (b.barion_gateway_url) {
    return res.json({
      payment_id: b.barion_payment_id,
      gateway_url: b.barion_gateway_url,
      is_stub: String(b.barion_gateway_url).startsWith('stub:'),
      reused: true,
    });
  }

  // Nincs még reservation → most hozzuk létre, és mentsük el a sorra.
  let barionRes;
  try {
    barionRes = await barion.reservePayment({
      jobId: b.id,
      totalHuf: b.price_huf,
      shipperEmail: b.shipper_email,
      carrierEmail: b.carrier_email,
    });
  } catch (err) {
    console.error('[barion] lusta reservePayment hiba:', err.message);
    return res.status(502).json({ error: 'Barion foglalás sikertelen', detail: err.message });
  }

  const carrierShare = Math.round(b.price_huf * (1 - barion.COMMISSION_PCT));
  const platformShare = b.price_huf - carrierShare;

  await db.query(
    `UPDATE route_bookings
        SET barion_payment_id   = $1,
            barion_gateway_url  = $2,
            carrier_share_huf   = COALESCE(carrier_share_huf, $3),
            platform_share_huf  = COALESCE(platform_share_huf, $4)
      WHERE id = $5`,
    [barionRes.paymentId, barionRes.gatewayUrl, carrierShare, platformShare, b.id],
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
router.post('/route-bookings/:id/confirm-payment', authRequired, async (req, res) => {
  const { rows: bRows } = await db.query(
    `SELECT b.*, r.carrier_id, r.title AS route_title,
            s.full_name AS shipper_name, s.email AS shipper_email
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
       JOIN users s ON s.id = b.shipper_id
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

  const { rows: updated } = await db.query(
    `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 RETURNING paid_at`,
    [b.id],
  );
  const paidAt = updated[0].paid_at;

  // 1) Értesítés a sofőrnek (a hirdetés létrehozójának)
  try {
    await createNotification({
      user_id: b.carrier_id,
      type: 'booking_paid',
      title: '💰 Kifizetett foglalás!',
      body: `${b.shipper_name || 'A feladó'} kifizette a(z) "${b.route_title}" foglalását ${b.price_huf.toLocaleString('hu-HU')} Ft értékben.`,
      link: `/sofor/utvonal/${b.route_id}`,
    });
  } catch (e) {
    console.warn('[notifications] booking_paid hiba:', e.message);
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
  async (req, res) => {
    const { rows: bRows } = await db.query(
      `SELECT b.*, r.carrier_id
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
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

    // Értesítés a feladónak: sajnos a sofőr elutasította
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

    res.json({ ok: true });
  },
);

module.exports = router;
