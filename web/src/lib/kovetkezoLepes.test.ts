import { describe, it, expect } from 'vitest';
import { kovetkezoLepes } from './kovetkezoLepes';

// UX-review A5 (2026-10-08): a főoldal minden elfogadott fuvaron „INDÍTÁS →”
// gombot mutatott, a díj előtt is. A közös logika ezt zárja: fizetetlen
// fuvaron nincs cselekvésre hívó gomb, csak jelvény.
describe('kovetkezoLepes', () => {
  it('elfogadott, FIZETETLEN fuvar: nincs gomb, „Díjfizetésre vár” jelvény', () => {
    const l = kovetkezoLepes({ status: 'accepted', paid_at: null });
    expect(l.kod).toBe('dijfizetes');
    expect(l.gomb, 'a díj előtt a szállítót nem hívhatjuk a csomag átvételére').toBeNull();
    expect(l.jelveny).toBe('Díjfizetésre vár');
    expect(l.sulyos).toBe(false);
  });

  it('elfogadott, fizetett fuvar: „Felvétel →”', () => {
    const l = kovetkezoLepes({ status: 'accepted', paid_at: '2026-10-01T10:00:00Z' });
    expect(l.kod).toBe('felvetel');
    expect(l.gomb).toBe('Felvétel →');
    expect(l.jelveny).toBeNull();
  });

  it('úton lévő fuvar: „Kézbesítés →”', () => {
    const l = kovetkezoLepes({ status: 'in_progress', paid_at: '2026-10-01T10:00:00Z' });
    expect(l.kod).toBe('kezbesites');
    expect(l.gomb).toBe('Kézbesítés →');
  });

  it('vitás fuvar: nincs gomb', () => {
    expect(kovetkezoLepes({ status: 'disputed', paid_at: 'x' }).gomb).toBeNull();
  });

  it('a gombfeliratok mondatkezdő betűsek, nem csupa nagybetűsek', () => {
    for (const status of ['accepted', 'in_progress']) {
      const g = kovetkezoLepes({ status, paid_at: 'x' }).gomb!;
      expect(g).not.toBe(g.toUpperCase());
    }
  });

  it('a munkalista sorrendje: úton → vita → felvétel → díjfizetésre vár', () => {
    const s = (status: string, paid_at: string | null) => kovetkezoLepes({ status, paid_at }).sorrend;
    expect(s('in_progress', 'x')).toBeLessThan(s('disputed', 'x'));
    expect(s('disputed', 'x')).toBeLessThan(s('accepted', 'x'));
    expect(s('accepted', 'x')).toBeLessThan(s('accepted', null));
  });
});
