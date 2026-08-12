// =====================================================================
//  CI-KAPU ŐR: a bukó teszt TÉNYLEG megbuktatja a buildet (2026-08-12)
//
//  ⚠️⚠️ EZ A MAI NAP LEGSÚLYOSABB TALÁLATA. A backend CI-lépése VAK VOLT:
//  egy biztosan bukó teszt mellett a `npx vitest run` és a CI parancsa
//  (`npm run test:coverage`) egyaránt **0-s kilépési kóddal** végzett. A
//  riport helyesen kiírta, hogy „Tests 1 failed" — a build mégis zöld lett.
//
//  Következmény: a `backend-tests.yml` teszt-lépése PIROS SUITE MELLETT IS
//  ÁTMENT. A CLAUDE.md azt rögzítette, hogy „N teszt fut CI-ben minden PR-en"
//  — futni futott, de NEM KAPUZOTT. Ténylegesen csak a függőség-audit és a
//  lefedettség-őr buktatta el a buildet (azok saját `process.exit`-tel élnek).
//
//  AZ OK (A/B-vel izolálva): a `pg.stop()` (embedded-postgres) a
//  gyerekfolyamat kilövésekor felülírja a vitest által beállított
//  `process.exitCode`-ot. Teardown nélkül a kód helyesen 1; csak a
//  `fs.rmSync`-kel szintén 1; a `pg.stop()`-pal 0.
//
//  A web-suite-ot ez nem érintette (nincs globalSetup — lemérve: 1), és az
//  E2E-t sem (külön Playwright-futtató). Ezért buktak el E2E-hibák, miközben
//  a backend mindig „zöld" volt.
//
//  ⚠️ UGYANAZ A HIBAOSZTÁLY, amit a projekt már megtalált a vitest
//  `coverage.thresholds`-ánál („kiírja a sértést, de NULLA kóddal lép ki") —
//  csak egy szinttel feljebb, a TELJES teszt-kapun. Ez az őr azt zárja le,
//  hogy a kapu némán újra kinyílhasson.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { execFileSync } = require('child_process');
const { writeFileSync, unlinkSync, existsSync } = require('fs');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const BUKO = path.join(__dirname, '__ci-kapu-proba.test.js');

/** Egy KÜLÖN vitest-futás kilépési kódja a megadott fájlra. */
function kilepesiKod(fajl) {
  try {
    execFileSync('npx', ['vitest', 'run', fajl], {
      cwd: GYOKER,
      stdio: 'ignore',
      // Saját port, hogy ne ütközzön a FUTÓ suite adatbázisával.
      env: { ...process.env, GOFUVAR_TEST_PG_PORT: '54399' },
      timeout: 180_000,
    });
    return 0;
  } catch (err) {
    return err.status ?? -1;
  }
}

describe('CI-kapu: a bukó teszt megbuktatja a buildet', () => {
  it('egy BIZTOSAN bukó teszt NEM NULLA kilépési kódot ad', () => {
    writeFileSync(BUKO, [
      "import { describe, it, expect } from 'vitest';",
      "describe('ci-kapu proba', () => {",
      "  it('szandekosan bukik', () => { expect(1).toBe(2); });",
      '});',
      '',
    ].join('\n'));

    let kod;
    try {
      kod = kilepesiKod('tests/__ci-kapu-proba.test.js');
    } finally {
      if (existsSync(BUKO)) unlinkSync(BUKO);
    }

    expect(
      kod,
      'A BUKÓ TESZT NULLA KILÉPÉSI KÓDDAL VÉGZETT — A CI-KAPU VAK.\n\n'
      + 'Ez azt jelenti, hogy a backend-tests.yml teszt-lépése PIROS SUITE\n'
      + 'MELLETT IS ÁTMEGY: bármilyen törött kód mergelhető, és a „CI zöld"\n'
      + 'állítás semmit nem jelent.\n\n'
      + 'Az ok jellemzően a globalSetup teardownja: a `pg.stop()` felülírja a\n'
      + 'vitest által beállított process.exitCode-ot. A javítás a\n'
      + 'tests/global-setup.js-ben van (a mért kódot a stop előtt elmentjük,\n'
      + 'és a process exit-horgonyán visszakényszerítjük).\n\n'
      + 'Ne a tesztet igazítsd — a KAPUT javítsd.',
    ).not.toBe(0);
  }, 200_000);

  it('a globalSetup teardownja tartalmazza a kilépési kód védelmét', () => {
    // Olcsó másodlagos jelzés: ha valaki „egyszerűsíti" a teardownt, ez
    // azonnal szól, anélkül hogy meg kéne várni a lassú alfolyamat-tesztet.
    const { readFileSync } = require('fs');
    const forras = readFileSync(path.join(__dirname, 'global-setup.js'), 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      forras.includes('exitCode'),
      'A globalSetup teardownjából eltűnt a kilépési kód védelme. A `pg.stop()` '
      + 'felülírja a vitest eredményét, és a CI-kapu újra vakká válik.',
    ).toBe(true);
  });
});
