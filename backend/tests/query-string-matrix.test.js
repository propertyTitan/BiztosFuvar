// =====================================================================
//  QUERY STRING MÁTRIX — az őrizetlen input-osztály (2026-08-12)
//
//  ⚠️ A `hulyebiztos-matrix.test.js` a projekt legerősebb input-őre: minden
//  végpontra szemetet tölt a PATH-paraméterekbe és a KÉRÉS-TÖRZSBE, és
//  megköveteli, hogy egyik se adjon 500-at (SZ1 szabály).
//
//  A QUERY STRINGET viszont SOHA nem mutálta. Ez egy egész input-osztály
//  volt őrizetlenül — és a lefedettségi kör azonnal talált benne élő hibát:
//
//      GET /payments/admin/log?offset=-5   → 500 „Szerverhiba"
//
//  mert a `Number(offset) || 0` a NEGATÍV számot truthy-ként átengedte, a
//  Postgres pedig `2201X: OFFSET must not be negative`-ot dobott. Élesben ez
//  hamis Sentry-riasztás és ijesztő hibaüzenet az adminnak.
//
//  Ez a fájl ugyanazt teszi a query stringgel, amit a mátrix a path-szal:
//  MINDEN hitelesített GET-végpontot meglő a leggyakoribb szemét-értékekkel
//  a legelterjedtebb paraméter-neveken.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, expressApp, createUser, createJob,
} = require('./helpers');
const { listRoutes } = require('./routeInventory');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

/**
 * A leggyakoribb query-paraméter-nevek a kódbázisban + a klasszikus
 * lapozó/szűrő nevek. Nem kell pontosan illeszkedniük: a végpont vagy
 * figyelmen kívül hagyja őket, vagy feldolgozza — utóbbi esetben pedig
 * pontosan azt mérjük, hogy nem omlik-e össze.
 */
const PARAMETEREK = [
  'limit', 'offset', 'page', 'status', 'search', 'q',
  'job_id', 'booking_id', 'user_id', 'route_id',
  'lat', 'lng', 'radius_km', 'min_price', 'max_price', 'max_weight',
  'pickup_city', 'dropoff_city', 'from', 'to', 'date', 'sort', 'order',
];

/** Szemét, ami a valóságban is előfordul (rossz kliens, támadó, elgépelés). */
const SZEMET = [
  ['negatív', '-5'],
  ['nulla', '0'],
  ['óriás', '1e309'],
  ['nem-szám', 'abc'],
  ['üres', ''],
  ['SQL-injekció', "1' OR '1'='1"],
  ['null-bájt', 'a%00b'],
  ['óriás string', 'x'.repeat(1200)],
  ['tömb-alak', 'a&limit=b'],
  ['tört', '1.5'],
  ['százalék-joker', '%'],
  ['negatív tört', '-0.5'],
];

let szereplok;

beforeAll(async () => {
  szereplok = {
    admin: await createUser({ role: 'admin' }),
    shipper: await createUser({ role: 'shipper' }),
    carrier: await createUser({ role: 'carrier' }),
  };
  // Legyen valós adat, amin a szűrők dolgozhatnak.
  await createJob({
    shipperId: szereplok.shipper.id, carrierId: szereplok.carrier.id,
    status: 'delivered', paid: true,
  });
});

/** Csak a paraméter NÉLKÜLI, hitelesített GET-ek — ezekre lehet vakon lőni. */
function celpontok() {
  return listRoutes(expressApp)
    .filter((r) => r.method === 'GET' && !r.path.includes(':'))
    .filter((r) => r.middlewares.includes('authRequired'));
}

describe('Query string mátrix: szemét a paraméterekben', () => {
  it('van mit mérni (az őr nem lehet vak)', () => {
    expect(
      celpontok().length,
      'nem találtam paraméter nélküli, hitelesített GET-végpontot',
    ).toBeGreaterThan(5);
  });

  it('EGYETLEN végpont sem ad 5xx-et szemét query-paraméterre', async () => {
    const gondok = [];

    for (const r of celpontok()) {
      // Melyik szereplővel hívjuk: az admin-végpontokat adminnal.
      const ki = r.path.includes('/admin') ? szereplok.admin
        : (r.middlewares.some((m) => /carrier|driver/i.test(m)) ? szereplok.carrier
          : szereplok.shipper);

      for (const param of PARAMETEREK) {
        for (const [cimke, ertek] of SZEMET) {
          __resetRateLimitsForTests();
          const res = await request(app)
            .get(`${r.path}?${param}=${encodeURIComponent(ertek)}`)
            .set('Authorization', `Bearer ${ki.token}`);

          if (res.status >= 500) {
            gondok.push(`${r.path}?${param}=<${cimke}> → ${res.status} ${JSON.stringify(res.body).slice(0, 90)}`);
          }
        }
      }
    }

    expect(
      gondok,
      `Ezek a végpontok 5xx-et adtak szemét query-paraméterre:\n  ${gondok.slice(0, 25).join('\n  ')}\n`
      + `${gondok.length > 25 ? `  …és további ${gondok.length - 25}\n` : ''}\n`
      + 'A projekt SZ1 szabálya: egyetlen végpont sem adhat 500-at rossz\n'
      + 'inputra. Élesben ez hamis Sentry-riasztást és ijesztő „Szerverhiba"\n'
      + 'üzenetet jelent — miközben a kérés egyszerűen érvénytelen volt (400).\n\n'
      + '⚠️ A hülyebiztos-mátrix ezt az osztályt NEM fedte: csak a PATH-\n'
      + 'paramétereket és a kérés-TÖRZSET mutálja. A query string egy egész,\n'
      + 'őrizetlen input-felület volt — az első mérés azonnal talált benne\n'
      + 'élő hibát (GET /payments/admin/log?offset=-5 → 500).',
    ).toEqual([]);
  }, 300_000);
});
