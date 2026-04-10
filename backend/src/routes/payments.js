// GoFuvar Payment Processing — Barion Webhook + Escrow + Split + Invoice.
//
// A teljes pénzügyi flow egyetlen fájlban:
//   1) Webhook fogadás (idempotens — dupla hívás nem okoz dupla feldolgozást)
//   2) Split kalkuláció (90/10)
//   3) VAT kiszámítás a sofőr profiljából
//   4) Számla-adat előkészítés (invoice metadata)
//   5) Admin log (payment_events tábla)
//   6) Értesítések (push + in-app + email)
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { computeVat } = require('../services/vat');
const { generatePlatformFeeInvoice } = require('../services/invoicing');
const { freezeExchangeRate } = require('../services/exchange');
const barion = require('../services/barion');
const realtime = require('../realtime');

const router = express.Router();

// ============================================================
// BARION WEBHOOK — Idempotens Payment State Handler
// ============================================================

router.post('/payments/barion/callback', express.json(), async (req, res) => {
  const { PaymentId } = req.body || {};
  const barionStatus = req.body.Status || 'Unknown';

  console.log(`[barion] webhook: PaymentId=${PaymentId}, Status=${barionStatus}`);

  if (!PaymentId) {
    return res.status(400).json({ error: 'Missing PaymentId' });
  }

  // === IDEMPOTENCY CHECK ===
  // Ha ezt a PaymentId + Status kombinációt már feldolgoztuk, kihagyjuk.
  // A UNIQUE constraint (payment_id, status) biztosítja DB szinten is.
  try {
    const { rows: existing } = await db.query(
      `SELECT id, processed FROM payment_events
        WHERE payment_id = $1 AND status = $2`,
      [PaymentId, barionStatus],
    );
    if (existing.length > 0 && existing[0].processed) {
      console.log(`[barion] SKIP: ${PaymentId}/${barionStatus} már feldolgozva (idempotent)`);
      return res.json({ ok: true, skipped: true });
    }
  } catch {}

  // === ENTITÁS KERESÉSE ===
  // Megkeressük melyik fuvarhoz vagy foglaláshoz tartozik a PaymentId
  let entity = null; // { type: 'job' | 'booking', data: {...} }

  const { rows: escrowRows } = await db.query(
    `SELECT et.*,
            j.id AS job_id, j.shipper_id, j.carrier_id, j.title,
            j.status AS job_status, j.currency AS job_currency,
            s.full_name AS shipper_name, s.billing_country AS shipper_country,
            c.full_name AS carrier_name, c.billing_country AS carrier_country,
            c.tax_id AS carrier_tax_id, c.company_name AS carrier_company,
            c.locale AS carrier_locale
       FROM escrow_transactions et
       JOIN jobs j ON j.id = et.job_id
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
      WHERE et.barion_payment_id = $1`,
    [PaymentId],
  );
  if (escrowRows[0]) {
    entity = { type: 'job', data: escrowRows[0] };
  }

  if (!entity) {
    const { rows: bookingRows } = await db.query(
      `SELECT b.*,
              r.carrier_id, r.title AS route_title,
              s.full_name AS shipper_name,
              c.full_name AS carrier_name, c.billing_country AS carrier_country,
              c.tax_id AS carrier_tax_id, c.company_name AS carrier_company,
              c.locale AS carrier_locale
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
         JOIN users s ON s.id = b.shipper_id
    LEFT JOIN users c ON c.id = r.carrier_id
        WHERE b.barion_payment_id = $1`,
      [PaymentId],
    );
    if (bookingRows[0]) {
      entity = { type: 'booking', data: bookingRows[0] };
    }
  }

  if (!entity) {
    console.warn(`[barion] PaymentId nem található: ${PaymentId}`);
    // Még így is mentjük az event-et az audithoz
    await logPaymentEvent({
      paymentId: PaymentId, status: barionStatus, eventType: 'webhook',
      summary: `Ismeretlen PaymentId: ${PaymentId}`,
      processed: false,
    });
    return res.json({ ok: true, unknown: true });
  }

  const d = entity.data;
  const totalAmount = entity.type === 'job'
    ? (d.amount_huf || d.accepted_price_huf || 0)
    : (d.price_huf || 0);
  const currency = d.currency || d.job_currency || 'HUF';
  const title = d.title || d.route_title || '?';

  // === SUCCEEDED — Sikeres fizetés ===
  if (barionStatus === 'Succeeded') {
    // 1) Split kalkuláció
    const platformFee = Math.round(totalAmount * barion.COMMISSION_PCT);
    const carrierPayout = totalAmount - platformFee;

    // 2) VAT kiszámítás a sofőr profilja alapján
    const vatResult = await computeVat({
      buyerCountry: d.carrier_country || 'HU',
      buyerTaxId: d.carrier_tax_id,
      buyerIsCompany: !!(d.carrier_company || d.carrier_tax_id),
      amount: platformFee,
      currency,
    });

    // 3) Árfolyam befagyasztás (ha EUR tranzakció)
    let exchangeData = null;
    if (currency === 'EUR') {
      exchangeData = await freezeExchangeRate();
    }

    // 4) paid_at beállítás (idempotens — csak ha még nincs)
    if (entity.type === 'job') {
      await db.query(
        `UPDATE jobs SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.job_id],
      );
      if (exchangeData) {
        await db.query(
          `UPDATE escrow_transactions
              SET exchange_rate = $1, exchange_rate_frozen_at = NOW()
            WHERE job_id = $2`,
          [exchangeData.rate, d.job_id],
        );
      }
    } else {
      await db.query(
        `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.id],
      );
    }

    // 5) Számla-előkészítés (invoice metadata) — STUB módban is menti
    let invoice = null;
    if (d.carrier_id) {
      try {
        invoice = await generatePlatformFeeInvoice({
          jobId: entity.type === 'job' ? d.job_id : null,
          bookingId: entity.type === 'booking' ? d.id : null,
          platformFee,
          currency,
          carrierId: d.carrier_id,
        });
      } catch (err) {
        console.error('[invoicing] Számla generálás hiba:', err.message);
      }
    }

    // 6) Admin-barát összefoglaló szöveg
    const carrierType = d.carrier_company ? 'cég' : 'magánszemély';
    const carrierCountryLabel = d.carrier_country || 'HU';
    const vatLabel = vatResult.isReverseCharge
      ? 'ford. adózás'
      : `${Math.round(vatResult.vatRate * 100)}% ÁFA`;
    const summary = [
      `${carrierCountryLabel} ${carrierType}`,
      `${d.carrier_name || '?'}`,
      `fizet: ${totalAmount} ${currency}`,
      `jutalék: ${platformFee} ${currency} (${vatLabel})`,
      `sofőr kap: ${carrierPayout} ${currency}`,
      exchangeData ? `árfolyam: ${exchangeData.rate} HUF/EUR` : null,
      invoice ? `számla: ${invoice.id}` : null,
    ].filter(Boolean).join(' · ');

    // 7) Payment event log (idempotency + audit)
    await logPaymentEvent({
      paymentId: PaymentId, status: barionStatus, eventType: 'webhook',
      jobId: entity.type === 'job' ? d.job_id : null,
      bookingId: entity.type === 'booking' ? d.id : null,
      totalAmount, currency, platformFee, carrierPayout,
      vatRate: vatResult.vatRate, vatAmount: vatResult.vatAmount,
      isReverseCharge: vatResult.isReverseCharge,
      shipperId: d.shipper_id, carrierId: d.carrier_id,
      carrierCountry: d.carrier_country,
      summary,
      processed: true,
    });

    // 8) Értesítések
    if (d.carrier_id) {
      await createNotification({
        user_id: d.carrier_id,
        type: entity.type === 'job' ? 'job_paid' : 'booking_paid',
        title: '💰 Kifizették a fuvarodat!',
        body: `"${title}" — ${totalAmount} ${currency}. A sofőri részt (${carrierPayout} ${currency}) a kézbesítés után kapod meg.`,
        link: entity.type === 'job' ? `/sofor/fuvar/${d.job_id}` : `/sofor/utvonal/${d.route_id}`,
      }).catch(() => {});
      realtime.emitToUser(d.carrier_id, entity.type === 'job' ? 'job:paid' : 'route-booking:paid', {
        job_id: d.job_id, booking_id: d.id,
      });
    }
    if (d.shipper_id) {
      realtime.emitToUser(d.shipper_id, entity.type === 'job' ? 'job:paid' : 'route-booking:paid', {
        job_id: d.job_id, booking_id: d.id,
      });
    }

    console.log(`[barion] ✅ SUCCEEDED: ${summary}`);
  }

  // === CANCELED / EXPIRED ===
  if (barionStatus === 'Canceled' || barionStatus === 'Expired') {
    await logPaymentEvent({
      paymentId: PaymentId, status: barionStatus, eventType: 'webhook',
      jobId: entity.type === 'job' ? d.job_id : null,
      bookingId: entity.type === 'booking' ? d.id : null,
      totalAmount, currency,
      summary: `${barionStatus}: "${title}" — ${totalAmount} ${currency}`,
      processed: true,
    });

    if (d.shipper_id) {
      await createNotification({
        user_id: d.shipper_id,
        type: 'payment_failed',
        title: '⚠️ Fizetés megszakadt',
        body: `A(z) "${title}" fizetése nem sikerült (${barionStatus}). Próbáld újra.`,
        link: entity.type === 'job' ? `/dashboard/fuvar/${d.job_id}` : `/dashboard/foglalasaim`,
      }).catch(() => {});
    }

    console.log(`[barion] ❌ ${barionStatus}: "${title}"`);
  }

  // === EGYÉB STÁTUSZOK (Prepared, Started, stb.) — csak logoljuk ===
  if (!['Succeeded', 'Canceled', 'Expired'].includes(barionStatus)) {
    await logPaymentEvent({
      paymentId: PaymentId, status: barionStatus, eventType: 'webhook',
      jobId: entity.type === 'job' ? d.job_id : null,
      bookingId: entity.type === 'booking' ? d.id : null,
      summary: `${barionStatus}: "${title}"`,
      processed: true,
    });
  }

  res.json({ ok: true });
});

