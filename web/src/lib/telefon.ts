// =====================================================================
//  Telefonszám megjelenítése és hívás-linkje (UX Q06, 2026-10-08)
//
//  A díj után a feladó a szállító telefonszámáért fizetett — eddig az
//  tagolatlanul jelent meg („+36305551234"), hívógomb nélkül. Egy formázó,
//  minden kontakt-kártya ezt használja:
//    +36305551234   → +36 30 555 1234   (mobil és 2 jegyű körzet: 2 + 3 + 4)
//    +3612345678    → +36 1 234 5678    (Budapest: 1 + 3 + 4)
//    +3662123456    → +36 62 123 456    (vidéki vezetékes: 2 + 3 + 3)
//    06 30 555 1234 → +36 30 555 1234   (belföldi „06" előtag)
//  Nem magyar (vagy nem értelmezhető) számot nem találunk ki: változatlanul
//  adjuk vissza, a hívás-link a számjegyekből és a „+"-ból áll.
// =====================================================================

/** Csak a számjegyek és a vezető „+". */
function tisztit(tel: string): string {
  const t = tel.trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
}

/** Magyar szám esetén a nemzeti rész (a „36" utáni számjegyek), különben null. */
function magyarNemzeti(tel: string): string | null {
  const t = tisztit(tel);
  if (t.startsWith('+36')) return t.slice(3);
  if (t.startsWith('0036')) return t.slice(4);
  if (t.startsWith('06')) return t.slice(2);
  if (t.startsWith('36') && (t.length === 10 || t.length === 11)) return t.slice(2);
  return null;
}

/** Olvasható alak: „+36 30 555 1234". */
export function telefonFormaz(tel: string | null | undefined): string {
  if (!tel) return '';
  const n = magyarNemzeti(tel);
  if (n && /^1\d{7}$/.test(n)) return `+36 1 ${n.slice(1, 4)} ${n.slice(4)}`;
  if (n && /^\d{9}$/.test(n)) return `+36 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  if (n && /^\d{8}$/.test(n)) return `+36 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  return tel.trim();
}

/** `tel:` link — nemzetközi alakban, szóköz nélkül. */
export function telefonHref(tel: string | null | undefined): string {
  if (!tel) return '';
  const n = magyarNemzeti(tel);
  return `tel:${n ? `+36${n}` : tisztit(tel)}`;
}
