// =====================================================================
//  Publikus fuvar-követés a címzettnek — nincs bejelentkezés.
//
//  A címzett SMS-ben kap egy linket: gofuvar.hu/nyomon-kovetes/<token>
//  Ezen az oldalon látja:
//    - Fuvar állapota (úton / megérkezett / lezárva)
//    - Szállító neve + jármű leírása
//    - Élő pozíció (utolsó GPS ping)
//    - Becsült érkezési idő
//    - Az átvételi kód (!)
// =====================================================================

const express = require('express');
const db = require('../db');

const router = express.Router();

// A követő-link a kézbesítés (vagy lemondás) után ennyi napig él még.
// Két hét bőven elég a visszakereséshez; utána a link nem szolgál semmit.
const TRACKING_GRACE_DAYS = 14;

// GET /tracking/:token — publikus, nincs auth
router.get('/tracking/:token', async (req, res) => {
  // Keresés a jobs-ban VAGY a route_bookings-ban
  let job, pingRows = [];

  const { rows: jobRows } = await db.query(
    `SELECT j.id, j.title, j.status, 'job' AS source,
            j.pickup_address, j.dropoff_address,
            j.dropoff_lat, j.dropoff_lng,
            j.delivery_code, j.delivered_at, j.paid_at, j.cancelled_at, j.updated_at,
            j.recipient_name, j.recipient_phone,
            j.dropoff_needs_carrying, j.dropoff_floor, j.dropoff_has_elevator,
            c.full_name AS carrier_name,
            c.vehicle_type AS carrier_vehicle,
            c.phone AS carrier_phone,
            c.rating_avg AS carrier_rating
       FROM jobs j
  LEFT JOIN users c ON c.id = j.carrier_id
      WHERE j.tracking_token = $1`,
    [req.params.token],
  );
  job = jobRows[0];

  if (!job) {
    // Keresés a route_bookings-ban
    const { rows: bookingRows } = await db.query(
      `SELECT b.id, r.title, b.status, 'booking' AS source,
              b.pickup_address, b.dropoff_address,
              b.dropoff_lat, b.dropoff_lng,
              b.delivery_code, b.delivered_at, b.paid_at, b.created_at,
              b.recipient_name, b.recipient_phone,
              c.full_name AS carrier_name,
              c.vehicle_type AS carrier_vehicle,
              c.phone AS carrier_phone,
              c.rating_avg AS carrier_rating
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
    LEFT JOIN users c ON c.id = r.carrier_id
        WHERE b.tracking_token = $1`,
      [req.params.token],
    );
    job = bookingRows[0];
  }

  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });

  // Utolsó GPS pozíció (jobs-hoz van location_pings)
  if (job.source === 'job') {
    const { rows } = await db.query(
      `SELECT lat, lng, speed_kmh, recorded_at
         FROM location_pings WHERE job_id = $1
        ORDER BY recorded_at DESC LIMIT 1`,
      [job.id],
    );
    pingRows = rows;
  }

  // ── Díj-kapu (2026-08-09, biztonsági audit) ──
  // A szállító TELEFONSZÁMA és az átvételi KÓD csak a kapcsolatfelvételi díj
  // kifizetése (paid_at) UTÁN kerül a válaszba. Enélkül a feladó — aki a saját
  // fuvarából megkapja a tracking_tokent — ezen a publikus végponton fizetés
  // NÉLKÜL kiolvasná a szállító számát (a díj, a platform egyetlen bevétele,
  // megkerülhető lenne). A legitim CÍMZETT a felvételkor (ami már post-pay)
  // kapja a linket, ezért a valós követési folyamat nem sérül.
  const isPaid = !!job.paid_at;

  // ⚠️ LEJÁRAT (2026-08-10, adatáramlási audit): a token eddig az anonimizálásig
  // (3, zároltnál 5 év) élt, és LEZÁRT fuvarra is ugyanezt adta. Aki valaha
  // megkapta a linket — rossz számra ment SMS, továbbküldött levél,
  // böngésző-előzmény, Referer —, az ÉVEKIG lekérdezhette a címeket és a
  // neveket. A követés célja a kézbesítés; utána a link nem szolgál semmit.
  const lezart = ['delivered', 'completed', 'cancelled'].includes(job.status);
  const lezarasIdeje = job.delivered_at || job.cancelled_at || job.updated_at || job.created_at;
  if (lezart && lezarasIdeje
      && Date.now() - new Date(lezarasIdeje).getTime() > TRACKING_GRACE_DAYS * 86400000) {
    return res.status(410).json({ error: 'Ez a követési link lejárt.' });
  }

  res.json({
    id: job.id,
    title: job.title,
    status: job.status,
    // ⚠️ A FELVÉTELI cím NEM megy ki: a címzettet a kézbesítési cím érdekli,
    // a feladó otthoni címe rá nem tartozik. (A linket bárki megnyithatja,
    // aki hozzájut — nem kell hozzá fiók.)
    dropoff_address: job.dropoff_address,
    dropoff_lat: job.dropoff_lat,
    dropoff_lng: job.dropoff_lng,
    delivery_code: isPaid ? job.delivery_code : null,
    delivered_at: job.delivered_at,
    recipient_name: job.recipient_name,
    carrier: job.carrier_name ? {
      // A NÉV szándékosan kapu NÉLKÜL megy (korábbi tudatos döntés): a
      // címzettnek tudnia kell, ki hozza a csomagot, és a névvel — a
      // telefonszámmal ellentétben — a kapcsolatfelvételi díj nem kerülhető
      // meg. Az audit itt a fuvar- és a foglalás-ág eltérő sémáját vetette
      // össze; a díj-kapu a KONTAKT-adatra való, nem a megnevezésre.
      name: job.carrier_name,
      vehicle: job.carrier_vehicle,
      phone: isPaid ? job.carrier_phone : null,
      rating: job.carrier_rating,
    } : null,
    last_position: pingRows[0] || null,
    dropoff_needs_carrying: job.dropoff_needs_carrying,
    dropoff_floor: job.dropoff_floor,
    dropoff_has_elevator: job.dropoff_has_elevator,
  });
});

module.exports = router;
