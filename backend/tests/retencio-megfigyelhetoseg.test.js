// =====================================================================
//  A RETENCIÓ MEGFIGYELHETŐSÉGE (2026-08-10, séma-audit)
//
//  A megőrzési szabályok megvoltak és futottak — de SEMMI nem bizonyította,
//  hogy valaha lefutottak. Minden purge lenyelte a saját hibáját (`catch` +
//  console.error), az ütemező pedig `.catch(() => {})`-tal hívott. Ha egy
//  séma-változás vagy jogosultsági hiba miatt a kör hónapokig elszáll, azt
//  SEMMI nem jelzi.
//
//  A GDPR 5. cikk (2) (elszámoltathatóság) épp ezt kéri: nem elég betartani a
//  megőrzési időket, bizonyítani is kell tudni. Egy hatósági vizsgálatnál
//  pont ez a bizonyíték hiányzott.
//
//  ⚠️ Ez a teszt azt is őrzi, hogy EGY kör hibája NE állítsa meg a többit —
//  a korábbi szekvenciális `await` láncban egy dobó függvény az utána
//  következő MINDEN kört kihagyta volna.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';

const { db } = require('./helpers');
const retention = require('../src/services/retention');

afterEach(() => { vi.restoreAllMocks(); });

describe('A napi kör nyomot hagy', () => {
  it('minden futás naplósort ír, eredményekkel', async () => {
    await retention.runDailyRetention();

    const { rows } = await db.query(
      'SELECT eredmeny, hibak, ok, finished_at FROM retention_runs ORDER BY started_at DESC LIMIT 1',
    );
    expect(rows[0], 'a kör lefutott, de semmilyen nyomot nem hagyott').toBeTruthy();
    expect(rows[0].finished_at).toBeTruthy();
    expect(rows[0].ok).toBe(true);
    expect(
      Object.keys(rows[0].eredmeny).length,
      'a napló üres — nem derül ki, MELYIK körök futottak',
    ).toBeGreaterThan(15);
  });

  it('a sikeres futás visszakérdezhető (az elszámoltathatóság bizonyítéka)', async () => {
    await retention.runDailyRetention();
    const utolso = await retention.lastSuccessfulRetentionRun();
    expect(utolso, 'nem lehet megmondani, mikor futott utoljára hibátlanul').toBeTruthy();
    expect(utolso.finished_at).toBeTruthy();
  });
});

describe('Egy kör hibája nem állítja meg a többit', () => {
  it('a hibát naplózza, a többi kör lefut, és riasztás megy', async () => {
    // A `purgeOldInvoices` szándékosan elszáll — a korábbi szekvenciális
    // láncban ez az UTÁNA következő MINDEN kört kihagyta volna.
    vi.spyOn(retention, 'purgeOldInvoices').mockImplementation(() => {
      throw new Error('szándékos teszt-hiba');
    });
    const Sentry = require('@sentry/node');
    const riasztas = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => {});

    const { eredmeny, hibak, ok } = await retention.runDailyRetention();

    expect(ok, 'a kör sikeresnek jelentette magát, pedig hiba volt').toBe(false);
    expect(hibak.purgeOldInvoices, 'a hiba nem került a naplóba').toContain('szándékos teszt-hiba');
    expect(
      eredmeny.purgeOldTaxData,
      'a hibás kör UTÁN következők nem futottak le — egy elszállt lépés az '
      + 'egész napi retenciót kiütötte volna',
    ).toBeDefined();
    expect(
      riasztas,
      'a néma kiesés riasztás nélkül maradt — pont ez volt a hiba lényege',
    ).toHaveBeenCalled();

    const { rows } = await db.query(
      'SELECT ok, hibak FROM retention_runs ORDER BY started_at DESC LIMIT 1',
    );
    expect(rows[0].ok).toBe(false);
    expect(rows[0].hibak.purgeOldInvoices).toBeTruthy();
  });
});
