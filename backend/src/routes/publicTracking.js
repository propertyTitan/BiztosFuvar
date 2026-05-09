// =====================================================================
//  Publikus fuvar-követés a címzettnek — nincs bejelentkezés.
//
//  A címzett SMS-ben kap egy linket: gofuvar.hu/nyomon-kovetes/<token>
//  Ezen az oldalon látja:
//    - Fuvar állapota (úton / megérkezett / lezárva)
//    - Sofőr neve + jármű leírása
//    - Élő pozíció (utolsó GPS ping)
//    - Becsült érkezési idő
//    - Az átvételi kód (!)
//    - QR kód (!)
// =====================================================================

const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /tracking/:token — publikus, nincs auth
router.get('/tracking/:token', async (req, res) => {
  // Keresés a jobs-ban VAGY a route_bookings-ban
  let job, pingRows = [];

  const { rows: jobRows } = await db.query(
    `SELECT j.id, j.title, j.status, 'job' AS source,
            j.pickup_address, j.dropoff_address,
            j.dropoff_lat, j.dropoff_lng,
            j.delivery_code, j.delivered_at,
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
              b.delivery_code, b.delivered_at,
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

  res.json({
    id: job.id,
    title: job.title,
    status: job.status,
    pickup_address: job.pickup_address,
    dropoff_address: job.dropoff_address,
    dropoff_lat: job.dropoff_lat,
    dropoff_lng: job.dropoff_lng,
    delivery_code: job.delivery_code,
    delivered_at: job.delivered_at,
    recipient_name: job.recipient_name,
    carrier: job.carrier_name ? {
      name: job.carrier_name,
      vehicle: job.carrier_vehicle,
      phone: job.carrier_phone,
      rating: job.carrier_rating,
    } : null,
    last_position: pingRows[0] || null,
    dropoff_needs_carrying: job.dropoff_needs_carrying,
    dropoff_floor: job.dropoff_floor,
    dropoff_has_elevator: job.dropoff_has_elevator,
  });
});

module.exports = router;
