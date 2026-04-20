// Barion Bridge integráció – Payment Reservation (Escrow) + Split Payment.
//
// A teljes fuvardíjat a feladótól FOGLALJUK (reservation), majd a sikeres
// "Proof of Delivery 2.0" után FELOSZTJUK:
//   - 90 % a sofőrnek (carrier)
//   - 10 % a GoFuvar platformnak (jutalék)
//
// Barion API dokumentáció:
//   - POST /v2/Payment/Start             (PaymentType: "Reservation")
//   - POST /v2/Payment/FinishReservation
//
// Ha BARION_POS_KEY nincs beállítva → STUB módban fut, hogy a workflow
// fejlesztés közben tesztelhető maradjon (sandbox nélkül is).

const BARION_BASE_URL =
  process.env.BARION_BASE_URL ||
  (process.env.BARION_ENV === 'prod'
    ? 'https://api.barion.com'
    : 'https://api.test.barion.com');

const COMMISSION_PCT = parseFloat(process.env.PLATFORM_COMMISSION_PCT || '0.10');
const COMMISSION_FIXED_HUF = parseInt(process.env.PLATFORM_COMMISSION_FIXED_HUF || '400', 10);
const PLATFORM_PAYEE = process.env.BARION_PLATFORM_PAYEE || 'platform@gofuvar.hu';
const RESERVATION_PERIOD = process.env.BARION_RESERVATION_PERIOD || '1.00:00:00'; // 1 nap

function isStub() {
  return !process.env.BARION_POS_KEY;
}

/**
 * Platformdíj számítása: 10% + 400 Ft fix adminisztrációs díj.
 * Visszaadja a sofőr és a platform részét kerekítve.
 */
function calculatePlatformFee(totalHuf) {
  const percentFee = Math.round(totalHuf * COMMISSION_PCT);
  const platformShare = percentFee + COMMISSION_FIXED_HUF;
  const carrierShare = Math.max(0, totalHuf - platformShare);
  return { carrierShare, platformShare };
}

async function barionFetch(path, body) {
  const res = await fetch(`${BARION_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ POSKey: process.env.BARION_POS_KEY, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.Errors && json.Errors.length)) {
    const err = new Error(`Barion API hiba: ${res.status} ${JSON.stringify(json.Errors || json)}`);
    err.barion = json;
    throw err;
  }
  return json;
}

// Támogatott valuták — a Barion EU licensszel HUF-ot és EUR-t is kezel.
const SUPPORTED_CURRENCIES = ['HUF', 'EUR'];
const CURRENCY_LOCALE = { HUF: 'hu-HU', EUR: 'en-EU' };

/**
 * Foglalás indítása – a feladó a visszakapott `gatewayUrl`-en fizet.
 *
 * @param {object} p
 * @param {string} p.jobId
 * @param {number} p.amount        – összeg (a currency-ben)
 * @param {string} [p.currency='HUF'] – 'HUF' | 'EUR'
 * @param {string} p.shipperEmail
 * @param {string} [p.carrierEmail]
 */
async function reservePayment({ jobId, amount, totalHuf, shipperEmail, carrierEmail, currency = 'HUF' }) {
  // Backward compat: ha a hívó még totalHuf-ot küld, azt használjuk
  const total = amount || totalHuf;
  const cur = SUPPORTED_CURRENCIES.includes(currency) ? currency : 'HUF';

  if (isStub()) {
    return {
      paymentId: `stub-${jobId}`,
      gatewayUrl: `stub:payment/${jobId}`,
      stub: true,
      currency: cur,
      message: `Barion STUB – ${total} ${cur} foglalás.`,
    };
  }

  const payload = {
    PaymentType: 'Reservation',
    ReservationPeriod: RESERVATION_PERIOD,
    PaymentWindow: '00:30:00',
    GuestCheckOut: true,
    FundingSources: ['All'],
    PaymentRequestId: `bf-${jobId}-${Date.now()}`,
    PayerHint: shipperEmail,
    Currency: cur,
    Locale: CURRENCY_LOCALE[cur] || 'hu-HU',
    OrderNumber: `JOB-${jobId.substring(0, 8)}`,
    RedirectUrl: `${process.env.WEB_BASE_URL || 'http://localhost:3000'}/dashboard/fuvar/${jobId}`,
    CallbackUrl: `${process.env.API_BASE_URL || 'http://localhost:4000'}/payments/barion/callback`,
    Transactions: [
      {
        POSTransactionId: `bf-${jobId}-reserve`,
        Payee: PLATFORM_PAYEE,
        Total: total,
        Comment: `GoFuvar fuvar ${jobId} (${cur})`,
        Items: [
          {
            Name: cur === 'EUR' ? 'Transport reservation' : 'Fuvar foglalás',
            Description: `GoFuvar #${jobId}`,
            Quantity: 1,
            Unit: cur === 'EUR' ? 'pcs' : 'db',
            UnitPrice: total,
            ItemTotal: total,
          },
        ],
      },
    ],
  };

  const json = await barionFetch('/v2/Payment/Start', payload);
  return {
    paymentId: json.PaymentId,
    gatewayUrl: json.GatewayUrl,
    stub: false,
    raw: json,
  };
}