// ============================================================
// ADMIN — Fizetési napló
// ============================================================

router.get('/payments/admin/log', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak admin' });
  }
  const { limit = 50, offset = 0 } = req.query;
  const { rows } = await db.query(
    `SELECT pe.*,
            j.title AS job_title,
            r.title AS route_title
       FROM payment_events pe
  LEFT JOIN jobs j ON j.id = pe.job_id
  LEFT JOIN route_bookings rb ON rb.id = pe.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
      ORDER BY pe.created_at DESC
      LIMIT $1 OFFSET $2`,
    [Math.min(Number(limit), 200), Number(offset)],
  );
  res.json(rows);
});

// ============================================================
// ESCROW & PAYOUT STATUS
// ============================================================

router.get('/jobs/:jobId/escrow', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT amount_huf, currency, status, barion_payment_id, barion_gateway_url,
            carrier_share_huf, platform_share_huf, exchange_rate,
            held_at, released_at, refunded_at
       FROM escrow_transactions WHERE job_id = $1`,
    [req.params.jobId],
  );
  res.json(rows[0] || null);
});

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
      r.job_status !== 'delivered' ? 'A fuvar még nincs lezárva.'
      : r.escrow_status !== 'released' ? 'Az escrow még nem szabadult fel.'
      : null,
  });
});

// ============================================================
// HELPER
// ============================================================

async function logPaymentEvent({
  paymentId, status, eventType,
  jobId, bookingId,
  totalAmount, currency, platformFee, carrierPayout,
  vatRate, vatAmount, isReverseCharge,
  shipperId, carrierId, carrierCountry,
  summary,
  processed,
}) {
  try {
    await db.query(
      `INSERT INTO payment_events (
         payment_id, status, event_type,
         job_id, booking_id,
         total_amount, currency, platform_fee, carrier_payout,
         vat_rate, vat_amount, is_reverse_charge,
         shipper_id, carrier_id, carrier_country,
         summary, processed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (payment_id, status) DO UPDATE SET
         processed = EXCLUDED.processed,
         summary = COALESCE(EXCLUDED.summary, payment_events.summary)`,
      [
        paymentId, status, eventType,
        jobId || null, bookingId || null,
        totalAmount || null, currency || 'HUF', platformFee || null, carrierPayout || null,
        vatRate || null, vatAmount || null, isReverseCharge || false,
        shipperId || null, carrierId || null, carrierCountry || null,
        summary || null, processed,
      ],
    );
  } catch (err) {
    console.error('[payment_events] log hiba:', err.message);
  }
}

module.exports = router;
