// =====================================================================
//  JÁRAT (carrier_routes) + FOGLALÁS (route_bookings) — a HIBAÁGAK
//
//  Miért kellett: a `src/routes/carrierRoutes.js` a boldog úton végig volt
//  járva (szerep-lefedettség, teljes-út), de az elágazásainak több mint
//  harmada SOSEM futott le. Márpedig ebben a fájlban él
//    * a platform EGYETLEN bevételének (kapcsolatfelvételi díj) foglalás-ági
//      teljes életciklusa (confirm → pay → confirm-payment),
//    * a járat-részletnézet kapuja (a szállító megállóinak koordinátái),
//    * és a kapcsolat-szivárgás szűrő két beírópontja (járat + foglalás).
//
//  Minden teszt ÁLLAPOTOT is mér, nem csak státuszkódot: egy elutasított
//  kérés után a DB-nek változatlannak kell lennie. Egy „400-at ad, de közben
//  már írt" hiba a puszta státusz-ellenőrzéssel láthatatlan maradna.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

const NEM_LETEZO = '00000000-0000-0000-0000-000000000000';

// ⚠️ A címekbe/nevekbe SOHA ne tegyünk hosszú számsort: a kapcsolat-szivárgás
// szűrő 9 egymást követő számjegynél telefonszámot kiált (a `Date.now()`
// 13 jegyű — ezen a csapdán a fejlesztés közben elcsúsztunk).
let sorszam = 0;
function egyediNev(elotag) {
  sorszam += 1;
  const betuk = 'abcdefghijklmnopqrstuvwxyz';
  const suffix = Array.from({ length: 6 }, () => betuk[Math.floor(Math.random() * 26)]).join('');
  return `${elotag}-${betuk[sorszam % 26]}${suffix}`;
}

const HOLNAP = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

