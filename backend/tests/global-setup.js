// Vitest globalSetup — beágyazott Postgres a backend unit tesztekhez.
// A tényleges indítás/séma-betöltés a közös pg-server.js-ben van (a
// Playwright E2E is azt használja, a 54332-es porton).
const path = require('path');
const { startTestPostgres } = require('./pg-server');

module.exports = async function globalSetup() {
  const server = await startTestPostgres({
    port: 54331,
    dataDir: path.join(__dirname, '.pg-data'),
  });
  return async function teardown() {
    await server.stop();
  };
};
