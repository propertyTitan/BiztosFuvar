// =====================================================================
//  Megszólítás a teljes névből (UX A13, 2026-10-08)
//
//  A regisztráció magyar névsorrendet kér („Pl. Kovács Péter”), a felület
//  viszont a név ELSŐ szavát vette — így lett a köszöntés „Szia, Fehér!”,
//  a fejléc fiókchipjén pedig „Kovács”. Most a KERESZTNÉV jön:
//    „Kovács Anna”         → Anna
//    „Dr. Kovács Anna”     → Anna   (a titulus nem név)
//    „Nagy Anna Mária”     → Anna   (az első utónév)
//    „Kovácsné Nagy Anna”  → Anna   (a házassági névrész után a születési)
//    „Kovács-Nagy Péter”   → Péter
//    „Anna”                → Anna
//    „Kovács Jánosné”      → Kovács Jánosné (nincs külön utónév)
//  ⚠️ A backend párja: backend/src/utils/nev.js — a backend
//  tests/ux-a13-megszolitas.test.js a kettőt egymáshoz méri.
// =====================================================================

const TITULUS = /^(dr|ifj|id|özv|prof|ing)\.?$/i;
// A „-né" házassági névrész — de vannak „né"-re végződő UTÓNEVEK is
// (René): azok nem házassági nevek (fix2-review: „Kovács René" eddig a
// teljes nevet adta „René" helyett).
const NE_VEGU_UTONEVEK = new Set(['rené']);
const hazassagi = (tag: string) => /né$/i.test(tag) && !NE_VEGU_UTONEVEK.has(tag.toLowerCase());

/** A megszólításhoz használt név (üres, ha nincs név). */
export function megszolitasNev(teljesNev: string | null | undefined): string {
  const tagok = String(teljesNev ?? '').trim().split(/\s+/).filter((t) => t && !TITULUS.test(t));
  if (tagok.length === 0) return '';
  if (tagok.length === 1) return tagok[0];
  let i = 0;
  // „Kovácsné Nagy Anna": a házassági névrész(ek) után jön a születési név.
  while (i < tagok.length - 2 && hazassagi(tagok[i])) i += 1;
  const utonev = tagok[i + 1];
  // „Kovács Jánosné": nincs külön utónév — a teljes nevet használjuk.
  if (!utonev || hazassagi(utonev)) return tagok.join(' ');
  return utonev;
}

/** „Szia, Anna!" — név nélkül a megadott tartalék („Szia, Feladó!"), vagy „Szia!". */
export function szia(teljesNev: string | null | undefined, tartalek?: string): string {
  const nev = megszolitasNev(teljesNev) || tartalek || '';
  return nev ? `Szia, ${nev}!` : 'Szia!';
}
