// Díjszámítás — az ÁSZF-ben rögzített szabályok gépi őrzése.
// Készpénzes modell (2026-07-03, a user üzleti döntése):
//   kapcsolatfelvételi díj (bruttó, bevezető ár, a FELADÓ fizeti):
//     20 000 Ft-ig 500 / 50 000 Ft-ig 1 490 / 100 000 Ft-ig 2 490 / felette 3 990
//   a fuvardíj 100%-a a sofőré (készpénz, levonás nélkül)
//   lemondási díj NINCS; a kapcsolatfelvételi díj nem visszatérítendő
import { describe, it, expect } from 'vitest';

const barion = require('../src/services/barion');
const { calculateConnectionFee, CONNECTION_FEE_TIERS } = require('../src/services/connectionFee');

describe('Kapcsolatfelvételi díj (sávos, bevezető ár — ÁSZF 4.1)', () => {
  it('20 000 Ft-ig 500 Ft', () => {
    expect(calculateConnectionFee(1)).toBe(500);
    expect(calculateConnectionFee(15000)).toBe(500);
    expect(calculateConnectionFee(20000)).toBe(500);
  });

  it('20 001 – 50 000 Ft: 1 490 Ft', () => {
    expect(calculateConnectionFee(20001)).toBe(1490);
    expect(calculateConnectionFee(50000)).toBe(1490);
  });

  it('50 001 – 100 000 Ft: 2 490 Ft', () => {
    expect(calculateConnectionFee(50001)).toBe(2490);
    expect(calculateConnectionFee(100000)).toBe(2490);
  });

  it('100 000 Ft felett: 3 990 Ft', () => {
    expect(calculateConnectionFee(100001)).toBe(3990);
    expect(calculateConnectionFee(5000000)).toBe(3990);
  });

  it('a sávok az ÁSZF-fel egyeznek', () => {
    expect(CONNECTION_FEE_TIERS).toEqual([
      { maxPriceHuf: 20000, feeHuf: 500 },
      { maxPriceHuf: 50000, feeHuf: 1490 },
      { maxPriceHuf: 100000, feeHuf: 2490 },
      { maxPriceHuf: Infinity, feeHuf: 3990 },
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