function jaratBody(o = {}) {
  return {
    title: 'Teszt járat',
    departure_at: HOLNAP(),
    waypoints: [
      { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ],
    prices: [{ size: 'M', price_huf: 10000 }],
    ...o,
  };
}

function foglalasBody(o = {}) {
  return {
    length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
    pickup_address: 'Budapest, Teszt utca 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
    ...o,
  };
}

/** Járat létrehozása a végponton át (a validáció is lefut rajta). */
async function letrehozJarat(carrier, o = {}) {
  const res = await request(app).post('/carrier-routes').set(auth(carrier.token)).send(jaratBody(o));
  expect(res.status, `a járat-fixtúra létrehozása elhasalt: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body;
}

/** Járat közvetlen SQL-lel — olyan státuszokhoz, amit a POST nem enged. */
async function jaratSql(carrierId, {
  status = 'open', isTemplate = false, departureSql = "NOW() + INTERVAL '1 day'", city = 'Budapest',
} = {}) {
  const { rows } = await db.query(
    `INSERT INTO carrier_routes (carrier_id, title, departure_at, waypoints, status, is_template)
     VALUES ($1, 'SQL járat', ${departureSql},
             $4::jsonb,
             $2, $3)
     RETURNING *`,
    [carrierId, status, isTemplate, JSON.stringify([
      { name: city, lat: 47.4979, lng: 19.0402 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414 },
    ])],
  );
  return rows[0];
}

// ⚠️ A LISTA-VÉGPONT `LIMIT 200`-AT HASZNÁL, és a teszt-DB-t az összes
// teszt-fájl OSZTJA. Szűretlen lekérdezéssel a saját járataink kicsúszhatnak
// a 200-as ablakból (mérve: a teljes csomagot futtatva pontosan 200 elemű
// listát kaptunk, benne a mienk nélkül) — a teszt így FUTÁS-SORRENDTŐL
// függően bukna. Minden lista-lekérdezés ezért EGYEDI városra szűkít, amit
// csak az adott teszt járatai tartalmaznak.
const listaUrl = (varos, extra = '') => `/carrier-routes?city=${encodeURIComponent(varos)}${extra}`;

const jaratSorok = async (carrierId) => (await db.query(
  'SELECT * FROM carrier_routes WHERE carrier_id = $1', [carrierId],
)).rows;

const foglalasSor = async (id) => (await db.query(
  'SELECT * FROM route_bookings WHERE id = $1', [id],
)).rows[0];

const ertesitesek = async (userId, tipus) => (await db.query(
  'SELECT * FROM notifications WHERE user_id = $1 AND type = $2', [userId, tipus],
)).rows;

// =====================================================================
//  1. JÁRAT LÉTREHOZÁS — a bemeneti kapuk
// =====================================================================
describe('Járat létrehozás: a kötelező mezők és a státusz-fehérlista', () => {
  it('hiányzó cím vagy indulási időpont → 400, és EGYETLEN járat-sor sem keletkezik', async () => {
    const szallito = await createUser({ role: 'carrier' });

    const cimNelkul = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send({ ...jaratBody(), title: undefined });
    expect(cimNelkul.status, 'cím nélkül is létrejöhet a járat').toBe(400);
    expect(cimNelkul.body.error, 'a hibaüzenet nem mondja meg, MI hiányzik').toMatch(/cím és indulás/i);

    const idoNelkul = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send({ ...jaratBody(), departure_at: undefined });
    expect(idoNelkul.status, 'indulási időpont nélkül is létrejöhet a járat').toBe(400);

    expect(
      (await jaratSorok(szallito.id)).length,
      'az elutasított kérés MÉGIS beírt a carrier_routes táblába',
    ).toBe(0);
  });

  it('a nem-string cím (szám) sem csúszik át a 3–100 karakteres kapun', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const res = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ title: 424242 }));

    expect(res.status, 'számot adva a cím-validáció (typeof-ág) kimarad').toBe(400);
    expect(res.body.error).toMatch(/útvonal neve/i);
    expect((await jaratSorok(szallito.id)).length, 'szám-cím mellett is keletkezett sor').toBe(0);
  });

  it('létrehozáskor CSAK draft vagy open státusz fogadható el', async () => {
    const szallito = await createUser({ role: 'carrier' });
    // A carrier_route_status enumban a 'full'/'in_progress'/'completed'/
    // 'cancelled' is létező érték — fehérlista nélkül a szállító MÁR
    // teljesítettként vagy „megtelt"-ként hirdethetne új járatot.
    for (const status of ['full', 'in_progress', 'completed', 'cancelled', 'akarmi']) {
      const res = await request(app).post('/carrier-routes').set(auth(szallito.token))
        .send(jaratBody({ status }));
      expect(res.status, `a "${status}" státusz átment a létrehozáskor`).toBe(400);
      expect(res.body.error, `a "${status}" hibaüzenete nem a státuszról szól`).toMatch(/státusz/i);
    }
    expect((await jaratSorok(szallito.id)).length, 'tiltott státusszal is keletkezett járat').toBe(0);

    const draft = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ status: 'draft' }));
    expect(draft.status, 'a piszkozat-létrehozást (draft) is elutasítja a fehérlista').toBe(201);
    expect(draft.body.status).toBe('draft');
  });

  it('draft járat NEM jelenik meg a feladói böngészőben, az open igen', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varos = egyediNev('Piszkozatfalva');
    const wp = (nev) => [
      { name: nev, lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ];

    const piszkozat = await letrehozJarat(szallito, { status: 'draft', waypoints: wp(varos) });
    const nyitott = await letrehozJarat(szallito, { status: 'open', waypoints: wp(varos) });

    const lista = await request(app).get(`/carrier-routes?city=${encodeURIComponent(varos)}`)
      .set(auth(felado.token));
    expect(lista.status).toBe(200);
    const idk = lista.body.map((r) => r.id);
    expect(idk, 'a PISZKOZAT járat megjelent a feladói böngészőben').not.toContain(piszkozat.id);
    expect(idk, 'a publikált (open) járat hiányzik a böngészőből').toContain(nyitott.id);
  });
});

// =====================================================================
//  2. KAPCSOLAT-SZIVÁRGÁS a járat szövegmezőin
//     (a platform egyetlen bevételét védő kapu — 2026-08-11, 9. mérés A2)
// =====================================================================
describe('Járat: a kapcsolat-szivárgás szűrő minden szabad szövegen', () => {
  it('a WAYPOINT nevébe írt telefonszám is CONTACT_LEAK — létrehozáskor', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const res = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({
        waypoints: [
          { name: 'Szeged (hívj 06 30 123 4567)', lat: 46.253, lng: 20.1414, order: 0 },
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 1 },
        ],
      }));

    expect(res.status, 'a megálló NEVE megkerüli a kontakt-szűrőt — tartós hirdetőfelület').toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
    expect((await jaratSorok(szallito.id)).length, 'a szivárgó járat mégis létrejött').toBe(0);
  });

  it('a leírás és a jármű-leírás is szűrt, a tiszta szöveg viszont átmegy', async () => {
    const szallito = await createUser({ role: 'carrier' });

    const leiras = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ description: 'Írj rám: valaki@gmail.com' }));
    expect(leiras.status, 'a járat LEÍRÁSA szűretlen').toBe(400);
    expect(leiras.body.code).toBe('CONTACT_LEAK');

    const jarmu = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ vehicle_description: 'Ford Transit, hívj +36301234567' }));
    expect(jarmu.status, 'a JÁRMŰ-LEÍRÁS szűretlen').toBe(400);

    const tiszta = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ description: 'Ponyvás, 3 raklapnyi hely.', vehicle_description: 'Ford Transit' }));
    expect(tiszta.status, 'a szűrő ártatlan szövegre is rácsap (hamis riasztás)').toBe(201);
  });

  it('a kapu SZERKESZTÉSSEL sem kerülhető meg (PATCH), és a járat változatlan marad', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { description: 'Tiszta leírás.' });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({
        description: 'Hívj: 06301234567',
        waypoints: [
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
          { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
        ],
      });

    expect(res.status, 'a szerkesztés kikerüli a létrehozáskori kontakt-kaput').toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
    const utana = (await jaratSorok(szallito.id))[0];
    expect(utana.description, 'az elutasított PATCH MÉGIS átírta a leírást').toBe('Tiszta leírás.');
  });
});

// =====================================================================
//  3. JÁRAT-BÖNGÉSZŐ: szűrők + a lejárt járatok eltűnése (BUG-028)
// =====================================================================
describe('Járat-böngésző (GET /carrier-routes): szűrők', () => {
  it('a ?city= szűrő a waypoint NEVÉRE illeszt, más járatot nem hoz', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varosA = egyediNev('Alfaváros');
    const varosB = egyediNev('Bétaváros');

    const jaratA = await letrehozJarat(szallito, {
      waypoints: [
        { name: varosA, lat: 47.4979, lng: 19.0402, order: 0 },
        { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
      ],
    });
    const jaratB = await letrehozJarat(szallito, {
      waypoints: [
        { name: varosB, lat: 47.4979, lng: 19.0402, order: 0 },
        { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
      ],
    });

    const lista = await request(app).get(`/carrier-routes?city=${encodeURIComponent(varosA)}`)
      .set(auth(felado.token));
    expect(lista.status).toBe(200);
    const idk = lista.body.map((r) => r.id);
    expect(idk, 'a keresett városhoz tartozó járat hiányzik').toContain(jaratA.id);
    expect(idk, 'a város-szűrő átengedte a MÁSIK város járatát is').not.toContain(jaratB.id);
  });

  it('a ?from_date / ?to_date ablak kizárja a rajta kívüli indulásokat', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varos = egyediNev('Datumfalva');
    const nap = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const wp = [
      { name: varos, lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ];

    const korai = await letrehozJarat(szallito, { departure_at: nap(10).toISOString(), waypoints: wp });
    const kesoi = await letrehozJarat(szallito, { departure_at: nap(40).toISOString(), waypoints: wp });

    const eddig = await request(app).get(listaUrl(varos, `&to_date=${iso(nap(20))}`)).set(auth(felado.token));
    const eddigIdk = eddig.body.map((r) => r.id);
    expect(eddigIdk, 'a to_date szűrő kihagyta az ablakon BELÜLI járatot').toContain(korai.id);
    expect(eddigIdk, 'a to_date szűrő átengedte a későbbi indulást').not.toContain(kesoi.id);

    const ettol = await request(app).get(listaUrl(varos, `&from_date=${iso(nap(20))}`)).set(auth(felado.token));
    const ettolIdk = ettol.body.map((r) => r.id);
    expect(ettolIdk, 'a from_date szűrő kihagyta a későbbi (releváns) járatot').toContain(kesoi.id);
    expect(ettolIdk, 'a from_date szűrő átengedte a korábbi indulást').not.toContain(korai.id);
  });

  it('BUG-028: az elindult járat 1 óra türelmi idő UTÁN eltűnik a keresésből', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varos = egyediNev('Indulofalva');

    const csuszo = await jaratSql(szallito.id, { city: varos, departureSql: "NOW() - INTERVAL '20 minutes'" });
    const regi = await jaratSql(szallito.id, { city: varos, departureSql: "NOW() - INTERVAL '3 hours'" });

    const lista = await request(app).get(listaUrl(varos)).set(auth(felado.token));
    const idk = lista.body.map((r) => r.id);
    expect(idk, 'a most induló (20 perce csúszó) járat eltűnt — a türelmi ablak elveszett').toContain(csuszo.id);
    expect(idk, 'a 3 órája elindult járatra még mindig lehet jelentkezni').not.toContain(regi.id);
  });
});

// =====================================================================
//  4. JÁRAT-RÉSZLETNÉZET KAPUJA (2026-08-11, 10. mérés A2)
//     A waypoints JSONB a szállító megállóinak PONTOS koordinátáit
//     tartalmazza — jellemzően az otthoni indulóponttal.
// =====================================================================
describe('Járat részletnézet: idegen csak a böngészhető járatot kapja', () => {
  it('draft / full / cancelled / completed / in_progress járat idegennek 404, a tulajdonosnak 200', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'shipper' });

    for (const status of ['draft', 'full', 'cancelled', 'completed', 'in_progress']) {
      const jarat = await jaratSql(szallito.id, { status });

      const kivul = await request(app).get(`/carrier-routes/${jarat.id}`).set(auth(idegen.token));
      expect(kivul.status, `a(z) "${status}" státuszú járat kiadta magát idegennek`).toBe(404);
      expect(
        JSON.stringify(kivul.body),
        `a(z) "${status}" járat 404-e mellé megállók is mentek`,
      ).not.toMatch(/waypoints/);

      const sajat = await request(app).get(`/carrier-routes/${jarat.id}`).set(auth(szallito.token));
      expect(sajat.status, `a tulajdonos nem éri el a saját "${status}" járatát`).toBe(200);
      expect(sajat.body.waypoints, 'a tulajdonos válaszából hiányoznak a megállók').toBeTruthy();
    }
  });

  it('a nyitott, nem-sablon járatot idegen is lekérheti — árakkal együtt', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito, { prices: [{ size: 'S', price_huf: 3000 }, { size: 'M', price_huf: 8000 }] });

    const res = await request(app).get(`/carrier-routes/${jarat.id}`).set(auth(felado.token));
    expect(res.status, 'a publikált járat részletét a feladó sem éri el').toBe(200);
    expect(res.body.prices.map((p) => p.size), 'a részletnézetről hiányzik az ártábla').toEqual(['S', 'M']);
  });

  it('nem létező azonosítóra 404 (nem 500, nem üres 200)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await request(app).get(`/carrier-routes/${NEM_LETEZO}`).set(auth(felado.token));
    expect(res.status).toBe(404);
  });
});

// =====================================================================
//  5. ÚTBA ESŐ FUVAROK
// =====================================================================
describe('Útba eső fuvarok (GET /carrier-routes/:id/along-jobs)', () => {
  it('csak a járat tulajdonosa kérheti le — más szállító 403, nem létező 404', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const masik = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito);

    const idegen = await request(app).get(`/carrier-routes/${jarat.id}/along-jobs`).set(auth(masik.token));
    expect(idegen.status, 'idegen szállító is lekérdezheti a járat mentén fekvő fuvarokat').toBe(403);
    expect(idegen.body.jobs, 'a 403 mellé fuvar-lista is ment').toBeUndefined();

    const nincs = await request(app).get(`/carrier-routes/${NEM_LETEZO}/along-jobs`).set(auth(szallito.token));
    expect(nincs.status).toBe(404);
  });

  it('lezárt/lemondott járatra üres listát ad (nem keres tovább fuvarokat)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    // Nyitott, a járat mentén fekvő fuvar — hogy a keresés TALÁLNA is valamit.
    await createJob({ shipperId: felado.id, status: 'bidding' });

    const jarat = await letrehozJarat(szallito);
    const nyitva = await request(app).get(`/carrier-routes/${jarat.id}/along-jobs`).set(auth(szallito.token));
    expect(nyitva.status).toBe(200);
    expect(nyitva.body.jobs.length, 'a nyitott járat mentén nem talált egyetlen fuvart sem — a fixtúra rossz').toBeGreaterThan(0);

    await db.query(`UPDATE carrier_routes SET status = 'cancelled' WHERE id = $1`, [jarat.id]);
    const lemondva = await request(app).get(`/carrier-routes/${jarat.id}/along-jobs`).set(auth(szallito.token));
    expect(lemondva.status).toBe(200);
    expect(lemondva.body.jobs, 'a LEMONDOTT járathoz is ajánl fuvarokat').toEqual([]);
  });
});

// =====================================================================
//  6. JÁRAT STÁTUSZ-VÁLTÁS + SZERKESZTÉS
// =====================================================================
describe('Járat státusz-váltás (PATCH /carrier-routes/:id/status)', () => {
  it('csak draft/open/full/cancelled állítható be — a többi 400, a státusz marad', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { status: 'open' });

    for (const status of ['completed', 'in_progress', 'delivered', '']) {
      const res = await request(app).patch(`/carrier-routes/${jarat.id}/status`)
        .set(auth(szallito.token)).send({ status });
      expect(res.status, `a "${status}" státuszt elfogadta a végpont`).toBe(400);
    }
    const utana = await db.query('SELECT status FROM carrier_routes WHERE id = $1', [jarat.id]);
    expect(utana.rows[0].status, 'az elutasított állítás mégis megváltoztatta a státuszt').toBe('open');

    const ok = await request(app).patch(`/carrier-routes/${jarat.id}/status`)
      .set(auth(szallito.token)).send({ status: 'full' });
    expect(ok.status, 'az érvényes "full" állítás sem megy át').toBe(200);
    expect(ok.body.status).toBe('full');
  });

  it('idegen szállító nem állíthatja át a járat státuszát (404, IDOR)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const masik = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { status: 'open' });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}/status`)
      .set(auth(masik.token)).send({ status: 'cancelled' });
    expect(res.status, 'idegen is lemondhatja más járatát').toBe(404);

    const utana = await db.query('SELECT status FROM carrier_routes WHERE id = $1', [jarat.id]);
    expect(utana.rows[0].status, 'az idegen kérése MÉGIS átállította a státuszt').toBe('open');
  });
});

