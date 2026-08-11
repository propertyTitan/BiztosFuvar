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

  it('a napi kör TÉNYLEGESEN meghívja a manifestben hivatkozott függvényeket', async () => {
    // ⚠️ EZ A TESZT KORÁBBAN BIZONYÍTOTTAN VAK VOLT (2026-08-11).
    //
    // Szövegben kereste a függvényneveket a `runDailyRetention`-től a fájl
    // VÉGÉIG tartó szeletben — csakhogy az a szelet tartalmazza a
    // `module.exports = {…}` blokkot is, amiben MINDEN purge-név szerepel.
    // Így bármelyik EXPORTÁLT függvényre igazat adott, akkor is, ha a napi
    // kör soha nem hívta meg. Bizonyítva: a `purgeOldTaxData` kivétele a
    // KOR_NEVEK-ből (a DAC7-adat 5 éves törlése némán megszűnik) NEM tette
    // pirossá az őrt.
    //
    // Mostantól nem szöveget nézünk, hanem LEFUTTATJUK a napi kört mockolt
    // modul-exporttal, és feljegyezzük, MELYIKET hívta meg ténylegesen.
    // (A `runDailyRetention` a köröket `module.exports[nev]()`-vel hívja, épp
    // azért, hogy ez mérhető legyen.)
    const hivott = new Set();
    const eredetiek = {};

    const nevek = Object.keys(retention).filter(
      (k) => typeof retention[k] === 'function' && /^(purge|anonymize|expire|shorten)/.test(k),
    );
    for (const nev of nevek) {
      eredetiek[nev] = retention[nev];
      retention[nev] = async () => { hivott.add(nev); return 0; };
    }

    try {
      await retention.runDailyRetention();
    } finally {
      for (const [nev, fn] of Object.entries(eredetiek)) retention[nev] = fn;
    }

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
    const nemFutott = [...hivatkozott].filter(
      (fn) => !MASHOL_UTEMEZETT.includes(fn) && !hivott.has(fn),
    );

    expect(
      nemFutott,
      `A manifest olyan retenciós szabályra hivatkozik, amit a napi kör NEM hívott meg: `
      + `${nemFutott.join(', ')}.\n\nEgy meg nem hívott szabály papír-ígéret: a `
      + 'tájékoztatóban ott a megőrzési idő, a gépben nincs, aki végrehajtsa.',
    ).toEqual([]);
  });

  it('a NAPI KÖR maga ütemezve van', () => {
    // ⚠️ ELLENPÉLDÁVAL IGAZOLT VAKFOLT (2026-08-11, 7. mérés): az őr külön
    // tesztet szentelt annak, hogy a purgeOldKycFiles ütemezve van — a FŐ
    // körre viszont nem volt ilyen. Lefuttatva: az index.js ütemező sorainak
    // törlésével MIND A 19 retenciós kör némán megszűnt, és a TELJES suite
    // (755 teszt) ZÖLD MARADT. A retenciós szabályok papíron megvoltak, a
    // gépben senki nem hívta volna őket.
    const index = require('fs').readFileSync(`${__dirname}/../src/index.js`, 'utf8');
    expect(
      /setInterval\([\s\S]{0,80}runDailyRetention/.test(index),
      'A napi retenciós kör NINCS ütemezve az index.js-ben. Enélkül MINDEN '
      + 'megőrzési szabály papír-ígéret: a tájékoztatóban ott a határidő, a '
      + 'gépben nincs, aki végrehajtsa.',
    ).toBe(true);
  });

  it('MINDEN retenciós függvény szerepel a napi körben', async () => {
    // ⚠️ MÁSODIK ELLENPÉLDA: az őr csak a manifestben NEVESÍTETT függvényeket
    // követelte meg. A `purgeStaleLastKnownLocation`-t egyik manifest-bejegyzés
    // sem nevezi meg — lefuttatva: a KOR_NEVEK-ből kivéve a suite ZÖLD MARADT,
    // miközben a szállító utolsó ismert GPS-pozíciója (tipikusan a lakhelye
    // környéke) a 7 nap helyett a fiók élettartamáig megmaradt volna.
    // Ezért mostantól nem a manifest felől nézünk, hanem a KÓD felől: minden
    // exportált retenciós függvényt meg kell hívnia a napi körnek.
    const hivott = new Set();
    const eredetiek = {};
    const nevek = Object.keys(retention).filter(
      (k) => typeof retention[k] === 'function' && /^(purge|anonymize|expire|shorten)/.test(k),
    );
    for (const nev of nevek) {
      eredetiek[nev] = retention[nev];
      retention[nev] = async () => { hivott.add(nev); return 0; };
    }
    try {
      await retention.runDailyRetention();
    } finally {
      for (const [nev, fn] of Object.entries(eredetiek)) retention[nev] = fn;
    }

    // Amit SZÁNDÉKOSAN nem a napi kör hív — indoklással.
    const KIVETELEK = {
      purgeOldKycFiles: 'külön ütemezve az index.js-ben (lásd a fenti tesztet)',
      shortenAnonymizedAddresses: 'az anonymizeOldJobs hívja a saját törzsében (önjavító alág)',
    };

    const nemHivott = nevek.filter((n) => !hivott.has(n) && !KIVETELEK[n]);
    expect(
      nemHivott,
      `Ezek a retenciós függvények LÉTEZNEK, de a napi kör nem hívja meg őket: `
      + `${nemHivott.join(', ')}.\n\nVagy vedd fel a KOR_NEVEK tömbbe, vagy — ha `
      + 'máshol fut — írd meg ITT, a KIVETELEK listában, hol és miért.',
    ).toEqual([]);
  });

  it('a MÁSHOL ütemezett kivétel tényleg ütemezve van', () => {
    // ⚠️ A `purgeOldKycFiles` az egyetlen kivétel a fenti tesztben — és eddig
    // ELLENŐRIZETLENÜL. Ha valaki kiveszi az index.js-ből, az őr zöld marad,
    // miközben a SZEMÉLYI IGAZOLVÁNY fotójának 30 napos törlése megszűnik.
    const index = require('fs').readFileSync(`${__dirname}/../src/index.js`, 'utf8');
    expect(
      index.includes('purgeOldKycFiles'),
      'A KYC-fotó purge nincs ütemezve az index.js-ben — ez a rendszer '
      + 'legérzékenyebb törlése (a személyi igazolvány nyers fotója).',
    ).toBe(true);
  });
});
