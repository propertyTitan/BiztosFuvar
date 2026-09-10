import { describe, it, expect } from 'vitest';
import {
  kapcsolatfelvetelDijHuf, DIJ_SZABALY_SZOVEG, DIJ_SAVHATAR_HUF, DIJ_SAVOK,
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
    // A hu-HU ezres-tagoló NEM sima szóköz (U+202F / U+00A0) — a mérés
    // előtt normalizálunk, különben a helyes szöveg is pirosat adna.
    // (A hu-HU CLDR a 4 jegyű számot NEM tagolja: 1000, nem „1 000".)
    const sima = DIJ_SZABALY_SZOVEG.replace(/\s/g, ' ');
    expect(sima).toMatch(/\b500 Ft/);
    expect(sima).toMatch(/50 000 Ft fuvardíjig/);
    expect(sima).toMatch(/felette 1 ?000 Ft/);
    expect(DIJ_SAVOK).toHaveLength(2);
  });
});
