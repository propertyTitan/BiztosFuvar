// Backend üzleti szabály tesztek — valódi (beágyazott) Postgres ellen.
//
// - globalSetup: elindít egy embedded-postgres példányt a 54331-es porton,
//   betölti a sémát + az összes migrációt, a végén leállítja.
// - setupFiles: MINDEN teszt-worker env-jét a teszt-DB-re kényszeríti,
//   mielőtt bármi backend-kód betöltődne — a prod Neon-t teszt SOHA nem éri el.
// - fileParallelism: false — egy DB-példányon osztoznak a fájlok, a
//   sorrendfüggetlenség így is elvárás, de a párhuzamos séma-írás tilos.
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globalSetup: './tests/global-setup.js',
    setupFiles: ['./tests/env-setup.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // ── Lefedettség ──
    // ⚠️ A vitest saját `thresholds` beállítását SZÁNDÉKOSAN nem használjuk:
    // kiírja ugyan, hogy „does not meet global threshold", de NULLA
    // kilépési kóddal végez — vagyis CI-kapuként használhatatlan lenne
    // (lemérve: a build zöld maradt egy 99%-os küszöbbel is). A tényleges
    // kapu a `scripts/lefedettseg-or.js`, ami a json-summary riportot olvassa.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
