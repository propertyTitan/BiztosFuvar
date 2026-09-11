import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mentPiszkozat, olvasPiszkozat, torolPiszkozat } from './urlapPiszkozat';

describe('űrlap-piszkozat', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ment → olvas visszaadja; töröl után nincs', () => {
    expect(mentPiszkozat('k', { title: 'Szekrény', weight_kg: 40 })).toBe(true);
    expect(olvasPiszkozat<{ title: string }>('k')?.title).toBe('Szekrény');
    torolPiszkozat('k');
    expect(olvasPiszkozat('k')).toBeNull();
  });

  it('lejárt piszkozat nem jön vissza (és törlődik)', () => {
    mentPiszkozat('k', { title: 'régi' });
    const cs = JSON.parse(window.localStorage.getItem('k')!);
    cs.at = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem('k', JSON.stringify(cs));
    expect(olvasPiszkozat('k')).toBeNull();
    expect(window.localStorage.getItem('k')).toBeNull();
  });

  it('sérült / idegen verziójú bejegyzés → null, nem dob', () => {
    window.localStorage.setItem('k', '{nem json');
    expect(olvasPiszkozat('k')).toBeNull();
    window.localStorage.setItem('k', JSON.stringify({ v: 99, at: Date.now(), adat: { x: 1 } }));
    expect(olvasPiszkozat('k')).toBeNull();
  });

  it('letiltott tárolónál sose dob', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(mentPiszkozat('k', { a: 1 })).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(olvasPiszkozat('k')).toBeNull();
  });
});
