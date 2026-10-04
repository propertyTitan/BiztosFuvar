// =====================================================================
//  CIB PR-5 (web, W2) — az automatikus egyeztetés követése (2026-10-04)
//
//  A backend (cib-pr5/backend, d0e1bba) a kétes (close_unknown) kísérletet
//  már nem csak kézzel rendezi: a MSGT10 után CIB_EGYEZTETES_PERC (alapból
//  20) perccel egy csak-olvasó MSGT33 dönt („nem terhelt" / lezárt). Az
//  eredményoldal az „ellenőrzés" állapotban eddig LEÁLLT a lekérdezéssel —
//  a gyakori, kijelentkezett (socket nélküli) böngészőben az automatikus
//  döntés soha nem jelent meg, a feladó a „Ne fizess újra" dobozt nézte.
// =====================================================================
import { describe, expect, it } from 'vitest';
import * as fizetes from './cibFizetes';

type Fv = (...a: any[]) => any;
const fv = (nev: string): Fv => {
  const f = (fizetes as unknown as Record<string, unknown>)[nev];
  expect(typeof f, `${nev} hiányzik a lib/cibFizetes.ts-ből`).toBe('function');
  return f as Fv;
};

describe('lekerdezesUtem — az eredményoldal lekérdezési üteme az állapot szerint', () => {
  it('feldolgozás: a megszokott ütem (3 mp, 3 perc után 20 mp)', () => {
    const utem = fv('lekerdezesUtem');
    expect(utem('feldolgozas', 0)).toBe(fizetes.GYORS_LEKERDEZES_MS);
    expect(utem('feldolgozas', fizetes.GYORS_SZAKASZ_MS + 1)).toBe(fizetes.LASSU_LEKERDEZES_MS);
  });

  it('ellenőrzés (egyeztetés alatt): lassú ütemben tovább figyelünk — az automatikus döntés így megjelenik', () => {
    const utem = fv('lekerdezesUtem');
    expect(utem('ellenorzes', 0)).toBe(fizetes.LASSU_LEKERDEZES_MS);
    expect(utem('ellenorzes', fizetes.GYORS_SZAKASZ_MS + 1)).toBe(fizetes.LASSU_LEKERDEZES_MS);
  });

  it.each(['sikeres', 'sikertelen', 'nem_terhelt', 'mar_fizetve', 'visszateritve'])('%s: végleges, a lekérdezés leáll', (a) => {
    expect(fv('lekerdezesUtem')(a, 0)).toBeNull();
  });

  it('ismeretlen állapot (hiba után még nincs válasz): a megszokott ütem', () => {
    expect(fv('lekerdezesUtem')(null, 0)).toBe(fizetes.GYORS_LEKERDEZES_MS);
  });
});
