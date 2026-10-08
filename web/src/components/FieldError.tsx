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

import { CircleAlert } from 'lucide-react';

/** Csillag a kötelező mezők címkéjében. */
export const REQ = { color: 'var(--danger-text)', fontWeight: 700 } as const;

/**
 * Piros keret a hibás mezőre. Használat: `style={hiba ? redBorder : undefined}`.
 *
 * ⚠️ 2026-10-08 (UX-kör A8): az egységes hibaállapot az `aria-invalid="true"`
 * attribútum — a globals.css abból rajzol piros keretet és halvány hátteret,
 * sötét témában is. Új űrlapon azt használd; ez a stílus a meglévő
 * fogyasztóknak marad (sötétben a globals.css ezt is helyreállítja).
 */
export const redBorder = {
  border: '2px solid var(--danger)',
  boxShadow: '0 0 0 3px rgba(239,68,68,0.15)',
} as const;

/**
 * Egy mező alatti piros hibaüzenet — csak akkor renderel, ha van mit mondani.
 *
 * `role="alert"`: a képernyőolvasó felolvassa, amikor megjelenik. Enélkül a
 * vak felhasználó csak annyit érzékelne, hogy az űrlap „nem csinál semmit".
 * A megjelenés a `.field-error` osztályban él (globals.css): 12 px, ikon +
 * szöveg — a szín nem az egyetlen jelzés (WCAG 1.4.1).
 */
export default function FieldError({ children, id }: { children: string | null; id?: string }) {
  if (!children) return null;
  return (
    // Az `id` az input `aria-describedby`-jának célpontja (GF-013): a
    // felolvasó így a MEZŐHÖZ kötve mondja el a hibát, nem csak bemondja.
    <p id={id} role="alert" className="field-error">
      <CircleAlert size={14} aria-hidden />
      {children}
    </p>
  );
}
