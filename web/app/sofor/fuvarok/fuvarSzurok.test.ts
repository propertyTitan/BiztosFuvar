import { describe, it, expect } from 'vitest';
import { aktivSzurokSzama, figyeloLink, EMPTY_FILTERS } from './fuvarSzurok';

describe('fuvarSzurok', () => {
  it('az aktív szűrők száma (a rejtett típus-szűrő nem számít)', () => {
    expect(aktivSzurokSzama(EMPTY_FILTERS)).toBe(0);
    expect(aktivSzurokSzama({ ...EMPTY_FILTERS, from: 'Budapest', max: '9000', type: 'true' })).toBe(2);
    expect(aktivSzurokSzama({ ...EMPTY_FILTERS, from: '   ' })).toBe(0);
  });

  it('a figyelő-link a szűrt városokkal tölt elő, kódolva', () => {
    expect(figyeloLink({ from: '', to: '' })).toBe('/sofor/ertesitok');
    expect(figyeloLink({ from: 'Budapest', to: '' })).toBe('/sofor/ertesitok?honnan=Budapest');
    expect(figyeloLink({ from: 'Hódmezővásárhely', to: 'Szeged' }))
      .toBe('/sofor/ertesitok?honnan=H%C3%B3dmez%C5%91v%C3%A1s%C3%A1rhely&hova=Szeged');
  });
});
