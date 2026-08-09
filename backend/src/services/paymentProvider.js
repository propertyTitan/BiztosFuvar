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

// ─────────────────────────────────────────────────────────────────────────
// ÉLES FUTÁS + STUB PROVIDER = TILTOTT ÁLLAPOT (2026-08-09, audit 3. kör)
//
// A stub (kulcs nélküli) mód dev/teszt eszköz: nem szed pénzt, és kinyitja a
// kézi fizetés-nyugtázást (`/confirm-payment`), hogy a tesztek végig tudjanak
// menni a pénz-úton. Élesben ugyanez azt jelentené, hogy BÁRKI fizetés nélkül
// „fizetettnek" jelöli a saját fuvarját → a platform egyetlen bevétele
// megkerülhető, ráadásul a webhook is elhinné a nyers body-t.
//
// Eddig ezt csak egy boot-időben kiírt figyelmeztetés jelezte — egy elfelejtett
// env-változó tehát némán nyitva hagyta a kaput. Mostantól ebben az állapotban
// a rendszer BIZTONSÁGOS MÓDBAN fut: a díj-nyugtázó és a webhook-ág ZÁRVA
// (`manualConfirmAllowed` → false, a callback 503), a boot pedig hangosan
// figyelmeztet + Sentry-riasztást küld.
//
// ⚠️ Miért nem hard-fail (2026-08-09, éles tanulság): a leállás kipróbálva —
// a Railway-en `NODE_ENV=production`, a CIB-kulcs pedig a launchig NINCS, így
// a boot-exit újraindítási ciklusba tette az éles backendet, és az API 502-t
// adott. A „prod + stub" a launch ELŐTT NEM rendkívüli állapot, hanem a
// normál üzem: a platform még nem szed díjat. Amit védeni kell — hogy ilyenkor
// se lehessen fizetés nélkül „fizetettnek" jelölni egy fuvart —, azt a
// futásidejű guard adja, nem a leállás. Bevétel-kiesést itt nem lehet némán
// elszenvedni: ha nincs kulcs, senki nem tud fizetni, az azonnal látszik.
//
// SZÁNDÉKOSAN NINCS env-kapcsoló a guard feloldására: az elfelejtve maradna
// bekapcsolva pont a launchkor, és épp azt a rést nyitná ki, ami ellen az
// egész véd.
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Éles futás stub providerrel → biztonságos mód (a fizetési ágak zárva). */
function isUnsafeStub() {
  return isProduction() && active().isStub();
}

/**
 * Szabad-e a kézi fizetés-nyugtázás (a webhook megkerülése)? Csak akkor, ha a
 * provider stub ÉS ez nem éles futás — így élesben a webhook marad az egyetlen
 * hiteles forrás, kulcs-hiány esetén sem nyílik meg a megkerülő ág.
 */
function manualConfirmAllowed() {
  return active().isStub() && !isUnsafeStub();
}

module.exports = {
  name,
  providers: Object.keys(PROVIDERS),
  active,
  isStub: () => active().isStub(),
  isUnsafeStub,
  manualConfirmAllowed,
  startFeePayment: (opts) => active().startFeePayment(opts),
  getPaymentState: (id) => active().getPaymentState(id),
};
