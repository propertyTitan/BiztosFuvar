// Szállító-kereső város-szűrők: GET /jobs?pickup_city=…&dropoff_city=…
// A szűrő részszöveg-keresés a címmezőkön (ILIKE), kisbetű-érzéketlen.
// Egyedi városnevekkel dolgozunk, hogy a párhuzamosan futó tesztek
// fuvarjai ne zavarjanak bele az eredménybe.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob } = require('./helpers');

function listJobs(token, query = {}) {
  return request(app)
    .get('/jobs')
    .query({ status: 'bidding', ...query })
    .set('Authorization', `Bearer ${token}`);
}

describe('Város-szűrők a fuvarkeresőben', () => {
  it('pickup_city: csak az egyező felvételi címűeket adja, kisbetűvel is', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const jobPecs = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Pécsvárszűrő, Fő u. 1.', dropoffAddress: 'Budapest, Cél u. 2.',
    });
    const jobGyor = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Győrszűrő, Ipar u. 3.', dropoffAddress: 'Budapest, Cél u. 2.',
    });

    const res = await listJobs(carrier.token, { pickup_city: 'pécsvárszűrő' });

    expect(res.status).toBe(200);
    const ids = res.body.map((j) => j.id);
    expect(ids).toContain(jobPecs.id);
    expect(ids).not.toContain(jobGyor.id);
  });

  it('dropoff_city: csak az egyező lerakodási címűeket adja', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const jobToSzeged = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Budapest, Indul u. 1.', dropoffAddress: 'Szegedszűrő, Cél tér 5.',
    });
    const jobToDebrecen = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Budapest, Indul u. 1.', dropoffAddress: 'Debrecenszűrő, Cél tér 6.',
    });

    const res = await listJobs(carrier.token, { dropoff_city: 'Szegedszűrő' });

    expect(res.status).toBe(200);
    const ids = res.body.map((j) => j.id);
    expect(ids).toContain(jobToSzeged.id);
    expect(ids).not.toContain(jobToDebrecen.id);
  });

  it('honnan + hová együtt: mindkét feltételnek egyeznie kell', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const match = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Miskolcszűrő, A u. 1.', dropoffAddress: 'Sopronszűrő, B u. 2.',
    });
    const half = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Miskolcszűrő, A u. 1.', dropoffAddress: 'Budapest, B u. 2.',
    });

    const res = await listJobs(carrier.token, {
      pickup_city: 'Miskolcszűrő', dropoff_city: 'Sopronszűrő',
    });

    expect(res.status).toBe(200);
    const ids = res.body.map((j) => j.id);
    expect(ids).toContain(match.id);
    expect(ids).not.toContain(half.id);
  });

  it('LIKE-joker az inputban (%): nem találhat meg mindent, és nem 500-azik', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Zalaszűrő, C u. 1.', dropoffAddress: 'Budapest, D u. 2.',
    });

    // A '%' kiszedése után a minta '%zalaszűrőmás%' — semmire nem illik
    const res = await listJobs(carrier.token, { pickup_city: 'Zalaszűrő%más' });

    expect(res.status).toBe(200);
    expect(res.body.map((j) => j.id)).not.toContain(job.id);

    // Gonosz input: óriás string se okozzon 500-at
    const evil = await listJobs(carrier.token, { pickup_city: 'x'.repeat(5000) });
    expect(evil.status).toBe(200);
  });
});
