// =====================================================================
//  Értesítés-szövegek magyar nyelvtani segédei (2026-10-08, UX-átvizsgálás A22)
//
//  A harang-értesítések eddig gépiesen szóltak: „a(z)" névelő, egyenes
//  idézőjel ("…"), és a szöveg-előnézet szó KÖZEPÉN szakadt meg
//  („…jelentk"). A felhasználó az értesítésből tudja meg, hogy elfogadták
//  az ajánlatát vagy megjött a díj — ha ez olvashatatlan, késik a reakció.
//
//  Csak MEGJELENÍTÉSI segédek: tartalmat nem adnak hozzá, a bemenetet nem
//  értelmezik (a kontakt-szűrés a hívó dolga, a beírás pontján).
// =====================================================================

const MAGANHANGZOK = 'aáeéiíoóöőuúüű';

/**
 * Határozott névelő a szó elé: „az" magánhangzó-kezdetre és a kiolvasva
 * magánhangzóval kezdődő számra, egyébként „a". Üres / nem-szöveg
 * bemenetre „a".
 *
 * Számoknál a KIOLVASÁS dönt (fix1-review: a „10 doboz" „az" lett):
 *  - 5-tel kezdődő: mindig „az" (öt, ötven, ötszáz, ötezer…);
 *  - 1-gyel kezdődő: a jegyek számától függ — 1 (egy), 1000–1999 (ezer),
 *    1 000 000-tól (egymillió) „az”, de 10–19 (tíz, tizen…), 100–199
 *    (száz…), 10 000–19 999 (tízezer…) „a”: „az” akkor, ha a jegyek
 *    száma 3k+1;
 *  - minden más kezdőjegy (két, három, négy, hat, hét, nyolc, kilenc) „a”.
 * Az ezres-tagolás (szóköz, nem törhető szóköz, pont + 3 jegy) a szám része.
 */
function nevelo(szo) {
  const s = String(szo ?? '').trim().replace(/^[„"'«(\[]+/, '');
  if (!s) return 'a';
  const elso = s[0].toLowerCase();
  if (MAGANHANGZOK.includes(elso)) return 'az';
  const szam = /^\d{1,3}(?:[ \u00a0.]\d{3})+(?!\d)|^\d+/.exec(s);
  if (szam) {
    const jegyek = szam[0].replace(/\D/g, '');
    if (jegyek[0] === '5') return 'az';
    if (jegyek[0] === '1' && jegyek.length % 3 === 1) return 'az';
  }
  return 'a';
}

/** Magyar idézőjel: „…" (a belső egyenes idézőjeleket nem bántjuk). */
function idezet(szoveg) {
  return `„${String(szoveg ?? '').trim()}”`;
}

/**
 * Rövidítés SZÓHATÁRON, „…" jellel. A `max` a kimenet teljes hossza
 * (a „…" is beleszámít). Rövid szöveg változatlan marad.
 */
function rovidit(szoveg, max = 100) {
  const s = String(szoveg ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const keret = s.slice(0, Math.max(1, max - 1));
  const utolsoSzokoz = keret.lastIndexOf(' ');
  // Ha az első szó maga túl hosszú, inkább vágunk benne, mint hogy üres legyen.
  const vagott = utolsoSzokoz >= Math.floor(max / 2) ? keret.slice(0, utolsoSzokoz) : keret;
  return `${vagott.replace(/[\s,.;:!?–-]+$/, '')}…`;
}

/**
 * „az „Íróasztal"" típusú hivatkozás (névelő + idézőjeles cím) — a hívó
 * mondatában utána jön a „fuvar(ra)". Cím nélkül csak a névelő marad
 * („a fuvarra"), nem „a „fuvar" fuvarra".
 */
function fuvarRef(cim) {
  const c = String(cim ?? '').trim();
  return c ? `${nevelo(c)} ${idezet(c)}` : 'a';
}

/** Mondat eleji alak: „Az „Íróasztal"" / „A „Kanapé"". */
function nagyKezdo(szoveg) {
  const s = String(szoveg ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

module.exports = { nevelo, idezet, rovidit, fuvarRef, nagyKezdo };
