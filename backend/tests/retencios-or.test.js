// =====================================================================
//  RETENCIÓS ŐR — osztály-szintű védelem a „lefedetlen tábla" ellen
//
//  ⚠️ HÁROM egymást követő adatvédelmi audit-kör talált „lefedetlen tábla"
//  találatot: előbb a hirdetési fotó, aztán öt tábla retenció nélkül, majd a
//  payment_events / a DAC7-adat / a beragadt foglalás. Mindegyik kör kézzel,
//  egyszer nézett végig — és mindegyik talált újat.
//
//  A projekt ugyanezt a hibaosztályt máshol MÁR gépesítette (route-manifest
//  őr, scrub-ALLOWLIST őr). A retencióra nem volt ilyen. Ez az.
//
//  Az őr a VALÓS adatbázis-sémából olvassa a táblákat — nem egy kézzel írt
//  listából —, így egy új migráció automatikusan a hatálya alá kerül.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db } = require('./helpers');
const { RETENTION_MANIFEST } = require('./retentionManifest');
const retention = require('../src/services/retention');

// Nem adat-táblák: a migrációs napló önmagáról szól.
const NEM_ADAT_TABLA = ['schema_migrations', 'migrations', 'pgmigrations'];

describe('Retenciós őr: minden táblának ismernie kell az életciklusát', () => {
  it('a séma MINDEN táblája szerepel a manifestben', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const tablak = rows.map((r) => r.table_name).filter((t) => !NEM_ADAT_TABLA.includes(t));

    expect(tablak.length, 'nem sikerült kiolvasni a táblákat — az őr vak lenne').toBeGreaterThan(20);

    const hianyzo = tablak.filter((t) => !RETENTION_MANIFEST[t]);
    expect(
      hianyzo,
      `Ezeknek a tábláknak nincs bejegyzésük a retenciós manifestben: ${hianyzo.join(', ')}.\n\n`
      + 'Minden táblának ISMERNIE KELL az életciklusát. Vedd fel a\n'
      + 'tests/retentionManifest.js-be VAGY egy futó `szabaly`-lyal (van végrehajtó\n'
      + 'kód a services/retention.js-ben), VAGY egy `kivetel`-lel, amiben LEÍROD,\n'
      + 'miért nem kell időzített törlés. A cél nem a bejegyzés, hanem hogy a\n'
      + 'döntés tudatos legyen — három audit-kör bukott el azon, hogy nem volt az.',
    ).toEqual([]);
  });

  it('a manifest nem avulhat el: nem szerepelhet benne nem létező tábla', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const letezo = new Set(rows.map((r) => r.table_name));
    const felesleges = Object.keys(RETENTION_MANIFEST).filter((t) => !letezo.has(t));
    expect(
      felesleges,
      `A manifest olyan táblát sorol fel, ami már nem létezik: ${felesleges.join(', ')}. `
      + 'Töröld a bejegyzést — az elavult manifest hamis biztonságot ad.',
    ).toEqual([]);
  });

  it('minden bejegyzésnek pontosan egy formája van (szabály VAGY indokolt kivétel)', () => {
    for (const [tabla, be] of Object.entries(RETENTION_MANIFEST)) {
      const vanSzabaly = typeof be.szabaly === 'string' && be.szabaly.length > 10;
      const vanKivetel = typeof be.kivetel === 'string' && be.kivetel.length > 30;
      expect(
        vanSzabaly !== vanKivetel,
        `A(z) "${tabla}" manifest-bejegyzése hibás: pontosan EGY mező kell — vagy `
        + '`szabaly` (van futó retenciós kód), vagy `kivetel` (érdemi indoklás, '
        + 'legalább 30 karakter). Az üres/általános indoklás („nem kell") nem elfogadható.',
      ).toBe(true);
    }
  });

  it('a napi kör tényleg meghívja a manifestben hivatkozott függvényeket', () => {
    // Az őr önmagában nem ér semmit, ha a hivatkozott függvények nem futnak.
    // A napi kör forrását nézzük: minden nevesített purge/anonimizáló
    // szerepeljen benne.
    const forras = require('fs').readFileSync(`${__dirname}/../src/services/retention.js`, 'utf8');
    const napiKor = forras.slice(forras.indexOf('async function runDailyRetention'));

    const hivatkozott = new Set();
    for (const be of Object.values(RETENTION_MANIFEST)) {
      if (!be.szabaly) continue;
      for (const m of be.szabaly.matchAll(/\b(purge[A-Za-z]+|anonymize[A-Za-z]+|expire[A-Za-z]+)\b/g)) {
        hivatkozott.add(m[1]);
      }
    }
    expect(hivatkozott.size, 'a manifest egyetlen függvényt sem nevez meg — az őr vak').toBeGreaterThan(8);

    // A KYC-fotó purge külön ütemezett (index.js), nem a napi retenciós körben.
    const MASHOL_UTEMEZETT = ['purgeOldKycFiles'];
    const nemFut = [...hivatkozott].filter(
      (fn) => !MASHOL_UTEMEZETT.includes(fn) && !napiKor.includes(fn),
    );
    expect(
      nemFut,
      `A manifest olyan retenciós függvényre hivatkozik, amit a napi kör NEM hív meg: `
      + `${nemFut.join(', ')}. Egy meg nem hívott szabály papír-ígéret.`,
    ).toEqual([]);

    // És legyen exportálva is (különben nem tesztelhető)
    for (const fn of hivatkozott) {
      if (MASHOL_UTEMEZETT.includes(fn)) continue;
      expect(typeof retention[fn], `a ${fn} nincs exportálva a retention.js-ből`).toBe('function');
    }
  });
});
