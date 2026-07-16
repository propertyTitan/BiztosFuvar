// Biztonsági regresszió: PII / átvételi-kód szivárgás a fuvar- és
// foglalás-csatornákon. A 2026-07-11-i audit három megerősített lyukat
// talált, mindet ez a suite őrzi:
//   1. `jobs:new` socket-broadcast (io.emit MINDEN kliensnek, vendégnek is)
//      — a payload a KÍVÜLÁLLÓ nézetre scrubbolt kell legyen. A broadcast
//      literálisan `scrubJobForUser(job, null)`-t hív, így azt teszteljük.
//   2. `GET /route-bookings/:id` — a szállító NEM kaphatja a tracking_token-t
//      (azzal a publikus követőoldalról kiolvasható lenne a kód).
//   3. a szállító útvonalának foglalás-listája ugyanígy scrubbolt.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob, createBooking } = require('./helpers');
const { scrubJobForUser } = require('../src/routes/jobs');

// Ami SOHA nem mehet ki egy kívülállónak (se socketen, se REST-en).
const FORBIDDEN_FOR_OUTSIDER = [
  'delivery_code', 'sender_delivery_code', 'tracking_token',
  'recipient_name', 'recipient_phone', 'recipient_email',
  'barion_payment_id', 'barion_gateway_url',
  'paid_at', 'fee_consent_at', 'connection_fee_huf',
];

describe('jobs:new broadcast — kívülálló-scrub (PII + kód nem szivárog)', () => {
  it('scrubJobForUser(job, null): egyetlen érzékeny mező sem marad benne', () => {
    // A `jobs:new` payload pontosan ez — a nyers DB-sor minden mezővel.
    const rawJob = {
      id: 'j1', shipper_id: 's1', carrier_id: null,
      title: 'Teszt', pickup_address: 'Budapest', dropoff_address: 'Szeged',
      pickup_lat: 47.5, pickup_lng: 19.0, suggested_price_huf: 12000,
      weight_kg: 5, status: 'bidding',
      delivery_code: '111222', sender_delivery_code: '333444',
      tracking_token: 'SUPERSECRETTOKEN',
      recipient_name: 'Kis Anna', recipient_phone: '+36301112233',
      recipient_email: 'anna@example.com',
      barion_payment_id: 'bar-1', barion_gateway_url: 'https://barion/x',
      paid_at: null, fee_consent_at: null, connection_fee_huf: 500,
    };

    const out = scrubJobForUser(rawJob, null);

    for (const field of FORBIDDEN_FOR_OUTSIDER) {
      expect(out, `"${field}" NEM mehet ki kívülállónak`).not.toHaveProperty(field);
    }
    // A publikus mezők maradjanak (a lista így is használható a szállítónak)
    expect(out.id).toBe('j1');
    expect(out.title).toBe('Teszt');
    expect(out.pickup_address).toBe('Budapest');
    expect(out.suggested_price_huf).toBe(12000);
  });

  it('a kijelölt szállító sem kapja a kódot / tokent, de a címzett-kontaktot igen', () => {
    const rawJob = {
      id: 'j2', shipper_id: 's1', carrier_id: 'c1',
      delivery_code: '111222', sender_delivery_code: '333444',
      tracking_token: 'TOK', recipient_phone: '+36301112233',
    };
    const out = scrubJobForUser(rawJob, { sub: 'c1', role: 'carrier' });
    expect(out).not.toHaveProperty('delivery_code');
    expect(out).not.toHaveProperty('sender_delivery_code');
    expect(out).not.toHaveProperty('tracking_token');
    expect(out.recipient_phone).toBe('+36301112233'); // kézbesítéskor hívnia kell
  });
});

describe('Foglalás-végpontok — a szállító nem juthat a tracking_token-hez', () => {
  it('GET /route-bookings/:id: a szállító válaszában nincs tracking_token / delivery_code', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await request(app)
      .get(`/route-bookings/${booking.id}`)
      .set('Authorization', `Bearer ${carrier.token}`);

    expect(res.status).toBe(200);
    expect(res.body.tracking_token).toBeUndefined();
    expect(res.body.delivery_code).toBeUndefined();
  });

  it('GET /route-bookings/:id: a FELADÓ viszont látja a saját kódját + tokenjét', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await request(app)
      .get(`/route-bookings/${booking.id}`)
      .set('Authorization', `Bearer ${shipper.token}`);

    expect(res.status).toBe(200);
    expect(res.body.delivery_code).toBe('111222');
    expect(typeof res.body.tracking_token).toBe('string');
  });

  it('a szállító útvonal-foglalás listája is scrubbolt (nincs token/kód)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking, routeId } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await request(app)
      .get(`/carrier-routes/${routeId}/bookings`)
      .set('Authorization', `Bearer ${carrier.token}`);

    expect(res.status).toBe(200);
    const row = res.body.find((b) => b.id === booking.id);
    expect(row).toBeTruthy();
    expect(row.tracking_token).toBeUndefined();
    expect(row.delivery_code).toBeUndefined();
    // A szállítónak a kézbesítéshez kell a címzett elérhetősége — az marad
    expect(row.recipient_phone).toBe('+36301112233');
  });
});
