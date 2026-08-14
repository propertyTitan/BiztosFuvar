// =====================================================================
//  DEPLOY-GYÖKÉR ŐR: az éles kód nem hivatkozhat a backend/-en kívülre
//  (2026-08-14)
//
//  ⚠️ EZ AZ ŐR EGY ÉLES LEÁLLÁS UTÁN SZÜLETETT. A banki felkészülési anyag
//  JSON-ját a repó gyökerében lévő `shared/` mappába tettem, és az admin
//  route így hivatkozott rá:
//
//      require('../../../shared/bank-felkeszules.json')
//
//  Lokálisan működött, a CI-ban működött (ott a TELJES repó ki van csekkolva),
//  a PR mind az 5 checkje zöld volt. Élesben viszont a Railway a `backend/`
//  könyvtárat deployolja, a repó gyökerét NEM — a require boot-időben elszállt,
//  és vele az EGÉSZ szerver. Nem csak az az egy végpont: az API 502-t adott
//  („Application failed to respond"), a felhasználók be sem tudtak lépni.
//
//  ⚠️ AMIÉRT EGYETLEN MEGLÉVŐ TESZT SEM FOGTA MEG: mindegyik a repó gyökeréből
//  fut, ahol a fájl OTT VAN. A teszt-környezet és az éles környezet közti
//  különbség — pontosan az a fajta rés, amit csak a valóság mutat meg.
//
//  A `shared/` mappa addig kizárólag TESZTEKBŐL volt hivatkozva (PII-korpusz),
//  ezért nem derült ki korábban, hogy éles kódból nem elérhető.
//
//  EZ AZ ŐR: végigmegy a `src/` MINDEN require-jén, és elhasal, ha bármelyik
//  kilép a `backend/` könyvtárból.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

const BACKEND_GYOKER = path.resolve(__dirname, '..');
const SRC = path.join(BACKEND_GYOKER, 'src');

/** Minden .js fájl a src/ alatt. */
function jsFajlok(dir, ki = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const teljes = path.join(dir, e.name);
    if (e.isDirectory()) jsFajlok(teljes, ki);
    else if (e.name.endsWith('.js')) ki.push(teljes);
  }
  return ki;
}

/**
 * A fájlban szereplő RELATÍV require-ek (a csomagneveket nem nézzük).
 *
 * ⚠️ A KOMMENTEKET ELŐBB KISZEDJÜK. Az első változatom nem tette, és azonnal
 * hamis riasztást adott: a `middleware/rateLimit.js` docblockjában szerepel egy
 * HASZNÁLATI PÉLDA (`require('./middleware/rateLimit')`), ami sosem fut le.
 * Ez ugyanaz a hibaosztály, amit a projekt már megtalált a szöveg-illesztő
 * őröknél — csak ott a komment ELFEDTE a hibát, itt KITALÁLT egyet.
 * Mindkét irányban ugyanaz a tanulság: a forrásszöveg nem a program.
 */
function relativRequirek(forras) {
  const kommentNelkul = forras
    .replace(/\/\*[\s\S]*?\*\//g, '')   // blokk-komment
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // sor-komment (az URL-ek // -ét kímélve)

  const ki = [];
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(kommentNelkul))) ki.push(m[1]);
  return ki;
}

describe('Deploy-gyökér őr', () => {
  it('van mit vizsgálni (az őr nem lehet vak)', () => {
    expect(jsFajlok(SRC).length).toBeGreaterThan(20);
  });

  it('EGYETLEN éles modul sem hivatkozik a backend/ könyvtáron kívülre', () => {
    const sertesek = [];

    for (const fajl of jsFajlok(SRC)) {
      const forras = fs.readFileSync(fajl, 'utf8');
      for (const hiv of relativRequirek(forras)) {
        const felold = path.resolve(path.dirname(fajl), hiv);
        if (!felold.startsWith(BACKEND_GYOKER + path.sep)) {
          sertesek.push(
            `${path.relative(BACKEND_GYOKER, fajl)} → ${hiv}  (feloldva: ${felold})`,
          );
        }
      }
    }

    expect(
      sertesek,
      'AZ ÉLES KÓD A DEPLOY-GYÖKÉREN KÍVÜLRE HIVATKOZIK:\n\n  '
      + `${sertesek.join('\n  ')}\n\n`
      + 'A Railway a `backend/` könyvtárat deployolja, a repó gyökerét NEM.\n'
      + 'Egy ilyen require BOOT-IDŐBEN száll el, és nem csak az érintett\n'
      + 'végpontot viszi magával, hanem az EGÉSZ SZERVERT: az API 502-t ad, a\n'
      + 'felhasználók be sem tudnak lépni.\n\n'
      + '⚠️ Ez már MEGTÖRTÉNT (2026-08-14), és sem a lokális futás, sem a CI\n'
      + 'nem fogta meg — ott a teljes repó ki van csekkolva, tehát a fájl a\n'
      + 'helyén van. Csak az éles környezet mutatta meg.\n\n'
      + 'MEGOLDÁS: másold a szükséges fájlt a `backend/` alá (pl.\n'
      + '`backend/src/data/`), és onnan hivatkozz rá.',
    ).toEqual([]);
  });

  it('a hivatkozott relatív fájlok LÉTEZNEK is', () => {
    // Egy elgépelt útvonal ugyanúgy boot-hibát okoz, mint a gyökéren kívüli.
    const hianyzok = [];

    for (const fajl of jsFajlok(SRC)) {
      const forras = fs.readFileSync(fajl, 'utf8');
      for (const hiv of relativRequirek(forras)) {
        const alap = path.resolve(path.dirname(fajl), hiv);
        const letezik = fs.existsSync(alap)
          || fs.existsSync(`${alap}.js`)
          || fs.existsSync(`${alap}.json`)
          || fs.existsSync(path.join(alap, 'index.js'));
        if (!letezik) {
          hianyzok.push(`${path.relative(BACKEND_GYOKER, fajl)} → ${hiv}`);
        }
      }
    }

    expect(
      hianyzok,
      `NEM LÉTEZŐ MODULRA HIVATKOZÓ REQUIRE:\n  ${hianyzok.join('\n  ')}\n\n`
      + 'Ez ugyanúgy boot-időben dobja el az egész szervert, mint a\n'
      + 'deploy-gyökéren kívüli hivatkozás.',
    ).toEqual([]);
  });
});
