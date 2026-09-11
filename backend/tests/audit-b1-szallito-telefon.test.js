// TELJES AUDIT — B1 (2026-09-11): a szállítónak KÖTELEZŐ a telefonszám —
// a kifizetett kapcsolatfelvétel különben üres kontaktot ad.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('szállítói telefon-kapu', () => {
  it('telefon nélkül az ajánlattétel 403 PHONE_REQUIRED; a telefon megadása után átmegy', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET phone = NULL WHERE id = $1', [szallito.id]);
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const nelkul = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(nelkul.status, JSON.stringify(nelkul.body)).toBe(403);
    expect(nelkul.body.code, 'telefon nélkül is átment az ajánlat — a feladó üres kontaktot fizetne ki').toBe('PHONE_REQUIRED');

    const patch = await request(app).patch('/auth/me').set(auth(szallito.token)).send({ phone: '+36 20 123 4567' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const vele = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(vele.status, JSON.stringify(vele.body)).toBe(201);
  });

  it('a feladói út érintetlen: telefon nélkül is feladhat', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    await db.query('UPDATE users SET phone = NULL WHERE id = $1', [felado.id]);
    const r = await request(app).post('/jobs').set(auth(felado.token)).send({
      title: 'Telefon nélküli feladó', pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
      dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
      weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
