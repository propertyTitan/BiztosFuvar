// =====================================================================
//  JÁRAT-KAPU: KIS/NAGYBETŰ + MINDEN ROUTER (2026-09-28, audit P1 R1-3)
//
//  A járat-ág a launchra rejtett (JARAT_ENABLED nincs beállítva élesben). A
//  kapu eddig egy KIS/NAGYBETŰ-ÉRZÉKENY regexszel nézte a `req.path`-ot, az
//  Express routere viszont alapból KIS/NAGYBETŰ-ÉRZÉKETLEN: a
//  `POST /Carrier-Routes`, `POST /ROUTE-BOOKINGS/<id>/confirm` stb. átcsúszott
//  a kapun, és elérte a kezelőt. A `POST /route-bookings/:bookingId/photos`
//  pedig a photos routerben él (a carrierRoutes ELŐTT mountolva), oda a kapu
//  el sem jutott.
//
//  Az őr az OSZTÁLYT méri: a végpont-listát futásidőben a router-stackből
//  olvassa (routeInventory), így egy BÁRMELY routerbe kerülő új járat-író
//  végpont kapu nélkül azonnal pirosra vált.
// =====================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, expressApp, db, createUser, createBooking, TINY_PNG,
} = require('./helpers');
const { listRoutes } = require('./routeInventory');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// SZÁNDÉKOSAN a teszt saját másolata (nem a kapu modulja): az őr ne a
// megvalósítás regexét higgye el, hanem azt mérje, amit az Express elér.
const JARAT_ELOTAG = /^\/(carrier-routes|route-bookings)(\/|$)/i;
const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

/** Azok a járat-író végpontok, amiket MA biztosan ismerünk (a leltár ép-e). */
const ISMERT_IROK = [
  'POST /carrier-routes',
  'PATCH /carrier-routes/:id',
  'PATCH /carrier-routes/:id/status',
  'POST /carrier-routes/:id/bookings',
  'POST /route-bookings/:id/pay',
  'POST /route-bookings/:id/confirm-payment',
  'POST /route-bookings/:id/confirm',
  'POST /route-bookings/:id/reject',
  'POST /route-bookings/:id/cancel',
  'POST /route-bookings/:bookingId/photos',
];

/** Minden (bármely routerben élő) nem-GET végpont a két járat-előtag alatt. */
function jaratIroVegpontok() {
  return listRoutes(expressApp)
    .filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && JARAT_ELOTAG.test(r.path));
}

/** Betű-alakok: az Express mindegyiket UGYANARRA a kezelőre irányítja. */
const ALAKOK = {
  kisbetus: (s) => s,
  NAGYBETUS: (s) => s.toUpperCase(),
  Vegyes: (s) => s.replace(/(^|-)([a-z])/g, (_, elo, c) => elo + c.toUpperCase()),
};

/** A sablon literál szakaszait alakítja, a paramétereket azonosítóra cseréli. */
function konkretUt(sablon, alakit, id = DUMMY_ID) {
  return sablon.split('/').map((s) => (s.startsWith(':') ? id : alakit(s))).join('/');
}

function valtozatok(sablon) {
  const out = [];
  for (const [nev, alakit] of Object.entries(ALAKOK)) {
    const ut = konkretUt(sablon, alakit);
    out.push({ nev, ut });
    out.push({ nev: `${nev}+perjel`, ut: `${ut}/` });
  }
  return out;
}

function ervenyesJaratTorzs() {
  return {
    title: 'Budapest – Szeged járat',
    departure_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    waypoints: [
      { name: 'Budapest', lat: 47.4979, lng: 19.0402 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414 },
    ],
    prices: [{ size: 'M', price_huf: 9000 }],
    status: 'open',
  };
}

let eredetiJarat;
beforeEach(() => {
  eredetiJarat = process.env.JARAT_ENABLED;
  // Az éles állapot: a kapcsoló NINCS beállítva (nem 'false', hanem hiányzik).
  delete process.env.JARAT_ENABLED;
  __resetRateLimitsForTests();
});
afterEach(() => {
  if (eredetiJarat === undefined) delete process.env.JARAT_ENABLED;
  else process.env.JARAT_ENABLED = eredetiJarat;
});

