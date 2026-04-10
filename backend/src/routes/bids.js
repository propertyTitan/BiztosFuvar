// Licit (Bid) végpontok + escrow letét szimuláció.
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const realtime = require('../realtime');
const barion = require('../services/barion');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendBidReceivedEmail, sendBidAcceptedEmail } = require('../services/email');

const router = express.Router();

// GET /bids/mine – a bejelentkezett felhasználó összes leadott licitje
//   (bárki lehet most már licitáló, nem csak "carrier" role).
router.get('/bids/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT
        b.id              AS bid_id,
        b.amount_huf,
        b.eta_minutes,
        b.message,
        b.status          AS bid_status,
        b.created_at      AS bid_created_at,
        j.id              AS job_id,
        j.title           AS job_title,
        j.status          AS job_status,
        j.pickup_address,
        j.dropoff_address,
        j.distance_km,
        j.suggested_price_huf,
        j.accepted_price_huf,
        j.carrier_id      AS job_carrier_id
       FROM bids b
       JOIN jobs j ON j.id = b.job_id
      WHERE b.carrier_id = $1
      ORDER BY b.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// POST /jobs/:jobId/bids – bárki licitálhat egy fuvarra, kivéve ha ő a feladója
router.post('/jobs/:jobId/bids', authRequired, writeRateLimit, async (req, res) => {
  const { jobId } = req.params;
  const { amount_huf, message, eta_minutes } = req.body || {};
  if (!amount_huf || amount_huf <= 0) return res.status(400).json({ error: 'Érvénytelen összeg' });

  const { rows: jobRows } = await db.query(
    'SELECT status, shipper_id FROM jobs WHERE id = $1',
    [jobId],
  );
  if (!jobRows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
  if (jobRows[0].shipper_id === req.user.sub) {
    return res.status(403).json({ error: 'A saját fuvarodra nem licitálhatsz.' });
  }
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

    // Értesítés a feladónak: új licit érkezett (in-app + email)
    try {
      const { rows: jRows } = await db.query(
        `SELECT j.shipper_id, j.title,
                s.email AS shipper_email, s.full_name AS shipper_name,
                u.full_name AS carrier_name
           FROM jobs j
           JOIN users s ON s.id = j.shipper_id
           JOIN users u ON u.id = $2
          WHERE j.id = $1`,
        [jobId, req.user.sub],
      );
      if (jRows[0]) {
        const info = jRows[0];
        await createNotification({
          user_id: info.shipper_id,
          type: 'bid_received',
          title: 'Új licit érkezett 🎯',
          body: `${info.carrier_name} ${amount_huf.toLocaleString('hu-HU')} Ft ajánlatot tett a(z) "${info.title}" fuvaradra.`,
          link: `/dashboard/fuvar/${jobId}`,
        });
        // Email is, fire-and-forget (ne blokkolja a választ)
        setImmediate(() => {
          sendBidReceivedEmail({
            to: info.shipper_email,
            shipperName: info.shipper_name,
            jobTitle: info.title,
            jobId,
            carrierName: info.carrier_name,
            amountHuf: amount_huf,
          }).catch((e) => console.warn('[email] bid_received hiba:', e.message));
        });
      }
    } catch (e) {
      console.warn('[notifications] bid_received hiba:', e.message);
    }

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

// POST /bids/:id/accept – a fuvar feladója elfogadja a licitet → ESCROW lefoglalás
// (Bárki elfogadhat, aki feladta a fuvart — a tulajdonos-ellenőrzés alább.)
router.post('/bids/:id/accept', authRequired, writeRateLimit, async (req, res) => {
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

    // Értesítés a nyertes sofőrnek (in-app + email)
    try {
      const { rows: jobInfo } = await db.query(
        `SELECT j.title, u.full_name AS carrier_name, u.email AS carrier_email
           FROM jobs j
           JOIN users u ON u.id = $2
          WHERE j.id = $1`,
        [bid.job_id, bid.carrier_id],
      );
      const info = jobInfo[0] || {};
      await createNotification({
        user_id: bid.carrier_id,
        type: 'bid_accepted',
        title: '🎉 Elfogadták a licitedet!',
        body: `A(z) "${info.title || 'fuvar'}" licitedet elfogadták ${bid.amount_huf.toLocaleString('hu-HU')} Ft-ért. Nyisd meg a mobilappot a fuvar indításához.`,
        link: `/sofor/fuvar/${bid.job_id}`,
      });
      if (info.carrier_email) {
        setImmediate(() => {
          sendBidAcceptedEmail({
            to: info.carrier_email,
            carrierName: info.carrier_name,
            jobTitle: info.title,
            jobId: bid.job_id,
            amountHuf: bid.amount_huf,
          }).catch((e) => console.warn('[email] bid_accepted hiba:', e.message));
        });
      }
    } catch (e) {
      console.warn('[notifications] bid_accepted hiba:', e.message);
    }

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
