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

// =====================================================================
//  Megszólítás a teljes névből (UX A13, 2026-10-08)
//
//  A regisztráció magyar névsorrendet kér („Pl. Kovács Péter”), a felület és
//  a levelek viszont a név ELSŐ szavát vették — így lett a köszöntés
//  „Szia, Fehér!”, a levelekben pedig „Szia Kovács Anna!” (vessző nélkül, a
//  teljes névvel). Most a KERESZTNÉV jön:
//    „Kovács Anna”         → Anna
//    „Dr. Kovács Anna”     → Anna   (a titulus nem név)
//    „Nagy Anna Mária”     → Anna   (az első utónév)
//    „Kovácsné Nagy Anna”  → Anna   (a házassági névrész után a születési)
//    „Kovács-Nagy Péter”   → Péter
//    „Anna”                → Anna
//    „Kovács Jánosné”      → Kovács Jánosné (nincs külön utónév — a teljes név)
//  A web párja: web/src/lib/nev.ts — a backend
//  tests/ux-a13-megszolitas.test.js a kettőt egymáshoz méri.
// =====================================================================

const TITULUS = /^(dr|ifj|id|özv|prof|ing)\.?$/i;
const HAZASSAGI = /né$/i;

/** A megszólításhoz használt név (üres, ha nincs név). */
function megszolitasNev(teljesNev) {
  const tagok = String(teljesNev ?? '').trim().split(/\s+/).filter((t) => t && !TITULUS.test(t));
  if (tagok.length === 0) return '';
  if (tagok.length === 1) return tagok[0];
  let i = 0;
  // „Kovácsné Nagy Anna": a házassági névrész(ek) után jön a születési név.
  while (i < tagok.length - 2 && HAZASSAGI.test(tagok[i])) i += 1;
  const utonev = tagok[i + 1];
  // „Kovács Jánosné": nincs külön utónév — a teljes nevet használjuk.
  if (!utonev || HAZASSAGI.test(utonev)) return tagok.join(' ');
  return utonev;
}

/** „Szia, Anna!" — név nélkül „Szia!". Nyers szöveg: a hívó escape-eli. */
function szia(teljesNev) {
  const nev = megszolitasNev(teljesNev);
  return nev ? `Szia, ${nev}!` : 'Szia!';
}

module.exports = { NEV_SZAMJEGY_HIBA, nevbenSzamjegy, megszolitasNev, szia };
