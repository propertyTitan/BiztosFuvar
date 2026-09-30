import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// A böngészős mérések (render / a11y / halott link / szövegőr) a Playwrightban
// futnak, itt nem. Ez az őr azt tartja, hogy a két új CIB-oldal BEKERÜLT a
// közös leltárba és a szövegőr listájába — különben a 16-os spec leltár-őre
// csak a CI-ban, a teljes E2E-futásnál szólna.
const olvas = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('CIB-oldalak a böngészős leltárakban', () => {
  it('az oldal-leltárban mindkét új oldal szerepel', () => {
    const leltar = olvas('e2e/oldal-leltar.ts');
    expect(leltar).toContain("minta: '/fizetes/eredmeny'");
    expect(leltar).toContain("minta: '/bankkartyas-fizetes'");
  });

  it('az eredményoldal mért állapotai külön névvel szerepelnek (a Playwright-címek egyediek)', () => {
    const leltar = olvas('e2e/oldal-leltar.ts');
    for (const nev of ['sikeres', 'sikertelen', 'feldolgozas', 'ellenorzes']) {
      expect(leltar).toContain(`allapotNev: '${nev}'`);
    }
    for (const spec of ['e2e/16-oldal-lefedettseg.spec.ts', 'e2e/19-akadalymentesites.spec.ts', 'e2e/20-halott-linkek.spec.ts']) {
      expect(olvas(spec), spec).toContain('allapotCimke(oldal)');
    }
  });

  it('a szövegőr a publikus tájékoztató oldalt is nézi', () => {
    expect(olvas('e2e/13-szovegor.spec.ts')).toContain("'/bankkartyas-fizetes'");
  });

  it('a sitemap-ben benne van a publikus tájékoztató', () => {
    expect(olvas('app/sitemap.ts')).toContain('/bankkartyas-fizetes');
  });
});
