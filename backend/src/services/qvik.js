// QVIK — magyar azonnali fizetés (AFR, QR / request-to-pay) a
// kapcsolatfelvételi díj beszedésére. Barion-alternatíva: sokkal olcsóbb
// (~0,4–0,8% a kártyás díjhoz képest), azonnali jóváírás, nincs chargeback.
//
// A KÖD FEL VAN KÉSZÍTVE, de a valódi API-hívások TODO-val jelöltek — ezeket
// a kiválasztott QVIK-PSP (bank/aggregátor) dokumentációja alapján kell
// kitölteni, amint megvan a jogosultság + a hozzáférés.
//
// Aktiválás (amikor élesedik):
//   1) PAYMENT_PROVIDER=qvik  (a paymentProvider.js erre vált)
//   2) QVIK_API_KEY / QVIK_MERCHANT_ID / QVIK_BASE_URL env (a PSP adja)
//   3) a lenti két függvény (startFeePayment, getPaymentState) kitöltése
//   4) a /payments/qvik/callback bekötése (payments.js — lásd ott a skeletont)
//
// Interfész: SZÁNDÉKOSAN azonos a barion.js fee-függvényeivel, hogy a
// paymentProvider.js bármelyiket be tudja húzni.

const QVIK_BASE_URL = process.env.QVIK_BASE_URL || 'https://sandbox.example-qvik-psp.hu';

// STUB, amíg nincs API-kulcs — a teljes díj-workflow így is tesztelhető,
// pontosan mint a Barion stub (fejlesztés/teszt közben nincs valódi pénz).
function isStub() {
  return !process.env.QVIK_API_KEY;
}

/**
 * A kapcsolatfelvételi díj fizetésének indítása. Ugyanaz a szerződés, mint a
 * barion.startFeePayment: { jobId, feeHuf, shipperEmail, redirectPath } →
 * { paymentId, gatewayUrl, stub }.
 *
 * QVIK-nél a `gatewayUrl` jellemzően egy fizetési oldal / bankalkalmazás-deep
 * link / QR-adat lesz — a feladó a saját bankappjában hagyja jóvá az azonnali
 * utalást (request-to-pay).
 */
async function startFeePayment({ jobId, feeHuf, shipperEmail, redirectPath }) {
  if (isStub()) {
    return {
      paymentId: `qvik-stub-${jobId}`,
      gatewayUrl: `stub:qvik/${jobId}`,
      stub: true,
      currency: 'HUF',
      message: `QVIK STUB – ${feeHuf} Ft kapcsolatfelvételi díj.`,
    };
  }

  // TODO(QVIK): a PSP request-to-pay / QR indítása. Tipikus alak:
  //   POST `${QVIK_BASE_URL}/payments`
  //   headers: Authorization: Bearer ${process.env.QVIK_API_KEY}
  //   body: {
  //     merchantId: process.env.QVIK_MERCHANT_ID,
  //     amount: feeHuf, currency: 'HUF',
  //     reference: `FEE-${jobId}`,
  //     payerHint: shipperEmail,
  //     callbackUrl: `${process.env.API_BASE_URL}/payments/qvik/callback`,
  //     redirectUrl: `${process.env.WEB_BASE_URL}${redirectPath || `/dashboard/fuvar/${jobId}`}`,
  //   }
  //   → válasz: { paymentId, gatewayUrl | qrData | deepLink }
  // A visszaadott objektumnak { paymentId, gatewayUrl, stub:false } formájúnak
  // kell lennie (a /pay ezt várja a redirecthez).
  throw new Error('QVIK integráció még nincs bekötve (QVIK_API_KEY hiányzik / TODO: startFeePayment).');
}

/**
 * A fizetés valódi állapotának visszaolvasása a PSP-től (a webhook body-jának
 * nem hiszünk — pontosan mint Barionnál). Stub módban null.
 * Visszaadott alak: { Status: 'Succeeded' | 'Pending' | 'Failed' | ... }
 * (a paymentokat feldolgozó callback a Status-t nézi).
 */
async function getPaymentState(paymentId) {
  if (isStub()) return null;
  // TODO(QVIK): GET `${QVIK_BASE_URL}/payments/${paymentId}` (Bearer QVIK_API_KEY)
  //   → { status } → normalizáld { Status: 'Succeeded' | ... } alakra.
  throw new Error('QVIK getPaymentState még nincs bekötve (TODO).');
}

module.exports = { isStub, startFeePayment, getPaymentState, QVIK_BASE_URL };
