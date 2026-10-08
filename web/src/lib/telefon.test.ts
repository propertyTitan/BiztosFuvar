// UX Q06: tagolt telefonszám, egységes tel: link, navigációs linkek.
import { describe, it, expect } from 'vitest';
import { telefonFormaz, telefonHref } from './telefon';
import { googleNavigacio, wazeNavigacio } from './terkepLinkek';

describe('telefonFormaz', () => {
  it('a magyar számokat tagolja', () => {
    expect(telefonFormaz('+36305551234')).toBe('+36 30 555 1234');
    expect(telefonFormaz('06305551234')).toBe('+36 30 555 1234');
    expect(telefonFormaz('+36 30 555-1234')).toBe('+36 30 555 1234');
    expect(telefonFormaz('0036305551234')).toBe('+36 30 555 1234');
    expect(telefonFormaz('+3612345678')).toBe('+36 1 234 5678');
    expect(telefonFormaz('+3662123456')).toBe('+36 62 123 456');
  });

  it('külföldi vagy értelmezhetetlen számot nem talál ki', () => {
    expect(telefonFormaz('+43 664 1234567')).toBe('+43 664 1234567');
    expect(telefonFormaz('123')).toBe('123');
    expect(telefonFormaz(null)).toBe('');
  });
});

describe('telefonHref', () => {
  it('nemzetközi alak, szóköz nélkül', () => {
    expect(telefonHref('+36 30 555 1234')).toBe('tel:+36305551234');
    expect(telefonHref('06305551234')).toBe('tel:+36305551234');
    expect(telefonHref('+43 664 1234567')).toBe('tel:+436641234567');
    expect(telefonHref('')).toBe('');
  });
});

describe('navigációs linkek', () => {
  it('Google Maps és Waze a pontos koordinátára', () => {
    expect(googleNavigacio(47.4979, 19.0402))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=47.4979,19.0402&travelmode=driving');
    expect(wazeNavigacio(46.253, 20.1414)).toBe('https://waze.com/ul?ll=46.253,20.1414&navigate=yes');
  });

  it('hiányzó vagy hibás koordinátára nincs link', () => {
    expect(googleNavigacio(null, 19)).toBeNull();
    expect(googleNavigacio(0, 0)).toBeNull();
    expect(wazeNavigacio(999, 19)).toBeNull();
  });
});
