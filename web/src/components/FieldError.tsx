'use client';

// =====================================================================
//  MEZŐSZINTŰ HIBAJELZÉS — közös, hogy MINDEN űrlapon ugyanúgy nézzen ki
//
//  A tesztelő kérése (2026-08-15): „ahogy a fuvar feladásánál megcsináltad
//  (hibás adat vagy ki nem töltött mezőknél körbekeretezed pirossal és
//  aláírod, hogy mi a baj), úgy jó lenne az ajánlattételnél és az
//  útvonal-figyelőnél is, hogy egységes legyen."
//
//  Ez eddig a `dashboard/uj-fuvar` oldalon élt, HELYBEN definiálva. Ha
//  űrlaponként másolgatnánk, három külön változat lenne, amik idővel
//  szétcsúsznak — pontosan az a mintázat, amit a projekt már sokszor
//  megtalált: „a védelem azon az úton épül meg, ahol felfedezték".
//
//  Ezért egy forrás, több fogyasztó: aki új űrlapot ír, innen veszi.
// =====================================================================

/** Csillag a kötelező mezők címkéjében. */
export const REQ = { color: 'var(--danger-text)', fontWeight: 700 } as const;

/** Piros keret a hibás mezőre. Használat: `style={hiba ? redBorder : undefined}` */
export const redBorder = {
  border: '2px solid var(--danger)',
  boxShadow: '0 0 0 3px rgba(239,68,68,0.15)',
} as const;

/**
 * Egy mező alatti piros hibaüzenet — csak akkor renderel, ha van mit mondani.
 *
 * `role="alert"`: a képernyőolvasó felolvassa, amikor megjelenik. Enélkül a
 * vak felhasználó csak annyit érzékelne, hogy az űrlap „nem csinál semmit".
 */
export default function FieldError({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ color: 'var(--danger-text)', fontSize: 12, margin: '4px 0 0' }}>
      {children}
    </p>
  );
}
