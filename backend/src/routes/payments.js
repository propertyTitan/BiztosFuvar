// GoFuvar Payment Processing — provider-független díj-webhook + számla.
//
// A teljes pénzügyi flow egyetlen fájlban:
//   1) Webhook fogadás (idempotens — dupla hívás nem okoz dupla feldolgozást)
//   2) VAT kiszámítás a feladó profiljából (a díjat a feladó fizeti)
//   3) Számla-adat előkészítés (invoice metadata)
//   4) Admin log (payment_events tábla)
//   5) Értesítések (push + in-app + email)
//
// ⚠️ 2026-08-09 (biztonsági audit + user-döntés): a BARION VÉGLEG TÖRÖLVE.
// A díj-webhook feldolgozója (`confirmFeePayment`) PROVIDER-FÜGGETLEN, és a
// hívó callback MÁR VISSZAELLENŐRZÖTT státuszt ad át (nem a nyers body-t) —
// így nincs "body-trust" rés. Az aktív provider a CIB vPOS (a callback
// bekötésekor); a stub (kulcs nélküli) mód dev/teszthez, valódi pénz nélkül.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { computeVat } = require('../services/vat');
const { generatePlatformFeeInvoice } = require('../services/invoicing');
const paymentProvider = require('../services/paymentProvider');
const realtime = require('../realtime');
const { getJobParty } = require('../utils/jobAccess');
const { maybeGrantReferralReward } = require('../services/referral');

const router = express.Router();

