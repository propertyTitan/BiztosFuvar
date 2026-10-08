// =====================================================================
//  UX-review A27 (2026-10-08): az utca-szintű (díj előtti) cím magyar
//  sorrendben, a rövidítés pontjával.
//
//  A régi kimenet: „Debrecen, Piac u, 4026" — az irányítószám a végére
//  került, a rövidítés pontja elveszett, így az olvasó a 4026-ot HÁZSZÁMNAK
//  értette. A szállító ebből becsül, a feladó pedig azt hihette, kiszivárgott
//  a házszáma. A javítás nélkül az első két teszt piros.
// =====================================================================
import { describe, it, expect } from 'vitest';
const { utcaSzint, telepulesNev, telepulesSzint } = require('../src/utils/address');

describe('utcaSzint — magyar sorrend', () => {
  it('az irányítószám a település elé kerül, nem a cím végére', () => {
    expect(utcaSzint('Debrecen, Piac u. 4, 4026')).toBe('4026 Debrecen, Piac u.');
    expect(utcaSzint('Budapest, Bartók Béla út 12, 1225')).toBe('1225 Budapest, Bartók Béla út');
  });

  it('a rövidítés pontja megmarad („Piac u.", nem „Piac u")', () => {
    const e = utcaSzint('Debrecen, Piac u. 4, 4026');
    expect(e).toContain('Piac u.');
    expect(e.endsWith('u')).toBe(false);
  });

  it('a kimenet SEMMILYEN formában nem végződik számmal (ami házszámnak látszana)', () => {
    for (const cim of [
      'Debrecen, Piac u. 4, 4026', 'Budapest, Váci út 12, 1132', 'Szeged, Kárász utca 9., 6720',
      'Debrecen, Piac u. 4, 4026 Magyarország', 'Budapest, Andrássy út 60-62, 1062',
    ]) {
      expect(utcaSzint(cim), cim).not.toMatch(/\d\.?$/);
    }
  });

  it('a magyar országnév a magyar sorrendű címből elmarad', () => {
    expect(utcaSzint('Debrecen, Piac u. 4, 4026 Magyarország')).toBe('4026 Debrecen, Piac u.');
    expect(utcaSzint('Budapest, Váci út 12, 1132, Magyarország')).toBe('1132 Budapest, Váci út');
  });

  it('a már magyar sorrendű (irányítószámmal kezdődő) cím változatlan sorrendű', () => {
    expect(utcaSzint('1132 Budapest, Váci út 12')).toBe('1132 Budapest, Váci út');
  });

  it('nem magyar formátumot nem rendez át', () => {
    expect(utcaSzint('Hauptstraße 5, 10115 Berlin, Germany')).toBe('Hauptstraße, 10115 Berlin, Germany');
    expect(utcaSzint('Strada Mihai Viteazu 12, Arad')).toBe('Strada Mihai Viteazu, Arad');
    expect(utcaSzint('Budapest, Hungary')).toBe('Budapest, Hungary');
  });

  it('a házszám továbbra sem szivároghat (a régi garancia)', () => {
    expect(utcaSzint('Debrecen, Piac u. 4, 4026')).not.toMatch(/\b4\b/);
    expect(utcaSzint('Budapest, Váci út 12/B, 1132')).not.toContain('12');
  });

  it('az „u." rövidítés utcának számít (a település-szint nem adja vissza)', () => {
    expect(telepulesSzint('Piac u., Debrecen')).toBe('Debrecen');
  });
});

describe('telepulesNev — statisztikához', () => {
  it('a település neve irányítószám és utca nélkül', () => {
    expect(telepulesNev('Budapest, Váci út 12, 1132')).toBe('Budapest');
    expect(telepulesNev('1132 Budapest, Váci út 12')).toBe('Budapest');
    expect(telepulesNev('Hauptstraße 5, 10115 Berlin, Germany')).toBe('Berlin');
  });

  it('település nélküli címre üres — házszámot soha', () => {
    expect(telepulesNev('Margit körút 50.')).toBe('');
    expect(telepulesNev(null)).toBe('');
  });
});
