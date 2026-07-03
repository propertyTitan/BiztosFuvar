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
const barion = require('../services/barion');
const realtime = require('../realtime');
const { getJobParty } = require('../utils/jobAccess');

const router = express.Router();

// ============================================================
// BARION WEBHOOK — Idempotens Payment State Handler
// ============================================================

router.post('/payments/barion/callback', express.json(), async (req, res) => {
  const { PaymentId } = req.body || {};
  let barionStatus = req.body.Status || 'Unknown';

  console.log(`[barion] webhook: PaymentId=${PaymentId}, Status=${barionStatus}`);

  if (!PaymentId) {
    return res.status(400).json({ error: 'Missing PaymentId' });
  }

  // A webhook body-jának NEM hiszünk: éles módban a tényleges státuszt a
  // Bariontól olvassuk vissza, így egy hamisított 'Succeeded' POST hatástalan.
  // (Stub módban nincs külső fél, marad a body — ott nincs valódi pénzmozgás.)
  if (!barion.isStub()) {
    try {
      const state = await barion.getPaymentState(PaymentId);
      barionStatus = state?.Status || 'Unknown';
    } catch (err) {
      console.error('[barion] GetPaymentState hiba a webhooknál:', err.message);
      return res.status(502).json({ error: 'Barion állapot-ellenőrzés sikertelen' });
    }
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

  // === SUCCEEDED — Sikeres díj-fizetés ===
  // Készpénzes modell: a beérkezett összeg a KAPCSOLATFELVÉTELI DÍJ (a
  // platform saját bevétele, a feladó fizeti). A fuvardíj készpénzben megy
  // a sofőrnek — arról a platform nem könyvel és nem számláz.
  if (barionStatus === 'Succeeded') {
    // 1) A díj teljes egészében a platformé; sofőr-kifizetés nincs.
    const platformFee = totalAmount;
    const carrierPayout = 0;

    // 2) VAT kiszámítás a díjat fizető FELADÓ profilja alapján
    const { rows: shipperRows } = await db.query(
      `SELECT billing_country, tax_id, company_name FROM users WHERE id = $1`,
      [d.shipper_id],
    );
    const shipper = shipperRows[0] || {};
    const vatResult = await computeVat({
      buyerCountry: shipper.billing_country || 'HU',
      buyerTaxId: shipper.tax_id,
      buyerIsCompany: !!(shipper.company_name || shipper.tax_id),
      amount: platformFee,
      currency,
    });

    // 3) paid_at beállítás (idempotens — csak ha még nincs) + a díj-sor
    //    lezárása: a szolgáltatás (kontakt-átadás) teljesült, 'released'.
    if (entity.type === 'job') {
      await db.query(
        `UPDATE jobs SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.job_id],
      );
      await db.query(
        `UPDATE escrow_transactions
            SET status = 'released', released_at = NOW()
          WHERE job_id = $1 AND status = 'held'`,
        [d.job_id],
      );
    } else {
      await db.query(
        `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.id],
      );
    }

    // 4) Számla-előkészítés a FELADÓNAK (invoice metadata) — STUB is menti
    let invoice = null;
    try {
      invoice = await generatePlatformFeeInvoice({
        jobId: entity.type === 'job' ? d.job_id : null,
        bookingId: entity.type === 'booking' ? d.id : null,
        platformFee,
        currency,
        buyerUserId: d.shipper_id,
      });
    } catch (err) {
      console.error('[invoicing] Számla generálás hiba:', err.message);
    }

    // 5) Admin-barát összefoglaló szöveg
    const vatLabel = vatResult.isReverseCharge
      ? 'ford. adózás'
      : `${Math.round(vatResult.vatRate * 100)}% ÁFA`;
    const summary = [
      `${d.shipper_name || '?'} (feladó)`,
      `kapcsolatfelvételi díj: ${platformFee} ${currency} (${vatLabel})`,
      `fuvardíj (kápé, sofőrnek): ${d.accepted_price_huf || d.price_huf || '?'} ${currency}`,
      invoice ? `számla: ${invoice.id}` : null,
    ].filter(Boolean).join(' · ');

    // 6) Payment event log (idempotency + audit)
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

    // 7) Értesítések: a kontakt felfedve, indulhat a fuvar
    if (d.carrier_id) {
      await createNotification({
        user_id: d.carrier_id,
        type: entity.type === 'job' ? 'job_paid' : 'booking_paid',
        title: '🤝 Indulhat a fuvar!',
        body: `"${title}" — a feladó kifizette a kapcsolatfelvételi díjat. Mostantól látjátok egymás elérhetőségét; a fuvardíjat készpénzben kapod.`,
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
  // IDOR-védelem: csak a fuvar fele (feladó / sofőr / admin) láthatja az
  // escrow + Barion fizetési adatokat (összegek, barion_payment_id, gateway URL).
  const { notFound, isParty } = await getJobParty(req.params.jobId, req.user);
  if (notFound) return res.status(404).json({ error: 'Fuvar nem található' });
  if (!isParty) return res.status(403).json({ error: 'Nincs jogosultság ehhez a fuvarhoz.' });

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
  // IDOR-védelem: csak a fuvar fele láthatja a kifizetési státuszt.
  const access = await getJobParty(req.params.jobId, req.user);
  if (access.notFound) return res.status(404).json({ error: 'Fuvar nem található' });
  if (!access.isParty) return res.status(403).json({ error: 'Nincs jogosultság ehhez a fuvarhoz.' });

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
  // Készpénzes modell: a "payout" a kézbesítéskor készpénzben történik,
  // a platform nem utal a sofőrnek. A mezők a UI kompatibilitás miatt
  // maradnak: payout_ready = a fuvar lezárult (a kápé átadása esedékes).
  res.json({
    ...r,
    cash_payment: true,
    payout_ready: r.job_status === 'delivered',
    payout_blocked_reason:
      r.job_status !== 'delivered' ? 'A fuvar még nincs lezárva.' : null,
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