describe('Járat szerkesztés (PATCH /carrier-routes/:id)', () => {
  it('idegen 403-at kap és semmit nem ír át; nem létező járat 404', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const masik = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { title: 'Eredeti cím' });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`)
      .set(auth(masik.token)).send({ title: 'Eltérített cím' });
    expect(res.status, 'idegen szerkesztheti más járatát').toBe(403);

    const utana = (await jaratSorok(szallito.id))[0];
    expect(utana.title, 'az idegen PATCH-e MÉGIS átírta a címet').toBe('Eredeti cím');

    const nincs = await request(app).patch(`/carrier-routes/${NEM_LETEZO}`)
      .set(auth(szallito.token)).send({ title: 'Akármi' });
    expect(nincs.status).toBe(404);
  });

  it('érvénytelen státusz a PATCH-ben visszagörgeti a VELE KÜLDÖTT címváltoztatást is', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { title: 'Eredeti cím' });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ title: 'Új cím', status: 'completed' });

    expect(res.status, 'a PATCH is elfogad tetszőleges enum-státuszt').toBe(400);
    const utana = (await jaratSorok(szallito.id))[0];
    expect(utana.title, 'a hibás kérés RÉSZBEN érvényesült — a tranzakció nem gördült vissza').toBe('Eredeti cím');
  });

  it('érvénytelen ár esetén a RÉGI ártábla és a cím is sértetlen marad (rollback)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, {
      title: 'Eredeti cím', prices: [{ size: 'M', price_huf: 10000 }],
    });

    // Az első ár érvényes, a MÁSODIK nem — a validáció a törlés/beszúrás ELŐTT
    // fut, így a régi áraknak túl kell élniük. Ha valaki a DELETE-et a
    // validáció elé mozdítja, a szállító ártáblája némán kiürül.
    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({
        title: 'Új cím',
        prices: [{ size: 'S', price_huf: 4000 }, { size: 'L', price_huf: -1 }],
      });

    expect(res.status, 'a negatív ár átment a PATCH-en').toBe(400);
    const arak = await db.query('SELECT size, price_huf FROM carrier_route_prices WHERE route_id = $1', [jarat.id]);
    expect(arak.rows, 'a hibás ár-kérés KITÖRÖLTE a járat meglévő ártábláját').toEqual([
      { size: 'M', price_huf: 10000 },
    ]);
    const utana = (await jaratSorok(szallito.id))[0];
    expect(utana.title, 'a hibás ár-kérés mellett a cím MÉGIS átíródott').toBe('Eredeti cím');
  });

  it('részleges frissítés: csak a küldött mezők változnak, az üres leírás NULL lesz', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, {
      title: 'Eredeti cím', description: 'Eredeti leírás', vehicle_description: 'Ford Transit',
    });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ description: '' });

    expect(res.status).toBe(200);
    expect(res.body.title, 'a nem küldött cím is felülíródott').toBe('Eredeti cím');
    expect(res.body.vehicle_description, 'a nem küldött jármű-leírás is felülíródott').toBe('Ford Transit');
    expect(res.body.description, 'az üres leírásból nem lett NULL (üres string maradt)').toBeNull();
  });

  it('az ártábla CSERÉLHETŐ: a régi méret eltűnik, az új megjelenik', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { prices: [{ size: 'M', price_huf: 10000 }] });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ prices: [{ size: 'S', price_huf: 2500 }, { size: 'XL', price_huf: 30000 }] });

    expect(res.status).toBe(200);
    expect(res.body.prices, 'az ártábla cseréje nem a küldött listát eredményezte').toEqual([
      { size: 'S', price_huf: 2500 },
      { size: 'XL', price_huf: 30000 },
    ]);
  });
});

// =====================================================================
//  7. FOGLALÁS FELADÁSA (POST /carrier-routes/:id/bookings)
// =====================================================================
describe('Foglalás feladása: a bemeneti kapuk', () => {
  it('hiányzó koordináta / nulla méret / kategórián kívüli csomag → 400, foglalás nem keletkezik', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito);

    const esetek = [
      ['nincs felvételi cím', foglalasBody({ pickup_address: '' })],
      ['nincs lerakodási koordináta', foglalasBody({ dropoff_lat: null })],
      ['nulla súly', foglalasBody({ weight_kg: 0 })],
      ['negatív oldalhossz', foglalasBody({ length_cm: -10 })],
      ['egyik kategóriába sem fér', foglalasBody({ length_cm: 400, width_cm: 300, height_cm: 200, weight_kg: 500 })],
    ];
    for (const [nev, body] of esetek) {
      const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
        .set(auth(felado.token)).send(body);
      expect(res.status, `"${nev}" esetén a foglalás átment`).toBe(400);
    }

    const { rows } = await db.query('SELECT * FROM route_bookings WHERE shipper_id = $1', [felado.id]);
    expect(rows.length, 'érvénytelen adatokból is keletkezett foglalás-sor').toBe(0);
  });

  it('a saját járatára a szállító nem foglalhat (403)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito);

    const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
      .set(auth(szallito.token)).send(foglalasBody());

    expect(res.status, 'a szállító a saját járatára is foglalhat — önmagával kötne ügyletet').toBe(403);
    const { rows } = await db.query('SELECT * FROM route_bookings WHERE shipper_id = $1', [szallito.id]);
    expect(rows.length).toBe(0);
  });

  it('nem publikált (draft / full / cancelled) járatra 409, nem létezőre 404', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });

    for (const status of ['draft', 'full', 'cancelled', 'completed']) {
      const jarat = await jaratSql(szallito.id, { status });
      await db.query(
        `INSERT INTO carrier_route_prices (route_id, size, price_huf) VALUES ($1, 'M', 9000)`,
        [jarat.id],
      );
      const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
        .set(auth(felado.token)).send(foglalasBody());
      expect(res.status, `a(z) "${status}" státuszú járat még mindig fogad foglalást`).toBe(409);
    }

    const nincs = await request(app).post(`/carrier-routes/${NEM_LETEZO}/bookings`)
      .set(auth(felado.token)).send(foglalasBody());
    expect(nincs.status).toBe(404);
  });

  it('ha a szállító az adott MÉRETRE nem adott árat, a foglalás 409 (nem 0 Ft-os ügylet)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito, { prices: [{ size: 'S', price_huf: 3000 }] });

    // 40×30×20 / 5 kg → 'M' kategória, amire ezen a járaton nincs ár.
    const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
      .set(auth(felado.token)).send(foglalasBody());

    expect(res.status, 'ár nélküli méretre is létrejön a foglalás').toBe(409);
    expect(res.body.error, 'a hibaüzenet nem mondja meg, melyik méretre nincs ár').toMatch(/"M"/);
  });

  it('a foglalás jegyzete ÉS a két cím is kontakt-szűrt (2026-08-11, 9. mérés A1)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito);

    const mezok = [
      ['notes', { notes: 'Hívj a részletekért: 06301234567' }],
      ['pickup_address', { pickup_address: 'Budapest, Teszt u. 1. (mobil: +36 30 123 4567)' }],
      ['dropoff_address', { dropoff_address: 'Szeged, Teszt tér 2., valaki@gmail.com' }],
    ];
    for (const [mezo, patch] of mezok) {
      const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
        .set(auth(felado.token)).send(foglalasBody(patch));
      expect(res.status, `a foglalás "${mezo}" mezője szűretlen — a szállító a díj ELŐTT látja`).toBe(400);
      expect(res.body.code).toBe('CONTACT_LEAK');
    }

    const tiszta = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
      .set(auth(felado.token)).send(foglalasBody({ notes: 'Törékeny, kérlek óvatosan.' }));
    expect(tiszta.status, 'a szűrő ártatlan jegyzetet is blokkol').toBe(201);
  });

  it('a foglalás ÁRA a járat ártáblájából jön — a kliens által küldött ár nem számít', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito, { prices: [{ size: 'M', price_huf: 12345 }] });

    const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
      .set(auth(felado.token))
      .send(foglalasBody({ price_huf: 1, connection_fee_huf: 0, status: 'delivered', paid_at: new Date().toISOString() }));

    expect(res.status).toBe(201);
    const sor = await foglalasSor(res.body.id);
    expect(sor.price_huf, 'a kliens által küldött ár felülírta a szállító árát').toBe(12345);
    expect(sor.status, 'a kliens beállíthatta a foglalás státuszát (mass assignment)').toBe('pending');
    expect(sor.paid_at, 'a kliens fizetettnek jelölhette a saját foglalását').toBeNull();
  });

  it('GET /route-bookings/:id — az admin mindent lát, a kívülálló 403, nem létező 404', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const kivulallo = await createUser({ role: 'shipper' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    // Az adminnak a VITARENDEZÉSHEZ látnia kell az átvételi kódot és a
    // követő-tokent — a scrub admin-ága pont ezért adja vissza a nyers sort.
    const adminRes = await request(app).get(`/route-bookings/${booking.id}`).set(auth(admin.token));
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.delivery_code, 'az admin nem látja az átvételi kódot — vitánál nincs mit ellenőriznie').toBeTruthy();
    expect(adminRes.body.tracking_token, 'az admin nem látja a követő-tokent').toBeTruthy();

    const idegen = await request(app).get(`/route-bookings/${booking.id}`).set(auth(kivulallo.token));
    expect(idegen.status, 'bárki lekérheti más foglalásának részleteit').toBe(403);
    expect(JSON.stringify(idegen.body), 'a 403 mellé foglalás-adat is ment').not.toMatch(/delivery_code|tracking_token/);

    const nincs = await request(app).get(`/route-bookings/${NEM_LETEZO}`).set(auth(admin.token));
    expect(nincs.status).toBe(404);
  });

  it('sikeres foglalásról a SZÁLLÍTÓ értesítést kap', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const jarat = await letrehozJarat(szallito);

    const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
      .set(auth(felado.token)).send(foglalasBody());
    expect(res.status).toBe(201);

    const ert = await ertesitesek(szallito.id, 'booking_received');
    expect(ert.length, 'a szállító nem tudja meg, hogy foglaltak a járatán').toBe(1);
    expect(ert[0].link, 'az értesítés nem a járat oldalára visz').toContain(jarat.id);
  });
});

// =====================================================================
//  8. FOGLALÁS MEGERŐSÍTÉSE + A KAPCSOLATFELVÉTELI DÍJ
// =====================================================================
describe('Foglalás megerősítése (POST /route-bookings/:id/confirm)', () => {
  it('csak a járat szállítója erősíthet meg — a feladó és egy idegen sem', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });

    for (const [nev, user] of [['feladó', felado], ['idegen szállító', idegen]]) {
      const res = await request(app).post(`/route-bookings/${booking.id}/confirm`)
        .set(auth(user.token)).send({});
      expect(res.status, `a(z) ${nev} megerősíthette a foglalást`).toBe(403);
    }
    expect((await foglalasSor(booking.id)).status, 'a jogosulatlan kérés MÉGIS megerősítette a foglalást').toBe('pending');

    const nincs = await request(app).post(`/route-bookings/${NEM_LETEZO}/confirm`)
      .set(auth(szallito.token)).send({});
    expect(nincs.status).toBe(404);
  });

  it('másodszor már nem erősíthető meg (409) — nem indul új díj-fizetés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });

    const elso = await request(app).post(`/route-bookings/${booking.id}/confirm`)
      .set(auth(szallito.token)).send({});
    expect(elso.status).toBe(200);
    const elsoSor = await foglalasSor(booking.id);

    const masodik = await request(app).post(`/route-bookings/${booking.id}/confirm`)
      .set(auth(szallito.token)).send({});
    expect(masodik.status, 'a már megerősített foglalás újra megerősíthető').toBe(409);

    const utana = await foglalasSor(booking.id);
    expect(utana.barion_payment_id, 'a második megerősítés ÚJ fizetési munkamenetet nyitott')
      .toBe(elsoSor.barion_payment_id);
  });

  it('a díj a fuvardíj sávjából jön, és a fuvardíjból a platform NULLÁT könyvel', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    // Egyszerűsített launch-árazás (2026-07-15): ≤50 000 Ft → 500, felette 1 000.
    for (const [ar, vartDij] of [[15000, 500], [60000, 1000]]) {
      const { booking } = await createBooking({
        shipperId: felado.id, carrierId: szallito.id, status: 'pending', priceHuf: ar,
      });
      const res = await request(app).post(`/route-bookings/${booking.id}/confirm`)
        .set(auth(szallito.token)).send({});
      expect(res.status).toBe(200);

      const sor = await foglalasSor(booking.id);
      expect(sor.connection_fee_huf, `${ar} Ft fuvardíjnál rossz kapcsolatfelvételi díj`).toBe(vartDij);
      expect(sor.platform_share_huf, 'a platform részesedése nem a díjjal egyenlő').toBe(vartDij);
      expect(sor.carrier_share_huf, 'a platform a FUVARDÍJBÓL is könyvelt — a modell készpénzes').toBe(0);
      expect(sor.confirmed_at, 'a megerősítés időpontja nincs rögzítve').toBeTruthy();
    }
  });
});

// =====================================================================
//  9. DÍJFIZETÉS (pay) — fogyasztóvédelmi kapu + idempotencia
// =====================================================================
describe('Foglalási díj fizetése (POST /route-bookings/:id/pay)', () => {
  it('csak a feladó fizethet, és csak megerősített foglalást', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const { booking: fuggo } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });
    const korai = await request(app).post(`/route-bookings/${fuggo.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(korai.status, 'a még meg sem erősített foglalásra is indítható fizetés').toBe(409);

    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });
    const szallitoFizet = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(szallito.token)).send({ consent: true });
    expect(szallitoFizet.status, 'a szállító is indíthat fizetést a feladó nevében').toBe(403);
    expect((await foglalasSor(booking.id)).fee_consent_at, 'idegen kérés rögzítette a nyilatkozatot').toBeNull();
  });

  it('nyilatkozat nélkül nincs fizetés (45/2014. 29. § (1) a) — és a consent nem rögzül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });

    const nelkule = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({});
    expect(nelkule.status, 'a fizetés elindul kifejezett nyilatkozat nélkül is').toBe(400);
    expect(nelkule.body.code).toBe('CONSENT_REQUIRED');
    expect((await foglalasSor(booking.id)).fee_consent_at, 'az elutasított kérés MÉGIS rögzítette a nyilatkozatot').toBeNull();

    const hamis = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: 'igen' });
    expect(hamis.status, 'a "consent: igen" string is elfogadott nyilatkozatnak számít').toBe(400);

    const jo = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(jo.status).toBe(200);
    expect((await foglalasSor(booking.id)).fee_consent_at, 'az elfogadott nyilatkozat nem rögzült').toBeTruthy();
  });

  it('a fizetés indítása idempotens: másodszor UGYANAZT a munkamenetet adja vissza', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });

    const elso = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(elso.status).toBe(200);
    expect(elso.body.reused, 'az első fizetés-indítás már "újrahasznosítottnak" mondja magát').toBe(false);
    expect(elso.body.gateway_url, 'nem jött fizetési munkamenet').toBeTruthy();

    const masodik = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(masodik.status).toBe(200);
    expect(masodik.body.reused, 'a második kattintás ÚJ fizetési munkamenetet nyitott').toBe(true);
    expect(masodik.body.gateway_url, 'a második kattintás más fizetési linket adott').toBe(elso.body.gateway_url);
  });

  it('a már kifizetett díjat nem lehet újra elindítani (409)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    const res = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(res.status, 'a kifizetett díj újra elindítható — dupla terhelés kockázata').toBe(409);
    expect(res.body.error).toMatch(/már ki van fizetve/i);
  });
});

