// Beágyazott teszt-Postgres indítása a Playwright futás elejére.
// A közös backend/tests/pg-server.js modult használjuk (CJS), a vitest
// unit tesztektől eltérő porton (54332), hogy párhuzamosan is futhassanak.
import path from 'path';
import fs from 'fs';

/**
 * Mérés-naplók, amiket a specek TESZTEK KÖZÖTT adnak át egymásnak (19-es
 * axe-összegzés, 20-as link-ellenőrzés).
 *
 * ⚠️ MIÉRT ITT TÖRLÜNK, ÉS NEM A SPEC `beforeAll`-jában (2026-08-12, mért
 * tapasztalat): a Playwright BUKÁS UTÁN ÚJRAINDÍTJA a worker-folyamatot, és
 * a `beforeAll` az új workerben ÚJRA LEFUT — vagyis a „tiszta lappal
 * indulunk" törlés pont a bukás után törölte volna ki az addig gyűjtött
 * bizonyítékot. Élesben lemérve: négy oldal bukott, az összegzés mégis
 * „nincs sértés"-t írt. A globalSetup futásonként PONTOSAN EGYSZER fut,
 * minden worker előtt — ez a helyes hely.
 */
const MERES_NAPLOK = ['axe-sertesek.jsonl', 'linkek.jsonl'];

export default async function globalSetup() {
  for (const nev of MERES_NAPLOK) {
    fs.rmSync(path.join(__dirname, '..', 'test-results', nev), { force: true });
  }

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
