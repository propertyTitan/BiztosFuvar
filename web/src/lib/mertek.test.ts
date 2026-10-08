// UX A17 (2. lépés): egy kártyán belül vegyes volt a tizedes-jel — „1,61 m³”
// mellett „65.00 kg” és „164.07 km” (a pg NUMERIC stringként jön).
import { describe, expect, it } from 'vitest';
import { ertekeles, mertek } from './mertek';

describe('mertek', () => {
  it('a pg NUMERIC stringet magyar tizedesvesszővel, felesleges nullák nélkül adja', () => {
    expect(mertek('65.00', 'kg')).toBe('65 kg');
    expect(mertek('164.07', 'km')).toBe('164,1 km');
    expect(mertek('1.612', 'm³', 2)).toBe('1,61 m³');
    expect(mertek(0.5, 'kg')).toBe('0,5 kg');
  });

  it('a négyjegyű szám is tagolt, mint a díjaknál (fix2-review)', () => {
    expect(mertek(1250.2, 'km', 0)).toMatch(/^1\s250\skm$/);
  });

  it('ertekeles: egy tizedes, magyar vesszővel („4.70” → „4,7”), érvénytelenre üres', () => {
    expect(ertekeles('4.70')).toBe('4,7');
    expect(ertekeles(4.75)).toBe('4,8');
    expect(ertekeles(5)).toBe('5,0');
    expect(ertekeles(null)).toBe('');
    expect(ertekeles('abc')).toBe('');
  });

  it('hiányzó vagy érvénytelen értékre üres szöveg (nem „NaN kg”)', () => {
    expect(mertek(null, 'kg')).toBe('');
    expect(mertek(undefined, 'kg')).toBe('');
    expect(mertek('', 'kg')).toBe('');
    expect(mertek('abc', 'kg')).toBe('');
  });
});
