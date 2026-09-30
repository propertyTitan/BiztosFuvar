// A CIB kártyás fizetés eredményének KÖTELEZŐ adatsora — a bank átvételi
// tesztje ezeket a feliratokat SZÓ SZERINT keresi az eredményoldalon és a
// vásárlónak küldött e-mailben (Fejlesztési javaslatok 6. o.).
//
// 2026-09-29 (CIB PR-2/A): egy forrás a backendnek (e-mail, admin); a webes
// tükör a `web/src/lib/cibFeliratok.ts` (PR-3), a kettőt egy szinkronőr veti
// össze (a `dij-sav-web-szinkron` mintájára) — a feliratot ezért ITT is
// csak a bankkal egyeztetve szabad átírni.
const CIB_FELIRATOK = Object.freeze({
  trid: 'A tranzakció azonosítója (TrID)',
  rc: 'A tranzakció eredményének kódja (RC)',
  rt: 'A tranzakció eredményének szöveges ismertetése (RT)',
  amo: 'A fizetett összeg (AMO)',
  penznem: 'HUF',
  anum: 'A kibocsátó bank által adott engedélyszám (ANUM)',
});

// A kötelező adatsor sorrendje (a bank a fenti sorrendben sorolja fel).
const CIB_ADATSOR_SORREND = Object.freeze(['trid', 'rc', 'rt', 'amo', 'anum']);

module.exports = { CIB_FELIRATOK, CIB_ADATSOR_SORREND };
