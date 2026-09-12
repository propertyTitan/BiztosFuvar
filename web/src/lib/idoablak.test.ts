import { describe, it, expect } from 'vitest';
import { idoablakHiba, idoablakSzoveg } from './idoablak';

const most = new Date('2026-09-12T10:00:00').getTime();
const iso = (h: number) => new Date(most + h * 3600_000).toISOString().slice(0, 16);

describe('felvételi időablak', () => {
  it('üres → nincs hiba; jó ablak → nincs hiba', () => {
    expect(idoablakHiba('', '', most)).toBeNull();
    expect(idoablakHiba(iso(2), iso(6), most)).toBeNull();
    expect(idoablakHiba(iso(2), '', most)).toBeNull();
  });
  it('múltbeli kezdet, fordított sorrend, 60 napon túl → hiba', () => {
    expect(idoablakHiba(iso(-5), iso(6), most)).toMatch(/múltban/);
    expect(idoablakHiba(iso(6), iso(2), most)).toMatch(/kezdete előtt/);
    expect(idoablakHiba(iso(24 * 70), '', most)).toMatch(/60 nappal/);
    expect(idoablakHiba('nem-datum', '', most)).toMatch(/Érvénytelen/);
  });
  it('szöveg: mindkettő / csak kezdet / csak vég', () => {
    expect(idoablakSzoveg('2026-09-12T10:00', '2026-09-12T14:00')).toMatch(/10:00 – 14:00/);
    expect(idoablakSzoveg('2026-09-12T10:00', null)).toMatch(/-tól$/);
    expect(idoablakSzoveg(null, '2026-09-12T14:00')).toMatch(/-ig$/);
    expect(idoablakSzoveg(null, null)).toBeNull();
  });
});
