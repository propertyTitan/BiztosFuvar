import { describe, it, expect } from 'vitest';
import { classifyPackage } from './packageSizes';

describe('classifyPackage', () => {
  it('a legkisebb beleférő kategóriát adja vissza', () => {
    expect(classifyPackage(30, 20, 10, 2)).toBe('S'); // pont S
    expect(classifyPackage(10, 10, 10, 1)).toBe('S');
    expect(classifyPackage(50, 40, 30, 10)).toBe('M'); // pont M
    expect(classifyPackage(80, 60, 50, 25)).toBe('L'); // pont L
    expect(classifyPackage(150, 100, 80, 50)).toBe('XL'); // pont XL
  });

  it('a méret túllépésekor a következő kategóriába sorol', () => {
    expect(classifyPackage(31, 20, 10, 2)).toBe('M'); // 1 cm-rel hosszabb mint S
    expect(classifyPackage(51, 40, 30, 10)).toBe('L');
  });

  it('a súly is léptet kategóriát', () => {
    expect(classifyPackage(30, 20, 10, 3)).toBe('M'); // S-be férne, de 3 kg > 2 kg
    expect(classifyPackage(30, 20, 10, 11)).toBe('L'); // 11 kg > M (10 kg)
  });

  it('orientáció-független (a méretek sorrendje nem számít)', () => {
    expect(classifyPackage(10, 20, 30, 2)).toBe('S');
    expect(classifyPackage(30, 10, 20, 2)).toBe('S');
  });

  it('null, ha semmibe sem fér bele', () => {
    expect(classifyPackage(200, 100, 80, 50)).toBeNull(); // túl hosszú
    expect(classifyPackage(150, 100, 80, 51)).toBeNull(); // túl nehéz
  });
});
