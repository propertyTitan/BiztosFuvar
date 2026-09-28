// =====================================================================
//  AUDIT P1 (2026-09-28): a kontakt-szűrő NEM-SZÖVEG és UNICODE osztálya
//
//  A díj-kapu (a platform egyetlen bevétele) a `detectContactLeak`-en áll —
//  és az a nem-string értéket „tisztának" nyilvánította
//  (`typeof text !== 'string' → null`). Több írási végpont pedig típus-
//  ellenőrzés nélkül adta tovább a mezőt a pg-nek (`mezo || null`): a
//  node-postgres a tömböt '{"…"}' literállá, az objektumot JSON-ná, a számot
//  szöveggé alakítja, a TEXT-oszlop szó szerint eltárolja, a web pedig a
//  MÁSIK FÉLNEK a díj ELŐTT megmutatja. Egy `["Hívj: 06301234567"]` leírás
//  így teljesen megkerülte a szűrőt.
//
//  Ez a fájl az OSZTÁLYT méri:
//   - minden érintett végpont × szabad-szöveges mező × (tömb, objektum,
//     szám) → 4xx ÉS semmi nem tárolódik; a normál szöveg átmegy
//   - a számos mellékcsatorna: az ajánlat `eta_minutes`-e és a járat
//     méret-ára korlátlan egész volt (egy 9 jegyű mobilszám belefért)
//   - Unicode: teljes szélességű számjegyek, zéró-szélességű elválasztók,
//     lágy kötőjel — a szűrő NFKC-normalizált, formázó-karakter nélküli
//     szövegen keres; a magyar szöveg (ékezet, „…", dátum, ár, irsz.)
//     továbbra sem akad fenn
//   - a kontakt-szűrő maga FAIL-CLOSED: nem-string = nem tiszta
// =====================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const {
  app, db, createUser, createJob, uniqueEmail,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const { detectContactLeak, firstContactLeak } = require('../src/utils/contactGuard');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

// A három nem-szöveg alak, ami eddig a szűrőt megkerülte.
const NEM_SZOVEGEK = [
  ['tömb', ['Hívj: 06301234567']],
  ['objektum', { a: '06301234567' }],
  ['szám', 36301234567],
];

const BP = { lat: 47.4979, lng: 19.0402 };
const SZEGED = { lat: 46.253, lng: 20.1414 };
const jovobeli = () => new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

function fuvarTorzs() {
  return {
    title: 'Kanapé szállítás',
    description: 'Egy háromszemélyes kanapé, 2. emelet.',
    pickup_address: 'Budapest, Váci út 12.', pickup_lat: BP.lat, pickup_lng: BP.lng,
    dropoff_address: 'Szeged, Kárász utca 5.', dropoff_lat: SZEGED.lat, dropoff_lng: SZEGED.lng,
    length_cm: 200, width_cm: 90, height_cm: 80, weight_kg: 45,
    suggested_price_huf: 25000,
  };
}

function jaratTorzs() {
  return {
    title: 'Budapest → Szeged',
    description: 'Hétköznap délután indulok.',
    vehicle_description: 'Fehér furgon',
    departure_at: jovobeli(),
    waypoints: [
      { name: 'Budapest', lat: BP.lat, lng: BP.lng, order: 0 },
      { name: 'Szeged', lat: SZEGED.lat, lng: SZEGED.lng, order: 1 },
    ],
    prices: [{ size: 'M', price_huf: 5000 }],
    status: 'open',
  };
}

async function nyitottJarat(carrierId) {
  const { rows } = await db.query(
    `INSERT INTO carrier_routes (carrier_id, title, description, vehicle_description, departure_at, waypoints, status)
     VALUES ($1, 'Teszt járat', 'Eredeti leírás', 'Eredeti jármű', NOW() + INTERVAL '2 days',
             $2::jsonb, 'open') RETURNING id`,
    [carrierId, JSON.stringify(jaratTorzs().waypoints)],
  );
  for (const size of ['S', 'M', 'L', 'XL']) {
    await db.query('INSERT INTO carrier_route_prices (route_id, size, price_huf) VALUES ($1, $2, 5000)', [rows[0].id, size]);
  }
  return rows[0].id;
}