/**
 * Foglalás lezárása – a Proof of Delivery után hívjuk.
 * A `Transactions` mezőben adjuk meg a SPLIT-et:
 *   - 90 % carrier-nek
 *   - 10 % platform jutalék (a maradék a platformnál marad)
 *
 * Barion modell: a `FinishReservation` minden tranzakciónak megadja az új
 * (csökkentett) összegét. Mi a teljes összeget hagyjuk a platform tranzakción
 * (azaz teljesen érvényesítjük), majd a kifizetést egy külön
 * `Payment/Transfer` hívással küldjük tovább a sofőrnek.
 * Ez a leggyakoribb pattern, ha a sofőr nem regisztrált Barion fiókkal indul.
 */
async function finishReservation({ paymentId, jobId, totalHuf, carrierPayee }) {
  const { carrierShare, platformShare } = calculatePlatformFee(totalHuf);

  if (isStub()) {
    return {
      stub: true,
      paymentId,
      total_huf: totalHuf,
      carrier_share_huf: carrierShare,
      platform_share_huf: platformShare,
      message: 'Barion STUB – split kifizetés szimulálva.',
    };
  }

  // 1) Foglalás véglegesítése (a teljes összeg érvényesül)
  const finish = await barionFetch('/v2/Payment/FinishReservation', {
    PaymentId: paymentId,
    Transactions: [
      {
        TransactionId: `bf-${jobId}-reserve`, // a Start-nál használt POSTransactionId
        Total: totalHuf,
      },
    ],
  });

  // 2) Sofőr részének átutalása (Transfer)
  let transfer = null;
  if (carrierPayee) {
    transfer = await barionFetch('/v2/Transfer/Send', {
      Currency: 'HUF',
      Amount: carrierShare,
      RecipientName: carrierPayee,
      Comment: `GoFuvar fuvar #${jobId} – sofőri részesedés`,
    }).catch((err) => {
      console.warn('[barion] transfer hiba:', err.message);
      return { error: err.message };
    });
  }

  return {
    stub: false,
    paymentId,
    total_huf: totalHuf,
    carrier_share_huf: carrierShare,
    platform_share_huf: platformShare,
    finish,
    transfer,
  };
}

/**
 * Foglalás visszamondása (pl. fuvar törlés, vagy validáció hiba és nincs
 * megegyezés). Visszatéríti a feladónak a teljes összeget.
 */
async function cancelReservation({ paymentId, jobId }) {
  if (isStub()) {
    return { stub: true, paymentId, message: 'Barion STUB – foglalás törölve.' };
  }
  return barionFetch('/v2/Payment/CancelAuthorization', { PaymentId: paymentId });
}

/**
 * Részleges visszatérítés — a lemondási flow-hoz használjuk, amikor
 * a feladó a már kifizetett fuvart mondja le és 10% (max 1000 Ft)
 * lemondási díjat levonunk a visszatérítésből. A refundAmount a
 * TÉNYLEGESEN visszautalandó összeg Ft-ban.
 *
 * STUB módban csak logol. Éles Barion esetén a Payment/Refund API-t
 * hívja (ez teszi lehetővé a részleges refund-ot, szemben a
 * CancelAuthorization-val, ami mindig 100%).
 */
async function refundPayment({ paymentId, jobId, refundAmountHuf, reason }) {
  if (isStub()) {
    console.log(`[barion STUB] refund: ${refundAmountHuf} Ft (${reason || 'no reason'}) → payment ${paymentId}`);
    return {
      stub: true,
      paymentId,
      refund_huf: refundAmountHuf,
      message: 'Barion STUB – visszatérítés szimulálva.',
    };
  }
  return barionFetch('/v2/Payment/Refund', {
    PaymentId: paymentId,
    TransactionsToRefund: [
      {
        TransactionId: `bf-${jobId}-reserve`,
        POSTransactionId: `bf-${jobId}-refund-${Date.now()}`,
        AmountToRefund: refundAmountHuf,
        Comment: reason || `GoFuvar lemondás – fuvar #${jobId}`,
      },
    ],
  });
}

/**
 * A GoFuvar lemondási díj-szabálya egy helyen:
 *   - Ha még nem történt fizetés → díj = 0, refund = 0 (nincs pénz)
 *   - Ha a SOFŐR mondja le → díj = 0, 100% refund (max szigorú a feladó felé)
 *   - Ha a FELADÓ mondja le a már kifizetett fuvart → 10% díj (max 1000 Ft)
 */
function computeCancellationSettlement({ totalHuf, paid, cancelledByRole }) {
  if (!paid || !totalHuf) return { fee: 0, refund: 0 };
  if (cancelledByRole === 'carrier') return { fee: 0, refund: totalHuf };
  // Feladó lemondás:
  const rawFee = Math.round(totalHuf * 0.10);
  const fee = Math.min(rawFee, 1000);
  const refund = totalHuf - fee;
  return { fee, refund };
}

module.exports = {
  reservePayment,
  finishReservation,
  cancelReservation,
  refundPayment,
  computeCancellationSettlement,
  calculatePlatformFee,
  COMMISSION_PCT,
  COMMISSION_FIXED_HUF,
  SUPPORTED_CURRENCIES,
  isStub,
};
