// Beágyazott teszt-Postgres indítása a Playwright futás elejére.
// A közös backend/tests/pg-server.js modult használjuk (CJS), a vitest
// unit tesztektől eltérő porton (54332), hogy párhuzamosan is futhassanak.
import path from 'path';

export default async function globalSetup() {
  // A web package.json nem ESM, a Playwright CJS-ként fordítja ezt a fájlt,
  // így a CJS require közvetlenül elérhető.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startTestPostgres } = require('../../backend/tests/pg-server.js');
  const server = await startTestPostgres({
    port: 54332,
    dataDir: path.join(__dirname, '.pg-data'),
  });
  return async () => {
    await server.stop();
  };
}
