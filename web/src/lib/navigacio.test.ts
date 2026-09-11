import { describe, it, expect } from 'vitest';
import { biztonsagosBelsoUt } from './navigacio';

describe('biztonsagosBelsoUt (?next=)', () => {
  it('belső, relatív útvonalat elfogad', () => {
    expect(biztonsagosBelsoUt('/dashboard/uj-fuvar')).toBe('/dashboard/uj-fuvar');
    expect(biztonsagosBelsoUt('/fuvarjaim?tab=vallalt')).toBe('/fuvarjaim?tab=vallalt');
  });
  it('nyílt átirányítást elutasít', () => {
    for (const rossz of ['//gonosz.hu', 'https://gonosz.hu', 'javascript:alert(1)', '/\\gonosz.hu', 'gonosz.hu', '', null, undefined, '/x\nSet-Cookie: a=b']) {
      expect(biztonsagosBelsoUt(rossz as any), `átengedve: ${JSON.stringify(rossz)}`).toBeNull();
    }
  });
});
