import { describe, it, expect } from 'vitest';
import { fuelCostHuf, fuelLiters, co2SavedKg, greenStats } from './green';

describe('green — zöld/üzemanyag becslések', () => {
  it('üzemanyagköltség: 170 km ≈ 11.9 l ≈ ~7735 Ft', () => {
    expect(fuelLiters(170)).toBeCloseTo(11.9, 1);
    expect(fuelCostHuf(170)).toBe(Math.round(170 * 0.07 * 650)); // 7735
  });

  it('megspórolt CO₂: 170 km-es fuvar ≈ 43 kg (elkerült dedikált futár)', () => {
    expect(co2SavedKg(170)).toBe(43); // 170 * 250 / 1000 = 42.5 → 43
  });

  it('greenStats: a fuvardíj fedezet-szorzója helyes', () => {
    const s = greenStats(100, 9000); // fuel = 100*0.07*650 = 4550
    expect(s.fuelCostHuf).toBe(4550);
    expect(s.coversFuel).toBeCloseTo(+(9000 / 4550).toFixed(1), 1); // ~2.0
  });

  it('nulla/negatív/hiányzó távolság sose dob, 0-t ad', () => {
    expect(fuelCostHuf(0)).toBe(0);
    expect(co2SavedKg(-5)).toBe(0);
    expect(greenStats(0).coversFuel).toBeNull();
    // @ts-expect-error – szándékos rossz input
    expect(fuelLiters(undefined)).toBe(0);
  });
});
