// Élő követés: a sofőr periódikusan POST-olja a pozícióját.
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const realtime = require('../realtime');

const router = express.Router();

// POST /jobs/:jobId/location
router.post('/jobs/:jobId/location', authRequired, requireRole('carrier'), async (req, res) => {
  const { jobId } = req.params;
  const { lat, lng, speed_kmh } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'Hiányzó koordináta' });

  const { rows: jobRows } = await db.query('SELECT carrier_id, status FROM jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (job.carrier_id !== req.user.sub) return res.status(403).json({ error: 'Nincs jogosultság' });

  await db.query(
    `INSERT INTO location_pings (job_id, carrier_id, lat, lng, speed_kmh)
     VALUES ($1,$2,$3,$4,$5)`,
    [jobId, req.user.sub, lat, lng, speed_kmh || null],
  );

  const ping = { job_id: jobId, lat, lng, speed_kmh: speed_kmh || null, ts: Date.now() };
  realtime.emitToJob(jobId, 'tracking:ping', ping);
  res.json({ ok: true });
});

// GET /jobs/:jobId/location/last – legutolsó pozíció
router.get('/jobs/:jobId/location/last', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT lat, lng, speed_kmh, recorded_at
       FROM location_pings WHERE job_id = $1
      ORDER BY recorded_at DESC LIMIT 1`,
    [req.params.jobId],
  );
  res.json(rows[0] || null);
});

module.exports = router;
