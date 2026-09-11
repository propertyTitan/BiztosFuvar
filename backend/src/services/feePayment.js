// =====================================================================
//  Kapcsolatfelvételi díj — KÖZÖS könyvelési mag (2026-09-11, teljes audit A2)
//
//  Két út vezet ide: a PSP-webhook (routes/payments.js) és a kézi nyugtázás
//  (routes/jobs.js + routes/carrierRoutes.js — csak teszt-üzemben él). A kézi
//  út eddig CSUPASZ `UPDATE … SET paid_at = NOW()` volt: se állapot-őr (a
//  SELECT és az UPDATE közt lemondott ügylet is fizetetté vált), se fizetési
//  napló, se számla. Vagyis a teszt-üzem és az éles út két KÜLÖN rendszerként
//  viselkedett — amit a tesztelő végigjárt, az nem az volt, ami élesben fut.
//
//  Mostantól MINDEN díj-könyvelés ezen a magon megy át:
//    1) állapot-őr: paid_at CSAK várakozó ügyletre (accepted / confirmed —
//       vita alatt is), és csak egyszer (rowCount → a hívó 409-et ad);
//    2) a díj-sor 'released' (fuvar-ág);
//    3) ÁFA + számla a feladónak;
//    4) fizetési napló (payment_events) — az AJÁNLÓI JUTALOM erre épül, nem
//       a paid_at oszlopra (amit a kupon és a kézi SQL is beállít);
//    5) ajánlói jutalom-trigger (a napló megírása UTÁN).
//
//  A webhook idempotencia-CLAIM-je is itt él: a (payment_id, status) sort a
//  feldolgozás ELEJÉN foglaljuk le, nem a végén írjuk.
//  Őr: tests/audit-a2-penz-ut.test.js.
// =====================================================================
const db = require('../db');
const { computeVat } = require('./vat');
const { generatePlatformFeeInvoice } = require('./invoicing');
const { maybeGrantReferralReward } = require('./referral');

/** Ennyi perc után vehető át egy processed=false (elakadt) claim. */
const ELAKADT_UTAN_PERC = 2;

const VARAKOZO_ALLAPOT = {
  job: ['accepted', 'disputed'],
  booking: ['confirmed', 'disputed'],
};

