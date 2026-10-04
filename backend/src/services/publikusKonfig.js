// =====================================================================
//  PUBLIKUS ÜZEMI KONFIG a webnek (2026-10-03, CIB PR-5, szerződés: C1)
//
//  A web globális „Teszt üzemmód — valódi pénzmozgás nincs" sávja eddig
//  FELTÉTEL NÉLKÜL, minden oldalon látszott — a CIB éles kulcsra váltása után
//  egy valódi kártyaterhelés mellett is ezt állította volna. Most a backend
//  mondja meg, mi igaz:
//    teszt_uzem        — igaz, ha bárki számára elérhető a stub (szimulált)
//                        fizetés (nem éles futás, ALLOW_STUB_PAYMENTS, vagy az
//                        éles „biztonságos mód", ahol fizetni sem lehet), VAGY
//                        a CIB a bank TESZT-környezetére mutat (nincs valódi
//                        terhelés);
//    kartyas_fizetes   — 'teszt' | 'eles' | null: él-e a CIB kártyás út, és
//                        melyik banki környezetben. 2026-10-03: null akkor
//                        is, ha éles futásban a teszt-allowlist zárt (senki
//                        nem fizethet kártyával);
//    szimulalt_fizetes — igaz, ha a szimulált (stub) díjfizetés ténylegesen
//                        végigvihető (a kézi nyugtázás nyitva). A web csak
//                        ekkor mondja, hogy „a díjfizetés szimuláció" — a
//                        „biztonságos módban" és a hibás CIB-konfignál ez
//                        hamis volt (2026-10-03, a 3. review).
//  Titok, kulcs-ujjlenyomat, PID, host SOHA nem megy ki — csak ez a három mező.
// =====================================================================

/**
 * @param {{ut?:string, beall?:object, cibEki?:boolean, stubElerheto?:boolean, szimulalt?:boolean}} [be]
 *   — tesztben befecskendezhető; alapból a futó konfigurációból
 * @returns {{teszt_uzem:boolean, kartyas_fizetes:'teszt'|'eles'|null, szimulalt_fizetes:boolean}}
 */
function publikusKonfig(be = alapBemenet()) {
  const beall = be.beall || {};
  const kornyezet = ['teszt', 'eles'].includes(beall.kornyezet) ? beall.kornyezet : null;
  const tesztKornyezet = kornyezet === 'teszt' && beall.allapot !== 'nincs';
  // A zárt teszt-allowlist mellett (éles futás, üres / csupa érvénytelen
  // CIB_TESZT_FELHASZNALOK) senki nem kapja a kártyás utat.
  const kartyasUt = be.cibEki && kornyezet && !(kornyezet === 'teszt' && beall.tesztAllowlistZart);
  return {
    teszt_uzem: !!be.stubElerheto || tesztKornyezet,
    kartyas_fizetes: kartyasUt ? kornyezet : null,
    szimulalt_fizetes: !!be.szimulalt,
  };
}

function alapBemenet() {
  const paymentProvider = require('./paymentProvider');
  const cibProtokoll = require('./cibProtokoll');
  let ut;
  try {
    // Felhasználó nélkül: a teszt-allowlisten KÍVÜLI (azaz bárki) útja.
    ut = paymentProvider.fizetesiUt();
  } catch {
    ut = 'hibas';
  }
  let cibEki = false;
  try { cibEki = paymentProvider.usesCibEki(); } catch { cibEki = false; }
  // A szimulált fizetés akkor vihető végig, ha a kézi nyugtázás nyitva
  // (stub-út + nem éles futás vagy ALLOW_STUB_PAYMENTS).
  let szimulalt = false;
  try { szimulalt = ut === 'stub' && paymentProvider.manualConfirmAllowed(); } catch { szimulalt = false; }
  return {
    ut,
    beall: cibProtokoll.cibBeallitasok(),
    cibEki,
    stubElerheto: ut === 'stub',
    szimulalt,
  };
}

module.exports = { publikusKonfig };
