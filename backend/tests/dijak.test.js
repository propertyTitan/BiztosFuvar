// Díjszámítás — az ÁSZF-ben rögzített szabályok gépi őrzése.
// Készpénzes modell (2026-07-03) + EGYSZERŰSÍTETT launch-árazás
// (2026-07-15, user + ügyvezető döntése, cél: user-gyűjtés):
//   kapcsolatfelvételi díj (bruttó, bevezető ár, a FELADÓ fizeti):
//     50 000 Ft fuvardíjig 500 Ft / felette 1 000 Ft
//   a fuvardíj 100%-a a szállítóé (készpénz, levonás nélkül)
//   lemondási díj NINCS; a kapcsolatfelvételi díj nem visszatérítendő
import { describe, it, expect } from 'vitest';

const barion = require('../src/services/barion');
const { calculateConnectionFee, CONNECTION_FEE_TIERS } = require('../src/services/connectionFee');

describe('Kapcsolatfelvételi díj (sávos, bevezető ár — ÁSZF 4.1)', () => {
  it('50 000 Ft-ig 500 Ft', () => {
    expect(calculateConnectionFee(1)).toBe(500);
    expect(calculateConnectionFee(15000)).toBe(500);
    expect(calculateConnectionFee(50000)).toBe(500);
  });

  it('50 000 Ft felett 1 000 Ft', () => {
    expect(calculateConnectionFee(50001)).toBe(1000);
    expect(calculateConnectionFee(100000)).toBe(1000);
    expect(calculateConnectionFee(5000000)).toBe(1000);
  });

  it('a sávok az ÁSZF-fel egyeznek', () => {
    expect(CONNECTION_FEE_TIERS).toEqual([
      { maxPriceHuf: 50000, feeHuf: 500 },
      { maxPriceHuf: Infinity, feeHuf: 1000 },
    ]);
  });
});

describe('Lemondás (ÁSZF 5.1): nincs lemondási díj, nincs visszatérítés', () => {
  it('a settlement mindig { fee: 0, refund: 0 } — a platform nem kezel fuvardíjat', () => {
    expect(barion.computeCancellationSettlement({
      totalHuf: 20000, paid: true, cancelledByRole: 'shipper',
    })).toEqual({ fee: 0, refund: 0 });
    expect(barion.computeCancellationSettlement({
      totalHuf: 20000, paid: true, cancelledByRole: 'carrier',
    })).toEqual({ fee: 0, refund: 0 });
    expect(barion.computeCancellationSettlement()).toEqual({ fee: 0, refund: 0 });
  });
});
