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
const cibProtokoll = require('./cibProtokoll');

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
// ⚠️⚠️⚠️ 2026-08-15, USER-DÖNTÉS: MÉGIS VAN KAPCSOLÓ — TESZTELÉSHEZ ⚠️⚠️⚠️
//
// Az eredeti szöveg itt azt írta, hogy „SZÁNDÉKOSAN NINCS env-kapcsoló a guard
// feloldására: az elfelejtve maradna bekapcsolva pont a launchkor". Ez az
// aggály VÁLTOZATLANUL ÉRVÉNYES — de a védelem mellékhatása az lett, hogy a
// fizetés UTÁNI fél rendszer (felvétel, átvételi kód, kézbesítés, értékelés,
// vita) élesben EGYÁLTALÁN NEM TESZTELHETŐ, amíg a CIB nem él. A tesztelő
// ezen elakadt. A user döntése: kapcsoljuk ki, a launchnál vissza.
//
// ‼️ LAUNCH ELŐTT KÖTELEZŐ: `ALLOW_STUB_PAYMENTS` TÖRLÉSE A RAILWAY ENV-BŐL.
//    Enélkül BÁRKI fizetés nélkül „fizetettnek" jelölheti a saját fuvarát, és
//    ingyen megkapja a kontaktot — a platform EGYETLEN bevétele kerülhető meg.
//
// AMI NEM AZ EMLÉKEZETRE ÉPÜL (mert az elfelejtődik):
//   1. minden boot-nál HANGOS figyelmeztetés + Sentry-riasztás;
//   2. a webes felületen LÁTHATÓ, sárga „TESZT FIZETÉSI MÓD" sáv a fizetési
//      kártyán — ha valaha bent maradna élesben, azt egy valódi felhasználó is
//      azonnal látja (ez a legerősebb védelem: nem kell hozzá senki figyelme);
//   3. a launch-kapu ellenőrzőlista első sora (CLAUDE.md 6. szakasz).
const STUB_ENGEDELY_ENV = 'ALLOW_STUB_PAYMENTS';

/** Kifejezetten engedélyezve van-e a stub-fizetés élesben (TESZT-ÜZEM)? */
function stubEngedelyezve() {
  return String(process.env[STUB_ENGEDELY_ENV] || '').toLowerCase() === 'true';
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Éles futás stub providerrel → biztonságos mód (a fizetési ágak zárva). */
function isUnsafeStub() {
  return isProduction() && active().isStub();
}

// ─────────────────────────────────────────────────────────────────────────
// FELHASZNÁLÓNKÉNTI ÚTVÁLASZTÁS (2026-09-29, CIB PR-2/A)
//
// A CIB EKI a teljes konfigurációval sem feltétlenül mindenkinek szól: a
// bank tesztkulcsával az éles domainen (2b. fázis) csak 2–3 kijelölt fiók
// (CIB_TESZT_FELHASZNALOK) megy a banki tesztkörnyezetbe, a többi tesztelő a
// stub teszt-üzemet használja tovább — változatlan `cib-stub-<id>`
// formátummal. Élesben (CIB_KORNYEZET=eles) az allowlist HATÁSTALAN: mindenki
// a valódi utat kapja, így egy bent felejtett lista sem nyithat stub-kaput.
//
//   konfig 'nincs'                       → 'stub'  (ma: bitre a régi működés)
//   konfig 'hibas'                       → 'hibas' (503; a stub NEM nyílik vissza)
//   'teljes' + eles                      → 'cib'
//   'teljes' + teszt, üres allowlist     → 'cib'
//   'teljes' + teszt, a user a listán    → 'cib'
//   'teljes' + teszt, a user nincs rajta → 'stub'
// ─────────────────────────────────────────────────────────────────────────

/**
 * Melyik fizetési úton megy EZ a felhasználó?
 * @param {string} [userId] — felhasználó nélkül a globális út (a listán kívüli)
 * @returns {'stub'|'cib'|'hibas'}
 */
function fizetesiUt(userId) {
  const provider = active(); // ismeretlen PAYMENT_PROVIDER → hangos hiba
  // ⚠️ Az isStub az aktív provider-objektumon át (a tesztek ezt cserélik le).
  if (provider.isStub()) return 'stub';
  if (name() !== 'cib') return 'hibas'; // a QVIK valódi útja nincs bekötve
  const b = cibProtokoll.cibBeallitasok();
  if (b.allapot !== 'teljes') return 'hibas';
  if (b.kornyezet === 'eles' || b.tesztFelhasznalok.length === 0) return 'cib';
  const id = typeof userId === 'string' ? userId.trim().toLowerCase() : '';
  return id && b.tesztFelhasznalok.includes(id) ? 'cib' : 'stub';
}

/** Él-e a CIB EKI-gépezet (a lekérdező kör, a banki végpontok)? */
function usesCibEki() {
  return name() === 'cib' && cibProtokoll.cibKonfig() === 'teljes';
}

/**
 * Szabad-e a kézi fizetés-nyugtázás (a webhook megkerülése)? Csak a STUB
 * úton, és csak nem éles futásban — vagy a tudatos TESZT-ÜZEMBEN
 * (ALLOW_STUB_PAYMENTS=true, lásd a fenti figyelmeztetést; launch előtt az
 * env-változót TÖRÖLNI kell). A CIB-úton SOHA: ott a banki zárás (MSGT32 →
 * MSGT31 RC=00) az egyetlen hiteles forrás, és a hibás konfig sem nyitja ki.
 * @param {string} [userId] — a fizető feladó (a teszt-allowlisthez)
 */
function manualConfirmAllowed(userId) {
  if (fizetesiUt(userId) !== 'stub') return false;
  return stubEngedelyezve() || !isProduction();
}

/**
 * A determinisztikus stub-kísérlet a teszt-allowlisten KÍVÜLI felhasználónak,
 * amikor az aktív provider (teljes CIB-konfig mellett) már nem stub
 * (2026-09-29, CIB PR-2/B): a `cib-stub-<id>` / `stub:cib/<id>` pár és a
 * 089-es „szimulált" besorolás bitre a régi.
 */
function startTesztStubFizetes(opts) {
  const provider = active();
  if (typeof provider.stubFeePayment !== 'function') {
    throw new Error('Az aktív provider nem tud teszt-stub kísérletet adni.');
  }
  return provider.stubFeePayment(opts);
}

module.exports = {
  name,
  startTesztStubFizetes,
  stubEngedelyezve,
  STUB_ENGEDELY_ENV,
  providers: Object.keys(PROVIDERS),
  active,
  isStub: () => active().isStub(),
  isUnsafeStub,
  manualConfirmAllowed,
  fizetesiUt,
  usesCibEki,
  startFeePayment: (opts) => active().startFeePayment(opts),
  getPaymentState: (id) => active().getPaymentState(id),
};
