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
 * Határozott névelő a szó elé: „az" magánhangzó-kezdetre (és az 1-gyel,
 * 5-tel kezdődő számra: egy, öt, ezer…), egyébként „a".
 * Üres / nem-szöveg bemenetre „a".
 */
function nevelo(szo) {
  const s = String(szo ?? '').trim().replace(/^[„"'«(\[]+/, '');
  if (!s) return 'a';
  const elso = s[0].toLowerCase();
  if (MAGANHANGZOK.includes(elso)) return 'az';
  // „1 db" → egy, „5 doboz" → öt; a 10–19, 50–59 stb. is „az" (egy…, öt…)
  if (elso === '1' || elso === '5') return 'az';
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