// ============================================================
// PROVIDER-FÜGGETLEN DÍJ-FIZETÉS MEGERŐSÍTÉS (közös webhook-mag)
//
// A `verifiedStatus` a hívó callback által MÁR VISSZAOLVASOTT PSP-státusz
// (nem a nyers webhook-body) — így egy hamisított "Succeeded" POST
// hatástalan. Idempotens: a (payment_id, status) UNIQUE + a `processed`
// flag véd a dupla feldolgozás ellen. Sose dob — `{ http, body }`-t ad
// vissza, amit a hívó route továbbít.
// ============================================================
async function confirmFeePayment(PaymentId, verifiedStatus) {
  const status = verifiedStatus || 'Unknown';

  // === IDEMPOTENCY CHECK ===
  try {
    const { rows: existing } = await db.query(
      `SELECT id, processed FROM payment_events WHERE payment_id = $1 AND status = $2`,
      [PaymentId, status],
    );
    if (existing.length > 0 && existing[0].processed) {
      console.log(`[fee-webhook] SKIP: ${PaymentId}/${status} már feldolgozva (idempotent)`);
      return { http: 200, body: { ok: true, skipped: true } };
    }
  } catch {}

  // === ENTITÁS KERESÉSE (fuvar VAGY foglalás a payment-id alapján) ===
  let entity = null;
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
  if (escrowRows[0]) entity = { type: 'job', data: escrowRows[0] };

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
    if (bookingRows[0]) entity = { type: 'booking', data: bookingRows[0] };
  }

  if (!entity) {
    console.warn(`[fee-webhook] PaymentId nem található: ${PaymentId}`);
    await logPaymentEvent({
      paymentId: PaymentId, status, eventType: 'webhook',
      summary: `Ismeretlen PaymentId: ${PaymentId}`,
      processed: false,
    });
    return { http: 200, body: { ok: true, unknown: true } };
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
  // a szállítónak — arról a platform nem könyvel és nem számláz.
  if (status === 'Succeeded') {
    const platformFee = totalAmount;
    const carrierPayout = 0;

    const { rows: shipperRows } = await db.query(
      `SELECT billing_country, tax_id, company_name, email, full_name
         FROM users WHERE id = $1`,
      [d.shipper_id],
    );
    const shipper = shipperRows[0] || {};
    const vatResult = await computeVat({
      buyerCountry: shipper.billing_country || 'HU',
      buyerTaxId: shipper.tax_id,
      buyerIsCompany: !!(shipper.company_name || shipper.tax_id),
      amount: platformFee,
      amountIsGross: true,
      currency,
    });

    if (entity.type === 'job') {
      await db.query(
        `UPDATE jobs SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.job_id],
      );
      await db.query(
        `UPDATE escrow_transactions SET status = 'released', released_at = NOW()
          WHERE job_id = $1 AND status = 'held'`,
        [d.job_id],
      );
    } else {
      await db.query(
        `UPDATE route_bookings SET paid_at = NOW() WHERE id = $1 AND paid_at IS NULL`,
        [d.id],
      );
    }

    // Ajánlói jutalom-trigger: a feladó kifizette az első díját (éles út).
    maybeGrantReferralReward(d.shipper_id, {
      role: 'shipper',
      jobId: entity.type === 'job' ? d.job_id : null,
    }).catch(() => {});

    // Számla-előkészítés a FELADÓNAK (STUB is menti a metaadatot)
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

    const vatLabel = vatResult.isReverseCharge
      ? 'ford. adózás'
      : `${Math.round(vatResult.vatRate * 100)}% ÁFA`;
    const summary = [
      `${d.shipper_name || '?'} (feladó)`,
      `kapcsolatfelvételi díj: ${platformFee} ${currency} (${vatLabel})`,
      `fuvardíj (kápé, szállítónak): ${d.accepted_price_huf || d.price_huf || '?'} ${currency}`,
      invoice ? `számla: ${invoice.id}` : null,
    ].filter(Boolean).join(' · ');

    await logPaymentEvent({
      paymentId: PaymentId, status, eventType: 'webhook',
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

    // Értesítések: a kontakt felfedve, indulhat a fuvar
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

    // Díj-visszaigazolás a FELADÓNAK tartós adathordozón (45/2014. 18. §)
    if (shipper.email) {
      const { sendFeeConfirmationEmail } = require('../services/email');
      setImmediate(() => {
        sendFeeConfirmationEmail({
          to: shipper.email,
          shipperName: shipper.full_name,
          jobTitle: title,
          feeHuf: totalAmount,
          cashHuf: d.accepted_price_huf || d.price_huf,
          paidAtIso: new Date().toISOString(),
          detailsPath: entity.type === 'job' ? `/dashboard/fuvar/${d.job_id}` : '/dashboard/foglalasaim',
        }).catch((e) => console.warn('[email] fee_confirmation hiba:', e.message));
      });
    }

    console.log(`[fee-webhook] ✅ SUCCEEDED: ${summary}`);
  }

  // === CANCELED / EXPIRED ===
  if (status === 'Canceled' || status === 'Expired') {
    await logPaymentEvent({
      paymentId: PaymentId, status, eventType: 'webhook',
      jobId: entity.type === 'job' ? d.job_id : null,
      bookingId: entity.type === 'booking' ? d.id : null,
      totalAmount, currency,
      summary: `${status}: "${title}" — ${totalAmount} ${currency}`,
      processed: true,
    });
    if (d.shipper_id) {
      await createNotification({
        user_id: d.shipper_id,
        type: 'payment_failed',
        title: '⚠️ Fizetés megszakadt',
        body: `A(z) "${title}" fizetése nem sikerült (${status}). Próbáld újra.`,
        link: entity.type === 'job' ? `/dashboard/fuvar/${d.job_id}` : `/dashboard/foglalasaim`,
      }).catch(() => {});
    }
    console.log(`[fee-webhook] ❌ ${status}: "${title}"`);
  }

  // === EGYÉB STÁTUSZOK (Prepared, Started, stb.) — csak logoljuk ===
  if (!['Succeeded', 'Canceled', 'Expired'].includes(status)) {
    await logPaymentEvent({
      paymentId: PaymentId, status, eventType: 'webhook',
      jobId: entity.type === 'job' ? d.job_id : null,
      bookingId: entity.type === 'booking' ? d.id : null,
      summary: `${status}: "${title}"`,
      processed: true,
    });
  }

  return { http: 200, body: { ok: true } };
}

// ============================================================
// PROVIDER-CALLBACKEK — a PSP ide POST-ol a fizetés eredményével.
//
// BIZTONSÁG: a státuszt SOHA nem a body-ból hisszük el, hanem — éles
// (nem-stub) módban — a PSP-től olvassuk vissza (`getPaymentState`), így
// egy hamisított "Succeeded" POST hatástalan. A visszaolvasott, HITELES
// státusz megy a közös `confirmFeePayment`-be.
// ============================================================
async function handleProviderCallback(req, res) {
  const PaymentId = req.body?.PaymentId || req.body?.paymentId || req.body?.transactionId;
  if (!PaymentId) return res.status(400).json({ error: 'Missing PaymentId' });

  // ⚠️ ÉLES FUTÁS + STUB PROVIDER (elfelejtett kulcs) → a lenti visszaolvasás
  // kimaradna, és a callback a NYERS BODY-nak hinne: egy hamisított
  // `{"PaymentId":"…","Status":"Succeeded"}` POST fizetés nélkül felfedné a
  // kontaktot. Ilyen állapotban semmit nem dolgozunk fel (a boot amúgy is
  // leáll — ez a második védvonal, ha valaki felülbírálja).
  if (paymentProvider.isUnsafeStub()) {
    console.error('[fee-webhook] ⛔ ELDOBVA: éles futás stub providerrel — a callback nem dolgozható fel hitelesen.');
    return res.status(503).json({ error: 'A fizetés-feldolgozás nem elérhető (hibás szolgáltató-konfiguráció).' });
  }

  let status = req.body?.Status || req.body?.status || 'Unknown';
  if (!paymentProvider.isStub()) {
    try {
      const state = await paymentProvider.getPaymentState(PaymentId);
      status = state?.Status || state?.status || 'Unknown';
    } catch (err) {
      console.error('[fee-webhook] getPaymentState hiba:', err.message);
      return res.status(502).json({ error: 'Fizetés-állapot ellenőrzés sikertelen' });
    }
  }

  const r = await confirmFeePayment(PaymentId, status);
  return res.status(r.http).json(r.body);
}

// CIB vPOS (a launch fizetése) + QVIK (dormant, ha valaha bekötjük).
// A régi /payments/barion/callback SZÁNDÉKOSAN megszűnt (Barion törölve).
router.post('/payments/cib/callback', express.json(), handleProviderCallback);
router.post('/payments/qvik/callback', express.json(), handleProviderCallback);

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
    [Math.min(Number(limit) || 50, 200), Number(offset) || 0],
  );
  res.json(rows);
});

// ============================================================
// ESCROW & PAYOUT STATUS (a fuvar felének, IDOR-védett)
// ============================================================
router.get('/jobs/:jobId/escrow', authRequired, async (req, res) => {
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
  // Készpénzes modell: a "payout" a kézbesítéskor készpénzben történik.
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
