// CIB bankkártyás elfogadás — a KAPCSOLATFELVÉTELI DÍJ beszedésére.
//
// A LAUNCH FIZETÉSI RENDSZERE (2026-08-08, user-döntés): a CIB (a cég
// számlavezető bankja) kártyás elfogadása. 2026-09-29 (CIB PR-2/A): a banki
// protokoll az EKI (SAKI 1.50) — nem REST-es vPOS. A valódi út NEM ezen az
// adapteren megy: a kétfázisú indítás, a böngészős átirányítás és a
// pontosan egyszeri zárás külön modulokban él (services/cibProtokoll.js,
// cibKliens.js, és a rájuk épülő fizetési folyamat). Ez a fájl a
// provider-interfész (isStub / startFeePayment / getPaymentState) CIB-tagja:
//
//  * CIB-konfiguráció NÉLKÜL (cibKonfig() === 'nincs' — ma a Railway-en) a
//    stub-ág bitre a régi: `cib-stub-<id>` + `stub:cib/<id>` (a 089-es
//    migráció PONTOSAN ezt a párt sorolja „szimulált"-nak);
//  * 'teljes' vagy 'hibas' konfignál a stub SZÁNDÉKOSAN nem nyílik vissza:
//    a startFeePayment/getPaymentState kivételt dob (a CIB-út a saját
//    moduljain fut, a hibás konfig pedig 503).
//
// ⚠️ A 2026-08-08-i vPOS-skeleton env-párosa (CIB_API_KEY + CIB_MERCHANT_ID
// + CIB_BASE_URL) KIVEZETVE: a kód nem olvassa, a boot figyelmeztet rá. Ha
// mégis mindkettő be van állítva (és nincs EKI-konfig), a feloldás
// fail-closed „hibás" — ma e kettővel a stub zárva volt, így is marad.

const { cibKonfig } = require('./cibProtokoll');

/** Stub mód: SEMMILYEN CIB-konfiguráció nincs (dev/teszt, ma az éles is). */
function isStub() {
  return cibKonfig() === 'nincs';
}

/**
 * A determinisztikus stub-kísérlet. Külön is hívható: teszt-környezetben a
 * teszt-allowlisten KÍVÜLI felhasználók a teljes CIB-konfig mellett is ezt
 * az utat kapják (paymentProvider.fizetesiUt), változatlan formátummal.
 */
function stubFeePayment({ jobId, feeHuf }) {
  return {
    paymentId: `cib-stub-${jobId}`,
    gatewayUrl: `stub:cib/${jobId}`,
    stub: true,
    currency: 'HUF',
    message: `CIB STUB – ${feeHuf} Ft kapcsolatfelvételi díj.`,
  };
}

/**
 * Provider-interfész: { jobId, feeHuf, shipperEmail, redirectPath } →
 * { paymentId, gatewayUrl, stub }. Csak stub módban ad eredményt.
 */
async function startFeePayment(opts) {
  if (isStub()) return stubFeePayment(opts);
  throw new Error('A CIB EKI-fizetés nem a provider-adapteren át fut — a startFeePayment ebben a módban nincs bekötve '
    + `(CIB-konfiguráció: ${cibKonfig()}).`);
}

/**
 * A fizetés valódi állapota. Stub módban null (a callback a body-t veszi).
 * EKI-módban a hiteles eredményt a MSGT32-re kapott MSGT31 adja, nem ez.
 */
async function getPaymentState() {
  if (isStub()) return null;
  throw new Error('A CIB EKI-állapot nem a provider-adapteren át jön — a getPaymentState ebben a módban nincs bekötve.');
}

module.exports = {
  isStub, startFeePayment, getPaymentState, stubFeePayment,
};
