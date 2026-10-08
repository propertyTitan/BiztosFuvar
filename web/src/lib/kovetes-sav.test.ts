// UX A05 (2026-10-08): az élő követés „hamarosan" sávja csak a feleknek és
// csak elfogadott / úton lévő fuvaron látszik; a térkép-gomb nem ígér élő
// követést, hanem az útvonal hosszát mondja.
import { describe, it, expect } from 'vitest';
import { kovetesSavLathato } from './statusz';
import { utvonalGombFelirat } from '@/components/MapCollapse';

const FELADO = 'u-felado';
const SZALLITO = 'u-szallito';
const fuvar = (status: string, extra: Record<string, unknown> = {}) => ({
  status, shipper_id: FELADO, carrier_id: SZALLITO, status_before_dispute: null, ...extra,
});

describe('kovetesSavLathato', () => {
  it('elfogadott és úton lévő fuvaron a feleknek látszik', () => {
    for (const s of ['accepted', 'in_progress']) {
      expect(kovetesSavLathato(fuvar(s), FELADO), `${s} / feladó`).toBe(true);
      expect(kovetesSavLathato(fuvar(s), SZALLITO), `${s} / szállító`).toBe(true);
    }
  });

  it('ajánlatokra váró, kézbesített, lemondott fuvaron nem látszik', () => {
    for (const s of ['bidding', 'pending', 'delivered', 'completed', 'cancelled', 'expired']) {
      expect(kovetesSavLathato(fuvar(s, { carrier_id: s === 'bidding' ? null : SZALLITO }), FELADO), s).toBe(false);
    }
  });

  it('kívülállónak és kijelentkezett nézőnek soha', () => {
    expect(kovetesSavLathato(fuvar('in_progress'), 'u-mas')).toBe(false);
    expect(kovetesSavLathato(fuvar('in_progress'), null)).toBe(false);
  });

  it('vita alatt a vita előtti fizikai állapot számít', () => {
    expect(kovetesSavLathato(fuvar('disputed', { status_before_dispute: 'in_progress' }), FELADO)).toBe(true);
    expect(kovetesSavLathato(fuvar('disputed', { status_before_dispute: 'delivered' }), FELADO)).toBe(false);
  });
});

describe('utvonalGombFelirat', () => {
  it('a távolságot mutatja, ezres tagolással, élő követés nélkül', () => {
    expect(utvonalGombFelirat(163.7)).toBe('Útvonal a térképen · 164 km');
    expect(utvonalGombFelirat('1250.2')).toMatch(/^Útvonal a térképen · 1\s?250 km$/);
    expect(utvonalGombFelirat(null)).toBe('Útvonal a térképen');
    expect(utvonalGombFelirat(0)).toBe('Útvonal a térképen');
    expect(utvonalGombFelirat(42)).not.toMatch(/követés/i);
  });
});
