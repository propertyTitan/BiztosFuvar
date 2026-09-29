// Minden fizetésindító út ugyanazon ügyletsorzár alatt ellenőrzi és
// használja újra a munkamenetet. A korábbi sessioneket a DB-trigger megőrzi.
const db = require('../db');
const paymentProvider = require('./paymentProvider');
const { calculateConnectionFee } = require('./connectionFee');
const { maskInText } = require('../utils/mask');

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

function cibNemElerheto() {
  return { http: 503, body: {
    error: 'A kártyás fizetés átmenetileg nem elérhető. Nem történt terhelés — próbáld újra később.',
    code: 'CIB_UNAVAILABLE',
  } };
}

// A hívó kezeli a tranzakciót, így az elfogadás és a fizetés hivatkozása együtt mentődik.
//
// `atAcceptance` (2026-09-29, CIB PR-2/B): az elfogadás (ajánlat, ellenajánlat,
// azonnali fuvar, járat-foglalás megerősítése) CIB-úton NEM indít banki
// kísérletet — se MSGT10, se session, se díj-sor. A kártyás kísérlet egyszer
// használatos banki linkkel jár, és a feladó böngészőjéből kell indulnia
// (/pay); ha az elfogadás indítaná, a kísérlet a SZÁLLÍTÓ kérésében születne,
// és egy soha meg nem nyitott banki tranzakció foglalná a fuvart. A díj
// összege ettől még rögzül (connection_fee_huf). Hibás CIB-konfignál az
// elfogadás sem bukik el: a fizetés később, a /pay-en ad 503-at. Stub-úton
// (ma, CIB-env nélkül) a viselkedés bitre a régi.
async function startOrReuseFeePaymentInTransaction(client, {
  entityType, entityId, shipperId, requireConsent = true, atAcceptance = false,
}) {
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
  const ut = paymentProvider.fizetesiUt(shipperId);
  if (ut !== 'stub') {
    // A fuvar /pay-je a CIB-ágat külön hívja (services/cibFizetes.js); ide
    // nem elfogadásként CIB-úton csak a még be nem kötött járat-ág juthat.
    if (!atAcceptance) return cibNemElerheto();
    await client.query(isJob
      ? 'UPDATE jobs SET connection_fee_huf = $1 WHERE id = $2 AND connection_fee_huf IS NULL'
      : 'UPDATE route_bookings SET connection_fee_huf = COALESCE(connection_fee_huf, $1) WHERE id = $2',
    [feeHuf, entity.id]);
    return { http: 200, body: {
      payment_id: null, gateway_url: null, fee_huf: feeHuf, deferred: true,
    } };
  }
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
    const opts = {
      jobId: entity.id, feeHuf, shipperEmail: entity.shipper_email,
      ...(isJob ? {} : { redirectPath: '/dashboard/foglalasaim' }),
    };
    // Teljes CIB-konfig mellett a teszt-allowlisten kívüli felhasználó a
    // régi stub-kísérletet kapja (a provider-adapter ilyenkor nem stub).
    payment = paymentProvider.isStub()
      ? await paymentProvider.startFeePayment(opts)
      : await paymentProvider.startTesztStubFizetes(opts);
    if (!payment?.paymentId || !payment.gatewayUrl
        || (previous?.state === 'closed' && payment.paymentId === entity.barion_payment_id && !payment.stub)) {
      throw new Error('A fizetésszolgáltató nem adott új, használható fizetési munkamenetet.');
    }
  } catch (err) {
    // ⚠️ A BELSŐ HIBASZÖVEG NEM MEGY KI (2026-09-29, CIB PR-1): eddig a 502-es
    // válasz `detail: err.message`-et adott — egy banki/hálózati hiba belső
    // címet, végpontot, akár konfigurációs részletet tett a böngészőbe (és a
    // /bids/:id/accept válaszán át is). A részlet csak a szerver-naplóba
    // kerül, maszkolva; a felhasználó általános üzenetet és kódot kap.
    console.error('[fee-payment] indítási hiba:', maskInText(String(err?.message || err)));
    return { http: 502, body: {
      error: 'A díjfizetés indítása sikertelen. Próbáld újra néhány perc múlva.',
      code: 'PAYMENT_START_FAILED',
    } };
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