// =====================================================================
//  10. FIZETÉS NYUGTÁZÁSA (confirm-payment)
// =====================================================================
describe('Fizetés nyugtázása (POST /route-bookings/:id/confirm-payment)', () => {
  it('a szállító nem nyugtázhatja a feladó fizetését (403), és nem lesz paid_at', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });
    await db.query('UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1', [booking.id]);

    const res = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
      .set(auth(szallito.token)).send({});
    expect(res.status, 'a szállító fizetettnek jelölheti a másik fél tartozását').toBe(403);
    expect((await foglalasSor(booking.id)).paid_at, 'idegen nyugtázás mégis fizetettre állította').toBeNull();
  });

  it('nyilatkozat (/pay) nélkül a nyugtázás sem megy át', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });

    const res = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(res.status, 'a /pay kihagyásával a nyilatkozat-kapu megkerülhető').toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect((await foglalasSor(booking.id)).paid_at).toBeNull();
  });

  it('a nem megerősített (pending) foglaláshoz nem tartozhat fizetés (409)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });
    await db.query('UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1', [booking.id]);

    const res = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(res.status, 'függő foglalás is fizetettre állítható').toBe(409);
    expect((await foglalasSor(booking.id)).paid_at).toBeNull();
  });

  it('sikeres nyugtázás: paid_at + a szállító értesítése; a második hívás idempotens', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });
    await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });

    const elso = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(elso.status).toBe(200);
    expect(elso.body.paid_at, 'a nyugtázás nem adta vissza a fizetés időpontját').toBeTruthy();

    const ert = await ertesitesek(szallito.id, 'booking_paid');
    expect(ert.length, 'a szállító nem tudja meg, hogy indulhat a foglalás').toBe(1);

    const masodik = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(masodik.status).toBe(200);
    expect(masodik.body.already_paid, 'a második nyugtázás nem jelezte, hogy már fizetve van').toBe(true);
    expect(masodik.body.paid_at, 'a második nyugtázás ELTOLTA a fizetés időpontját').toEqual(elso.body.paid_at);
    expect(
      (await ertesitesek(szallito.id, 'booking_paid')).length,
      'a második nyugtázás MÁSODIK értesítést is küldött (spam)',
    ).toBe(1);
  });
});

