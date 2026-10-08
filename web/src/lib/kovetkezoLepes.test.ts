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
    expect(kovetkezoLepes({ status: 'disputed', paid_at: 'x', status_before_dispute: 'delivered' }).szoveg)
      .toMatch(/addig várj/);
  });

  // fix2-review: a vitakártya szerint „ha a csomag még nálad van, az átadás a
  // szokásos módon” megy (a backend engedi: disputed + in_progress előtte) —
  // a munkalista nem mondhat ellentmondó „addig várj”-t.
  it('vita úton lévő csomaggal: a kézbesítés mehet, nem „addig várj”', () => {
    const l = kovetkezoLepes({ status: 'disputed', paid_at: 'x', status_before_dispute: 'in_progress' });
    expect(l.kod).toBe('vita');
    expect(l.gomb).toBe('Kézbesítés →');
    expect(l.szoveg).toMatch(/^Vita folyamatban — a csomag nálad van/);
    expect(l.szoveg).toMatch(/átvételi kódja/);
    expect(l.szoveg).not.toMatch(/várj/);
    expect(l.sulyos).toBe(true);
  });

  it('a vita jelvénye a fuvar-állapotjelvénnyel azonos szó: „Vita folyamatban”', () => {
    expect(kovetkezoLepes({ status: 'disputed', paid_at: 'x' }).jelveny).toBe('Vita folyamatban');
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
