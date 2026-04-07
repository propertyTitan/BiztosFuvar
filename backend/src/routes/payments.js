// Barion callback + escrow lekérdezés.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Barion IPN callback – sandbox / éles környezetben Barion ezt hívja meg.
// Itt csak naplózzuk és visszaigazoljuk.
router.post('/payments/barion/callback', express.json(), async (req, res) => {
  console.log('[barion] callback:', req.body);
  // TODO: PaymentId alapján Payment/GetPaymentState lekérdezés és státusz update.
  res.json({ ok: true });
});

// Egy fuvar escrow állapota (a Shipper Dashboard ezt mutatja).
router.get('/jobs/:jobId/escrow', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT amount_huf, status, barion_payment_id, barion_gateway_url,
            carrier_share_huf, platform_share_huf, held_at, released_at, refunded_at
       FROM escrow_transactions WHERE job_id = $1`,
    [req.params.jobId],
  );
  res.json(rows[0] || null);
});

module.exports = router;
