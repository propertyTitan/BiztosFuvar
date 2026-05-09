// =====================================================================
//  Autómentés / Mobilgumis végpontok.
//
//  Flow:
//    1. Bajba jutott: POST /towing/request → GPS + issue_type + vehicle
//    2. Backend: push a közeli, elérhető mentős-sofőröknek
//    3. Mentős: POST /towing/:id/accept → első nyer (atomi)
//    4. Mentős: POST /towing/:id/arrive → megérkeztem
//    5. Mentős: POST /towing/:id/complete → kész, végső ár
//    6. Bajba jutott: POST /towing/:id/cancel → lemondás
//
//  Plusz:
//    - POST /towing/register → mentős regisztráció (services + jármű)
//    - POST /towing/toggle-available → online/offline kapcsoló
//    - GET  /towing/incoming → elérhető mentés kérések (mentős nézet)
//    - GET  /towing/my-requests → saját kéréseim (bajba jutott nézet)
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { distanceMeters } = require('../utils/geo');
const { createNotification } = require('../services/notifications');
const { sendPushToUser } = require('../services/push');
const realtime = require('../realtime');

const router = express.Router();

const ISSUE_TYPES = [
  'breakdown', 'flat_tire', 'accident', 'ditch',
  'battery', 'lockout', 'fuel', 'other',
];
const ISSUE_LABELS = {
  breakdown: 'Lerobbanás',
  flat_tire: 'Defekt (mobilgumis)',
  accident: 'Baleset utáni mentés',
  ditch: 'Árokba csúszás / elakadás',
  battery: 'Akkumulátor lemerülés',
  lockout: 'Bezárt kulcs',
  fuel: 'Üzemanyag kifogyás',
  other: 'Egyéb probléma',
};
const VEHICLE_TYPES = ['car', 'van', 'truck', 'motorcycle'];
const DEFAULT_RADIUS_KM = 30;
const DEFAULT_EXPIRE_MINUTES = 30;
const MAX_PUSH_DRIVERS = 50;

// =====================================================================
//  BAJBA JUTOTT — mentés kérése
// =====================================================================

// POST /towing/request — "Segítség kérek!"
router.post('/towing/request', authRequired, writeRateLimit, async (req, res) => {
  const {
    lat, lng, address,
    issue_type = 'breakdown',
    issue_description,
    vehicle_type = 'car',
    vehicle_plate,
    search_radius_km,
  } = req.body || {};

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ error: 'GPS pozíció szükséges. Engedélyezd a helymeghatározást.' });
  }
  if (!ISSUE_TYPES.includes(issue_type)) {
    return res.status(400).json({ error: 'Érvénytelen probléma típus' });
  }

  const radius = Math.max(5, Math.min(100, Number(search_radius_km) || DEFAULT_RADIUS_KM));
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRE_MINUTES * 60 * 1000);

  const { rows } = await db.query(
    `INSERT INTO tow_requests
       (requester_id, lat, lng, address, issue_type, issue_description,
        vehicle_type, vehicle_plate, search_radius_km, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      req.user.sub, Number(lat), Number(lng), address || null,
      issue_type, issue_description || null,
      vehicle_type, vehicle_plate || null,
      radius, expiresAt,
    ],
  );
  const towReq = rows[0];

  res.status(201).json(towReq);

  // Fire-and-forget: közeli mentős-sofőrök értesítése
  setImmediate(async () => {
    try {
      await notifyNearbyTowDrivers(towReq);
    } catch (err) {
      console.warn('[towing] push hiba:', err.message);
    }
  });
});

// GET /towing/my-requests — a bajba jutott saját kérései
router.get('/towing/my-requests', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*, u.full_name AS responder_name, u.phone AS responder_phone,
            u.tow_vehicle_description AS responder_vehicle
       FROM tow_requests t
  LEFT JOIN users u ON u.id = t.responder_id
      WHERE t.requester_id = $1
      ORDER BY t.created_at DESC
      LIMIT 20`,
    [req.user.sub],
  );
  res.json(rows);
});

