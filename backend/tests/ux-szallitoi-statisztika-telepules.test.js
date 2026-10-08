// =====================================================================
//  UX-review A28 (2026-10-08): a szállítói statisztika „Top útvonalak"
//  blokkja TELEPÜLÉS-párokat mutat, nem utcát és házszámot.
//
//  A régi SQL `SPLIT_PART(cím, ',', -1)`-gyel az UTOLSÓ vesszős szakaszt
//  vette városnak: a magyar Google-formátumnál („Budapest, Margit körút 50.,
//  1024") ez az irányítószám, más alaknál az utca a házszámmal. A javítás
//  nélkül a végpont-teszt piros (a párosítás „1024 → 7621" lett volna).
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const request = require('supertest');
const { db, app, createUser, createJob } = require('./helpers');
const { topUtvonalak } = require('../src/routes/driverStats');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function lezart(shipperId, carrierId, pickupAddress, dropoffAddress, priceHuf) {
  const job = await createJob({
    shipperId, carrierId, status: 'delivered', paid: true, priceHuf, pickupAddress, dropoffAddress,
  });
  await db.query('UPDATE jobs SET delivered_at = NOW() WHERE id = $1', [job.id]);
  return job;
}

describe('GET /driver-stats — top útvonalak település-szinten', () => {
  it('„Budapest → Pécs", házszám és irányítószám nélkül, a települések szerint összevonva', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await lezart(felado.id, carrier.id, 'Budapest, Margit körút 50., 1024', 'Pécs, Király utca 15., 7621', 20000);
    await lezart(felado.id, carrier.id, 'Budapest, Váci út 1, 1132', 'Pécs, Rákóczi út 3, 7622', 30000);
    await lezart(felado.id, carrier.id, 'Szeged, Kárász utca 9., 6720', 'Debrecen, Piac u. 4, 4026', 15000);

    const res = await request(app).get('/driver-stats').set(auth(carrier.token));
    expect(res.status).toBe(200);
    const [elso, masodik] = res.body.top_routes;
    expect(elso).toMatchObject({ pickup_city: 'Budapest', dropoff_city: 'Pécs', count: 2, avg_price: 25000 });
    expect(masodik).toMatchObject({ pickup_city: 'Szeged', dropoff_city: 'Debrecen', count: 1 });
    for (const r of res.body.top_routes) {
      expect(`${r.pickup_city} ${r.dropoff_city}`, 'a statisztika házszámot / irányítószámot ír ki').not.toMatch(/\d/);
    }
  });
});

describe('topUtvonalak — tiszta logika', () => {
  it('a település nélküli címet „Ismeretlen település"-ként sorolja, házszámot nem ad ki', () => {
    const out = topUtvonalak([{ pickup_address: 'Margit körút 50.', dropoff_address: 'Király utca 15.', accepted_price_huf: 1000 }]);
    expect(out).toEqual([{ pickup_city: 'Ismeretlen település', dropoff_city: 'Ismeretlen település', count: 1, avg_price: 1000 }]);
  });

  it('legfeljebb 5 sor, gyakoriság szerint; ár nélküli fuvar nem rontja az átlagot', () => {
    const sor = (p, d, a) => ({ pickup_address: p, dropoff_address: d, accepted_price_huf: a });
    const rows = [
      sor('Győr, A utca 1', 'Pécs, B utca 2', 10000), sor('Győr, A utca 3', 'Pécs, B utca 4', null),
      ...['Eger', 'Vác', 'Pápa', 'Baja', 'Gyula', 'Sopron'].map((v) => sor(`${v}, C utca 1`, 'Szeged, D utca 1', 5000)),
    ];
    const out = topUtvonalak(rows);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ pickup_city: 'Győr', dropoff_city: 'Pécs', count: 2, avg_price: 10000 });
  });
});
