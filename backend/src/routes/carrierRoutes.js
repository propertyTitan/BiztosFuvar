// Sofőri útvonal-hirdetések + feladói foglalások.
//
// A fájl neve "carrierRoutes.js", hogy ne keveredjen össze az Express
// "router" fogalmával. Az URL-ekben /carrier-routes és /route-bookings
// formát használunk.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { PACKAGE_SIZES, classifyPackage } = require('../constants');
const barion = require('../services/barion');
const realtime = require('../realtime');

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
router.post('/carrier-routes', authRequired, requireRole('carrier'), async (req, res) => {
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
router.get('/carrier-routes/mine', authRequired, requireRole('carrier'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM carrier_routes WHERE carrier_id = $1 ORDER BY is_template ASC, departure_at DESC`,
    [req.user.sub],
  );
  res.json(await attachPrices(rows));
});

// GET /carrier-routes – publikált (open) útvonalak a feladóknak.
// Opcionális szűrés: ?city=Kecskemét — az összes olyan útvonal, aminek a
// waypoints mezőjében szerepel ez a város.
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

// PATCH /carrier-routes/:id/status – sofőr állítja draft→open, open→full, stb.
router.patch(
  '/carrier-routes/:id/status',
  authRequired,
  requireRole('carrier'),
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

// =====================================================================
//  FELADÓ – foglalás egy útvonalra
// =====================================================================

// POST /carrier-routes/:id/bookings – feladó helyet foglal
router.post(
  '/carrier-routes/:id/bookings',
  authRequired,
  requireRole('shipper'),
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

    res.status(201).json(booking);
  },
);

// GET /carrier-routes/:id/bookings – a sofőr látja egy saját útvonalához tartozó foglalásokat
router.get(
  '/carrier-routes/:id/bookings',
  authRequired,
  requireRole('carrier'),
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

// GET /route-bookings/mine – a feladó saját foglalásai
router.get('/route-bookings/mine', authRequired, requireRole('shipper'), async (req, res) => {
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

// POST /route-bookings/:id/confirm – sofőr elfogadja a foglalást, escrow lefoglalás
router.post(
  '/route-bookings/:id/confirm',
  authRequired,
  requireRole('carrier'),
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

      await client.query(
        `UPDATE route_bookings SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1`,
        [b.id],
      );

      await client.query('COMMIT');
      realtime.emitGlobal(`route-bookings:confirmed:${b.shipper_id}`, {
        booking_id: b.id,
        barion_gateway_url: barionRes.gatewayUrl,
      });
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

// POST /route-bookings/:id/reject – sofőr elutasítja
router.post(
  '/route-bookings/:id/reject',
  authRequired,
  requireRole('carrier'),
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
    res.json({ ok: true });
  },
);

module.exports = router;
