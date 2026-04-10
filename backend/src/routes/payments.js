// Barion webhook + Escrow kezelés + Payout logika.
//
// A GoFuvar pénzügyi flow:
//   1) Feladó fizet → Barion Reservation (escrow)
//   2) Webhook megerősíti a fizetést → paid_at beállítás
//   3) Sofőr lezárja a fuvart (dropoff + kód) → finishReservation
//   4) A 10% jutalék elkülönítve → számla generálás
//   5) A 90% a sofőrnek → payout (csak delivery után!)
//
// FONTOS: a payout SOHA nem történik meg a delivery confirmation előtt.
// A Barion reservation ezt biztosítja — a finishReservation csak a
// photos.js dropoff handler-ből hívódik.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const realtime = require('../realtime');

const router = express.Router();

// A Barion HMAC aláírás ellenőrzése (éles módban kötelező)
// STUB módban kihagyjuk az ellenőrzést.
function verifyBarionSignature(req) {
  // TODO: éles Barion-nál a POSKey + body hash validáció
  // Jelenleg STUB módban mindig true
  return true;
}

/**
 * Barion IPN (Instant Payment Notification) webhook.
 *
 * A Barion ezt hívja meg amikor egy fizetés státusza változik.
 * A PaymentId alapján lekérdezzük a Barion-tól az aktuális állapotot,
 * és ennek megfelelően frissítjük a saját DB-nket.
 *
 * Támogatott állapotok:
 *   - Prepared → a fizetési oldal megnyílt (nem csinálunk semmit)
 *   - Started  → a vevő megkezdte a fizetést
 *   - Succeeded → SIKERES fizetés → paid_at beállítás + értesítés
 *   - Canceled / Expired → a fizetés megszakadt → értesítés
 */
router.post('/payments/barion/callback', express.json(), async (req, res) => {
  const { PaymentId } = req.body || {};
  console.log('[barion] webhook:', { PaymentId, body: req.body });

  if (!PaymentId) {
    return res.status(400).json({ error: 'Missing PaymentId' });
  }

  if (!verifyBarionSignature(req)) {
    console.error('[barion] Érvénytelen webhook aláírás!');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Keressük meg az escrow tranzakciót
  const { rows: escrowRows } = await db.query(
    `SELECT et.*, j.id AS job_id, j.shipper_id, j.carrier_id, j.title, j.status AS job_status
       FROM escrow_transactions et
       JOIN jobs j ON j.id = et.job_id
      WHERE et.barion_payment_id = $1`,
    [PaymentId],
  );

  // Ha nem job-hoz tartozik, nézzük a route_bookings-ban
  let booking = null;
  if (!escrowRows[0]) {
    const { rows: bookingRows } = await db.query(
      `SELECT b.*, r.carrier_id, r.title AS route_title
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.barion_payment_id = $1`,
      [PaymentId],
    );
    booking = bookingRows[0];
  }

  const escrow = escrowRows[0];

  // --- STUB MODE: a stub fizetéseknél a confirm-payment endpoint
  // kezeli a paid_at beállítást, ide nem jutunk el. Éles Barion
  // esetén viszont IDE jön a megerősítés. ---

  if (escrow) {
    // Licites fuvar escrow
    // A Barion webhook nem mondja meg a státuszt közvetlenül —
    // élesben ide kellene egy Payment/GetPaymentState hívás.
    // Egyelőre naplózzuk és ha Succeeded jön, beállítjuk a paid_at-ot.
    const barionStatus = req.body.Status || 'Unknown';
    console.log(`[barion] job ${escrow.job_id}: ${barionStatus}`);

    if (barionStatus === 'Succeeded' && !escrow.paid_at) {
      // Fizetés sikeres → paid_at beállítás a job-on
      await db.query(
        `UPDATE jobs SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [escrow.job_id],
      );
      // Értesítés a sofőrnek
      if (escrow.carrier_id) {
        await createNotification({
          user_id: escrow.carrier_id,
          type: 'job_paid',
          title: '💰 Kifizették a fuvarodat!',
          body: `A(z) "${escrow.title}" fuvar ki lett fizetve. Indulhatsz!`,
          link: `/sofor/fuvar/${escrow.job_id}`,
        }).catch(() => {});
        realtime.emitToUser(escrow.carrier_id, 'job:paid', {
          job_id: escrow.job_id,
        });
      }
      // Értesítés a feladónak is
      if (escrow.shipper_id) {
        realtime.emitToUser(escrow.shipper_id, 'job:paid', {
          job_id: escrow.job_id,
        });
      }
    }

    if (barionStatus === 'Canceled' || barionStatus === 'Expired') {
      console.warn(`[barion] Fizetés megszakadt: ${escrow.job_id} → ${barionStatus}`);
      // A feladónak jelezzük
      if (escrow.shipper_id) {
        await createNotification({
          user_id: escrow.shipper_id,
          type: 'payment_failed',
          title: '⚠️ Fizetés megszakadt',
          body: `A(z) "${escrow.title}" fuvar fizetése nem sikerült. Próbáld újra.`,
          link: `/dashboard/fuvar/${escrow.job_id}`,
        }).catch(() => {});
      }
    }
  }

  if (booking) {
    const barionStatus = req.body.Status || 'Unknown';
    console.log(`[barion] booking ${booking.id}: ${barionStatus}`);

    if (barionStatus === 'Succeeded' && !booking.paid_at) {
      await db.query(
        `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [booking.id],
      );
      if (booking.carrier_id) {
        await createNotification({
          user_id: booking.carrier_id,
          type: 'booking_paid',
          title: '💰 Kifizetett foglalás!',
          body: `A(z) "${booking.route_title}" foglalás ki lett fizetve.`,
          link: `/sofor/utvonal/${booking.route_id}`,
        }).catch(() => {});
        realtime.emitToUser(booking.carrier_id, 'route-booking:paid', {
          booking_id: booking.id,
        });
      }
    }
  }

  // A Barion mindig 200-at vár vissza
  res.json({ ok: true });
});

// GET /jobs/:jobId/escrow — egy fuvar letét állapota
router.get('/jobs/:jobId/escrow', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT amount_huf, currency, status, barion_payment_id, barion_gateway_url,
            carrier_share_huf, platform_share_huf, held_at, released_at, refunded_at
       FROM escrow_transactions WHERE job_id = $1`,
    [req.params.jobId],
  );
  res.json(rows[0] || null);
});

// GET /payments/payout-status/:jobId — kifizetés állapot
// A sofőr innen tudja, hol tart a pénze.
router.get('/payments/payout-status/:jobId', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT
        et.status AS escrow_status,
        et.carrier_share_huf,
        et.platform_share_huf,
        et.currency,
        et.released_at,
        j.status AS job_status,
        j.paid_at,
        j.delivered_at
       FROM escrow_transactions et
       JOIN jobs j ON j.id = et.job_id
      WHERE j.id = $1`,
    [req.params.jobId],
  );
  if (!rows[0]) return res.json(null);
  const r = rows[0];
  res.json({
    ...r,
    payout_ready: r.job_status === 'delivered' && r.escrow_status === 'released',
    payout_blocked_reason:
      r.job_status !== 'delivered' ? 'A fuvar még nincs lezárva (kézbesítés szükséges).'
      : r.escrow_status !== 'released' ? 'Az escrow még nem szabadult fel.'
      : null,
  });
});

module.exports = router;
