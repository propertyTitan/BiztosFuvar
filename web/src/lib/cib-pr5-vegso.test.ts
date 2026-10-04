// =====================================================================
//  CIB PR-5 (web) — VÉGSŐ KÖR (2026-10-04): a teszt-üzem sávja nem mond
//  „szimulációt", ha a szimulált (stub) díjfizetés nem érhető el (a backend
//  szimulalt_fizetes jelzője; hiánya fail-closed: nem szimuláció). Ilyenkor
//  a kártyás díjfizetés „jelenleg nem érhető el", és valódi terhelés nincs.
//  A javítás nélkül piros.
// =====================================================================
import { describe, expect, it } from 'vitest';
import { ervenyesKonfig, tesztUzemSav } from './publikusKonfig';

describe('teszt-üzem sáv: a szimuláció csak akkor, ha elérhető', () => {
  it('kártyás út nélkül, NEM elérhető szimulációval: „nem érhető el", valódi terhelés nincs — nem „szimuláció"', () => {
    for (const k of [
      { teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: false },
      { teszt_uzem: true, kartyas_fizetes: null }, // régi backend: a hiány nem „szimuláció"
      { teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: 'true' },
    ]) {
      const s = tesztUzemSav(ervenyesKonfig(k))!;
      expect(s, JSON.stringify(k)).not.toBeNull();
      expect(s.szoveg, JSON.stringify(k)).not.toMatch(/szimuláció|szimulált/);
      expect(s.szoveg).toMatch(/kártyás díjfizetés jelenleg nem érhető el/);
      expect(s.szoveg).toMatch(/valódi terhelés nincs/);
    }
  });

  it('elérhető szimulációval: „szimuláció"', () => {
    const s = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: true }))!;
    expect(s.fajta).toBe('stub');
    expect(s.szoveg).toMatch(/szimuláció/);
  });

  it('CIB-teszt szimuláció nélkül: csak a bank tesztkörnyezete — a „szimulált" nem szerepel', () => {
    const s = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: 'teszt', szimulalt_fizetes: false }))!;
    expect(s.fajta).toBe('cib_teszt');
    expect(s.szoveg).toMatch(/CIB Bank tesztkörnyezet/);
    expect(s.szoveg).toMatch(/valódi terhelés nincs/);
    expect(s.szoveg).not.toMatch(/szimulált|szimuláció/);
  });

  it('az ervenyesKonfig a jelzőt csak logikai értékként fogadja el', () => {
    expect(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: true }))
      .toEqual({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: true });
    expect(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: 1 }))
      .toEqual({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: false });
  });
});
