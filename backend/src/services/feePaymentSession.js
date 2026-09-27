// Minden fizetésindító út ugyanazon ügyletsorzár alatt ellenőrzi és
// használja újra a munkamenetet. A korábbi sessioneket a DB-trigger megőrzi.
const db = require('../db');
const paymentProvider = require('./paymentProvider');
const { calculateConnectionFee } = require('./connectionFee');

function stateChanged() {
  return { http: 409, body: {
    error: 'A fizetési állapot időközben megváltozott. Frissítsd az oldalt.', code: 'STATE_CHANGED',
  } };
}

function reconciliationRequired() {
  return { http: 409, body: {
    error: 'A korábbi fizetés állapotát vagy összegét előbb rendezni kell. Kérj segítséget az ügyfélszolgálattól; új fizetést nem indítottunk.',
    code: 'PAYMENT_RECONCILIATION_REQUIRED',
  } };
}

// A hívó kezeli a tranzakciót, így az elfogadás és a fizetés hivatkozása együtt mentődik.
async function startOrReuseFeePaymentInTransaction(client, { entityType, entityId, shipperId, requireConsent = true }) {
  const isJob = entityType === 'job';
  if (!isJob && entityType !== 'booking') throw new Error('Ismeretlen fizetési ügylet.');
  // A kezdeti route-SELECT óta másik kérés indíthatott fizetést, vagy a
  // fuvar új megállapodást kaphatott. Az ár és a gateway is újraolvasandó.
  const { rows } = await client.query(isJob
    ? `SELECT j.*, s.email AS shipper_email
         FROM jobs j JOIN users s ON s.id = j.shipper_id
        WHERE j.id = $1 FOR UPDATE OF j`
    : `SELECT b.*, s.email AS shipper_email
         FROM route_bookings b JOIN users s ON s.id = b.shipper_id
        WHERE b.id = $1 FOR UPDATE OF b`, [entityId]);
  const entity = rows[0];
  if (!entity || entity.shipper_id !== shipperId || entity.status !== (isJob ? 'accepted' : 'confirmed')
      || entity.paid_at || (requireConsent && !entity.fee_consent_at)) {
    return stateChanged();
  }
  if (isJob) {
    // Külön statement a zár megszerzése UTÁN: egy LEFT JOIN az előző
    // statement snapshotjában még az első /pay előtti escrowt adhatná.
    const escrow = await client.query(
      'SELECT barion_payment_id, barion_gateway_url, amount_huf AS payment_amount_huf, status AS escrow_status FROM escrow_transactions WHERE job_id = $1', [entity.id],
    );
    Object.assign(entity, escrow.rows[0]);
  }
  const feeHuf = entity.connection_fee_huf
    ?? calculateConnectionFee(isJob ? entity.accepted_price_huf || entity.suggested_price_huf || 0 : entity.price_huf);
  // Régi/felülírt, de még fizethető session mellett sem indítható újabb.
  const sessions = (await client.query(
    `SELECT * FROM payment_sessions WHERE ${isJob ? 'job_id' : 'booking_id'} = $1 ORDER BY payment_id FOR UPDATE`, [entity.id],
  )).rows;
  const previous = sessions.find(s => s.payment_id === entity.barion_payment_id);
  if (sessions.some(s => s.state !== 'closed' && s.payment_id !== entity.barion_payment_id)
      || (isJob && entity.escrow_status && entity.escrow_status !== 'held')) return reconciliationRequired();
  if (previous && ['succeeded', 'needs_review'].includes(previous.state)) return stateChanged();
  if (entity.barion_payment_id || entity.barion_gateway_url) {
    if (!previous) return reconciliationRequired();
    if (previous.state !== 'closed') {
      if (!entity.barion_gateway_url || Number(previous.amount_huf) !== Number(feeHuf)
          || previous.currency !== 'HUF' || previous.shipper_id !== shipperId
          || (isJob && Number(entity.payment_amount_huf) !== Number(feeHuf))) return reconciliationRequired();
      return { http: 200, body: {
        payment_id: entity.barion_payment_id, gateway_url: entity.barion_gateway_url,
        fee_huf: feeHuf, is_stub: previous.is_simulated, reused: true,
      } };
    }
  }

  let payment;
  try {
    payment = await paymentProvider.startFeePayment({
      jobId: entity.id, feeHuf, shipperEmail: entity.shipper_email,
      ...(isJob ? {} : { redirectPath: '/dashboard/foglalasaim' }),
    });
    if (!payment?.paymentId || !payment.gatewayUrl
        || (previous?.state === 'closed' && payment.paymentId === entity.barion_payment_id && !payment.stub)) {
      throw new Error('A fizetésszolgáltató nem adott új, használható fizetési munkamenetet.');
    }
  } catch (err) {
    console.error('[fee-payment] indítási hiba:', err.message);
    return { http: 502, body: { error: 'A díjfizetés indítása sikertelen', detail: err.message } };
  }

  if (isJob) {
    await client.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, barion_gateway_url, carrier_share_huf, platform_share_huf)
       VALUES ($1, $2, 'held', $3, $4, 0, $2)
       ON CONFLICT (job_id) DO UPDATE SET
         amount_huf = EXCLUDED.amount_huf, barion_payment_id = EXCLUDED.barion_payment_id,
         barion_gateway_url = EXCLUDED.barion_gateway_url, carrier_share_huf = 0,
         platform_share_huf = EXCLUDED.platform_share_huf, held_at = NOW()`,
      [entity.id, feeHuf, payment.paymentId, payment.gatewayUrl],
    );
    await client.query('UPDATE jobs SET connection_fee_huf = $1 WHERE id = $2 AND connection_fee_huf IS NULL', [feeHuf, entity.id]);
  } else {
    await client.query(
      `UPDATE route_bookings SET barion_payment_id = $1, barion_gateway_url = $2,
              connection_fee_huf = COALESCE(connection_fee_huf, $3), carrier_share_huf = 0,
              platform_share_huf = COALESCE(platform_share_huf, $3) WHERE id = $4`,
      [payment.paymentId, payment.gatewayUrl, feeHuf, entity.id],
    );
  }
  return { http: 200, body: {
    payment_id: payment.paymentId, gateway_url: payment.gatewayUrl,
    fee_huf: feeHuf, is_stub: !!payment.stub, reused: false,
  } };
}

async function startOrReuseFeePayment(options) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await startOrReuseFeePaymentInTransaction(client, options);
    await client.query(result.http === 200 ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { startOrReuseFeePayment, startOrReuseFeePaymentInTransaction };
