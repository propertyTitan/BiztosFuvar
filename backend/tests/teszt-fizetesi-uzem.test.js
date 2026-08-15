// =====================================================================
//  TESZT FIZETÉSI ÜZEM — a kapcsoló hatóköre és a láthatósága (2026-08-15)
//
//  ⚠️ USER-DÖNTÉS, TUDATOS KOCKÁZATTAL. Élesben a stub-fizetés alapesetben
//  ZÁRVA van: enélkül bárki fizetés nélkül „fizetettnek" jelölheti a SAJÁT
//  fuvarát, és ingyen megkapja a kontaktot — a platform EGYETLEN bevétele
//  kerülhető meg. A védelem mellékhatása viszont az volt, hogy a fizetés
//  UTÁNI fél rendszer élesben nem tesztelhető, amíg a CIB nem él.
//
//  A user döntése: `ALLOW_STUB_PAYMENTS=true`, a launchnál vissza.
//
//  EZ AZ ŐR AZT RÖGZÍTI, AMI A DÖNTÉS MELLETT IS IGAZ KELL LEGYEN:
//
//   1. a kapcsoló CSAK a hitelesített, saját fuvarra ható kézi nyugtázást
//      nyitja ki — a PUBLIKUS webhookot SOHA (ott egy hamisított POST bárki
//      fuvarját fizetettnek jelölhetné, nem csak a sajátodét);
//   2. a felhasználó LÁTJA, hogy teszt-üzem van (`payment_test_mode` a
//      /auth/me-ben) — ez a védelem, ami nem az emlékezetre épül;
//   3. kapcsoló NÉLKÜL élesben minden zárva marad (nem lazult a védelem).
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ENV_NEV = 'ALLOW_STUB_PAYMENTS';

/** A provider-modul friss betöltése az adott env mellett. */
function frissProvider(env) {
  const regi = { ...process.env };
  Object.assign(process.env, env);
  const ut = require.resolve('../src/services/paymentProvider');
  delete require.cache[ut];
  const modul = require(ut);
  // A modul a hívásoknál olvassa az env-et, ezért NEM állítjuk vissza most.
  return { modul, visszaall: () => { process.env = regi; } };
}

let visszaall = null;
afterEach(() => { if (visszaall) { visszaall(); visszaall = null; } });
beforeEach(() => { delete process.env[ENV_NEV]; });

describe('Teszt fizetési üzem: a kapcsoló hatóköre', () => {
  it('KAPCSOLÓ NÉLKÜL élesben minden zárva (a védelem nem lazult)', () => {
    const { modul, visszaall: v } = frissProvider({ NODE_ENV: 'production' });
    visszaall = v;

    expect(modul.stubEngedelyezve()).toBe(false);
    expect(
      modul.manualConfirmAllowed(),
      'Éles futásban, kapcsoló NÉLKÜL a kézi fizetés-nyugtázás NYITVA van. '
      + 'Ez az eredeti, súlyos rés: bárki fizetés nélkül „fizetettnek" '
      + 'jelölhetné a saját fuvarát, és ingyen megkapná a kontaktot.',
    ).toBe(false);
    expect(modul.isUnsafeStub(), 'a webhook-kapunak zárva kell lennie').toBe(true);
  });

  it('KAPCSOLÓVAL a kézi nyugtázás nyílik — a PUBLIKUS webhook NEM', () => {
    const { modul, visszaall: v } = frissProvider({
      NODE_ENV: 'production', [ENV_NEV]: 'true',
    });
    visszaall = v;

    expect(modul.stubEngedelyezve()).toBe(true);
    expect(
      modul.manualConfirmAllowed(),
      'A teszt-üzem nem nyitotta ki a kézi nyugtázást — a tesztelő így nem tud '
      + 'túljutni a fizetésen, tehát a kapcsoló nem tölti be a szerepét.',
    ).toBe(true);

    expect(
      modul.isUnsafeStub(),
      '⚠️ A TESZT-ÜZEM KINYITOTTA A PUBLIKUS PSP-CALLBACKOT.\n\n'
      + 'Ez SOHA nem megengedett. A kézi nyugtázás hitelesített, és csak a\n'
      + 'SAJÁT fuvarodra hat — teszteléshez elfogadható kockázat. A callback\n'
      + 'viszont PUBLIKUS és hitelesítés NÉLKÜLI: ha kinyílik, egy hamisított\n'
      + 'POST-tal BÁRKI BÁRMELYIK fuvart fizetettnek jelölheti, beleértve\n'
      + 'másokét is. A tesztelésnek erre nincs is szüksége.',
    ).toBe(true);
  });

  it('a kapcsoló CSAK a pontos "true" értéket fogadja el', () => {
    for (const ertek of ['1', 'igen', 'yes', 'TRUE ', '', 'false']) {
      const { modul, visszaall: v } = frissProvider({
        NODE_ENV: 'production', [ENV_NEV]: ertek,
      });
      const eredmeny = modul.stubEngedelyezve();
      v();
      if (ertek.trim().toLowerCase() === 'true') continue;
      expect(
        eredmeny,
        `A(z) "${ertek}" érték bekapcsolta a teszt-üzemet. Csak a pontos `
        + '"true" kapcsolhatja be — egy félreütés nem nyithatja ki a pénz-utat.',
      ).toBe(false);
    }
  });

  it('a boot HANGOSAN figyelmeztet, ha a teszt-üzem aktív', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const forras = readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

    expect(
      forras.includes('stubEngedelyezve()'),
      'A boot-ellenőrzés nem nézi a teszt-üzemet. Ilyenkor SEMMI nem jelzi, '
      + 'hogy a pénz-út nyitva van — se a log, se a Sentry.',
    ).toBe(true);
    expect(
      /TESZT-ÜZEM AKTÍV/.test(forras),
      'A boot-figyelmeztetés szövege eltűnt vagy megváltozott.',
    ).toBe(true);
    expect(
      /LAUNCH ELŐTT TÖRÖLD/.test(forras),
      'A figyelmeztetésből kimaradt a TEENDŐ. Egy riasztás, ami nem mondja meg, '
      + 'mit kell tenni, nem ér semmit.',
    ).toBe(true);
  });
});

describe('Teszt fizetési üzem: a felhasználó LÁTJA', () => {
  it('a /auth/me kiadja a payment_test_mode jelzőt', () => {
    const { readFileSync } = require('fs');
    const path = require('path');
    const forras = readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');

    expect(
      forras.includes('payment_test_mode'),
      '⚠️ A /auth/me nem adja ki a `payment_test_mode` jelzőt.\n\n'
      + 'Ebből tudja a webes felület, hogy kiírja-e a látható „TESZT FIZETÉSI\n'
      + 'MÓD" sávot. E NÉLKÜL a teszt-üzem NÉMÁN bent maradhat élesben, és a\n'
      + 'jelzés csak a boot-logban lenne — amit senki nem néz.\n\n'
      + 'Ez a sáv az EGYETLEN védelem, ami nem az emlékezetre épül: egy valódi\n'
      + 'felhasználó is azonnal látja, ha a teszt-üzem élesben maradt.',
    ).toBe(true);
  });
});