/**
 * Fizetési napló-sor írása. (payment_id, status) UNIQUE — ismételt írás a
 * meglévő sort frissíti (a claim-sor ezen az úton kapja meg az adatait).
 * Sose dob.
 */
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
         event_type        = EXCLUDED.event_type,
         job_id            = COALESCE(EXCLUDED.job_id, payment_events.job_id),
         booking_id        = COALESCE(EXCLUDED.booking_id, payment_events.booking_id),
         total_amount      = COALESCE(EXCLUDED.total_amount, payment_events.total_amount),
         currency          = COALESCE(EXCLUDED.currency, payment_events.currency),
         platform_fee      = COALESCE(EXCLUDED.platform_fee, payment_events.platform_fee),
         carrier_payout    = COALESCE(EXCLUDED.carrier_payout, payment_events.carrier_payout),
         vat_rate          = COALESCE(EXCLUDED.vat_rate, payment_events.vat_rate),
         vat_amount        = COALESCE(EXCLUDED.vat_amount, payment_events.vat_amount),
         is_reverse_charge = EXCLUDED.is_reverse_charge,
         shipper_id        = COALESCE(EXCLUDED.shipper_id, payment_events.shipper_id),
         carrier_id        = COALESCE(EXCLUDED.carrier_id, payment_events.carrier_id),
         carrier_country   = COALESCE(EXCLUDED.carrier_country, payment_events.carrier_country),
         processed         = EXCLUDED.processed,
         summary           = COALESCE(EXCLUDED.summary, payment_events.summary)`,
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

/**
 * Idempotencia-claim a webhook ELEJÉN. Eredmény:
 *   { claimed: true }                         — miénk a feldolgozás
 *   { claimed: true, takeover: true }         — elakadt claimet vettünk át
 *   { claimed: false, reason: 'processed' }   — már feldolgozva
 *   { claimed: false, reason: 'in_flight' }   — épp egy másik hívás dolgozza
 */
async function claimPaymentEvent(paymentId, status, { eventType = 'webhook' } = {}) {
  try {
    return await claimPaymentEventBelso(paymentId, status, eventType);
  } catch (err) {
    // ⚠️ FAIL-OPEN: a napló admin-kényelmi funkció, a fizetés maga a pénz. Ha a
    // payment_events nem írható, a könyvelés attól még megy — az idempotencia-
    // védelem nélkül (a paid_at-őr a dupla könyvelést így is megfogja).
    // Őr: fizetes-hibaagak.test.js („a napló hibája sem buktatja el").
    console.error('[payment_events] claim hiba — feldolgozás védelem nélkül folytatva:', err.message);
    return { claimed: true, degraded: true };
  }
}

async function claimPaymentEventBelso(paymentId, status, eventType) {
  const ins = await db.query(
    `INSERT INTO payment_events (payment_id, status, event_type, processed, summary)
     VALUES ($1, $2, $3, false, 'feldolgozás alatt')
     ON CONFLICT (payment_id, status) DO NOTHING
     RETURNING id`,
    [paymentId, status, eventType],
  );
  if (ins.rowCount > 0) return { claimed: true };
  const atvesz = await db.query(
    `UPDATE payment_events
        SET created_at = NOW(), summary = 'feldolgozás újraindítva (elakadt claim átvéve)'
      WHERE payment_id = $1 AND status = $2 AND processed = false
        AND created_at < NOW() - ($3 || ' minutes')::interval
      RETURNING id`,
    [paymentId, status, String(ELAKADT_UTAN_PERC)],
  );
  if (atvesz.rowCount > 0) return { claimed: true, takeover: true };
  const { rows } = await db.query(
    `SELECT processed FROM payment_events WHERE payment_id = $1 AND status = $2`,
    [paymentId, status],
  );
  return { claimed: false, reason: rows[0]?.processed ? 'processed' : 'in_flight' };
}

/** Kivétel után: a claim felszabadítása, hogy a PSP ismétlése azonnal újra tudja próbálni. */
async function releasePaymentClaim(paymentId, status) {
  try {
    await db.query(
      `DELETE FROM payment_events WHERE payment_id = $1 AND status = $2 AND processed = false`,
      [paymentId, status],
    );
  } catch (err) {
    console.error('[payment_events] claim-felszabadítás hiba:', err.message);
  }
}

/**
 * A díj könyvelése egy fuvarra / foglalásra. Visszaad:
 *   { konyvelve: 0, ... }   — az ügylet nem várakozó / már fizetett (a hívó dönt: 409 vagy „árva")
 *   { konyvelve: 1, paidAt, invoice, vatResult, platformFee, shipper, summary }
 */
async function konyvelDijFizetes({
  entityType, entityId, paymentId, eventType, status = 'Succeeded',
  feeHuf, currency = 'HUF', shipperId, carrierId = null, carrierCountry = null,
}) {
  if (!VARAKOZO_ALLAPOT[entityType]) throw new Error(`ismeretlen entitás-típus: ${entityType}`);
  const platformFee = Number(feeHuf) || 0;

  const { rows: shipperRows } = await db.query(
    `SELECT billing_country, tax_id, company_name, email, full_name FROM users WHERE id = $1`,
    [shipperId],
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

  // 1) Állapot-őr + egyszeri paid_at (2026-09-11, teljes audit P0-1 / A2)
  let upd;
  if (entityType === 'job') {
    upd = await db.query(
      `UPDATE jobs SET paid_at = NOW()
        WHERE id = $1 AND paid_at IS NULL AND status::text = ANY($2::text[])
        RETURNING paid_at`,
      [entityId, VARAKOZO_ALLAPOT.job],
    );
    if (upd.rowCount > 0) {
      // 2) A díj-sor végleges ('released') — visszatérítés nincs
      await db.query(
        `UPDATE escrow_transactions SET status = 'released', released_at = NOW()
          WHERE job_id = $1 AND status = 'held'`,
        [entityId],
      );
    }
  } else {
    upd = await db.query(
      `UPDATE route_bookings SET paid_at = NOW()
        WHERE id = $1 AND paid_at IS NULL AND status::text = ANY($2::text[])
        RETURNING paid_at`,
      [entityId, VARAKOZO_ALLAPOT.booking],
    );
  }
  if (upd.rowCount === 0) {
    return { konyvelve: 0, vatResult, platformFee, shipper };
  }

  // 3) Számla a FELADÓNAK (stub is menti a metaadatot)
  let invoice = null;
  try {
    invoice = await generatePlatformFeeInvoice({
      jobId: entityType === 'job' ? entityId : null,
      bookingId: entityType === 'booking' ? entityId : null,
      platformFee, currency, buyerUserId: shipperId,
    });
  } catch (err) {
    console.error('[invoicing] Számla generálás hiba:', err.message);
  }

  // 4) Fizetési napló — NÉV NÉLKÜL (2026-08-09): csak azonosítók
  const vatLabel = vatResult.isReverseCharge
    ? 'ford. adózás'
    : `${Math.round(vatResult.vatRate * 100)}% ÁFA`;
  const summary = [
    `feladó: ${shipperId || '?'}`,
    `kapcsolatfelvételi díj: ${platformFee} ${currency} (${vatLabel})`,
    invoice ? `számla: ${invoice.id}` : null,
    eventType === 'manual' ? 'kézi nyugtázás (teszt-üzem)' : null,
  ].filter(Boolean).join(' · ');
  await logPaymentEvent({
    paymentId, status, eventType,
    jobId: entityType === 'job' ? entityId : null,
    bookingId: entityType === 'booking' ? entityId : null,
    totalAmount: platformFee, currency, platformFee, carrierPayout: 0,
    vatRate: vatResult.vatRate, vatAmount: vatResult.vatAmount,
    isReverseCharge: vatResult.isReverseCharge,
    shipperId, carrierId, carrierCountry,
    summary,
    processed: true,
  });

  // 5) Ajánlói jutalom — a napló megírása UTÁN (a referral a naplót olvassa)
  maybeGrantReferralReward(shipperId, {
    role: 'shipper',
    jobId: entityType === 'job' ? entityId : null,
  }).catch(() => {});

  return {
    konyvelve: 1, paidAt: upd.rows[0].paid_at, invoice, vatResult, platformFee, shipper, summary,
  };
}

module.exports = {
  ELAKADT_UTAN_PERC,
  VARAKOZO_ALLAPOT,
  logPaymentEvent,
  claimPaymentEvent,
  releasePaymentClaim,
  konyvelDijFizetes,
};
