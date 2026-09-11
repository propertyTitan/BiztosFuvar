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
