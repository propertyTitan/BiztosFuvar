// Díjszámítás — az ÁSZF-ben (ügyvéd által) rögzített szabályok gépi őrzése:
//   platform díj:   10% + 400 Ft fix
//   lemondási díj:  8 000 Ft-ig 400 Ft fix, felette 5% (csak feladói lemondásnál)
import { describe, it, expect } from 'vitest';

const barion = require('../src/services/barion');

describe('Platform díj (10% + 400 Ft)', () => {
  it('15 000 Ft-os fuvar: 1 900 Ft platform díj, 13 100 Ft a sofőré', () => {
    const { platformShare, carrierShare } = barion.calculatePlatformFee(15000);
    expect(platformShare).toBe(1900);
    expect(carrierShare).toBe(13100);
  });

  it('a jutalék-konstansok az ÁSZF-fel egyeznek', () => {
    expect(barion.COMMISSION_PCT).toBe(0.10);
    expect(barion.COMMISSION_FIXED_HUF).toBe(400);
  });
});

describe('Lemondási díj (ÁSZF: 8 000 Ft-ig 400 Ft, felette 5%)', () => {
  it('fizetetlen fuvar lemondása díjmentes', () => {
    expect(barion.computeCancellationSettlement({
      totalHuf: 20000, paid: false, cancelledByRole: 'shipper',
    })).toEqual({ fee: 0, refund: 0 });
  });

  it('sofőr lemondása: 100% refund a feladónak, díj nincs', () => {
    expect(barion.computeCancellationSettlement({
      totalHuf: 20000, paid: true, cancelledByRole: 'carrier',
    })).toEqual({ fee: 0, refund: 20000 });
  });

  it('feladói lemondás 8 000 Ft alatt: 400 Ft fix', () => {
    expect(barion.computeCancellationSettlement({
      totalHuf: 6000, paid: true, cancelledByRole: 'shipper',
    })).toEqual({ fee: 400, refund: 5600 });
  });

  it('feladói lemondás 8 000 Ft felett: 5%', () => {
    expect(barion.computeCancellationSettlement({
      totalHuf: 20000, paid: true, cancelledByRole: 'shipper',
    })).toEqual({ fee: 1000, refund: 19000 });
  });
});