// =====================================================================
//  11. ELUTASÍTÁS + LEMONDÁS
// =====================================================================
describe('Foglalás elutasítása (POST /route-bookings/:id/reject)', () => {
  it('csak a szállító utasíthat el, és csak függő (pending) foglalást', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });
    const feladoElutasit = await request(app).post(`/route-bookings/${booking.id}/reject`)
      .set(auth(felado.token)).send({});
    expect(feladoElutasit.status, 'a feladó elutasíthatja a SAJÁT foglalását a szállító nevében').toBe(403);
    expect((await foglalasSor(booking.id)).status).toBe('pending');

    const { booking: megerositett } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });
    const keso = await request(app).post(`/route-bookings/${megerositett.id}/reject`)
      .set(auth(szallito.token)).send({});
    expect(keso.status, 'a már megerősített foglalás utólag elutasítható').toBe(409);
    expect((await foglalasSor(megerositett.id)).status, 'az elutasítás mégis átállította a státuszt').toBe('confirmed');
  });

  it('sikeres elutasítás: rejected státusz + a feladó értesítése', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });

    const res = await request(app).post(`/route-bookings/${booking.id}/reject`)
      .set(auth(szallito.token)).send({});
    expect(res.status).toBe(200);
    expect((await foglalasSor(booking.id)).status).toBe('rejected');
    expect(
      (await ertesitesek(felado.id, 'booking_rejected')).length,
      'a feladó nem tudja meg, hogy elutasították — hiába vár a járatra',
    ).toBe(1);
  });
});

