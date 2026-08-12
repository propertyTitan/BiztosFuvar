// =====================================================================
//  A RETENCIÓ FUTÁSA — IDŐ-DIMENZIÓ (2026-08-12, 11. mérés T3)
//
//  ⚠️ EGY EGÉSZ DIMENZIÓ VOLT ŐRIZETLEN. Tizenegy kör azt kérdezte, hogy
//  „létezik-e a szabály" — azt nem, hogy „MIKOR és TÉNYLEG lefut-e".
//
//  A meglévő őr forrásszöveget illesztett:
//      /setInterval\([\s\S]{0,80}runDailyRetention/.test(index)
//  Ez a `setInterval` MÁSODIK argumentumát — a PERIÓDUST — soha nem nézte,
//  és két ellenpéldát engedett át:
//
//   (a) `DAY_MS` → `24 * DAY_MS`: minden szabály 24 NAPONTA fut. A 30 napos
//       fotó-ígéret 30–54 nap lesz, a 7 napos GPS 7–31 nap. Zöld build.
//   (b) az egész ütemező-blokk egy `if (process.env.X === '1')` mögé: a
//       forrásban a keresett szöveg MEGMARAD, tehát az őr zöld — élesben
//       viszont EGYETLEN retenciós kör sem fut soha, és semmi nem szól.
//
//  A (b) azért volt különösen néma, mert a `retention_runs` napló WRITE-ONLY
//  volt: a Sentry-riasztás csak akkor ment, ha egy kör DOBOTT. Ha el sem
//  indult, nincs esemény.
//
//  Ez az őr ezért három dolgot mér:
//    1. a PERIÓDUS a napi nagyságrendben van (nem forrásszöveg: a `setInterval`
//       tényleges hívásait fogjuk el a modul betöltésekor),
//    2. az ütemezés FELTÉTEL NÉLKÜL fut le,
//    3. van WATCHDOG, ami riaszt, ha a kör régóta nem futott.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db } = require('./helpers');
const { lastSuccessfulRetentionRun, runDailyRetention } = require('../src/services/retention');

const ORA = 60 * 60 * 1000;
const NAP = 24 * ORA;

describe('A retenció futása (idő-dimenzió)', () => {
  it('KONKRÉTAN a retenció van napi periódussal ütemezve', () => {
    // ⚠️ NEM ELÉG, HOGY „VAN NAPI IDŐZÍTŐ". Az első változatom csak a
    // periódusokat gyűjtötte, és a (b) ellenpélda átment rajta: az egész
    // retenciós ütemezést egy `if (process.env.X === '1')` mögé téve a teszt
    // ZÖLD maradt, mert a KYC/DAC7/emlékeztető körök periódusa is napi.
    //
    // Ezért most a CALLBACK-et is meghívjuk, és megnézzük, hogy tényleg a
    // retenciót indítja-e el.
    const retention = require('../src/services/retention');
    const eredetiKor = retention.runDailyRetention;
    let retencioIndult = false;
    retention.runDailyRetention = async () => { retencioIndult = true; };

    const eredetiInterval = global.setInterval;
    const eredetiTimeout = global.setTimeout;
    const idozitesek = [];
    global.setInterval = (fn, ms) => {
      idozitesek.push({ fn, ms });
      return { unref() { return this; } };
    };
    global.setTimeout = () => ({ unref() { return this; } });

    try {
      delete require.cache[require.resolve('../src/index')];
      require('../src/index');
    } finally {
      global.setInterval = eredetiInterval;
      global.setTimeout = eredetiTimeout;
    }

    expect(idozitesek.length, 'egyetlen setInterval sem futott le — az őr vak').toBeGreaterThan(0);

    // Napi tartományban lévő időzítők callbackjeit meghívjuk.
    const napiak = idozitesek.filter((i) => i.ms >= 12 * ORA && i.ms <= 2 * NAP);
    for (const i of napiak) {
      try { i.fn(); } catch { /* más körök hibája itt nem érdekes */ }
    }
    retention.runDailyRetention = eredetiKor;

    expect(
      retencioIndult,
      `A boot ${idozitesek.length} időzítést állított be (ebből ${napiak.length} napi), de\n`
      + 'EGYIK SEM indítja el a retenciót napi periódussal.\n\n'
      + 'Ez akkor fordul elő, ha az ütemezés feltétel mögé kerül, vagy ha a\n'
      + 'periódus elcsúszik. Mindkettő NÉMA: a rendszer kívülről hibátlanul\n'
      + 'működik, közben a megőrzési határidők (30 nap fotó, 7 nap GPS, 3 év\n'
      + 'fuvar-PII) nem teljesülnek — és a retention_runs napló üres marad,\n'
      + 'tehát utólag sem tudnánk bizonyítani (GDPR 5. cikk (2)).',
    ).toBe(true);
  });

  it('a WATCHDOG riaszt, ha a retenció régóta nem futott le', async () => {
    // Régi sikeres futás beírása, majd ellenőrizzük, hogy a lekérdezés
    // tényleg ezt adja vissza (ezen áll a watchdog).
    await db.query('DELETE FROM retention_runs');
    await db.query(
      `INSERT INTO retention_runs (started_at, finished_at, ok, eredmeny, hibak)
       VALUES (NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', TRUE, '{}'::jsonb, '{}'::jsonb)`,
    );
    const utolso = await lastSuccessfulRetentionRun();
    expect(utolso, 'a lastSuccessfulRetentionRun nem adott vissza semmit').toBeTruthy();

    // A függvény SORT ad vissza (started_at/finished_at/eredmeny), nem
    // időbélyeget — a watchdognak is így kell olvasnia.
    const mikor = utolso.finished_at || utolso.started_at;
    const oraja = (Date.now() - new Date(mikor).getTime()) / ORA;
    expect(oraja, 'a beírt 5 napos futást nem így olvassuk vissza').toBeGreaterThan(48);

    // …és a watchdog LÉTEZIK az indexben, feltétel nélkül ütemezve.
    const { readFileSync } = require('fs');
    const index = readFileSync(`${__dirname}/../src/index.js`, 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(
      index.includes('lastSuccessfulRetentionRun'),
      'Nincs watchdog: a retention_runs napló WRITE-ONLY, tehát ha a kör el sem\n'
      + 'indul, arról SEMMI nem szól. A GDPR 5. cikk (2) bizonyíthatóságot kér.',
    ).toBe(true);
  });

  it('a sikeres kör TÉNYLEGESEN naplózódik (a watchdog erre épül)', async () => {
    await db.query('DELETE FROM retention_runs');
    await runDailyRetention();

    const { rows } = await db.query(
      'SELECT ok, started_at FROM retention_runs ORDER BY started_at DESC LIMIT 1',
    );
    expect(
      rows.length,
      'A napi kör lefutott, de nem hagyott nyomot a retention_runs-ban — '
      + 'a watchdog így sosem tudná megmondani, hogy futott-e.',
    ).toBe(1);
    expect(rows[0].ok, 'a kör hibásnak jelölte magát egy tiszta DB-n').toBe(true);

    const utolso = await lastSuccessfulRetentionRun();
    expect(utolso, 'a friss futást a lekérdezés nem látja').toBeTruthy();
  }, 20_000);
});
