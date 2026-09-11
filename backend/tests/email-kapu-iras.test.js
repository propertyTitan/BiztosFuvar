// =====================================================================
//  E-MAIL-KAPU AZ ÍRÁSI VÉGPONTOKON (2026-09-11, user-döntés D5)
//
//  A feladónak nincs KYC-je (2026-07-19) — a megerősített e-mail az EGYETLEN
//  kapu a hamis hirdetések előtt, és ez eddig csak a felületen (EmailVerifyGate)
//  élt: az API-t közvetlenül hívva nem igazolt fiók feladhatott, licitálhatott,
//  foglalhatott. A kapu mostantól a szerveren is áll: POST /jobs,
//  POST /jobs/:id/bids, POST /carrier-routes/:id/bookings.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');

const FUVAR = {
  title: 'Teszt fuvar', description: 'egy doboz',
  pickup_address: 'Budapest, Teszt utca 1., 1111', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt tér 2., 6720', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20, suggested_price_huf: 15000,
};

describe('Nem igazolt e-mail → az írási végpontok 403-at adnak', () => {
  it('POST /jobs', async () => {
    const u = await createUser({ emailVerified: false });
    const res = await request(app).post('/jobs').set('Authorization', `Bearer ${u.token}`).send(FUVAR);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('POST /jobs/:id/bids', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier', emailVerified: false });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await request(app)
      .post(`/jobs/${job.id}/bids`).set('Authorization', `Bearer ${carrier.token}`)
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('POST /carrier-routes/:id/bookings', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser({ emailVerified: false });
    const { rows: r } = await db.query(
      `INSERT INTO carrier_routes (carrier_id, title, departure_at, status)
       VALUES ($1, 'Teszt járat', NOW() + INTERVAL '1 day', 'open') RETURNING id`,
      [carrier.id],
    );
    const res = await request(app)
      .post(`/carrier-routes/${r[0].id}/bookings`).set('Authorization', `Bearer ${shipper.token}`)
      .send({ length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
        pickup_address: 'Budapest, Teszt utca 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('igazolt fiók feladása továbbra is átmegy (a kapu nem túl széles)', async () => {
    const u = await createUser();
    const res = await request(app).post('/jobs').set('Authorization', `Bearer ${u.token}`).send(FUVAR);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
