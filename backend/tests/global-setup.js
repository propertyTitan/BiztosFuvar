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
    await server.stop();
  };
};
