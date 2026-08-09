// =====================================================================
//  PIACTÉR-FEED: a cím és a GPS nem megy vendég-sockethez
//
//  Audit 3. kör (2026-08-09). A `jobs:new`, `jobs:new-instant`, `towing:new`
//  és a járat-hirdetés `io.emit`-tel ment: MINDEN csatlakozott sockethez,
//  beleértve a be nem jelentkezett vendégeket. A payload a böngészéshez
//  szükséges PONTOS felvételi/lerakodási címet és GPS-koordinátákat
//  tartalmazza — fiók nélkül, egy böngészőkonzolból élőben lehetett címeket
//  learatni. (A mentés-kérésnél ráadásul a bajba jutott pontos helyét.)
//
//  Mostantól a `feed` szobába megy, ahova csak HITELESÍTETT kapcsolat léphet
//  be. Ez a suite a valódi Socket.IO szerverpéldányon méri, melyik csatornát
//  használják a végpontok.
// =====================================================================
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

const http = require('http');
const realtime = require('../src/realtime');
const { app, db, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

let io;
let szobaEmit;   // io.to(<szoba>).emit hívások
let globalEmit;  // io.emit hívások (mindenki, vendégek is)

beforeAll(() => {
  // Saját (nem figyelő) szerverre kötött Socket.IO — ugyanaz a realtime
  // modulpéldány, amit a route-ok is használnak.
  io = realtime.init(http.createServer());
});

beforeEach(() => {
  __resetRateLimitsForTests();
  szobaEmit = [];
  globalEmit = [];
  vi.spyOn(io, 'to').mockImplementation((szoba) => ({
    emit: (event, payload) => szobaEmit.push({ szoba, event, payload }),
  }));
  vi.spyOn(io, 'emit').mockImplementation((event, payload) => {
    globalEmit.push({ event, payload });
  });
});

afterEach(() => { vi.restoreAllMocks(); });

const feedEsemenyek = () => szobaEmit.filter((e) => e.szoba === 'feed');

describe('Új fuvar feladása', () => {
  it('a `jobs:new` a hitelesített feedbe megy, NEM mindenkinek', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({
        title: 'Feed teszt', description: 'teszt',
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Kossuth tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
        weight_kg: 5, suggested_price_huf: 15000,
        length_cm: 40, width_cm: 30, height_cm: 20,
      });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);

    const feed = feedEsemenyek().filter((e) => e.event === 'jobs:new');
    expect(feed.length, 'a fuvar nem került ki a feedbe (a szállítói lista nem frissülne)').toBe(1);
    expect(
      globalEmit.map((e) => e.event),
      'CÍM-SZIVÁRGÁS: a fuvar adatai minden csatlakozott (akár be nem jelentkezett) sockethez kimentek!',
    ).not.toContain('jobs:new');

    // A payload tényleg tartalmazza a pontos címet — ezért kell a kapu
    expect(feed[0].payload.pickup_address).toBeTruthy();
    // …és NEM tartalmazza az átvételi kódot / címzett-PII-t (kívülálló-scrub)
    expect(feed[0].payload.delivery_code).toBeUndefined();
    expect(feed[0].payload.recipient_phone).toBeUndefined();
  });
});

describe('Mentés-kérés (towing)', () => {
  it('a `towing:new` a feedbe megy, és csak KÖZELÍTŐ helyet ad', async () => {
    const bajbajutott = await createUser({ role: 'shipper' });
    const res = await request(app)
      .post('/towing/request')
      .set('Authorization', `Bearer ${bajbajutott.token}`)
      .send({ lat: 47.497912, lng: 19.040235, address: 'Budapest, Váci út 1.', issue_type: 'flat_tire' });
    expect(res.status).toBe(201);

    // A push/emit fire-and-forget (setImmediate) — várjunk rá
    await new Promise((r) => setTimeout(r, 150));

    const feed = feedEsemenyek().filter((e) => e.event === 'towing:new');
    expect(feed.length).toBe(1);
    expect(
      globalEmit.map((e) => e.event),
      'a bajba jutott helyzete minden vendég-sockethez kiment!',
    ).not.toContain('towing:new');

    const p = feed[0].payload;
    expect(p.approximate).toBe(true);
    expect(p.address, 'a pontos cím nem való a listás/feed eseménybe').toBeUndefined();
    // ~1 km-re kerekítve (2 tizedes), tehát NEM a nyers koordináta
    expect(p.lat).toBe(47.5);
    expect(p.lng).toBe(19.04);
    expect(p.lat).not.toBe(47.497912);
  });
});

describe('Foglalás-megerősítés', () => {
  it('a fizetési gateway-link a CÍMZETT szobájába megy, nem globálisan', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { createBooking } = require('./helpers');
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending', paid: false,
    });

    const res = await request(app)
      .post(`/route-bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${szallito.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);

    const userSzoba = szobaEmit.find((e) => e.event === 'route-booking:confirmed');
    expect(userSzoba, 'a feladó nem kapott értesítést a megerősítésről').toBeTruthy();
    expect(userSzoba.szoba).toBe(`user:${felado.id}`);
    expect(
      globalEmit.length,
      'FIZETÉSI LINK SZIVÁRGÁS: a gateway-URL minden csatlakozott sockethez kiment!',
    ).toBe(0);
  });
});

describe('emitGlobal — mi mehet tényleg mindenkinek', () => {
  it('az `emitToFeed` a feed szobát célozza, az `emitGlobal` mindenkit', () => {
    realtime.emitToFeed('teszt:feed', { a: 1 });
    expect(feedEsemenyek().some((e) => e.event === 'teszt:feed')).toBe(true);
    expect(globalEmit.length).toBe(0);

    realtime.emitGlobal('teszt:global', { b: 2 });
    expect(globalEmit.some((e) => e.event === 'teszt:global')).toBe(true);
  });
});
