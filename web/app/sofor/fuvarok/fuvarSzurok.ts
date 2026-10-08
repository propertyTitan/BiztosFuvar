// A szállítói fuvarlista szűrő-segédei (UX-review Q14, 2026-10-08).
// Külön modulban, mert egy Next.js page-fájl csak az oldal-exportokat adhatja ki.

export type Filters = { min: string; max: string; weight: string; from: string; to: string; type: '' | 'true' | 'false' };

export const EMPTY_FILTERS: Filters = { min: '', max: '', weight: '', from: '', to: '', type: '' };

// Az azonnali („UberFuvar”) fuvar a felületen ki van kapcsolva (lásd a lista
// kártyáinak `isInstant = false` sorát) — a típus-szűrő addig halott lenne, és
// egy régi, „csak azonnali” mentett szűrő némán üres listát adna.
export const AZONNALI_ELERHETO = false;

/** Hány szűrő aktív (a szűrő-gomb számlálójához és az üres állapothoz). */
export function aktivSzurokSzama(f: Filters): number {
  return [f.min, f.max, f.weight, f.from, f.to, AZONNALI_ELERHETO ? f.type : '']
    .filter((v) => String(v || '').trim() !== '').length;
}

/** Az útvonal-figyelő űrlap előtöltése a szűrt városokkal. */
export function figyeloLink(f: Pick<Filters, 'from' | 'to'>): string {
  const q = new URLSearchParams();
  if (f.from.trim()) q.set('honnan', f.from.trim());
  if (f.to.trim()) q.set('hova', f.to.trim());
  const qs = q.toString();
  return qs ? `/sofor/ertesitok?${qs}` : '/sofor/ertesitok';
}
