'use client';

// Megvan-e már a süti-döntés? (2026-10-08, UX-kör)
//
// A süti-sáv alul, teljes szélességben ül (z-index 9999). Amíg látszik, az
// alsó sávba tett lebegő elemek (AI-gomb, telepítő panel, a mobil főoldal
// ragadós „Adj fel egy fuvart" sávja) alatta rekednének: nem kattinthatók, és
// két egymásra rakott sáv elveszi a képernyő harmadát. Ezért ezek a döntés
// UTÁN jelennek meg. Egy forrás, három fogyasztó — ne csússzon szét.
import { useEffect, useState } from 'react';

export const SUTI_DONTES_KULCS = 'gofuvar_cookie_consent';
export const SUTI_DONTES_ESEMENY = 'gofuvar:cookie-consent';

export function useSutiDontesMegvan(): boolean {
  const [megvan, setMegvan] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SUTI_DONTES_KULCS)) setMegvan(true);
    } catch {
      // Tiltott tároló mellett a sáv sem tud emlékezni — ne rejtsünk el semmit.
      setMegvan(true);
    }
    const onDontes = () => setMegvan(true);
    window.addEventListener(SUTI_DONTES_ESEMENY, onDontes);
    return () => window.removeEventListener(SUTI_DONTES_ESEMENY, onDontes);
  }, []);
  return megvan;
}
