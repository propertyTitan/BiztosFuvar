'use client';

// =====================================================================
//  Adatra szabott böngészőfül-cím (UX-kör A24, 2026-10-08)
//
//  A fuvar- és a profiloldal adata hitelesített végpontról jön, ezért a
//  szerver-oldali metadata nem éri el: a layout csak az általános címet
//  („Fuvar részletei”, „Felhasználói profil”) tudja adni. Betöltés után
//  az oldal ezzel a hookkal teszi konkréttá („Kanapé — Ajánlatokat vár |
//  GoFuvar”, „Szabó Péter profilja | GoFuvar”), így több nyitott fül és az
//  előzmények is megkülönböztethetők.
//
//  ⚠️ Szándékosan NEM állítjuk vissza a régi címet lecsatoláskor: a
//  következő oldal metadatája ugyanabban a commitban írja a saját címét, és
//  egy késői visszaállítás azt írná felül.
// =====================================================================
import { useEffect } from 'react';

export const OLDALCIM_UTOTAG = ' | GoFuvar';

/** A teljes fülcím egy adatra szabott címből; üres/hiányzó cím → null. */
export function oldalCim(cim: string | null | undefined): string | null {
  const tiszta = (cim ?? '').replace(/\s+/g, ' ').trim();
  if (!tiszta) return null;
  // Egy nagyon hosszú hirdetéscím ne tolja ki a márkát a fülről.
  const rovid = tiszta.length > 60 ? `${tiszta.slice(0, 59).trimEnd()}…` : tiszta;
  return `${rovid}${OLDALCIM_UTOTAG}`;
}

/** Betöltött adat után beállítja a fül címét (amíg nincs adat, a layout címe marad). */
export function useOldalCim(cim: string | null | undefined): void {
  useEffect(() => {
    const teljes = oldalCim(cim);
    if (teljes && typeof document !== 'undefined') document.title = teljes;
  }, [cim]);
}
