// UX A24 (2026-10-08): a fuvar- és a profiloldal fülcíme az adatból jön.
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { oldalCim, useOldalCim } from './oldalCim';

describe('oldalCim', () => {
  it('a márkát egyszer teszi a végére, a szóközöket rendbe teszi', () => {
    expect(oldalCim('  Kanapé   szállítása ')).toBe('Kanapé szállítása | GoFuvar');
  });
  it('üres vagy hiányzó címre null (a layout címe marad)', () => {
    expect(oldalCim('')).toBeNull();
    expect(oldalCim('   ')).toBeNull();
    expect(oldalCim(undefined)).toBeNull();
  });
  it('a nagyon hosszú címet levágja, a márka a fülön marad', () => {
    const c = oldalCim('x'.repeat(200))!;
    expect(c.endsWith('… | GoFuvar')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(60 + ' | GoFuvar'.length);
  });
});

describe('useOldalCim', () => {
  it('adat után beállítja a document.title-t, adat nélkül nem nyúl hozzá', () => {
    document.title = 'Fuvar részletei | GoFuvar';
    const { rerender } = renderHook(({ c }) => useOldalCim(c), { initialProps: { c: null as string | null } });
    expect(document.title).toBe('Fuvar részletei | GoFuvar');
    rerender({ c: 'Kanapé — Ajánlatokat vár' });
    expect(document.title).toBe('Kanapé — Ajánlatokat vár | GoFuvar');
  });

  it.each([
    'app/dashboard/fuvar/[id]/page.tsx',
    'app/sofor/fuvar/[id]/page.tsx',
    'app/profil/[id]/page.tsx',
  ])('%s használja', (fajl) => {
    const forras = fs.readFileSync(path.join(process.cwd(), fajl), 'utf8');
    expect(forras).toMatch(/useOldalCim\(/);
  });
});