describe('Foglalás lemondása (POST /route-bookings/:id/cancel)', () => {
  it('kívülálló nem mondhat le, és a már megkezdett/lezárt foglalás sem mondható le', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const kivulallo = await createUser({ role: 'shipper' });

    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    const idegen = await request(app).post(`/route-bookings/${booking.id}/cancel`)
      .set(auth(kivulallo.token)).send({});
    expect(idegen.status, 'bárki lemondhatja más foglalását').toBe(403);
    expect((await foglalasSor(booking.id)).status).toBe('confirmed');

    for (const status of ['in_progress', 'delivered', 'rejected']) {
      const { booking: b } = await createBooking({
        shipperId: felado.id, carrierId: szallito.id, status, paid: true,
      });
      const res = await request(app).post(`/route-bookings/${b.id}/cancel`)
        .set(auth(felado.token)).send({});
      expect(res.status, `a(z) "${status}" állapotú foglalás lemondható`).toBe(409);
      expect((await foglalasSor(b.id)).status, `a(z) "${status}" lemondása mégis megtörtént`).toBe(status);
    }

    const { booking: mar } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'cancelled',
    });
    const ismet = await request(app).post(`/route-bookings/${mar.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(ismet.status).toBe(409);
    expect(ismet.body.error, 'a már lemondott foglalás nem kap saját, érthető üzenetet').toMatch(/már le van mondva/i);
  });

  it('a szállító is lemondhat — a lemondó rögzül, és a feladó értesítést kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    const res = await request(app).post(`/route-bookings/${booking.id}/cancel`)
      .set(auth(szallito.token)).send({ reason: 'Elromlott a kocsi' });
    expect(res.status).toBe(200);

    const sor = await foglalasSor(booking.id);
    expect(sor.status).toBe('cancelled');
    expect(sor.cancelled_by, 'nem a tényleges lemondó került az audit-mezőbe').toBe(szallito.id);
    expect(sor.cancel_reason, 'a lemondás indoka nem rögzült').toBe('Elromlott a kocsi');
    expect(sor.cancelled_at, 'a lemondás időpontja nem rögzült').toBeTruthy();
    expect(
      (await ertesitesek(felado.id, 'booking_cancelled')).length,
      'a feladó nem tudja meg, hogy a szállító visszalépett',
    ).toBe(1);
  });

  it('készpénzes modell: fizetés után sincs visszatérítés és lemondási díj', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true, priceHuf: 60000,
    });

    const res = await request(app).post(`/route-bookings/${booking.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.refund_huf, 'a válasz visszatérítést ígér — a platform nem kezeli a fuvardíjat').toBe(0);
    expect(res.body.cancellation_fee_huf, 'lemondási díjat számoltunk fel — az ÁSZF szerint NINCS').toBe(0);

    const sor = await foglalasSor(booking.id);
    expect(sor.refund_huf, 'visszatérítés került a foglalás sorába').toBe(0);
    expect(sor.cancellation_fee_huf, 'lemondási díj került a foglalás sorába').toBe(0);
    expect(
      (await ertesitesek(felado.id, 'refund_issued')).length,
      'visszatérítési értesítést kapott a feladó, pedig nincs mit visszautalni',
    ).toBe(0);
  });
});
