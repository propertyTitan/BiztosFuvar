import { describe, it, expect } from 'vitest';
import {
  CIB_FELIRATOK, CIB_FELIRAT_SORREND, CIB_OSSZEG_PENZNEM, KERESKEDO_ORSZAG_SOR,
  CIB_SZOLGALTATO_FELIRAT, ELFOGADOTT_KARTYAK_FELIRAT,
  CIB_TESZT_SAV_SZOVEG, CIB_IDO_TIPP, bankiErtek, osszegKiiras,
} from './cibFeliratok';
import * as feliratok from './cibFeliratok';
import { CIB_KARTYALOGOK_KEP, ELFOGADOTT_KARTYAK, KARTYA_NEVEK } from './kartyaLogok';

// A CIB „Fejlesztési javaslatok" (Tranzakció eredményének visszaigazolása):
// „A fenti értékek kísérőszövege meg kell egyezzen a fenti lista elemeivel."
// A banki átvételi teszt SZÓ SZERINT nézi — egy elírás vagy egy „szebb"
// átfogalmazás elbuktatja. Ezért a szöveget itt betűre rögzítjük.
describe('CIB kötelező feliratok (szó szerint)', () => {
  it('az öt kötelező felirat betűre egyezik a banki listával', () => {
    expect(CIB_FELIRATOK).toEqual({
      trid: 'A tranzakció azonosítója (TrID)',
      rc: 'A tranzakció eredményének kódja (RC)',
      rt: 'A tranzakció eredményének szöveges ismertetése (RT)',
      amo: 'A fizetett összeg (AMO)',
      anum: 'A kibocsátó bank által adott engedélyszám (ANUM)',
    });
  });

  it('a sorrend a banki lista sorrendje, és pontosan öt elem', () => {
    expect(CIB_FELIRAT_SORREND).toEqual(['trid', 'rc', 'rt', 'amo', 'anum']);
  });

  it('az összeg mellé a pénznem HUF', () => {
    expect(CIB_OSSZEG_PENZNEM).toBe('HUF');
    expect(osszegKiiras(500)).toBe('500 HUF');
    expect(osszegKiiras('1000')).toBe('1000 HUF');
    // Hiányzó érték: a sor megjelenik, de üres jellel — nem „undefined HUF".
    expect(osszegKiiras(null)).toBe('–');
  });

  it('a hiányzó banki érték (pl. elutasításnál az ANUM) „–" jelet kap', () => {
    expect(bankiErtek(null)).toBe('–');
    expect(bankiErtek(undefined)).toBe('–');
    expect(bankiErtek('   ')).toBe('–');
    expect(bankiErtek('AB12')).toBe('AB12');
  });

  it('a fizetési folyamat kötelező mondatai változatlanok', () => {
    expect(KERESKEDO_ORSZAG_SOR).toBe(
      'A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)',
    );
    // 2026-10-10: a saját KARTYAADAT_SOR kikerült — a bank szó szerinti rövid
    // tájékoztatója mondja el ugyanezt (lib/cibTajekoztato.ts).
    expect('KARTYAADAT_SOR' in feliratok).toBe(false);
    expect(CIB_SZOLGALTATO_FELIRAT).toBe('Kártyás fizetés szolgáltatója:');
    expect(ELFOGADOTT_KARTYAK_FELIRAT).toBe('Elfogadott kártyák');
    // A helyi lezárási ablak a MSGT10-től 9 perc 30 mp (CIB_ZARAS_HATARIDO_MP),
    // és a visszatérés után még egy banki lekérdezés + a lezárás is ebbe
    // esik: „kb. 10 perc" (PR-4), majd „kb. 9 perc" is túlígéret volt
    // (2026-10-03, CIB PR-5 — lelet 27).
    expect(CIB_IDO_TIPP).toMatch(/kb\. 8 percen belül/);
    expect(CIB_IDO_TIPP).not.toMatch(/10 perc|9 perc/);
    expect(CIB_TESZT_SAV_SZOVEG).toBe(
      'CIB BANKI TESZTKÖRNYEZET – valódi terhelés nincs, csak a bank tesztkártyái működnek',
    );
  });

  it('szövegszabály: sehol nincs „biztonságos fizetés"', () => {
    const minden = [
      ...Object.values(CIB_FELIRATOK), KERESKEDO_ORSZAG_SOR,
      CIB_SZOLGALTATO_FELIRAT, ELFOGADOTT_KARTYAK_FELIRAT, CIB_IDO_TIPP, CIB_TESZT_SAV_SZOVEG,
    ].join(' ');
    expect(minden).not.toMatch(/biztonságos\s+fizetés/i);
  });
});

describe('Elfogadott kártyák — EGY konstansból', () => {
  it('az alapérték a szerződés-tervezet szerinti négy márka', () => {
    expect([...ELFOGADOTT_KARTYAK]).toEqual(['visa', 'vpay', 'mastercard', 'maestro']);
  });
  it('minden elfogadott kártyának van neve, és a banki logóképen is szerepel', () => {
    // 2026-10-10: márkánkénti logó nincs többé — a bank egyben szerkesztett
    // logóképe mutatja a márkákat (a bank kérése).
    for (const k of ELFOGADOTT_KARTYAK) {
      expect(KARTYA_NEVEK[k].length).toBeGreaterThan(1);
      expect(CIB_KARTYALOGOK_KEP.alt).toContain(KARTYA_NEVEK[k]);
    }
  });
});
