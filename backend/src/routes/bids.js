// Licit (Bid) végpontok + escrow letét szimuláció.
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const realtime = require('../realtime');

const router = express.Router();

// POST /jobs/:jobId/bids – sofőr licitál
router.post('/jobs/:jobId/bids', authRequired, requireRole('carrier'), async (req, res) => {
  const { jobId } = req.params;
  const { amount_huf, message, eta_minutes } = req.body || {};
  if (!amount_huf || amount_huf <= 0) return res.status(400).json({ error: 'Érvénytelen összeg' });

  const { rows: jobRows } = await db.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
  if (!jobRows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
  if (!['pending', 'bidding'].includes(jobRows[0].status)) {
    return res.status(409).json({ error: 'A fuvarra már nem lehet licitálni' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, message, eta_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [jobId, req.user.sub, amount_huf, message || null, eta_minutes || null],
    );
    realtime.emitToJob(jobId, 'bids:new', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Már licitáltál erre a fuvarra' });
    throw err;
  }
});

// GET /jobs/:jobId/bids
router.get('/jobs/:jobId/bids', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, u.full_name AS carrier_name, u.rating_avg, u.rating_count
       FROM bids b JOIN users u ON u.id = b.carrier_id
      WHERE b.job_id = $1 ORDER BY b.amount_huf ASC`,
    [req.params.jobId],
  );
  res.json(rows);
});

// POST /bids/:id/accept – feladó elfogadja a licitet → ESCROW lefoglalás
router.post('/bids/:id/accept', authRequired, requireRole('shipper'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: bidRows } = await client.query(
      `SELECT b.*, j.shipper_id, j.status AS job_status
         FROM bids b JOIN jobs j ON j.id = b.job_id
        WHERE b.id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const bid = bidRows[0];
    if (!bid) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Licit nem található' }); }
    if (bid.shipper_id !== req.user.sub) {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    if (!['pending', 'bidding'].includes(bid.job_status)) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'A fuvar már nem elfogadható' });
    }

    await client.query(`UPDATE bids SET status = 'accepted' WHERE id = $1`, [bid.id]);
    await client.query(
      `UPDATE bids SET status = 'rejected' WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
      [bid.job_id, bid.id],
    );
    await client.query(
      `UPDATE jobs SET status = 'accepted', carrier_id = $1, accepted_price_huf = $2, updated_at = NOW()
        WHERE id = $3`,
      [bid.carrier_id, bid.amount_huf, bid.job_id],
    );
    // Escrow szimuláció: a fuvardíj "letétbe kerül"
    await client.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status)
       VALUES ($1, $2, 'held')
       ON CONFLICT (job_id) DO UPDATE SET amount_huf = EXCLUDED.amount_huf, status = 'held', held_at = NOW()`,
      [bid.job_id, bid.amount_huf],
    );

    await client.query('COMMIT');
    realtime.emitToJob(bid.job_id, 'job:accepted', { job_id: bid.job_id, carrier_id: bid.carrier_id, amount_huf: bid.amount_huf });
    res.json({ ok: true, job_id: bid.job_id, carrier_id: bid.carrier_id, amount_huf: bid.amount_huf });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
