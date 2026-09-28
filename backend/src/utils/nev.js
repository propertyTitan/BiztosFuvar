// =====================================================================
//  Személynév-szabály — EGY forrásból (2026-09-28, audit P1).
//
//  REG-P1-NEW-01 (user-döntés, 2026-08-30): SZEMÉLYNÉVBEN NINCS SZÁMJEGY.
//  A kontakt-szűrő 9+ számjegyes szabálya dátum-szerű neveknél (pl.
//  „1988.02.12") zavaró „telefonszám nem írható le" hibát adott, és
//  konverziót veszített (Manus 3. futás). A számjegy-tiltás egyszerre
//  ERŐSEBB díj-védelem (szám nélkül telefonszám sem írható a névbe) és
//  értelmes hibaüzenet. Az e-mail-minta szűrése (contactGuard) a néven marad.
//
//  Eddig az auth.js-ben élt helyben — a címzett neve (POST /jobs, járat-
//  foglalás) ezért nem kapta meg. Aki személynevet fogad, ezt hívja.
// =====================================================================

const NEV_SZAMJEGY_HIBA = 'A név nem tartalmazhat számokat.';

function nevbenSzamjegy(nev) {
  return /\d/.test(nev);
}

module.exports = { NEV_SZAMJEGY_HIBA, nevbenSzamjegy };
