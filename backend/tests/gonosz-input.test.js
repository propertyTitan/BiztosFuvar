// "Gonosz input" osztály-teszt — a tesztelői 2. kör tanulsága (BUG-007/011/
// 021, TC-013/107): a hibás user-input kezelése inkonzisztens volt, több
// helyen nyers 500 "Szerverhiba" jött validációs üzenet helyett.
//
// Ez a suite NEM egy-egy konkrét hibát őriz, hanem az OSZTÁLYT: a fő írási
// végpontok tipikus rossz inputokra (csupa szóköz, irreálisan hosszú string,
// rossz típus, negatív/óriás szám) SOHA nem adhatnak 500-at — mindig
// 4xx-et, érthető hibával.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob } = require('./helpers');

const SPACES = '        ';
const HUGE = 'x'.repeat(5000);

const VALID_JOB = {
  title: 'Gonosz-input teszt fuvar',
  pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};

function expect4xx(res, label) {
  expect(res.status, `${label} → ${res.status} (${JSON.stringify(res.body)})`).toBeGreaterThanOrEqual(400);
  expect(res.status, `${label} 500-at adott — validáció hiányzik`).toBeLessThan(500);
  expect(res.body?.error, `${label} nem adott hibaüzenetet`).toBeTruthy();
}

describe('Gonosz input → mindig 4xx, soha 500', () => {
  it('POST /jobs — rossz címek, típusok, számok', async () => {
    const user = await createUser();
    const cases = [
      ['csupa-szóköz cím', { ...VALID_JOB, title: SPACES }],
      ['óriás cím', { ...VALID_JOB, title: HUGE }],
      ['objektum címként', { ...VALID_JOB, title: { evil: true } }],
      ['string súly', { ...VALID_JOB, weight_kg: 'sok' }],
      ['negatív méret', { ...VALID_JOB, length_cm: -5 }],
      ['óriás ár', { ...VALID_JOB, suggested_price_huf: 99999999999 }],
      ['string koordináta', { ...VALID_JOB, pickup_lat: 'észak' }],
    ];
    for (const [label, body] of cases) {
      const res = await request(app)
        .post('/jobs').set('Authorization', `Bearer ${user.token}`).send(body);
      expect4xx(res, `POST /jobs (${label})`);
    }
  });

  it('POST /jobs/:id/bids — rossz összegek', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const cases = [
      ['string összeg', { amount_huf: 'ötezer; DROP TABLE', return_policy: 'included' }],
      ['tizedes összeg', { amount_huf: 100.99, return_policy: 'included' }],
      ['negatív összeg', { amount_huf: -1000, return_policy: 'included' }],
      ['óriás összeg', { amount_huf: 99999999999, return_policy: 'included' }],
      ['hiányzó visszaszállítási nyilatkozat', { amount_huf: 5000 }],
    ];
    for (const [label, body] of cases) {
      const res = await request(app)
        .post(`/jobs/${job.id}/bids`).set('Authorization', `Bearer ${carrier.token}`).send(body);
      expect4xx(res, `POST bids (${label})`);
    }
  });

  it('PATCH /auth/me — rossz profil-mezők', async () => {
    const user = await createUser();
    const cases = [
      ['csupa-szóköz név', { full_name: SPACES }],
      ['óriás név', { full_name: HUGE }],
      ['szemét telefonszám', { phone: 'hívj fel lécci!!!' }],
      ['script-tag rendszám', { vehicle_plate: '<script>x</script>' }],
      ['óriás bio', { bio: HUGE }],
      ['szemét adószám', { tax_id: 'nem-adoszam' }],
    ];
    for (const [label, body] of cases) {
      const res = await request(app)
        .patch('/auth/me').set('Authorization', `Bearer ${user.token}`).send(body);
      expect4xx(res, `PATCH /auth/me (${label})`);
    }
  });

  it('POST /carrier-routes — rossz útvonal-adatok', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const base = {
      title: 'Gonosz-input útvonal',
      departure_at: new Date(Date.now() + 86400000).toISOString(),
      waypoints: [
        { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
        { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
      ],
      prices: [{ size: 'M', price_huf: 10000 }],
    };
    const cases = [
      ['csupa-szóköz név', { ...base, title: SPACES }],
      ['óriás név', { ...base, title: HUGE }],
      ['egy waypoint', { ...base, waypoints: base.waypoints.slice(0, 1) }],
      ['negatív ár', { ...base, prices: [{ size: 'M', price_huf: -100 }] }],
      ['ismeretlen méret', { ...base, prices: [{ size: 'XXL', price_huf: 100 }] }],
    ];
    for (const [label, body] of cases) {
      const res = await request(app)
        .post('/carrier-routes').set('Authorization', `Bearer ${carrier.token}`).send(body);
      expect4xx(res, `POST /carrier-routes (${label})`);
    }
  });
});
