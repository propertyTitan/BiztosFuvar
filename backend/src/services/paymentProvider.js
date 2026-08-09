// Fizetési szolgáltató-absztrakció a KAPCSOLATFELVÉTELI DÍJHOZ.
//
// A díj-beszedés provider-független: a PAYMENT_PROVIDER env dönti el, melyik
// szolgáltató fut. Támogatott: barion | qvik | cib. A launch fizetési
// rendszere a CIB bankkártyás vPOS (2026-08-08 user-döntés). A váltás egyetlen
// env-változó, a hívó kód (jobs.js, bids.js, carrierRoutes.js) nem változik.
//
// FONTOS: ez CSAK a fee-fizetés outbound részét absztrahálja
// (startFeePayment / isStub / getPaymentState). A régi escrow/split
// (reservePayment, finishReservation, refund) továbbra is barion-specifikus
// és dormant (készpénzes modell). A callback-ek provider-specifikusak:
//   - /payments/barion/callback (payments.js)
//   - /payments/qvik/callback   (payments.js — skeleton)
//   - /payments/cib/callback    (integrációkor bekötendő)

const qvik = require('./qvik');
const cib = require('./cib');

// ⚠️ EXPLICIT provider-térkép (2026-08-08). Korábban a feloldás
// `name() === 'qvik' ? qvik : barion` volt — vagyis MINDEN más érték (pl. a
// launch CIB-je, vagy egy elgépelés) CSENDBEN visszaesett Barionra. Barion
// kulcs nélkül stub → az oldal „élesben" futott volna, de NULLA díjat szedett
// volna be, ÉS a confirm-payment guardok kinyíltak volna (isStub true). Ez a
// térkép + a lenti fail-loud ezt zárja: ismeretlen provider → hangos hiba,
// nem néma bevétel-kiesés.
const PROVIDERS = { qvik, cib };

// Alapértelmezés: CIB (a launch fizetése; kulcs nélkül stub — dev/teszt).
// A Barion 2026-08-09-én VÉGLEG törölve (user-döntés + biztonsági audit).
// Csak akkor „vált", ha az env EXPLICITEN mást állít be (qvik) — és akkor
// annak érvényes providernek kell lennie (különben a lenti fail-loud hibáz).
function name() {
  return (process.env.PAYMENT_PROVIDER || 'cib').toLowerCase();
}

function active() {
  const provider = PROVIDERS[name()];
  if (!provider) {
    throw new Error(
      `Ismeretlen PAYMENT_PROVIDER: "${name()}". Támogatott: ${Object.keys(PROVIDERS).join(', ')}. `
      + '(Rossz env-érték esetén a rendszer NEM esik vissza csendben — inkább hibázik, '
      + 'hogy ne fusson némán stub/nulla-díj módban.)',
    );
  }
  return provider;
}

module.exports = {
  name,
  providers: Object.keys(PROVIDERS),
  active,
  isStub: () => active().isStub(),
  startFeePayment: (opts) => active().startFeePayment(opts),
  getPaymentState: (id) => active().getPaymentState(id),
};
