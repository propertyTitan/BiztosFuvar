// =====================================================================
//  AUDIT 2026-09-28 (R1-4, P1) — ÚTBA ESŐ FUVAROK: a kitérő-távolság nem
//  lehet trilaterációs orákulum a díj előtt.
//
//  A `findJobsAlongRoute` a nyitott fuvar PONTOS felvételi/lerakodási
//  koordinátájától mért a járat megállóihoz, és 10 m-re (2 tizedes km) adta
//  vissza a kitérőt; a 15 km-es sugár-szűrés is a pontos ponton döntött.
//  A szállító a saját járata megállóit szabadon mozgatja (PATCH), tehát három
//  szondával a ház-pontos cím visszaszámolható volt — miközben ugyanaz a
//  válasz a koordinátát már ~110 m-re (3 tizedes) kerekítve adta.
//
//  Ugyanez az OSZTÁLY a többi, díj előtti / nem-félnek szóló úton: a
//  lane-alert illesztés, az azonnali fuvar közeli-szállító keresése (a push
//  szövegébe írt távolság) és a mentős-lista + mentős-értesítés (ott a
//  közelítő hely ~1 km-es, 2 tizedes).
//
//  Az invariáns, amit minden teszt mér: két fuvar (kérés), amelyeknek a
//  NYILVÁNOS (kerekített) koordinátája azonos, semmilyen szondával nem
//  különböztethető meg — se a visszaadott távolságban, se a szűrésben.
//  Minden teszt a javítás NÉLKÜL igazoltan piros.
// =====================================================================
import {
  describe, it, expect, beforeAll, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { distanceMeters } = require('../src/utils/geo');
const { jobMatchesAlert } = require('../src/services/laneAlerts');
const { findNearbyActiveCarriers } = require('../src/services/instantJobs');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());
afterEach(() => vi.restoreAllMocks());

/** A távolság (km) a megadott pontok közt, 0,1 km-re — az elvárt nyilvános érték. */
const km1 = (a, b) => +(distanceMeters(a[0], a[1], b[0], b[1]) / 1000).toFixed(1);
/** 0,1 km-es lépésben van-e (a 10 m-es felbontás maga volt az orákulum). */
const tizedKm = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;

