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
  },
});
