// A /pay ugyanazon ügyletsorzár alatt ellenőrzi az aktuális fizetést és
// indít újat. A korábbi sessionek nyomát a DB-trigger megőrzi.
const db = require('../db');
const paymentProvider = require('./paymentProvider');
const { calculateConnectionFee } = require('./connectionFee');

function stateChanged() {
  return { http: 409, body: {
    error: 'A fizetési állapot időközben megváltozott. Frissítsd az oldalt.', code: 'STATE_CHANGED',
  } };
}

async function startOrReuseFeePayment({ entityType, entityId, shipperId }) {
  const isJob = entityType === 'job';
  if (!isJob && entityType !== 'booking') throw new Error('Ismeretlen fizetési ügylet.');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
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
        || entity.paid_at || !entity.fee_consent_at) {
      await client.query('ROLLBACK');
      return stateChanged();
    }
    if (isJob) {
      // Külön statement a zár megszerzése UTÁN: egy LEFT JOIN az előző
      // statement snapshotjában még az első /pay előtti escrowt adhatná.
      const escrow = await client.query(
        'SELECT barion_payment_id, barion_gateway_url FROM escrow_transactions WHERE job_id = $1', [entity.id],
      );
      Object.assign(entity, escrow.rows[0]);
    }
    const feeHuf = entity.connection_fee_huf
      ?? calculateConnectionFee(isJob ? entity.accepted_price_huf || entity.suggested_price_huf || 0 : entity.price_huf);
    const previous = entity.barion_payment_id
      ? (await client.query('SELECT state FROM payment_sessions WHERE payment_id = $1 FOR UPDATE', [entity.barion_payment_id])).rows[0]
      : null;
    if (previous && ['succeeded', 'needs_review'].includes(previous.state)) {
      await client.query('ROLLBACK');
      return stateChanged();
    }
    if (entity.barion_payment_id && !entity.barion_gateway_url && previous?.state !== 'closed') {
      await client.query('ROLLBACK');
      return { http: 409, body: {
        error: 'A korábbi fizetés állapotát ellenőrizni kell. Kérj segítséget az ügyfélszolgálattól.',
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
      } };
    }
    // Csak hitelesen lezárt fizetés indítható újra. A hiányzó/ismeretlen
    // állapotú régi gatewayt nem cseréljük le egy másik fizethető linkre.
    if (entity.barion_gateway_url && previous?.state !== 'closed') {
      await client.query('COMMIT');
      return { http: 200, body: {
        payment_id: entity.barion_payment_id, gateway_url: entity.barion_gateway_url,
        fee_huf: feeHuf, is_stub: String(entity.barion_gateway_url).startsWith('stub:'), reused: true,
      } };
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
      await client.query('ROLLBACK');
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
    await client.query('COMMIT');
    return { http: 200, body: {
      payment_id: payment.paymentId, gateway_url: payment.gatewayUrl,
      fee_huf: feeHuf, is_stub: !!payment.stub, reused: false,
    } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { startOrReuseFeePayment };