/** Nyitott (bidding) fuvar a megadott PONTOS koordinátákkal. */
async function nyitottFuvar(shipperId, pickup, dropoff, title) {
  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       suggested_price_huf, status, delivery_code, tracking_token
     ) VALUES (
       $1, $2, 'trilateráció-teszt',
       'Budapest, Teszt utca 12.', $3, $4,
       'Szeged, Teszt tér 2.', $5, $6,
       15000, 'bidding', '111222', encode(gen_random_bytes(16), 'hex')
     ) RETURNING id`,
    [shipperId, title, pickup[0], pickup[1], dropoff[0], dropoff[1]],
  );
  return rows[0].id;
}

async function jarat(carrier, waypoints) {
  const res = await request(app)
    .post('/carrier-routes')
    .set(auth(carrier.token))
    .send({
      title: 'Trilateráció-teszt járat',
      departure_at: new Date(Date.now() + 86400000).toISOString(),
      waypoints: waypoints.map(([lat, lng], i) => ({ name: `Megálló ${i + 1}`, lat, lng, order: i })),
      prices: [{ size: 'M', price_huf: 5000 }],
    });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function utbaEso(carrier, routeId) {
  const res = await request(app)
    .get(`/carrier-routes/${routeId}/along-jobs`)
    .set(auth(carrier.token));
  expect(res.status).toBe(200);
  return res.body.jobs;
}

// A két fuvar PONTOS helye ~40 m-re van egymástól, de mindkettő ugyanabba a
// 3 tizedes (~110 m-es) cellába esik: nyilvánosan (47.498, 19.040) →
// (46.253, 20.141). Ebből a két fuvarból a válasz SEMMIBEN nem térhet el.
const A = { p: [47.4981, 19.0401], d: [46.2531, 20.1411] };
const B = { p: [47.4984, 19.0404], d: [46.2534, 20.1414] };
const NYILVANOS = { p: [47.498, 19.040], d: [46.253, 20.141] };
const MEZOK = ['along_pickup_detour_km', 'along_dropoff_detour_km', 'along_detour_km'];

describe('GET /carrier-routes/:id/along-jobs — a kitérő a NYILVÁNOS koordinátából', () => {
  let carrier;
  let routeId;
  let aId;
  let bId;

  beforeAll(async () => {
    carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    routeId = await jarat(carrier, [[47.52, 19.08], [46.28, 20.10]]);
    aId = await nyitottFuvar(shipper.id, A.p, A.d, 'Cella-teszt A');
    bId = await nyitottFuvar(shipper.id, B.p, B.d, 'Cella-teszt B');
  });

  /** A két fuvar sora + az elvárt (kerekített pontból számolt) értékek. */
  function ellenoriz(jobs, w1, w2) {
    const a = jobs.find((j) => j.id === aId);
    const b = jobs.find((j) => j.id === bId);
    expect(a, 'az A fuvar hiányzik az útba esők közül').toBeTruthy();
    expect(b, 'a B fuvar hiányzik az útba esők közül').toBeTruthy();
    for (const m of MEZOK) {
      expect(
        a[m],
        `${m}: a ~40 m-re lévő két fuvar eltérő kitérőt kapott (${a[m]} vs ${b[m]}) — `
        + 'a pontos koordinátából mért érték a trilateráció nyersanyaga',
      ).toBe(b[m]);
      expect(tizedKm(a[m]), `${m} = ${a[m]} nem 0,1 km-es lépésű`).toBe(true);
    }
    const felvetel = km1(w1, NYILVANOS.p);
    const lerakodas = km1(w2, NYILVANOS.d);
    expect(a.along_pickup_detour_km, 'a felvételi kitérő nem a kerekített pontból számolódott').toBe(felvetel);
    expect(a.along_dropoff_detour_km, 'a lerakodási kitérő nem a kerekített pontból számolódott').toBe(lerakodas);
    expect(a.along_detour_km).toBe(+(felvetel + lerakodas).toFixed(1));
    // A válasz koordinátája eddig is kerekített volt — a távolság most sem tud többet.
    expect(Number(a.pickup_lat)).toBe(NYILVANOS.p[0]);
    expect(Number(a.dropoff_lng)).toBe(NYILVANOS.d[1]);
  }

  it('két, ugyanabba a ~110 m-es cellába eső fuvar kitérője azonos, 0,1 km-es, a kerekített pontból', async () => {
    ellenoriz(await utbaEso(carrier, routeId), [47.52, 19.08], [46.28, 20.10]);
  });

  it('a megállók mozgatása (PATCH, ~20 m-es és nagyobb szondák) sem választja szét a két fuvart', async () => {
    const szondak = [
      [[47.5202, 19.0802], [46.2802, 20.1002]], // ~22 m-es elmozdítás
      [[47.5198, 19.0797], [46.2797, 20.0997]],
      [[47.51, 19.10], [46.27, 20.12]], // más irányból
    ];
    for (const [w1, w2] of szondak) {
      const res = await request(app)
        .patch(`/carrier-routes/${routeId}`)
        .set(auth(carrier.token))
        .send({
          waypoints: [
            { name: 'Megálló 1', lat: w1[0], lng: w1[1], order: 0 },
            { name: 'Megálló 2', lat: w2[0], lng: w2[1], order: 1 },
          ],
        });
      expect(res.status).toBe(200);
      ellenoriz(await utbaEso(carrier, routeId), w1, w2);
    }
  });

  it('a 15 km-es sugár-szűrés is a kerekített ponton dönt: a cellán belül a sugár-határon átlógó két fuvar egyformán jár', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    const jaratId = await jarat(szallito, [[47.0, 19.0], [46.0, 20.0]]);
    const le = [46.0001, 20.0001];
    // A 15 km a (47.0, 19.0) megállótól északra a 47.13490. szélességnél van —
    // ez a 47.135-ös cellába esik (47.1345–47.1355), aminek a KÖZEPE 15,01 km.
    // X pontosan 14,98 km (belül), Y 15,04 km (kívül): a régi szűrő X-et
    // mutatta, Y-t nem — vagyis elárulta, a cella melyik felén áll a ház.
    const xId = await nyitottFuvar(shipper.id, [47.1347, 19.0], le, 'Határ X');
    const yId = await nyitottFuvar(shipper.id, [47.1353, 19.0], le, 'Határ Y');
    // Ellenpróba: egy egyértelműen belül eső cella (47.134 → 14,9 km).
    const zId = await nyitottFuvar(shipper.id, [47.1337, 19.0], le, 'Belül Z');

    const ids = new Set((await utbaEso(szallito, jaratId)).map((j) => j.id));
    expect(
      ids.has(xId),
      'a sugár-szűrés a PONTOS koordinátán döntött: az azonos nyilvános cellájú X és Y közül csak az egyik jelent meg',
    ).toBe(ids.has(yId));
    expect(ids.has(xId), 'a 47.135-ös cella közepe 15,01 km — kívül esik').toBe(false);
    expect(ids.has(zId), 'a sugáron belüli fuvarnak meg kell jelennie (a szűrő nem vak)').toBe(true);
  });
});

describe('Az osztály többi útja — lane-alert, azonnali fuvar, mentős', () => {
  it('lane-alert: a figyelő illesztése a kerekített ponton dönt (felvétel ÉS lerakodás)', () => {
    const alapFuvar = {
      pickup_lat: 47.1347, pickup_lng: 19.0, dropoff_lat: 46.0, dropoff_lng: 20.0,
      suggested_price_huf: 15000, weight_kg: null,
    };
    const felvetelFigyelo = {
      from_lat: 47.0, from_lng: 19.0, to_lat: null, to_lng: null,
      radius_km: 15, min_price_huf: null, max_weight_kg: null,
    };
    const x = { ...alapFuvar, pickup_lat: 47.1347 };
    const y = { ...alapFuvar, pickup_lat: 47.1353 };
    expect(
      jobMatchesAlert(x, felvetelFigyelo),
      'az útvonal-figyelő a PONTOS felvételi ponton döntött — egy kis sugarú figyelő-háló a cella belsejét tapogatja le',
    ).toBe(jobMatchesAlert(y, felvetelFigyelo));
    expect(jobMatchesAlert(x, felvetelFigyelo)).toBe(false);

    // Ugyanez a lerakodási oldalon (a figyelő célterülete).
    const celFigyelo = {
      from_lat: 47.4979, from_lng: 19.0402, to_lat: 46.0, to_lng: 20.0,
      radius_km: 15, min_price_huf: null, max_weight_kg: null,
    };
    const le1 = {
      ...alapFuvar, pickup_lat: 47.4979, pickup_lng: 19.0402, dropoff_lat: 46.1347, dropoff_lng: 20.0,
    };
    const le2 = { ...le1, dropoff_lat: 46.1353 };
    expect(
      jobMatchesAlert(le1, celFigyelo),
      'a figyelő célterülete a PONTOS lerakodási ponton döntött',
    ).toBe(jobMatchesAlert(le2, celFigyelo));
  });

  it('azonnali fuvar: a push-ba írt távolság és a sugár-szűrés a kerekített felvételi pontból', async () => {
    const shipper = await createUser();
    const kozeli = await createUser({ role: 'carrier' });
    const hatari = await createUser({ role: 'carrier' });
    for (const [u, pos] of [[kozeli, [47.52, 19.08]], [hatari, [47.0, 19.0]]]) {
      await db.query(
        'UPDATE users SET last_known_lat = $1, last_known_lng = $2 WHERE id = $3',
        [pos[0], pos[1], u.id],
      );
      await db.query(
        `INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)`,
        [u.id, `ExponentPushToken[teszt-${u.id}]`],
      );
    }

    const tav = async (pickup) => {
      const lista = await findNearbyActiveCarriers(pickup[0], pickup[1], shipper.id, 20);
      return lista.find((c) => c.id === kozeli.id)?.distance_km;
    };
    const da = await tav(A.p);
    const db2 = await tav(B.p);
    expect(da, 'a közeli szállító hiányzik').toBeDefined();
    expect(
      da,
      `a ~40 m-re lévő két fuvar eltérő távolságot adott (${da} vs ${db2}) — a push szövegében ez megy ki`,
    ).toBe(db2);
    expect(tizedKm(da), `${da} nem 0,1 km-es lépésű`).toBe(true);
    expect(da).toBe(km1([47.52, 19.08], NYILVANOS.p));

    const benne = async (pickup) => (await findNearbyActiveCarriers(pickup[0], pickup[1], shipper.id, 15))
      .some((c) => c.id === hatari.id);
    expect(
      await benne([47.1347, 19.0]),
      'a sugár-szűrés a PONTOS felvételi ponton döntött (az azonos cellájú két fuvar közül csak az egyik értesített)',
    ).toBe(await benne([47.1353, 19.0]));
  });

  describe('mentős (towing) — a közelítő hely ~1 km-es, a távolság sem lehet pontosabb', () => {
    // Két segélykérés ~480 m-re egymástól, de ugyanabban a 2 tizedes cellában
    // (47.50, 19.04) — a lista csak ezt a közelítő helyet mutatja.
    const R1 = [47.4951, 19.0401];
    const R2 = [47.4979, 19.0449];
    const KOZELITO = [47.50, 19.04];

    async function segelykeres(pos, radius = 50) {
      const bajban = await createUser();
      const res = await request(app).post('/towing/request').set(auth(bajban.token)).send({
        lat: pos[0], lng: pos[1], issue_type: 'breakdown', vehicle_type: 'car', search_radius_km: radius,
      });
      expect(res.status).toBe(201);
      return res.body.id;
    }

    async function mentos() {
      const m = await createUser({ role: 'carrier', kyc: 'verified' });
      const reg = await request(app).post('/towing/register').set(auth(m.token))
        .send({ tow_services: ['breakdown'] });
      expect(reg.status).toBe(200);
      return m;
    }

    it('GET /towing/incoming: a szabadon választható ?lat/&lng szondából sem jön pontosabb távolság', async () => {
      const r1 = await segelykeres(R1);
      const r2 = await segelykeres(R2);
      const m = await mentos();
      for (const q of [[47.52, 19.08], [47.53, 19.10], [47.5202, 19.0802]]) {
        const res = await request(app).get(`/towing/incoming?lat=${q[0]}&lng=${q[1]}`).set(auth(m.token));
        expect(res.status).toBe(200);
        const a = res.body.find((r) => r.id === r1);
        const b = res.body.find((r) => r.id === r2);
        expect(a && b, 'a két segélykérés hiányzik a listából').toBeTruthy();
        expect(
          a.distance_km,
          `a ~480 m-re lévő két kérés eltérő távolságot kapott (${a.distance_km} vs ${b.distance_km}) — `
          + 'a bajba jutott PONTOS helye három szondából kiszámolható',
        ).toBe(b.distance_km);
        expect(tizedKm(a.distance_km)).toBe(true);
        expect(a.distance_km).toBe(km1(q, KOZELITO));
      }
    });

    it('GET /towing/incoming: a keresési sugár is a közelítő helyen dönt', async () => {
      // 10 km-es sugár a (47.0, 19.0) szondától: a határ a 47.08998. szélességnél
      // van, a 47.09-es cellán (47.085–47.095) BELÜL, aminek a közepe 10,008 km
      // (0,1 km-re: 10,0 — a lista a kerekített távolságra szűr). P pontosan
      // 9,79 km (belül), Q 10,23 km (kívül) — nyilvánosan mindkettő 47.09.
      // A régi szűrő P-t mutatta, Q-t nem.
      const p = await segelykeres([47.088, 19.0], 10);
      const q = await segelykeres([47.092, 19.0], 10);
      // Ellenpróba: egyértelműen belül eső cella (47.08 → 8,9 km).
      const z = await segelykeres([47.0782, 19.0], 10);
      const m = await mentos();
      const res = await request(app).get('/towing/incoming?lat=47.0&lng=19.0').set(auth(m.token));
      expect(res.status).toBe(200);
      const ids = new Set(res.body.map((r) => r.id));
      expect(
        ids.has(p),
        'a keresési sugár a PONTOS helyen döntött: az azonos közelítő helyű két kérés közül csak az egyik jelent meg',
      ).toBe(ids.has(q));
      expect(ids.has(p), 'a 47.09-es cella közepe 10,0 km-re van (0,1 km-re kerekítve) — belül').toBe(true);
      expect(ids.has(z), 'a sugáron belüli kérésnek meg kell jelennie (a szűrő nem vak)').toBe(true);
    });

    it('mentős-értesítés: a push szövegébe írt távolság is a közelítő helyből', async () => {
      // A push a valódi Expo API-t hívná — teszt alatt semmi nem mehet ki.
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
      const m = await mentos();
      await db.query('UPDATE users SET last_known_lat = 47.52, last_known_lng = 19.08 WHERE id = $1', [m.id]);
      await db.query('INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)', [m.id, `ExponentPushToken[m-${m.id}]`]);

      await segelykeres(R1);
      await segelykeres(R2);

      let szovegek = [];
      for (let i = 0; i < 60 && szovegek.length < 2; i++) {
        // eslint-disable-next-line no-await-in-loop
        const { rows } = await db.query(
          `SELECT body FROM notifications WHERE user_id = $1 AND type = 'tow_request_nearby' ORDER BY created_at`,
          [m.id],
        );
        szovegek = rows.map((r) => r.body);
        // eslint-disable-next-line no-await-in-loop
        if (szovegek.length < 2) await new Promise((r) => setTimeout(r, 50));
      }
      expect(szovegek.length, 'a mentős nem kapott két értesítést').toBe(2);
      expect(
        szovegek[0],
        'a két, azonos közelítő helyű kérés értesítése eltérő távolságot írt — a pontos helyből mért',
      ).toBe(szovegek[1]);
      expect(szovegek[0]).toContain(`${km1(KOZELITO, [47.52, 19.08]).toFixed(1)} km`);
    });
  });
});
