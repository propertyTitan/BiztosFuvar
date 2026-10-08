// UX A14: az új fuvar űrlap hibái toast nélkül — fókusz az első hibás
// mezőre (a címekre is), összegzés a gomb fölött.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { elsoHibasMezoId, hibaOsszegzes } from './urlapHibak';

const URES = {
  title: null, length: null, width: null, height: null, weight: null, price: null,
  declared: null, recipientName: null, recipientPhone: null, recipientEmail: null,
};

describe('elsoHibasMezoId', () => {
  it('az űrlap sorrendjében az első hiba — a nem megerősített cím is', () => {
    expect(elsoHibasMezoId({ ...URES, price: 'x' }, false, true)).toBe('fuvar-felvetel');
    expect(elsoHibasMezoId({ ...URES, price: 'x' }, true, false)).toBe('fuvar-lerakodas');
    expect(elsoHibasMezoId({ ...URES, title: 'x', price: 'x' }, false, false)).toBe('uj-cim');
    expect(elsoHibasMezoId({ ...URES, weight: 'x' }, true, true)).toBe('uj-suly');
    expect(elsoHibasMezoId(URES, true, true)).toBeNull();
  });
});

describe('hibaOsszegzes', () => {
  it('a darabszámot mondja, a mező-üzenetet nem ismétli', () => {
    const s = hibaOsszegzes({ ...URES, title: 'Kérjük, töltsd ki: Megnevezés.' }, false, true);
    expect(s).toMatch(/^Még 2 mezőt kell/);
    expect(s).not.toMatch(/Kérjük, töltsd ki/);
    expect(hibaOsszegzes(URES, true, true)).toBeNull();
  });

  it('az új fuvar és az ajánlattétel kliensoldali hibája nem toast', () => {
    const uj = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/uj-fuvar/page.tsx'), 'utf8');
    expect(uj).not.toMatch(/toast\.error\(\s*'Hiányzó vagy hibás mező'/);
    expect(uj).not.toMatch(/toast\.error\('Felvételi időablak'/);
    const ajanlat = fs.readFileSync(path.resolve(__dirname, '../../app/sofor/fuvar/[id]/page.tsx'), 'utf8');
    for (const cim of ['Nézd át az űrlapot', 'Hiányzó nyilatkozat', 'Hiányzó visszaszállítási díj']) {
      expect(ajanlat, cim).not.toContain(`toast.error('${cim}'`);
    }
  });
});
