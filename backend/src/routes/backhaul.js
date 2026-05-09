// =====================================================================
//  Visszafuvar (backhaul) végpontok.
//
//  GET  /backhaul/suggestions
//       → A hívó sofőr összes aktív fuvarához kapcsolódó visszafuvar-
//         ajánlatok. Használat: sofor/visszafuvar oldal.
//
//  GET  /backhaul/for-trip/:jobId
//       → Csak egy konkrét fuvar (amit a sofőr már elvállalt) visszafuvar
//         jelöltjei. Használat: fuvar részletek oldalon "Visszafele mit
//         hozhatsz?" kártya.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { suggestionsForCarrier, findBackhaulCandidates } = require('../services/backhaul');

const router = express.Router();

// GET /backhaul/suggestions
// A bejelentkezett sofőr összes aktív A→B fuvarára kiad egy ajánlás-listát.
// Üres tömb: nincs aktív fuvar, VAGY nincs passzoló jelölt egyikre sem.
router.get('/backhaul/suggestions', authRequired, async (req, res) => {
  try {
    const groups = await suggestionsForCarrier(req.user.sub);
    res.json({ groups });
  } catch (err) {
    console.error('[backhaul] suggestions hiba:', err);
    res.status(500).json({ error: 'Visszafuvar-ajánlás sikertelen', detail: err.message });
  }
});

// GET /backhaul/for-trip/:jobId
// Egy konkrét, a sofőr által birtokolt fuvarhoz (carrier_id = me) adja
// vissza a visszafuvar jelölteket. Jogosultság: csak a sofőr látja, aki
// az adott A→B fuvart már elvállalta.
router.get('/backhaul/for-trip/:jobId', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, carrier_id,
            pickup_lat,  pickup_lng,  pickup_address,
            dropoff_lat, dropoff_lng, dropoff_address,
            pickup_window_end, status
       FROM jobs
      WHERE id = $1`,
    [req.params.jobId],
  );
  const trip = rows[0];
  if (!trip) return res.status(404).json({ error: 'Fuvar nem található' });
  if (trip.carrier_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a sofőrnek érhető el' });
  }
  if (!['accepted', 'in_progress'].includes(trip.status)) {
    return res.json({ candidates: [] });
  }

  const candidates = await findBackhaulCandidates({
    originLat: trip.pickup_lat,
    originLng: trip.pickup_lng,
    destLat:   trip.dropoff_lat,
    destLng:   trip.dropoff_lng,
    carrierId: req.user.sub,
    earliestPickupAt: trip.pickup_window_end || null,
  });

  res.json({ trip_id: trip.id, candidates });
});

module.exports = router;