describe('JARAT_ENABLED nélkül — minden járat-író végpont zárva, betűalaktól függetlenül', () => {
  it('a leltár látja az ismert járat-író végpontokat (a fotó-feltöltést is)', () => {
    const kulcsok = jaratIroVegpontok().map((r) => `${r.method} ${r.path}`);
    const hianyzik = ISMERT_IROK.filter((k) => !kulcsok.includes(k));
    expect(hianyzik, `A route-leltár nem látja: ${hianyzik.join(', ')}`).toEqual([]);
  });

  it('kis-, NAGY- és Vegyes betűs út + záró perjel: mind 503 JARAT_DISABLED', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const gondok = [];
    for (const { method, path } of jaratIroVegpontok()) {
      for (const { nev, ut } of valtozatok(path)) {
        __resetRateLimitsForTests();
        const res = await request(app)[method.toLowerCase()](ut).set(auth(carrier.token)).send({});
        if (res.status !== 503 || res.body?.code !== 'JARAT_DISABLED') {
          gondok.push(`${method} ${ut} (${nev}) → ${res.status} ${res.body?.code || ''}`);
        }
      }
    }
    expect(
      gondok,
      `A kikapcsolt járat-ág írása ezeken az utakon ELÉRI a kezelőt:\n  ${gondok.join('\n  ')}\n\n`
      + 'Az Express routere kis/nagybetű-érzéketlen — a kapunak is annak kell lennie,\n'
      + 'és MINDEN routerben ott kell állnia, ahol járat-író végpont él\n'
      + '(utils/jaratKapcsolo.js: jaratIrasKapu).',
    ).toEqual([]);
  });

  it('hitelesítés nélkül is 503 (a kapu az auth ELŐTT áll, mint eddig)', async () => {
    const res = await request(app).post('/Carrier-Routes').send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('JARAT_DISABLED');
  });

  it('a Vegyes betűs út NEM hajt végre írást (valós állapoton mérve)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();

    // (1) Járat-hirdetés NAGYBETŰS úton.
    const letrehoz = await request(app).post('/CARRIER-ROUTES').set(auth(carrier.token))
      .send(ervenyesJaratTorzs());
    expect(letrehoz.status, JSON.stringify(letrehoz.body)).toBe(503);
    const { rows: jaratok } = await db.query(
      'SELECT count(*)::int AS n FROM carrier_routes WHERE carrier_id = $1', [carrier.id],
    );
    expect(jaratok[0].n, 'a kikapcsolt ágon mégis létrejött egy járat').toBe(0);

    // (2) Függő foglalás elutasítása Vegyes betűs úton.
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'pending',
    });
    const elutasit = await request(app).post(`/Route-Bookings/${booking.id}/Reject`)
      .set(auth(carrier.token)).send({});
    expect(elutasit.status, JSON.stringify(elutasit.body)).toBe(503);
    const { rows: b } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(b[0].status, 'a kikapcsolt ágon mégis elutasítódott a foglalás').toBe('pending');

    // (3) Foglalás-fotó (photos router — oda a régi kapu el sem jutott).
    const { booking: fizetett } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed', paid: true,
    });
    const foto = await request(app).post(`/route-bookings/${fizetett.id}/photos`)
      .set(auth(carrier.token))
      .field('kind', 'damage')
      .attach('file', TINY_PNG, { filename: 'kar.png', contentType: 'image/png' });
    expect(foto.status, JSON.stringify(foto.body)).toBe(503);
    expect(foto.body.code).toBe('JARAT_DISABLED');
    const { rows: fotok } = await db.query(
      'SELECT count(*)::int AS n FROM photos WHERE booking_id = $1', [fizetett.id],
    );
    expect(fotok[0].n, 'a kikapcsolt ágon mégis feltöltődött egy foglalás-fotó').toBe(0);
  });

  it('százalékkódolt előtaggal sem ér el kezelőt (404 vagy 503, soha a kezelő válasza)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const gondok = [];
    for (const ut of ['/carrier%2Droutes', '/%63arrier-routes', `/route%2Dbookings/${DUMMY_ID}/cancel`]) {
      const res = await request(app).post(ut).set(auth(carrier.token)).send(ervenyesJaratTorzs());
      if (![404, 503].includes(res.status)) gondok.push(`${ut} → ${res.status}`);
    }
    expect(gondok).toEqual([]);
  });

  it('az olvasó végpontok élnek (bármilyen betűalakkal)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed', paid: true,
    });
    for (const ut of ['/carrier-routes', '/Carrier-Routes', '/route-bookings/mine', `/route-bookings/${booking.id}/photos`]) {
      const res = await request(app).get(ut).set(auth(shipper.token));
      expect(res.status, `${ut} → ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it('más routerek írásai érintetlenek (a kapu csak a két előtagra hat)', async () => {
    const shipper = await createUser();
    const fuvar = await request(app).post('/jobs').set(auth(shipper.token)).send({});
    expect(fuvar.status, 'a járat-kapu átszivárgott a fuvar-routerre').not.toBe(503);
    // Előtag-hasonmás: nem járat-út, tehát a kapu nem nyúlhat hozzá.
    const hasonmas = await request(app).post('/carrier-routesx').set(auth(shipper.token)).send({});
    expect(hasonmas.status).not.toBe(503);
  });
});

describe('JARAT_ENABLED=true — az írás újra működik (a kapu nem zár túl)', () => {
  it('járat-hirdetés, Vegyes betűs elutasítás és foglalás-fotó sikeres', async () => {
    process.env.JARAT_ENABLED = 'true';
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();

    const letrehoz = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send(ervenyesJaratTorzs());
    expect(letrehoz.status, JSON.stringify(letrehoz.body)).toBe(201);

    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'pending',
    });
    const elutasit = await request(app).post(`/Route-Bookings/${booking.id}/Reject`)
      .set(auth(carrier.token)).send({});
    expect(elutasit.status, JSON.stringify(elutasit.body)).toBe(200);

    const { booking: fizetett } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed', paid: true,
    });
    const foto = await request(app).post(`/route-bookings/${fizetett.id}/photos`)
      .set(auth(carrier.token))
      .field('kind', 'damage')
      .attach('file', TINY_PNG, { filename: 'kar.png', contentType: 'image/png' });
    expect(foto.status, JSON.stringify(foto.body)).toBe(201);
  });
});

// Osztály-vizsgálat (2026-09-28): a `/uploads/private` 404-kapu mount-alapú
// (kis/nagybetűre érzéketlen), de a mount a NYERS, kódolt útvonalon illeszt,
// az express.static viszont DEKÓDOL és normalizál — a `/uploads/%70rivate/…`
// így átcsúszott, és kiszolgálta a privát (KYC disk-fallback) fájlt.
describe('Testvér-kapu: /uploads/private — kódolt és normalizálható alakkal is zárva', () => {
  const fs = require('fs');
  const path = require('path');
  const tarolo = require('../src/services/storage');
  const letrehozott = [];
  afterEach(() => {
    while (letrehozott.length) {
      try { fs.unlinkSync(letrehozott.pop()); } catch { /* már nincs */ }
    }
  });

  it('a privát fájl egyik alakon sem jön ki a statikus úton', async () => {
    const jelolo = await tarolo.savePrivateFile(Buffer.from('SZIGORUAN-BIZALMAS-OKMANY'), 'okmany.jpg', 'image/jpeg');
    const nev = path.basename(jelolo.slice('private:'.length));
    letrehozott.push(path.join(__dirname, '..', 'uploads', 'private', nev));

    const gondok = [];
    for (const ut of [
      `/uploads/private/${nev}`,
      `/UPLOADS/PRIVATE/${nev}`,
      `/uploads/%70rivate/${nev}`,
      `/uploads/%50RIVATE/${nev}`,
      `/Uploads/Priv%61te/${nev}`,
      `/uploads//private/${nev}`,
      `/uploads/%2Fprivate/${nev}`,
    ]) {
      const res = await request(app).get(ut);
      if (res.status !== 404 || String(res.text).includes('BIZALMAS')) {
        gondok.push(`${ut} → ${res.status}`);
      }
    }
    expect(
      gondok,
      `A privát (KYC) mappa a statikus úton kiszolgálható:\n  ${gondok.join('\n  ')}\n\n`
      + 'A kapunak a DEKÓDOLT, normalizált útvonalat kell néznie — azt, amit az\n'
      + 'express.static ténylegesen kiszolgál.',
    ).toEqual([]);
  });

  it('a publikus feltöltések továbbra is kiszolgálhatók', async () => {
    const url = await tarolo.saveFile(Buffer.from('publikus-kep'), 'kep.jpg', 'image/jpeg');
    letrehozott.push(path.join(__dirname, '..', 'uploads', path.basename(url)));
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
  });
});

// A testvér-kapuk (SOS, mentős) útvonal-ELŐTAGGAL mountolt `router.use`-t
// használnak — az Express ugyanúgy kis/nagybetű-érzéketlenül illeszti, mint a
// végpontokat, tehát ott nincs rés. Az őr ezt rögzíti, hogy egy jövőbeli
// „kézi regexes" átírás ne nyissa ki ugyanezt a hibát.
describe('Testvér-kapuk: SOS és mentős — nagybetűs úttal is zárva', () => {
  const eredeti = {};
  afterEach(() => {
    for (const [k, v] of Object.entries(eredeti)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  for (const { env, ut, kod } of [
    { env: 'SOS_ENABLED', ut: '/SOS', kod: 'SOS_DISABLED' },
    { env: 'TOWING_ENABLED', ut: '/Towing/Request', kod: 'TOWING_DISABLED' },
  ]) {
    it(`${env} nélkül a ${ut} 503 ${kod}`, async () => {
      eredeti[env] = process.env[env];
      delete process.env[env];
      const u = await createUser({ role: 'carrier' });
      const res = await request(app).post(ut).set(auth(u.token)).send({});
      expect(res.status).toBe(503);
      expect(res.body.code).toBe(kod);
    });
  }
});