// Beállít egy (akár beágyazott — `waypoints.0.name`) mezőt a törzsben.
function beallit(torzs, mezo, ertek) {
  const utvonal = mezo.split('.');
  let cel = torzs;
  for (const r of utvonal.slice(0, -1)) cel = cel[r];
  cel[utvonal[utvonal.length - 1]] = ertek;
  return torzs;
}

// Minden bejegyzés: hogyan jön létre a környezet, mit küldünk, és a DB mely
// állapotának kell VÁLTOZATLANNAK maradnia egy elutasított kérés után.
const VEGPONTOK = [
  {
    nev: 'POST /jobs',
    mezok: ['title', 'description', 'pickup_address', 'dropoff_address'],
    async kornyezet() { return { shipper: await createUser() }; },
    torzs: () => fuvarTorzs(),
    kuld: (k, b) => request(app).post('/jobs').set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, description, pickup_address, dropoff_address FROM jobs WHERE shipper_id = $1 ORDER BY id', [k.shipper.id])).rows,
    ok: 201,
  },
  {
    nev: 'PATCH /jobs/:id',
    mezok: ['title', 'description'],
    async kornyezet() {
      const shipper = await createUser();
      const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
      return { shipper, job };
    },
    torzs: () => ({ description: 'Két doboz, 2. emelet, lift van.' }),
    kuld: (k, b) => request(app).patch(`/jobs/${k.job.id}`).set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT title, description FROM jobs WHERE id = $1', [k.job.id])).rows,
    ok: 200,
  },
  {
    nev: 'POST /jobs/:jobId/bids',
    mezok: ['message'],
    async kornyezet() {
      const shipper = await createUser();
      const carrier = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
      return { shipper, carrier, job };
    },
    torzs: () => ({ amount_huf: 20000, return_policy: 'included', message: 'Holnap délután tudom vinni.' }),
    kuld: (k, b) => request(app).post(`/jobs/${k.job.id}/bids`).set(auth(k.carrier.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, message, eta_minutes FROM bids WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /auth/register',
    mezok: ['vehicle_type', 'company_name', 'company_reg_number', 'eu_vat_number', 'billing_address', 'tax_id'],
    async kornyezet() { return { email: uniqueEmail('reg') }; },
    torzs: (k) => ({
      email: k.email, password: 'Jelszo12345', full_name: 'Teszt Elek',
      vehicle_type: 'furgon', company_name: 'Tiszta Hód Kft.', billing_address: '6800 Hódmezővásárhely, Fő utca 1.',
    }),
    kuld: (k, b) => request(app).post('/auth/register').send(b),
    allapot: async (k) => (await db.query('SELECT id FROM users WHERE email = $1', [k.email])).rows,
    ok: 201,
  },
  {
    nev: 'PATCH /auth/me',
    mezok: ['bio', 'vehicle_type', 'company_name', 'company_reg_number', 'billing_address', 'tax_id'],
    async kornyezet() { return { user: await createUser() }; },
    torzs: () => ({ bio: 'Hétvégente is szállítok, 2. emelet sem gond.' }),
    kuld: (k, b) => request(app).patch('/auth/me').set(auth(k.user.token)).send(b),
    allapot: async (k) => (await db.query(
      'SELECT bio, vehicle_type, company_name, company_reg_number, billing_address, tax_id FROM users WHERE id = $1', [k.user.id],
    )).rows,
    ok: 200,
  },
  {
    nev: 'POST /reviews',
    mezok: ['comment'],
    async kornyezet() {
      const shipper = await createUser();
      const carrier = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
      return { shipper, carrier, job };
    },
    torzs: (k) => ({ job_id: k.job.id, stars: 5, comment: 'Pontos volt, köszönöm!' }),
    kuld: (k, b) => request(app).post('/reviews').set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, comment FROM reviews WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /jobs/:jobId/reviews (legacy)',
    mezok: ['comment'],
    async kornyezet() {
      const shipper = await createUser();
      const carrier = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
      return { shipper, carrier, job };
    },
    torzs: () => ({ rating: 5, comment: 'Minden rendben ment.' }),
    kuld: (k, b) => request(app).post(`/jobs/${k.job.id}/reviews`).set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, comment FROM reviews WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /disputes',
    mezok: ['description'],
    async kornyezet() {
      const shipper = await createUser();
      const carrier = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });
      return { shipper, carrier, job };
    },
    torzs: (k) => ({ job_id: k.job.id, description: 'A szállító nem jelent meg a megbeszélt időben.' }),
    kuld: (k, b) => request(app).post('/disputes').set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, description FROM disputes WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /jobs/:jobId/questions',
    mezok: ['question'],
    async kornyezet() {
      const shipper = await createUser();
      const asker = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
      return { shipper, asker, job };
    },
    torzs: () => ({ question: 'Van lift a házban?' }),
    kuld: (k, b) => request(app).post(`/jobs/${k.job.id}/questions`).set(auth(k.asker.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, question FROM job_questions WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /questions/:id/answer',
    mezok: ['answer'],
    async kornyezet() {
      const shipper = await createUser();
      const asker = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
      const { rows } = await db.query(
        `INSERT INTO job_questions (job_id, asker_id, question) VALUES ($1, $2, 'Van lift?') RETURNING id`, [job.id, asker.id],
      );
      return { shipper, asker, job, questionId: rows[0].id };
    },
    torzs: () => ({ answer: 'Igen, a 3. emeletig megy.' }),
    kuld: (k, b) => request(app).post(`/questions/${k.questionId}/answer`).set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT answer FROM job_questions WHERE id = $1', [k.questionId])).rows,
    ok: 200,
  },
  {
    nev: 'POST /messages',
    mezok: ['body'],
    async kornyezet() {
      const shipper = await createUser();
      const carrier = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted' });
      return { shipper, carrier, job };
    },
    torzs: (k) => ({ job_id: k.job.id, body: 'Szia! Holnap 14:30-kor jó?' }),
    kuld: (k, b) => request(app).post('/messages').set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id, body FROM messages WHERE job_id = $1', [k.job.id])).rows,
    ok: 201,
  },
  {
    nev: 'POST /carrier-routes',
    mezok: ['title', 'description', 'vehicle_description', 'waypoints.0.name', 'waypoints.1'],
    async kornyezet() { return { carrier: await createUser({ role: 'carrier' }) }; },
    torzs: () => jaratTorzs(),
    kuld: (k, b) => request(app).post('/carrier-routes').set(auth(k.carrier.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id FROM carrier_routes WHERE carrier_id = $1', [k.carrier.id])).rows,
    ok: 201,
  },
  {
    nev: 'PATCH /carrier-routes/:id',
    mezok: ['title', 'description', 'vehicle_description', 'waypoints', 'waypoints.0.name'],
    async kornyezet() {
      const carrier = await createUser({ role: 'carrier' });
      return { carrier, routeId: await nyitottJarat(carrier.id) };
    },
    torzs: () => ({ description: 'Péntekenként is megyek.', waypoints: jaratTorzs().waypoints }),
    kuld: (k, b) => request(app).patch(`/carrier-routes/${k.routeId}`).set(auth(k.carrier.token)).send(b),
    allapot: async (k) => (await db.query(
      'SELECT title, description, vehicle_description, waypoints FROM carrier_routes WHERE id = $1', [k.routeId],
    )).rows,
    ok: 200,
  },
  {
    nev: 'POST /carrier-routes/:id/bookings',
    mezok: ['notes', 'pickup_address', 'dropoff_address', 'recipient_name', 'recipient_phone', 'recipient_email'],
    async kornyezet() {
      const carrier = await createUser({ role: 'carrier' });
      const shipper = await createUser();
      return { carrier, shipper, routeId: await nyitottJarat(carrier.id) };
    },
    torzs: () => ({
      length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
      pickup_address: 'Budapest, Váci út 12.', pickup_lat: BP.lat, pickup_lng: BP.lng,
      dropoff_address: 'Szeged, Kárász utca 5.', dropoff_lat: SZEGED.lat, dropoff_lng: SZEGED.lng,
      notes: 'Törékeny, kérlek óvatosan.',
    }),
    kuld: (k, b) => request(app).post(`/carrier-routes/${k.routeId}/bookings`).set(auth(k.shipper.token)).send(b),
    allapot: async (k) => (await db.query('SELECT id FROM route_bookings WHERE route_id = $1', [k.routeId])).rows,
    ok: 201,
  },
];

describe('Nem-szöveg a szabad-szöveges mezőkben — 4xx és semmi nem tárolódik', () => {
  for (const v of VEGPONTOK) {
    describe(v.nev, () => {
      it('normál (magyar) szöveg elfogadva', async () => {
        const k = await v.kornyezet();
        const elotte = await v.allapot(k);
        const r = await v.kuld(k, v.torzs(k));
        expect(r.status, JSON.stringify(r.body)).toBe(v.ok);
        expect(await v.allapot(k), 'a normál kérés semmit nem változtatott').not.toEqual(elotte);
      });

      for (const mezo of v.mezok) {
        for (const [alak, ertek] of NEM_SZOVEGEK) {
          it(`${mezo} = ${alak} → 4xx, változatlan DB`, async () => {
            const k = await v.kornyezet();
            const elotte = await v.allapot(k);
            const r = await v.kuld(k, beallit(v.torzs(k), mezo, ertek));
            expect(r.status, `${v.nev} ${mezo}=${JSON.stringify(ertek)} → ${r.status} ${JSON.stringify(r.body)}`).toBeGreaterThanOrEqual(400);
            expect(r.status).toBeLessThan(500);
            expect(await v.allapot(k), `${v.nev}: a(z) ${mezo} nem-szöveg értéke eltárolódott`).toEqual(elotte);
          });
        }
      }
    });
  }

  it('PATCH /auth/me tax_id tömbben: a regex a String()-alakot nézte, a tömb eltárolódott', async () => {
    const user = await createUser();
    const r = await request(app).patch('/auth/me').set(auth(user.token)).send({ tax_id: ['12345678-1-42'] });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    const { rows } = await db.query('SELECT tax_id FROM users WHERE id = $1', [user.id]);
    expect(rows[0].tax_id).toBeNull();
  });

  it('a típus-hiba beszédes kódot kap (INVALID_TEXT_FIELD + a mező neve)', async () => {
    const shipper = await createUser();
    const r = await request(app).post('/jobs').set(auth(shipper.token))
      .send({ ...fuvarTorzs(), description: ['Hívj: 06301234567'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_TEXT_FIELD');
    expect(r.body.field).toBe('description');
  });

  it('járat-megálló: ismeretlen kulcs, tartományon kívüli koordináta → 400; a formázott cím is szűrt', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const megallo = (extra) => ({ ...jaratTorzs(), waypoints: [jaratTorzs().waypoints[0], { ...jaratTorzs().waypoints[1], ...extra }] });
    const rejtett = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send(megallo({ megjegyzes: 'Szeged' }));
    expect(rejtett.status, 'a megálló tetszőleges extra kulcsa rejtett csatorna').toBe(400);
    expect(rejtett.body.code).toBe('INVALID_WAYPOINTS');
    const lat = await request(app).post('/carrier-routes').set(auth(carrier.token)).send(megallo({ lat: 630123456 }));
    expect(lat.status).toBe(400);
    const cim = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send(megallo({ formatted_address: 'Szeged, hívj: 06 30 123 4567' }));
    expect(cim.status).toBe(400);
    expect(cim.body.code).toBe('CONTACT_LEAK');
    const { rows } = await db.query('SELECT id FROM carrier_routes WHERE carrier_id = $1', [carrier.id]);
    expect(rows).toEqual([]);
    const jo = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send(megallo({ formatted_address: 'Szeged, 6720 Magyarország' }));
    expect(jo.status, JSON.stringify(jo.body)).toBe(201);
  });

  it('SOS: a nem-szöveg üzenet nem tárolódik szó szerint — a vészjelzés viszont NEM vész el', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const r = await request(app).post('/sos').set(auth(shipper.token))
      .send({ job_id: job.id, message: ['Hívj: 06301234567'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { rows } = await db.query('SELECT message FROM sos_events WHERE job_id = $1', [job.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].message, 'a tömb szó szerint a vészjelzésbe került').toBeNull();
  });
});

describe('Számos mellékcsatorna — egy 9 jegyű szám nem fér el a mezőben', () => {
  async function ajanlatKornyezet() {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    return { shipper, carrier, job };
  }
  const ajanlat = (k, extra) => request(app).post(`/jobs/${k.job.id}/bids`).set(auth(k.carrier.token))
    .send({ amount_huf: 20000, return_policy: 'included', ...extra });

  it('eta_minutes = 630123456 → 400, nincs ajánlat', async () => {
    const k = await ajanlatKornyezet();
    const r = await ajanlat(k, { eta_minutes: 630123456 });
    expect(r.status, 'a mobilszám az érkezési idő mezőjében a feladóhoz jutott').toBe(400);
    const { rows } = await db.query('SELECT id FROM bids WHERE job_id = $1', [k.job.id]);
    expect(rows).toEqual([]);
  });

  it('eta_minutes: tört, negatív, tömb, szöveg → 400', async () => {
    for (const eta of [12.5, -5, 0, [90], 'hívj', true, 10081]) {
      const k = await ajanlatKornyezet();
      const r = await ajanlat(k, { eta_minutes: eta });
      expect(r.status, `eta_minutes=${JSON.stringify(eta)}`).toBe(400);
    }
  });

  it('eta_minutes: 90 és a hiányzó érték elfogadva', async () => {
    const k = await ajanlatKornyezet();
    const r = await ajanlat(k, { eta_minutes: 90 });
    expect(r.status).toBe(201);
    expect(r.body.eta_minutes).toBe(90);
    const k2 = await ajanlatKornyezet();
    const r2 = await ajanlat(k2, {});
    expect(r2.status).toBe(201);
    expect(r2.body.eta_minutes).toBeNull();
  });

  it('koordináta = 630123456 (a másik pont a zónában) → 400, nincs fuvar / foglalás', async () => {
    const shipper = await createUser();
    const fuvar = await request(app).post('/jobs').set(auth(shipper.token))
      .send({ ...fuvarTorzs(), dropoff_lat: 630123456 });
    expect(fuvar.status, 'a zónán kívüli pont koordinátája egy mobilszámot vitt a szállítókhoz').toBe(400);
    expect(fuvar.body.code).toBe('INVALID_COORDS');
    const { rows } = await db.query('SELECT id FROM jobs WHERE shipper_id = $1', [shipper.id]);
    expect(rows).toEqual([]);

    const carrier = await createUser({ role: 'carrier' });
    const routeId = await nyitottJarat(carrier.id);
    const foglalas = await request(app).post(`/carrier-routes/${routeId}/bookings`).set(auth(shipper.token))
      .send({
        length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
        pickup_address: 'Budapest, Váci út 12.', pickup_lat: 630123456, pickup_lng: BP.lng,
        dropoff_address: 'Szeged, Kárász utca 5.', dropoff_lat: SZEGED.lat, dropoff_lng: SZEGED.lng,
      });
    expect(foglalas.status).toBe(400);
    const { rows: fog } = await db.query('SELECT id FROM route_bookings WHERE route_id = $1', [routeId]);
    expect(fog).toEqual([]);
  });

  it('járat méret-ára = 630123456 → 400 (létrehozás és szerkesztés), nem tárolódik', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const uj = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send({ ...jaratTorzs(), prices: [{ size: 'M', price_huf: 630123456 }] });
    expect(uj.status, 'a korlátlan járat-ár egy mobilszámot vitt a feladóhoz').toBe(400);
    const { rows } = await db.query('SELECT id FROM carrier_routes WHERE carrier_id = $1', [carrier.id]);
    expect(rows).toEqual([]);

    const routeId = await nyitottJarat(carrier.id);
    const szerk = await request(app).patch(`/carrier-routes/${routeId}`).set(auth(carrier.token))
      .send({ prices: [{ size: 'M', price_huf: 630123456 }] });
    expect(szerk.status).toBe(400);
    const { rows: arak } = await db.query('SELECT price_huf FROM carrier_route_prices WHERE route_id = $1 AND size = $2', [routeId, 'M']);
    expect(arak[0].price_huf).toBe(5000);
  });
});

describe('Unicode-trükkök a kontakt-szűrőn', () => {
  const SZIVAROG = [
    ['teljes szélességű számjegyek', 'Hívj: ０６３０１２３４５６７'],
    ['teljes szélességű +36', '＋３６ ３０ １２３ ４５６７'],
    ['zéró-szélességű szóköz', '06​30​123​4567'],
    ['zéró-szélességű nem-összekötő', '06‌30‌1234567'],
    ['zéró-szélességű összekötő', '0630‍1234567'],
    ['szó-összekötő (U+2060)', '06⁠30⁠1234567'],
    ['BOM (U+FEFF)', '06﻿30﻿1234567'],
    ['lágy kötőjel', '06­30­123­4567'],
    ['e-mail zéró-szélességgel', 'irj: teszt​@gmail​.com'],
    ['teljes szélességű e-mail', 'ｔｅｓｚｔ＠ｇｍａｉｌ．ｃｏｍ'],
    ['teljes szélességű üzenetküldő', 'ｖｉｂｅｒ-en keress'],
  ];
  const TISZTA = [
    'Árvíztűrő tükörfúrógép, ő ű ö ü á é í ó ú',
    '„Törékeny" — kérlek óvatosan…',
    '2026. 08. 15-én tudom hozni, 14:30-kor.',
    '6800 Hódmezővásárhely, Szántó Kovács János utca 144.',
    'Kb. 3 m³ bútor, 10 m² szőnyeg, ½ raklap, 45 000 Ft.',
    'Ár: 25 000 Ft, 2. emelet, lift nincs, 1134 Budapest.',
    'Méret: 200 × 90 × 80 cm, 45 kg.',
  ];

  for (const [nev, t] of SZIVAROG) {
    it(`észleli: ${nev}`, () => {
      expect(detectContactLeak(t), `ÁTMENT: ${JSON.stringify(t)}`).toBeTruthy();
    });
  }
  it('a magyar szöveg (ékezet, „…", dátum, ár, irányítószám, m², ½) nem akad fenn', () => {
    for (const t of TISZTA) expect(detectContactLeak(t), `HIBÁS BLOKK: ${t}`).toBeNull();
  });

  it('végponton is: teljes szélességű szám az ajánlat-üzenetben → 400, zéró-szélességű a leírásban → 400', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier.token))
      .send({ amount_huf: 20000, return_policy: 'included', message: 'Hívj: ０６３０１２３４５６７' });
    expect(bid.status).toBe(400);
    expect(bid.body.code).toBe('CONTACT_LEAK');
    const { rows } = await db.query('SELECT id FROM bids WHERE job_id = $1', [job.id]);
    expect(rows).toEqual([]);

    const fuvar = await request(app).post('/jobs').set(auth(shipper.token))
      .send({ ...fuvarTorzs(), description: 'Hívj: 06​30​123​4567' });
    expect(fuvar.status).toBe(400);
    expect(fuvar.body.code).toBe('CONTACT_LEAK');
  });

  it('a tárolt szöveg NEM normalizálódik (a szűrés csak az észleléshez normalizál)', async () => {
    const shipper = await createUser();
    const r = await request(app).post('/jobs').set(auth(shipper.token))
      .send({ ...fuvarTorzs(), description: 'Kb. 3 m³ bútor, ½ raklap' });
    expect(r.status).toBe(201);
    const { rows } = await db.query('SELECT description FROM jobs WHERE id = $1', [r.body.id]);
    expect(rows[0].description).toBe('Kb. 3 m³ bútor, ½ raklap');
  });
});

describe('A kontakt-szűrő maga fail-closed', () => {
  it('nem-string, nem-üres érték → nem tiszta (tömb, objektum, szám, boolean)', () => {
    for (const ertek of [['06301234567'], { a: '06301234567' }, 36301234567, true, 0, false]) {
      expect(() => detectContactLeak(ertek)).not.toThrow();
      expect(detectContactLeak(ertek), `tisztának látta: ${JSON.stringify(ertek)}`).toBeTruthy();
    }
  });
  it('hiányzó / üres → tiszta', () => {
    for (const ertek of [null, undefined, '']) expect(detectContactLeak(ertek)).toBeNull();
  });
  it('firstContactLeak: egy nem-string elem a listában elég az elutasításhoz', () => {
    expect(firstContactLeak([null, 'Budapest, Váci út 12.', ['06301234567']])).toBeTruthy();
    expect(firstContactLeak([null, undefined, '', 'Szeged, Kárász utca 5.'])).toBeNull();
  });
});
