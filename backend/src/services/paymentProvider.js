// Fizetési szolgáltató-absztrakció a KAPCSOLATFELVÉTELI DÍJHOZ.
//
// A díj-beszedés provider-független: a PAYMENT_PROVIDER env dönti el, melyik
// szolgáltató fut (barion | qvik). Így a Barionról QVIK-re váltás egyetlen
// env-változó, a hívó kód (jobs.js, bids.js) nem változik.
//
// FONTOS: ez CSAK a fee-fizetés outbound részét absztrahálja
// (startFeePayment / isStub / getPaymentState). A régi escrow/split
// (reservePayment, finishReservation, refund) továbbra is barion-specifikus
// és dormant (készpénzes modell). A callback-ek provider-specifikusak:
//   - /payments/barion/callback (payments.js)
//   - /payments/qvik/callback  (payments.js — skeleton, integrációkor kitöltve)

const barion = require('./barion');
const qvik = require('./qvik');

function name() {
  return (process.env.PAYMENT_PROVIDER || 'barion').toLowerCase();
}

function active() {
  return name() === 'qvik' ? qvik : barion;
}

module.exports = {
  name,
  isStub: () => active().isStub(),
  startFeePayment: (opts) => active().startFeePayment(opts),
  getPaymentState: (id) => active().getPaymentState(id),
};