// POST /towing/:id/cancel — a kérő lemondja
router.post('/towing/:id/cancel', authRequired, writeRateLimit, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE tow_requests
        SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1 AND requester_id = $2 AND status IN ('searching', 'accepted')
    RETURNING *`,
    [req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található vagy nem mondható le' });

  if (rows[0].responder_id) {
    await createNotification({
      user_id: rows[0].responder_id,
      type: 'tow_cancelled',
      title: '❌ Mentés lemondva',
      body: 'A bajba jutott lemondta a mentés kérést.',
      link: '/mentes/beerkezett',
    }).catch(() => {});
  }

  realtime.emitGlobal('towing:cancelled', { tow_id: rows[0].id });
  res.json({ ok: true });
});

// =====================================================================
//  MENTŐS — elfogadás, megérkezés, lezárás
// =====================================================================

// POST /towing/register — mentős regisztráció
router.post('/towing/register', authRequired, writeRateLimit, async (req, res) => {
  const { tow_services = [], tow_vehicle_description } = req.body || {};

  const validServices = (Array.isArray(tow_services) ? tow_services : [])
    .filter((s) => ISSUE_TYPES.includes(s));

  if (validServices.length === 0) {
    return res.status(400).json({ error: 'Legalább egy mentési szolgáltatást válassz ki.' });
  }

  const { rows } = await db.query(
    `UPDATE users
        SET is_tow_driver = TRUE,
            tow_services = $1,
            tow_vehicle_description = $2,
            tow_available = TRUE
      WHERE id = $3
    RETURNING id, is_tow_driver, tow_services, tow_vehicle_description, tow_available`,
    [validServices, tow_vehicle_description || null, req.user.sub],
  );
  res.json(rows[0]);
});

// POST /towing/toggle-available — online/offline
router.post('/towing/toggle-available', authRequired, writeRateLimit, async (req, res) => {
  const { available } = req.body || {};
  const { rows } = await db.query(
    `UPDATE users SET tow_available = $1 WHERE id = $2 AND is_tow_driver = TRUE
     RETURNING tow_available`,
    [!!available, req.user.sub],
  );
  if (!rows[0]) return res.status(403).json({ error: 'Nem vagy regisztrált mentős' });
  res.json({ tow_available: rows[0].tow_available });
});

// GET /towing/incoming — elérhető mentés kérések a mentős közelében
router.get('/towing/incoming', authRequired, async (req, res) => {
  const { rows: me } = await db.query(
    `SELECT is_tow_driver, tow_services, last_known_lat, last_known_lng
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!me[0]?.is_tow_driver) {
    return res.status(403).json({ error: 'Nem vagy regisztrált mentős' });
  }

  const lat = Number(req.query.lat) || me[0].last_known_lat;
  const lng = Number(req.query.lng) || me[0].last_known_lng;

  let rows;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // GPS alapú szűrés
    const radiusKm = 50;
    const latDeg = radiusKm / 111;
    const lngDeg = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

    const result = await db.query(
      `SELECT t.*, u.full_name AS requester_name, u.phone AS requester_phone
         FROM tow_requests t
         JOIN users u ON u.id = t.requester_id
        WHERE t.status = 'searching'
          AND (t.expires_at IS NULL OR t.expires_at > NOW())
          AND t.lat BETWEEN $1 AND $2
          AND t.lng BETWEEN $3 AND $4
        ORDER BY t.created_at DESC
        LIMIT 50`,
      [lat - latDeg, lat + latDeg, lng - lngDeg, lng + lngDeg],
    );
    rows = result.rows;

    // Pontos távolság + szűrés
    rows = rows
      .map((r) => ({
        ...r,
        distance_km: +(distanceMeters(lat, lng, r.lat, r.lng) / 1000).toFixed(2),
      }))
      .filter((r) => r.distance_km <= r.search_radius_km)
      .sort((a, b) => a.distance_km - b.distance_km);
  } else {
    // Nincs GPS → az összes aktív kérés
    const result = await db.query(
      `SELECT t.*, u.full_name AS requester_name, u.phone AS requester_phone
         FROM tow_requests t
         JOIN users u ON u.id = t.requester_id
        WHERE t.status = 'searching'
          AND (t.expires_at IS NULL OR t.expires_at > NOW())
        ORDER BY t.created_at DESC
        LIMIT 50`,
    );
    rows = result.rows;
  }

  res.json(rows);
});

