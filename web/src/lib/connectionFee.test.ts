import { describe, it, expect } from 'vitest';
import {
  kapcsolatfelvetelDijHuf, DIJ_SZABALY_SZOVEG, DIJ_SAVHATAR_HUF, DIJ_SAVOK,
  DIJ_SAV_MONDAT, ft, ftFt,
} from './connectionFee';

// A backend képletének kliens-tükre — a HATÁRT mérjük, mert pont ott dől el,
// hogy a feladó 500 vagy 1 000 Ft-ot fizet (a backend `dijak.test.js`-e
// ugyanezeket a pontokat méri a szerver oldalon).
describe('kapcsolatfelvételi díj (web-tükör)', () => {
  it('a sávhatár BEFOGLALÓ: 50 000 Ft-nál még 500, 50 001-nél már 1 000', () => {
    expect(kapcsolatfelvetelDijHuf(0)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(1)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(49999)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(DIJ_SAVHATAR_HUF)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(DIJ_SAVHATAR_HUF + 1)).toBe(1000);
    expect(kapcsolatfelvetelDijHuf(1_000_000)).toBe(1000);
  });

  it('hiányzó / értelmezhetetlen árnál az alsó sáv (mint a backend Number(x)||0-ja)', () => {
    expect(kapcsolatfelvetelDijHuf(null)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(undefined)).toBe(500);
    expect(kapcsolatfelvetelDijHuf(Number.NaN)).toBe(500);
  });

  it('a szabály-mondat a sávokból jön, nem kézzel írt számokból', () => {
    // Ha valaki a sávot átírja, de a mondatot nem, ez piros — a mondat a
    // feladási űrlapon és a fizetés-kártyán jelenik meg.
    // A hu-HU ezres-tagoló NEM sima szóköz (U+00A0) — a mérés előtt
    // normalizálunk, különben a helyes szöveg is pirosat adna.
    const sima = DIJ_SZABALY_SZOVEG.replace(/\s/g, ' ');
    expect(sima).toBe('500 Ft, ha a fuvardíj legfeljebb 50 000 Ft; felette 1 000 Ft — bevezető ár, nem visszatérítendő');
    expect(DIJ_SAV_MONDAT.replace(/\s/g, ' ')).toBe('500 Ft, ha a fuvardíj legfeljebb 50 000 Ft; felette 1 000 Ft');
    expect(DIJ_SAVOK).toHaveLength(2);
  });

  // UX-kör A18 (2026-10-08): ugyanaz a díj hol „1000", hol „1 000" alakban
  // szerepelt (a hu-HU CLDR a 4 jegyű számot nem tagolja), és mobilon az
  // „500 / Ft" két sorba tört. Az ft() mindig tagol, az ftFt() nem törhet.
  it('az ft() a 4 jegyű számot is tagolja, nem törhető szóközzel', () => {
    expect(ft(1000)).toBe('1 000');
    expect(ft(50000)).toBe('50 000');
    expect(ft(500)).toBe('500');
  });

  it('az ftFt() a „Ft" elé nem törhető szóközt tesz', () => {
    expect(ftFt(500)).toBe('500 Ft');
    expect(ftFt(1000)).toBe('1 000 Ft');
    // A mondatban sehol nincs törhető szóköz szám és „Ft" között.
    expect(DIJ_SZABALY_SZOVEG).not.toMatch(/\d [Ff]t\b/);
  });
});
