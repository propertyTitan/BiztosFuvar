// Fotó-feltöltés (Proof of Delivery 2.0).
// - Memóriából tölti fel a multipart fájlt.
// - GPS koordináta + Gemini AI elemzés.
// - Dropoff típusnál validálja a céltól mért távolságot.
// - Sikeres validáció után a fuvar 'delivered' státuszba kerül és az
//   escrow letét felszabadul ('released').
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { analyzeCargoPhoto } = require('../services/gemini');
const { distanceMeters } = require('../utils/geo');
const realtime = require('../realtime');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_DROPOFF_DISTANCE_M = parseInt(process.env.DELIVERY_MAX_DISTANCE_METERS || '50', 10);

// MEGJEGYZÉS: Production-ben a fájlt S3 / Supabase Storage / GCS-be töltjük fel
// és a visszakapott URL-t mentjük. Itt egyelőre data URL-t mentünk – ezt
// cseréld le, mielőtt élesbe kerül.
function fakeUpload(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64').slice(0, 64)}...`;
}

// POST /jobs/:jobId/photos
//   multipart/form-data: file, kind, gps_lat, gps_lng, gps_accuracy_m
router.post('/jobs/:jobId/photos', authRequired, upload.single('file'), async (req, res) => {
  const { jobId } = req.params;
  const { kind, gps_lat, gps_lng, gps_accuracy_m } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  if (!['pickup', 'dropoff', 'damage', 'document'].includes(kind)) {
    return res.status(400).json({ error: 'Érvénytelen kind' });
  }

  const { rows: jobRows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (job.carrier_id !== req.user.sub) return res.status(403).json({ error: 'Csak a kijelölt sofőr tölthet fel fotót' });

  // 1) AI elemzés
  let ai = { has_cargo: null, confidence: null, raw: null };
  try {
    ai = await analyzeCargoPhoto(req.file.buffer, req.file.mimetype, kind);
  } catch (err) {
    console.warn('[gemini] photo analyze hiba:', err.message);
  }

  // 2) Tárolás (jelenleg fake URL)
  const url = fakeUpload(req.file);

  // 3) Mentés
  const { rows } = await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url, gps_lat, gps_lng, gps_accuracy_m,
                         ai_has_cargo, ai_confidence, ai_raw_response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      jobId, req.user.sub, kind, url,
      gps_lat ? parseFloat(gps_lat) : null,
      gps_lng ? parseFloat(gps_lng) : null,
      gps_accuracy_m ? parseFloat(gps_accuracy_m) : null,
      ai.has_cargo, ai.confidence, ai.raw ? JSON.stringify(ai.raw) : null,
    ],
  );
  const photo = rows[0];

  // 4) Workflow tranzíciók
  const validation = { distance_m: null, max_distance_m: MAX_DROPOFF_DISTANCE_M, ok: true };

  if (kind === 'pickup' && job.status === 'accepted') {
    await db.query(`UPDATE jobs SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [jobId]);
    realtime.emitToJob(jobId, 'job:picked_up', { job_id: jobId, photo });
  }

  if (kind === 'dropoff' && job.status === 'in_progress') {
    if (gps_lat == null || gps_lng == null) {
      validation.ok = false;
      validation.reason = 'Hiányzó GPS koordináta a lerakodáskor';
    } else {
      validation.distance_m = Math.round(
        distanceMeters(parseFloat(gps_lat), parseFloat(gps_lng), job.dropoff_lat, job.dropoff_lng),
      );
      validation.ok = validation.distance_m <= MAX_DROPOFF_DISTANCE_M;
      if (!validation.ok) validation.reason = `Túl messze a céltól (${validation.distance_m} m)`;
    }

    if (validation.ok) {
      await db.query(
        `UPDATE jobs SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [jobId],
      );
      // Escrow felszabadítás → kifizetés szimuláció
      await db.query(
        `UPDATE escrow_transactions SET status = 'released', released_at = NOW() WHERE job_id = $1`,
        [jobId],
      );
      realtime.emitToJob(jobId, 'job:delivered', { job_id: jobId, photo, validation });
    } else {
      realtime.emitToJob(jobId, 'job:dropoff_rejected', { job_id: jobId, photo, validation });
    }
  }

  res.status(201).json({ photo, validation });
});

// GET /jobs/:jobId/photos
router.get('/jobs/:jobId/photos', authRequired, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM photos WHERE job_id = $1 ORDER BY taken_at ASC',
    [req.params.jobId],
  );
  res.json(rows);
});

module.exports = router;
