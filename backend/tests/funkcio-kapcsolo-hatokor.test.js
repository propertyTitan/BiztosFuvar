// =====================================================================
//  FUNKCIÓ-KAPCSOLÓ HATÓKÖR ŐR (2026-08-12)
//
//  ⚠️ VALÓS HIBÁN TANULTUK. Az SOS kikapcsolásakor a kaput útvonal-előtag
//  NÉLKÜL tettem a routerbe:
//
//      router.use((req, res, next) => { ... 503 ... });   // ROSSZ
//      router.use('/sos', (req, res, next) => { ... });   // JÓ
//
//  Egy előtag nélküli `router.use` MINDEN kérésre lefut, ami azon a routeren
//  áthalad — és mivel a router `'/'`-ra van felcsatolva, az UTÁNA mountolt
//  routerek (admin, admin-üzenetek, kérdés-válasz, szállítói statisztika)
//  végpontjai is 503-at kaptak. Vagyis egy „csak ezt a funkciót kapcsolom ki"
//  változtatás az API jelentős részét kivégezte volna élesben.
//
//  A backend suite ezt NEM fogta meg, mert a teszt-környezet BEKAPCSOLJA a
//  funkciót (hogy a biztonsági tesztek fussanak) — az E2E fogta el, ahol a
//  kapcsoló nincs beállítva.
//
//  Ez az őr a hibaosztályt zárja: a kikapcsolt funkció kapuja NEM érinthet
//  más végpontot. Minden funkció-kapcsolóra külön eset kell.
// =====================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, createUser } = require('./helpers');

/** A kapcsolók és a hozzájuk tartozó SAJÁT végpont. */
const KAPCSOLOK = [
  { env: 'SOS_ENABLED', sajatUt: '/sos', kod: 'SOS_DISABLED' },
  { env: 'TOWING_ENABLED', sajatUt: '/towing/request', kod: 'TOWING_DISABLED' },
];

/**
 * Végpontok, amiknek a kikapcsolt funkciótól FÜGGETLENÜL működniük kell.
 * Szándékosan olyanok, amik a mount-sorrendben KÉSŐBB jönnek, mint a
 * kapcsolós routerek — épp ott csapott le a valós hiba.
 */
const ERINTETLEN = [
  { ut: '/admin/kyc-documents', szerep: 'admin' },
  { ut: '/admin/users', szerep: 'admin' },
  { ut: '/auth/me', szerep: 'shipper' },
  { ut: '/jobs', szerep: 'carrier' },
];

const eredetiEnv = {};
afterEach(() => {
  for (const [k, v] of Object.entries(eredetiEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Funkció-kapcsoló hatóköre', () => {
  for (const { env, sajatUt, kod } of KAPCSOLOK) {
    it(`a kikapcsolt ${env} CSAK a saját végpontjait zárja`, async () => {
      eredetiEnv[env] = process.env[env];
      process.env[env] = 'false';

      // 1. A SAJÁT végpontja tényleg zárva van.
      const admin = await createUser({ role: 'admin' });
      const sajat = await request(app)
        .post(sajatUt)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({});
      expect(
        sajat.status,
        `A kikapcsolt ${env} saját végpontja (${sajatUt}) nem ad 503-at — `
        + 'a kapcsoló nem hat.',
      ).toBe(503);
      expect(sajat.body.code).toBe(kod);

      // 2. MINDEN MÁS végpont érintetlen.
      const gondok = [];
      for (const { ut, szerep } of ERINTETLEN) {
        const u = await createUser({ role: szerep });
        const res = await request(app).get(ut).set('Authorization', `Bearer ${u.token}`);
        if (res.status === 503) gondok.push(`${ut} → 503 (${res.body?.code || '?'})`);
      }

      expect(
        gondok,
        `A kikapcsolt ${env} MÁS végpontokat is lezárt:\n  ${gondok.join('\n  ')}\n\n`
        + 'Ez akkor történik, ha a kapu útvonal-ELŐTAG NÉLKÜL került a routerbe:\n'
        + "  router.use((req,res,next) => …)        ← MINDEN kérésre lefut\n"
        + "  router.use('/sos', (req,res,next) => …) ← csak a sajátjára\n\n"
        + 'Mivel ezek a routerek `/`-ra vannak felcsatolva, egy előtag nélküli\n'
        + 'kapu az UTÁNA mountolt routerek végpontjait is kivégzi — élesben az\n'
        + 'API jelentős részét.',
      ).toEqual([]);
    });
  }
});
