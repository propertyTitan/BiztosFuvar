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
const PLATFORM_PAYEE = process.env.BARION_PLATFORM_PAYEE || 'platform@gofuvar.hu';
const RESERVATION_PERIOD = process.env.BARION_RESERVATION_PERIOD || '1.00:00:00'; // 1 nap

function isStub() {
  return !process.env.BARION_POS_KEY;
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

/**
 * Foglalás indítása – a feladó a visszakapott `gatewayUrl`-en fizet.
 * A teljes összeget egyetlen tranzakcióban foglaljuk le, a SPLIT csak
 * a `finishReservation` során történik (akkor már ismerjük a sofőrt).
 *
 * @param {object} p
 * @param {string} p.jobId
 * @param {number} p.totalHuf
 * @param {string} p.shipperEmail
 * @param {string} [p.carrierEmail]  – opcionálisan már ismert
 */
async function reservePayment({ jobId, totalHuf, shipperEmail, carrierEmail }) {
  if (isStub()) {
    return {
      paymentId: `stub-${jobId}`,
      gatewayUrl: null,
      stub: true,
      message: 'Barion STUB – nincs BARION_POS_KEY beállítva.',
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
    Currency: 'HUF',
    Locale: 'hu-HU',
    OrderNumber: `JOB-${jobId.substring(0, 8)}`,
    RedirectUrl: `${process.env.WEB_BASE_URL || 'http://localhost:3000'}/dashboard/fuvar/${jobId}`,
    CallbackUrl: `${process.env.API_BASE_URL || 'http://localhost:4000'}/payments/barion/callback`,
    Transactions: [
      {
        POSTransactionId: `bf-${jobId}-reserve`,
        Payee: PLATFORM_PAYEE, // a foglalás kezdetben a platformra érkezik
        Total: totalHuf,
        Comment: `GoFuvar fuvar ${jobId}`,
        Items: [
          {
            Name: 'Fuvar foglalás',
            Description: `GoFuvar fuvar #${jobId}`,
            Quantity: 1,
            Unit: 'db',
            UnitPrice: totalHuf,
            ItemTotal: totalHuf,
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
  const carrierShare = Math.round(totalHuf * (1 - COMMISSION_PCT));
  const platformShare = totalHuf - carrierShare;

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

module.exports = {
  reservePayment,
  finishReservation,
  cancelReservation,
  COMMISSION_PCT,
  isStub,
};
