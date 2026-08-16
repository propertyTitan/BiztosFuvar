'use client';

// =====================================================================
//  SZÁM-MEZŐ VÉDELEM — a görgő ne írja át az árat (2026-08-15, tesztelő)
//
//  A tesztelő észrevétele: „a fuvar ajánlattételnél a díj és az időnél
//  görgővel lehetett növelni az értéket, de közben elgörgettek az oldal adott
//  pontjától; ellenajánlatnál is."
//
//  Ez a HTML `<input type="number">` régi, közismert csapdája: ha a mező
//  fókuszban van, az egérgörgő ÁTÍRJA az értékét. A felhasználó azt hiszi,
//  görget — közben az ajánlata 12.000 Ft-ról 12.400-ra változik, és NEM VESZI
//  ÉSZRE, mert a szeme már lejjebb jár az oldalon.
//
//  Pénz-mezőn ez nem kényelmi kérdés: egy észrevétlenül elgörgetett ajánlat
//  rossz áron köt üzletet.
//
//  ── MIÉRT GLOBÁLIS, ÉS NEM MEZŐNKÉNT ────────────────────────────────
//  A hiba MINDEN `type="number"` mezőt érint — a kódbázisban hét fájlban
//  van ilyen, és a következő új mező is örökölné. Ha mezőnként javítanánk,
//  az pontosan az a mintázat lenne, amit a projekt már sokszor megtalált:
//  „a védelem azon az úton épül meg, ahol felfedezték". Egy globális,
//  dokumentum-szintű figyelő minden mezőt fed, a jövőbelieket is.
//
//  ── MIÉRT BLUR, ÉS NEM preventDefault ───────────────────────────────
//  A `preventDefault` megállítaná az értékváltozást, DE az oldal görgetését
//  is — a felhasználó úgy érezné, beragadt a lap. A `blur()` a helyes:
//  a mező elveszti a fókuszt, az érték nem változik, és a görgetés
//  természetesen folytatódik. Ez az iparági bevált megoldás.
// =====================================================================
import { useEffect } from 'react';

export default function SzamMezoVedelem() {
  useEffect(() => {
    function gorgo(e: WheelEvent) {
      const aktiv = document.activeElement;
      if (!(aktiv instanceof HTMLInputElement)) return;
      if (aktiv.type !== 'number') return;
      // Csak akkor, ha tényleg a mező fölött görget — különben egy távoli
      // görgetés is elvenné a fókuszt gépelés közben.
      if (e.target !== aktiv) return;
      aktiv.blur();
    }

    // Passzív figyelő: nem blokkoljuk a görgetést, csak a fókuszt vesszük el.
    document.addEventListener('wheel', gorgo, { passive: true });
    return () => document.removeEventListener('wheel', gorgo);
  }, []);

  return null;
}
