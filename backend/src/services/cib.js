// CIB vPOS — bankkártyás elfogadás a KAPCSOLATFELVÉTELI DÍJ beszedésére.
//
// A LAUNCH FIZETÉSI RENDSZERE (2026-08-08, user-döntés): a QVIK helyett a CIB
// (a cég számlavezető bankja) bankkártyás vPOS-a. Előny: a kártyás láb
// megnyitja a nem-magyar (diaszpóra-) feladókat is; a CIB ajánlata ~1,6%
// jutalék (500/1000 Ft-os díjnál 8-16 Ft/tranzakció).
//
// A KÖD FEL VAN KÉSZÍTVE, de a valódi vPOS-hívások TODO-val jelöltek — ezeket
// a CIB vPOS API-dokumentációja alapján kell kitölteni, amint megvan a
// szerződés + a hozzáférés (a CIB-egyeztetés megtörtént, véglegesítés a
// család nyaralása után — lásd CLAUDE.md 🟡 szakasz).
//
// Aktiválás (amikor élesedik):
//   1) PAYMENT_PROVIDER=cib  (a paymentProvider.js erre vált)
//   2) CIB_MERCHANT_ID / CIB_API_KEY (vagy vPOS terminál-azonosító + kulcs) +
//      CIB_BASE_URL env (a CIB adja a szerződéssel)
//   3) a lenti két függvény (startFeePayment, getPaymentState) kitöltése a
//      CIB vPOS API szerint
//   4) egy /payments/cib/callback bekötése (payments.js — a barion/qvik
//      callback mintájára; a fizetés-visszaigazolás AZONNALI webhookja kell a
//      kontakt-felfedéshez)
//
// Interfész: SZÁNDÉKOSAN azonos a barion.js/qvik.js fee-függvényeivel, hogy a
// paymentProvider.js bármelyiket be tudja húzni.

const CIB_BASE_URL = process.env.CIB_BASE_URL || 'https://sandbox.example-cib-vpos.hu';

// STUB, amíg nincs vPOS-kulcs — a teljes díj-workflow így is tesztelhető,
// pontosan mint a Barion/QVIK stub (fejlesztés/teszt közben nincs valódi pénz).
// A merchant-azonosítót ÉS a kulcsot is megköveteljük: vPOS-hoz mindkettő kell.
function isStub() {
  return !(process.env.CIB_API_KEY && process.env.CIB_MERCHANT_ID);
}

/**
 * A kapcsolatfelvételi díj fizetésének indítása. Ugyanaz a szerződés, mint a
 * barion.startFeePayment: { jobId, feeHuf, shipperEmail, redirectPath } →
 * { paymentId, gatewayUrl, stub }.
 *
 * CIB vPOS-nál a `gatewayUrl` a bank fizetőoldala, ahová a feladót átirányítjuk;
 * ott adja meg a kártyaadatait, majd a redirectUrl-re tér vissza, a hiteles
 * fizetés-állapotot pedig a webhook + getPaymentState adja (a redirectben nem
 * bízunk, pontosan mint Barionnál).
 */
async function startFeePayment({ jobId, feeHuf, shipperEmail, redirectPath }) {
  if (isStub()) {
    return {
      paymentId: `cib-stub-${jobId}`,
      gatewayUrl: `stub:cib/${jobId}`,
      stub: true,
      currency: 'HUF',
      message: `CIB STUB – ${feeHuf} Ft kapcsolatfelvételi díj.`,
    };
  }

  // TODO(CIB): a vPOS fizetés-indítás. Tipikus vPOS-alak:
  //   POST `${CIB_BASE_URL}/vpos/init`  (a pontos útvonalat a CIB doksi adja)
  //   auth: a CIB által előírt aláírás/HMAC vagy Bearer (CIB_API_KEY)
  //   body: {
  //     merchantId: process.env.CIB_MERCHANT_ID,
  //     amount: feeHuf, currency: 'HUF',
  //     orderRef: `FEE-${jobId}`,
  //     customerEmail: shipperEmail,
  //     callbackUrl: `${process.env.API_BASE_URL}/payments/cib/callback`,
  //     redirectUrl: `${process.env.WEB_BASE_URL}${redirectPath || `/dashboard/fuvar/${jobId}`}`,
  //   }
  //   → válasz: { transactionId, paymentUrl }
  // A visszaadott objektumnak { paymentId, gatewayUrl, stub:false } formájúnak
  // kell lennie (a /pay ezt várja a redirecthez).
  throw new Error('CIB vPOS integráció még nincs bekötve (CIB_API_KEY / CIB_MERCHANT_ID hiányzik / TODO: startFeePayment).');
}

/**
 * A fizetés valódi állapotának visszaolvasása a CIB-től (a webhook/redirect
 * body-jának NEM hiszünk — pontosan mint Barionnál). Stub módban null.
 * Visszaadott alak: { Status: 'Succeeded' | 'Pending' | 'Failed' | ... }
 * (a payment-callback a Status-t nézi).
 */
async function getPaymentState(paymentId) {
  if (isStub()) return null;
  // TODO(CIB): GET `${CIB_BASE_URL}/vpos/status/${paymentId}` (CIB auth)
  //   → { status } → normalizáld { Status: 'Succeeded' | ... } alakra.
  throw new Error('CIB getPaymentState még nincs bekötve (TODO).');
}

module.exports = { isStub, startFeePayment, getPaymentState, CIB_BASE_URL };
