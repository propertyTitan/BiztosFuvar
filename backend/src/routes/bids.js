// Licit (Bid) végpontok + escrow letét szimuláció.
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const realtime = require('../realtime');
const barion = require('../services/barion');

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
      `SELECT b.*, j.shipper_id, j.status AS job_status,
              s.email AS shipper_email,
              c.email AS carrier_email
         FROM bids b
         JOIN jobs j  ON j.id = b.job_id
         JOIN users s ON s.id = j.shipper_id
         JOIN users c ON c.id = b.carrier_id
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
    // Barion: foglalás indítása (Payment Reservation)
    let barionRes = { paymentId: null, gatewayUrl: null };
    try {
      barionRes = await barion.reservePayment({
        jobId: bid.job_id,
        totalHuf: bid.amount_huf,
        shipperEmail: bid.shipper_email,
        carrierEmail: bid.carrier_email,
      });
    } catch (err) {
      console.error('[barion] reservePayment hiba:', err.message);
      await client.query('ROLLBACK');
      return res.status(502).json({ error: 'Barion foglalás sikertelen', detail: err.message });
    }

    const carrierShare = Math.round(bid.amount_huf * (1 - barion.COMMISSION_PCT));
    const platformShare = bid.amount_huf - carrierShare;

    await client.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, barion_gateway_url,
          carrier_share_huf, platform_share_huf)
       VALUES ($1,$2,'held',$3,$4,$5,$6)
       ON CONFLICT (job_id) DO UPDATE SET
         amount_huf         = EXCLUDED.amount_huf,
         status             = 'held',
         barion_payment_id  = EXCLUDED.barion_payment_id,
         barion_gateway_url = EXCLUDED.barion_gateway_url,
         carrier_share_huf  = EXCLUDED.carrier_share_huf,
         platform_share_huf = EXCLUDED.platform_share_huf,
         held_at            = NOW()`,
      [bid.job_id, bid.amount_huf, barionRes.paymentId, barionRes.gatewayUrl, carrierShare, platformShare],
    );

    await client.query('COMMIT');
    realtime.emitToJob(bid.job_id, 'job:accepted', {
      job_id: bid.job_id,
      carrier_id: bid.carrier_id,
      amount_huf: bid.amount_huf,
      barion_gateway_url: barionRes.gatewayUrl,
    });
    res.json({
      ok: true,
      job_id: bid.job_id,
      carrier_id: bid.carrier_id,
      amount_huf: bid.amount_huf,
      barion: {
        payment_id: barionRes.paymentId,
        gateway_url: barionRes.gatewayUrl,
        carrier_share_huf: carrierShare,
        platform_share_huf: platformShare,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