// POST /towing/:id/accept — mentős elvállalja (első nyer)
router.post('/towing/:id/accept', authRequired, writeRateLimit, async (req, res) => {
  const { estimated_price_huf } = req.body || {};

  const { rows: me } = await db.query(
    `SELECT is_tow_driver, full_name, phone, tow_vehicle_description
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!me[0]?.is_tow_driver) {
    return res.status(403).json({ error: 'Nem vagy regisztrált mentős' });
  }

  // Atomi first-wins
  const { rows } = await db.query(
    `UPDATE tow_requests
        SET status = 'accepted',
            responder_id = $1,
            accepted_at = NOW(),
            estimated_price_huf = $2
      WHERE id = $3
        AND status = 'searching'
        AND responder_id IS NULL
        AND requester_id <> $1
        AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING *`,
    [req.user.sub, estimated_price_huf || null, req.params.id],
  );

  if (!rows[0]) {
    const { rows: check } = await db.query(
      `SELECT status, responder_id, requester_id, expires_at FROM tow_requests WHERE id = $1`,
      [req.params.id],
    );
    const t = check[0];
    if (!t) return res.status(404).json({ error: 'Mentés kérés nem található' });
    if (t.requester_id === req.user.sub) return res.status(403).json({ error: 'Saját kérésedet nem fogadhatod el' });
    if (t.responder_id) return res.status(409).json({ error: 'Sajnos elkelt — valaki más gyorsabb volt.' });
    if (t.expires_at && new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'A kérés lejárt.' });
    return res.status(409).json({ error: 'Nem fogadható el (állapot: ' + t.status + ')' });
  }

  const towReq = rows[0];

  // Értesítés a bajba jutottnak
  const responder = me[0];
  await createNotification({
    user_id: towReq.requester_id,
    type: 'tow_accepted',
    title: '🚗 Mentős úton van!',
    body: `${responder.full_name} elvállalta a mentést${responder.tow_vehicle_description ? ` (${responder.tow_vehicle_description})` : ''}.${responder.phone ? ` Tel: ${responder.phone}` : ''}`,
    link: `/mentes/kereseim`,
  }).catch(() => {});

  realtime.emitToUser(towReq.requester_id, 'towing:accepted', {
    tow_id: towReq.id,
    responder_name: responder.full_name,
    responder_phone: responder.phone,
    responder_vehicle: responder.tow_vehicle_description,
    estimated_price_huf: towReq.estimated_price_huf,
  });
  realtime.emitGlobal('towing:taken', { tow_id: towReq.id });

  res.json({
    ok: true,
    tow_id: towReq.id,
    requester_lat: towReq.lat,
    requester_lng: towReq.lng,
    issue_type: towReq.issue_type,
    vehicle_type: towReq.vehicle_type,
  });
});

// POST /towing/:id/arrive — mentős megérkezett
router.post('/towing/:id/arrive', authRequired, writeRateLimit, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE tow_requests
        SET status = 'arrived', arrived_at = NOW()
      WHERE id = $1 AND responder_id = $2 AND status = 'accepted'
    RETURNING *`,
    [req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található vagy nem frissíthető' });

  await createNotification({
    user_id: rows[0].requester_id,
    type: 'tow_arrived',
    title: '✅ A mentős megérkezett!',
    body: 'A mentős a helyszínen van.',
    link: '/mentes/kereseim',
  }).catch(() => {});

  realtime.emitToUser(rows[0].requester_id, 'towing:arrived', { tow_id: rows[0].id });
  res.json({ ok: true });
});

// POST /towing/:id/complete — mentés kész + végső ár
router.post('/towing/:id/complete', authRequired, writeRateLimit, async (req, res) => {
  const { final_price_huf } = req.body || {};
  const { rows } = await db.query(
    `UPDATE tow_requests
        SET status = 'completed',
            completed_at = NOW(),
            final_price_huf = $1
      WHERE id = $2 AND responder_id = $3 AND status IN ('accepted', 'arrived')
    RETURNING *`,
    [final_price_huf || null, req.params.id, req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található vagy nem zárható le' });

  const priceStr = final_price_huf
    ? `${Number(final_price_huf).toLocaleString('hu-HU')} Ft`
    : 'Ár egyeztetés alapján';

  await createNotification({
    user_id: rows[0].requester_id,
    type: 'tow_completed',
    title: '🎉 Mentés befejezve!',
    body: `A mentés sikeresen lezárult. ${priceStr}.`,
    link: '/mentes/kereseim',
  }).catch(() => {});

  res.json({ ok: true, final_price_huf: rows[0].final_price_huf });
});

// =====================================================================
//  Push logika — közeli mentős sofőrök értesítése
// =====================================================================

async function notifyNearbyTowDrivers(towReq) {
  const radiusKm = towReq.search_radius_km || DEFAULT_RADIUS_KM;
  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.max(0.1, Math.cos((towReq.lat * Math.PI) / 180)));

  const { rows: drivers } = await db.query(
    `SELECT DISTINCT u.id, u.full_name,
            u.last_known_lat AS lat, u.last_known_lng AS lng
       FROM users u
       JOIN push_tokens p ON p.user_id = u.id
      WHERE u.is_tow_driver = TRUE
        AND u.tow_available = TRUE
        AND u.id <> $1
        AND u.last_known_lat IS NOT NULL
        AND u.last_known_lat BETWEEN $2 AND $3
        AND u.last_known_lng BETWEEN $4 AND $5
      LIMIT $6`,
    [
      towReq.requester_id,
      towReq.lat - latDeg, towReq.lat + latDeg,
      towReq.lng - lngDeg, towReq.lng + lngDeg,
      MAX_PUSH_DRIVERS * 2,
    ],
  );

  const nearby = [];
  for (const d of drivers) {
    const dist = distanceMeters(towReq.lat, towReq.lng, d.lat, d.lng) / 1000;
    if (dist <= radiusKm) nearby.push({ ...d, distance_km: dist });
  }
  nearby.sort((a, b) => a.distance_km - b.distance_km);

  const issueLabel = ISSUE_LABELS[towReq.issue_type] || towReq.issue_type;
  const distStr = (km) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

  for (const d of nearby.slice(0, MAX_PUSH_DRIVERS)) {
    await createNotification({
      user_id: d.id,
      type: 'tow_request_nearby',
      title: '🚨 Mentés kérés a közelben!',
      body: `${issueLabel} — ${distStr(d.distance_km)} tőled. Az első elfogadó nyer!`,
      link: '/mentes/beerkezett',
    }).catch(() => {});
  }

  // Globális event a mentős UI-nak
  realtime.emitGlobal('towing:new', {
    tow_id: towReq.id,
    issue_type: towReq.issue_type,
    vehicle_type: towReq.vehicle_type,
    lat: towReq.lat,
    lng: towReq.lng,
    address: towReq.address,
    search_radius_km: radiusKm,
    expires_at: towReq.expires_at,
  });

  console.log(`[towing] request ${towReq.id}: ${nearby.length} közeli mentős értesítve (${radiusKm} km)`);
}

module.exports = router;
