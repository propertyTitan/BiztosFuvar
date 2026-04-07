// Kétirányú értékelés (Uber-szerű).
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// POST /jobs/:jobId/reviews
router.post('/jobs/:jobId/reviews', authRequired, async (req, res) => {
  const { jobId } = req.params;
  const { reviewee_id, rating, comment, photo_url } = req.body || {};
  if (!reviewee_id || !rating) return res.status(400).json({ error: 'Hiányzó mezők' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: '1-5 közötti pontszám' });

  const { rows: jobRows } = await db.query(
    'SELECT shipper_id, carrier_id, status FROM jobs WHERE id = $1', [jobId],
  );
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (![job.shipper_id, job.carrier_id].includes(req.user.sub)) {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  if (!['delivered', 'completed'].includes(job.status)) {
    return res.status(409).json({ error: 'Csak teljesített fuvarra adható értékelés' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, comment, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [jobId, req.user.sub, reviewee_id, rating, comment || null, photo_url || null],
    );
    // rolling average frissítés
    await client.query(
      `UPDATE users
          SET rating_count = rating_count + 1,
              rating_avg   = ((rating_avg * rating_count) + $1) / (rating_count + 1),
              updated_at   = NOW()
        WHERE id = $2`,
      [rating, reviewee_id],
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Már értékelted ezt a fuvart' });
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
