// Vitest globalSetup — beágyazott Postgres a backend unit tesztekhez.
// A tényleges indítás/séma-betöltés a közös pg-server.js-ben van (a
// Playwright E2E is azt használja, a 54332-es porton).
const path = require('path');
const { startTestPostgres } = require('./pg-server');

module.exports = async function globalSetup() {
  const server = await startTestPostgres({
    port: Number(process.env.GOFUVAR_TEST_PG_PORT || 54331),
    // Portonként külön adatkönyvtár — különben két párhuzamos futás
    // ugyanazt a klasztert próbálná használni.
    dataDir: path.join(__dirname, process.env.GOFUVAR_TEST_PG_PORT
      ? `.pg-data-${process.env.GOFUVAR_TEST_PG_PORT}` : '.pg-data'),
  });
  return async function teardown() {
    // ⚠️⚠️ A CI-KAPU EDDIG VAK VOLT (2026-08-12) — EZ A LEGSÚLYOSABB TALÁLAT.
    //
    // Lemérve: egy BIZTOSAN bukó teszt mellett a `npx vitest run` és a CI
    // parancsa (`npm run test:coverage`) egyaránt **0-s kilépési kóddal**
    // végzett. A riport helyesen kiírta, hogy „Tests 1 failed" — a build
    // mégis zöld lett. Vagyis a `backend-tests.yml` teszt-lépése PIROS SUITE
    // MELLETT IS ÁTMENT.
    //
    // A/B-vel izolálva az OK: a `pg.stop()` (embedded-postgres). Teardown
    // nélkül a kód helyesen 1; csak a `fs.rmSync`-kel szintén 1; a
    // `pg.stop()`-pal 0. A stop a gyerekfolyamat kilövésekor felülírja a
    // vitest által beállított `process.exitCode`-ot.
    //
    // A web-suite-ot ez nem érinti (nincs globalSetup, lemérve: 1), és az
    // E2E-t sem (külön Playwright-futtató) — ezért buktak el ma E2E-hibák,
    // miközben a backend mindig „zöld" volt.
    //
    // UGYANAZ A HIBAOSZTÁLY, amit a projekt már megtalált a vitest
    // `coverage.thresholds`-ánál („kiírja a sértést, de nulla kóddal lép ki")
    // — csak egy szinttel feljebb, a TELJES teszt-kapun.
    //
    // A JAVÍTÁS: a mért kilépési kódot a stop ELŐTT elmentjük, és a
    // folyamat tényleges kilépésekor visszakényszerítjük. A `process.on('exit')`
    // a legutolsó pont, ahol ez még hat.
    const mertKod = process.exitCode;
    if (mertKod) {
      process.on('exit', () => {
        // eslint-disable-next-line no-process-exit
        process.exitCode = mertKod;
      });
    }
    await server.stop();
    if (mertKod && !process.exitCode) process.exitCode = mertKod;
  };
};
