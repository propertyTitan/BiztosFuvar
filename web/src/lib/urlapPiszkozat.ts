// Űrlap-piszkozat a böngészőben (2026-09-11, teljes audit B2).
//
// A fuvarfeladás 20+ mezős űrlap; egy véletlen navigáció, egy lejárt
// munkamenet vagy egy mobil-böngésző tab-újratöltés eddig MINDENT elvitt.
// A piszkozat localStorage-ban él (csak ezen az eszközön, ezen a
// böngészőben), lejárattal; a sikeres feladás törli. Sose dob — privát
// módban / letiltott tárolónál egyszerűen nincs piszkozat.
const VERZIO = 1;

type Csomag<T> = { v: number; at: number; adat: T };

export function mentPiszkozat<T>(kulcs: string, adat: T): boolean {
  try {
    const cs: Csomag<T> = { v: VERZIO, at: Date.now(), adat };
    window.localStorage.setItem(kulcs, JSON.stringify(cs));
    return true;
  } catch {
    return false;
  }
}

export function olvasPiszkozat<T>(kulcs: string, maxKorMs = 7 * 24 * 60 * 60 * 1000): T | null {
  try {
    const nyers = window.localStorage.getItem(kulcs);
    if (!nyers) return null;
    const cs = JSON.parse(nyers) as Partial<Csomag<T>>;
    if (!cs || cs.v !== VERZIO || typeof cs.at !== 'number' || !cs.adat) {
      window.localStorage.removeItem(kulcs);
      return null;
    }
    if (Date.now() - cs.at > maxKorMs) {
      window.localStorage.removeItem(kulcs);
      return null;
    }
    return cs.adat;
  } catch {
    return null;
  }
}

export function torolPiszkozat(kulcs: string): void {
  try { window.localStorage.removeItem(kulcs); } catch { /* nincs tároló */ }
}

/**
 * FELHASZNÁLÓHOZ kötött piszkozat-kulcs (2026-09-13, teljes audit D3).
 * A fuvarfeladás piszkozata egyetlen globális kulcsban élt: közös eszközön
 * (család, iroda, teszt-fiókok) a KÖVETKEZŐ fiók „Piszkozat visszaállítva"
 * toasttal az ELŐZŐ feladó címzett-nevét, telefonszámát és címeit kapta az
 * űrlapba — ugyanaz a hibaosztály, mint a GF-006-os mód-kulcs.
 */
export function piszkozatKulcs(alap: string, userId: string): string {
  return `${alap}:${userId}`;
}

/** Kijelentkezéskor: minden, az előtaggal kezdődő piszkozat törlése. */
export function torolPiszkozatokElotaggal(elotag: string): void {
  try {
    const kulcsok: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(elotag)) kulcsok.push(k);
    }
    kulcsok.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* nincs tároló */ }
}

/** A fuvarfeladás piszkozatának kulcs-előtagja (a kijelentkezés is ezt takarítja). */
export const UJ_FUVAR_PISZKOZAT_ELOTAG = 'gofuvar_uj_fuvar_piszkozat';
