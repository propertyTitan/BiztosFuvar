// A korábbi, COMMIT utáni naplóírásból megmaradt hiányos tételek rendezése.
// A bizonylatot nem helyettesítjük banki találgatással: eredeti eseménytípus,
// egyező ügylet/fizető/összeg és fizetéskori számlázási snapshot szükséges.
const db = require('../db');
const { logPaymentEvent } = require('./feePayment');
const { maybeGrantReferralReward } = require('./referral');
const { jelezSorHibak } = require('./utemezo');

function requiresReview(paymentId) {
  return new Error(`A korábbi díjkönyvelés kézi egyeztetést igényel (${paymentId}).`);
}

async function repairReceipt(candidate) {
  const client = await db.pool.connect();
  let repaired = false;
  try {
    await client.query('BEGIN');
    // Az élő könyveléssel/fióktörléssel azonos sorrend: user → ügylet.
    await client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [candidate.shipper_id]);
    const isJob = Boolean(candidate.job_id);
    const entity = (await client.query(isJob
      ? 'SELECT id, shipper_id, paid_at FROM jobs WHERE id = $1 FOR UPDATE'
      : 'SELECT id, shipper_id, paid_at FROM route_bookings WHERE id = $1 FOR UPDATE',
    [candidate.job_id || candidate.booking_id])).rows[0];
    const receipt = (await client.query('SELECT * FROM fee_payment_receipts WHERE payment_id = $1 FOR UPDATE', [candidate.payment_id])).rows[0];
    const event = (await client.query("SELECT * FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded' FOR UPDATE", [candidate.payment_id])).rows[0];
    const session = (await client.query('SELECT * FROM payment_sessions WHERE payment_id = $1 FOR UPDATE', [candidate.payment_id])).rows[0];
    const snapshot = receipt?.invoice_snapshot;
    if (!receipt || !entity || !entity.paid_at || entity.shipper_id !== receipt.shipper_id
        || receipt.shipper_id !== candidate.shipper_id
        || receipt.job_id !== candidate.job_id || receipt.booking_id !== candidate.booking_id
        || Number(new Date(entity.paid_at)) !== Number(new Date(receipt.paid_at))
        || !snapshot || snapshot.version !== 1 || snapshot.currency !== receipt.currency
        || !snapshot.buyer || !snapshot.vat || snapshot.vat.grossAmount !== Number(receipt.fee_huf)
        || !event || !['webhook', 'manual'].includes(event.event_type)
        || (event.job_id && event.job_id !== receipt.job_id)
        || (event.booking_id && event.booking_id !== receipt.booking_id)
        || (event.shipper_id && event.shipper_id !== receipt.shipper_id)
        || (event.platform_fee != null && Number(event.platform_fee) !== Number(receipt.fee_huf))
        || (session && (session.job_id !== receipt.job_id || session.booking_id !== receipt.booking_id
          || session.shipper_id !== receipt.shipper_id || session.currency !== receipt.currency
          || Number(session.amount_huf) !== Number(receipt.fee_huf)
          || !['pending', 'succeeded'].includes(session.state)))) {
      throw requiresReview(candidate.payment_id);
    }
    if (!event.processed || session?.state === 'pending') {
      await logPaymentEvent({
        paymentId: receipt.payment_id, status: 'Succeeded', eventType: event.event_type,
        jobId: receipt.job_id, bookingId: receipt.booking_id,
        totalAmount: Number(receipt.fee_huf), currency: receipt.currency,
        platformFee: Number(receipt.fee_huf), carrierPayout: 0,
        vatRate: snapshot.vat.vatRate, vatAmount: snapshot.vat.vatAmount,
        isReverseCharge: snapshot.vat.isReverseCharge,
        shipperId: receipt.shipper_id, carrierId: event.carrier_id || session?.carrier_id,
        carrierCountry: event.carrier_country,
        summary: `Helyreállított díjkönyvelés a fizetéskori bizonylatból: ${receipt.fee_huf} ${receipt.currency}`,
        processed: true,
      }, client);
      repaired = true;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (repaired) await maybeGrantReferralReward(candidate.shipper_id, { role: 'shipper', jobId: candidate.job_id });
  return repaired;
}

async function recoverFeePaymentLedger() {
  let checked = 0;
  let repaired = 0;
  let cursor = null;
  const errors = [];
  // Kulcs szerinti lapozás: ötven régi, kézi egyeztetést igénylő sor sem
  // takarhatja el örökre a későbbi, automatikusan helyreállítható tételeket.
  while (true) {
    const { rows } = await db.query(
      `SELECT r.payment_id, r.job_id, r.booking_id, r.shipper_id
         FROM fee_payment_receipts r
         LEFT JOIN payment_events e ON e.payment_id = r.payment_id AND e.status = 'Succeeded'
         LEFT JOIN payment_sessions s ON s.payment_id = r.payment_id
        WHERE r.paid_at < NOW() - INTERVAL '2 minutes'
          AND (e.id IS NULL OR NOT e.processed OR s.state = 'pending')
          AND ($1::text IS NULL OR r.payment_id > $1)
        ORDER BY r.payment_id LIMIT 50`, [cursor],
    );
    checked += rows.length;
    for (const receipt of rows) {
      try { if (await repairReceipt(receipt)) repaired++; }
      catch (err) { errors.push(err); }
    }
    if (rows.length < 50) break;
    cursor = rows[rows.length - 1].payment_id;
  }
  jelezSorHibak('fee-payment-recovery', errors);
  return { checked, repaired, needsReview: errors.length };
}

module.exports = { recoverFeePaymentLedger };
