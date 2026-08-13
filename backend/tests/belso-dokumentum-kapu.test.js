// =====================================================================
//  BELSŐ DOKUMENTUM: A KAPU TÉNYLEGES MÉRÉSE (2026-08-13)
//
//  ⚠️ MIÉRT KELL EZ KÜLÖN TESZT: az első változatban a banki felkészülési
//  anyag szövege a React-oldalon élt, és a védelem egy kliens-oldali
//  átirányítás volt (nem-admin → `router.push('/')`). Az CSAK a
//  MEGJELENÍTÉST állítja meg: a szöveg bekerült a publikus JS-chunkba, és
//  bárki letölthette bejelentkezés nélkül a `/_next/static/chunks/` alól.
//  Lemérve, a build kimenetében megtalálva.
//
//  Ez pontosan az a mintázat, amit a projekt már többször megtalált: a
//  védelem azon a rétegen épült meg, ahol felfedezték. A tanulság itt is
//  ugyanaz — a kaput FUTTATVA kell mérni, nem ránézésre elhinni.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const UT = '/admin/dokumentumok/bank-felkeszules';

let admin; let felado; let szallito;

beforeAll(async () => {
  __resetRateLimitsForTests();
  admin = await createUser({ role: 'admin' });
  felado = await createUser({ role: 'shipper' });
  szallito = await createUser({ role: 'carrier' });
});

describe('A belső banki dokumentum végpontja', () => {
  it('token NÉLKÜL nem ad tartalmat', async () => {
    const res = await request(app).get(UT);
    expect(res.status, 'hitelesítés nélkül is kiadta a belső anyagot').toBeGreaterThanOrEqual(401);
    expect(JSON.stringify(res.body)).not.toContain('Tiszta Hód Korlátolt');
  });

  for (const [nev, kulcs] of [['feladónak', 'felado'], ['szállítónak', 'szallito']]) {
    it(`NEM admin (${nev}) nem kapja meg`, async () => {
      const user = kulcs === 'felado' ? felado : szallito;
      __resetRateLimitsForTests();
      const res = await request(app).get(UT).set('Authorization', `Bearer ${user.token}`);

      expect(
        res.status,
        `A(z) ${nev} megkapta a belső, banki felkészülési anyagot. Ez nem\n`
        + 'katasztrófa (nincs benne ügyfél-adat), de tárgyalási álláspontokat és\n'
        + 'belső forgalmi várakozásokat tartalmaz, és a felhasználónak semmi\n'
        + 'köze hozzá.',
      ).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Tiszta Hód Korlátolt');
    });
  }

  it('ADMINNAK viszont ép dokumentumot ad (a kapu nem túl széles)', async () => {
    __resetRateLimitsForTests();
    const res = await request(app).get(UT).set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.cim, 'a dokumentumnak nincs címe').toBeTruthy();
    expect(
      Array.isArray(res.body.szakaszok) && res.body.szakaszok.length >= 8,
      'A dokumentum csonka: nyolcnál kevesebb szakasz jött vissza.',
    ).toBe(true);

    // Minden szakasznak legyen címe és legalább egy blokkja — üres váz
    // ugyanúgy „200 OK", de a tárgyaláson használhatatlan.
    for (const sz of res.body.szakaszok) {
      expect(sz.cim, 'szakasz cím nélkül').toBeTruthy();
      expect(sz.blokkok?.length, `üres szakasz: ${sz.cim}`).toBeGreaterThan(0);
    }
  });
});
