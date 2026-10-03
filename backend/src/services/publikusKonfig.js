// =====================================================================
//  PUBLIKUS ÜZEMI KONFIG a webnek (2026-10-03, CIB PR-5, szerződés: C1)
//
//  A web globális „Teszt üzemmód — valódi pénzmozgás nincs" sávja eddig
//  FELTÉTEL NÉLKÜL, minden oldalon látszott — a CIB éles kulcsra váltása után
//  egy valódi kártyaterhelés mellett is ezt állította volna. Most a backend
//  mondja meg, mi igaz:
//    teszt_uzem      — igaz, ha bárki számára elérhető a stub (szimulált)
//                      fizetés (nem éles futás, ALLOW_STUB_PAYMENTS, vagy az
//                      éles „biztonságos mód", ahol fizetni sem lehet), VAGY
//                      a CIB a bank TESZT-környezetére mutat (nincs valódi
//                      terhelés);
//    kartyas_fizetes — 'teszt' | 'eles' | null: él-e a CIB kártyás út, és
//                      melyik banki környezetben.
//  Titok, kulcs-ujjlenyomat, PID, host SOHA nem megy ki — csak ez a két mező.
// =====================================================================

/**
 * @param {{ut?:string, beall?:object, cibEki?:boolean, stubElerheto?:boolean}} [be]
 *   — tesztben befecskendezhető; alapból a futó konfigurációból
 * @returns {{teszt_uzem:boolean, kartyas_fizetes:'teszt'|'eles'|null}}
 */
function publikusKonfig(be = alapBemenet()) {
  const beall = be.beall || {};
  const kornyezet = ['teszt', 'eles'].includes(beall.kornyezet) ? beall.kornyezet : null;
  const tesztKornyezet = kornyezet === 'teszt' && beall.allapot !== 'nincs';
  return {
    teszt_uzem: !!be.stubElerheto || tesztKornyezet,
    kartyas_fizetes: be.cibEki && kornyezet ? kornyezet : null,
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
  return {
    ut,
    beall: cibProtokoll.cibBeallitasok(),
    cibEki,
    stubElerheto: ut === 'stub',
  };
}

module.exports = { publikusKonfig };
