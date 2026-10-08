// A Fuvarjaim-hub füleinek mód-függő sorrendje és alapértelmezése
// (UX-review Q17, 2026-10-08). Külön modulban, mert egy Next.js page-fájl
// csak az oldal-exportokat adhatja ki.
import type { AppMode } from '@/lib/auth';

const SZALLITOI_SORREND = ['vallalt', 'licitjeim', 'hirdeteseim', 'foglalasaim'];

/** A fülek sorrendje az aktív mód szerint (szállító: a saját munkája elöl). */
export function fulSorrend<T extends { key: string }>(fulek: readonly T[], mode: AppMode | null): T[] {
  if (mode !== 'driver') return [...fulek];
  const hely = (k: string) => {
    const i = SZALLITOI_SORREND.indexOf(k);
    return i === -1 ? SZALLITOI_SORREND.length : i;
  };
  return [...fulek].sort((a, b) => hely(a.key) - hely(b.key));
}

/** Az alapértelmezett fül ?tab nélkül: szállító → vállalt, feladó → hirdetéseim. */
export function alapFul(mode: AppMode | null): string {
  return mode === 'driver' ? 'vallalt' : 'hirdeteseim';
}
