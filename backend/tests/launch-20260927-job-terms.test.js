import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const auth = u => ['Authorization', `Bearer ${u.token}`];
beforeEach(() => __resetRateLimitsForTests());
async function setup() {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  const offer = body => request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier))
    .send({ amount_huf: 20000, return_policy: 'included', ...body });
  const edit = body => request(app).patch(`/jobs/${job.id}`).set(...auth(shipper)).send(body);
  const read = async () => (await request(app).get(`/jobs/${job.id}/bids`).set(...auth(shipper))).body[0];
  const first = await offer({ expected_job_terms_revision: job.terms_revision });
  expect(first.status).toBe(201);
  const accept = async (snapshot) => request(app).post(`/bids/${first.body.id}/accept`).set(...auth(shipper)).send(snapshot ?? await seenOffer(first.body.id));
  return { job, shipper, carrier, bid: first.body, offer, edit, read, accept };
}

it('a lényegesen átírt fuvar csak szállítói újramegerősítés és a friss ajánlat elfogadása után vállalható', async () => {
  const p = await setup(); const old = await seenOffer(p.bid.id);
  const changed = await p.edit({ weight_kg: 300, length_cm: 200, width_cm: 150, height_cm: 150,
    pickup_needs_carrying: true, pickup_floor: 5, pickup_has_elevator: false });
  expect(changed.status).toBe(200); expect(changed.body.terms_revision).toBe(2);
  expect((await p.accept(old)).body.code).toBe('JOB_TERMS_CHANGED');
  expect((await p.accept()).status).toBe(409); // Friss ajánlatlista sem helyettesíti a szállító jóváhagyását.
  expect((await p.read()).needs_reconfirmation).toBe(true);
  const mine = await request(app).get('/bids/mine').set(...auth(p.carrier));
  expect(mine.body.find(b => b.job_id === p.job.id).needs_reconfirmation).toBe(true);
  for (const user of [p.shipper, p.carrier]) {
    const counter = await request(app).post(`/bids/${p.bid.id}/counter`).set(...auth(user)).send({ amount: 25000 });
    expect(counter.status).toBe(409); expect(counter.body.code).toBe('JOB_TERMS_CHANGED');
  }
  for (const version of [undefined, 1, '2', -1]) {
    const stale = await p.offer({ expected_job_terms_revision: version });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('JOB_CHANGED');
  }
  expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id=$1', [p.job.id])).rowCount).toBe(0);
  const confirmed = await p.offer({ amount_huf: 30000, expected_job_terms_revision: changed.body.terms_revision });
  expect(confirmed.status).toBe(201); expect(confirmed.body.id).toBe(p.bid.id);
  expect((await p.read()).needs_reconfirmation).toBe(false);
  expect((await p.accept(old)).body.code).toBe('OFFER_CHANGED');
  expect((await p.accept()).status).toBe(200);
  expect((await db.query('SELECT status,accepted_price_huf FROM jobs WHERE id=$1', [p.job.id])).rows[0])
    .toEqual({ status: 'accepted', accepted_price_huf: 30000 });
});

it('a feladói ellenajánlat elfogadása sem kerüli meg a megváltozott feltételeket', async () => {
  const p = await setup();
  expect((await request(app).post(`/bids/${p.bid.id}/counter`).set(...auth(p.shipper)).send({ amount: 18000 })).status).toBe(200);
  const seen = await seenOffer(p.bid.id);
  expect((await p.edit({ description: 'Most már két nagy szekrényt kell szállítani.' })).status).toBe(200);
  const result = await request(app).post(`/bids/${p.bid.id}/accept-counter`).set(...auth(p.carrier)).send(seen);
  expect(result.status).toBe(409); expect(result.body.code).toBe('JOB_TERMS_CHANGED');
  const updated = await p.offer({ expected_job_terms_revision: 2 });
  expect(updated.status).toBe(201); expect(updated.body.counter_by).toBeNull();
});

it('az irányár és a változatlan adatok mentése nem érvényteleníti a fix összegű ajánlatot', async () => {
  const p = await setup();
  const changed = await p.edit({ suggested_price_huf: 25000, title: p.job.title, description: p.job.description });
  expect(changed.status).toBe(200); expect(changed.body.terms_revision).toBe(1);
  expect((await p.read()).needs_reconfirmation).toBe(false);
  expect((await p.accept()).status).toBe(200);
});

it('a feltétel oda-vissza átírása is új megerősítést igényel', async () => {
  const p = await setup();
  expect((await p.edit({ description: 'Két szekrény' })).status).toBe(200);
  const restored = await p.edit({ description: p.job.description });
  expect(restored.body.terms_revision).toBe(3);
  expect((await p.accept()).status).toBe(409);
  expect((await p.offer({ expected_job_terms_revision: 3 })).status).toBe(201);
  expect((await p.accept()).status).toBe(200);
});

it('az elavult oldalon most először licitáló szállító sem vállalhatja el a megváltozott fuvart', async () => {
  const p = await setup(); const newcomer = await createUser({ role: 'carrier' });
  await p.edit({ pickup_needs_carrying: true, pickup_floor: 4 });
  const result = await request(app).post(`/jobs/${p.job.id}/bids`).set(...auth(newcomer))
    .send({ amount_huf: 25000, return_policy: 'included', expected_job_terms_revision: 1 });
  expect(result.status).toBe(409);
  expect((await db.query('SELECT 1 FROM bids WHERE job_id=$1 AND carrier_id=$2', [p.job.id, newcomer.id])).rowCount).toBe(0);
});

it('a fix áras elvállalás is ellenőrzi az áron túli munkafeltételeket', async () => {
  const p = await setup();
  await db.query('UPDATE jobs SET is_instant=TRUE WHERE id=$1', [p.job.id]);
  await p.edit({ weight_kg: 300 });
  const accept = revision => request(app).post(`/jobs/${p.job.id}/instant-accept`).set(...auth(p.carrier))
    .send({ expected_price_huf: 15000, expected_job_terms_revision: revision });
  expect((await accept(1)).body.code).toBe('JOB_CHANGED');
  expect((await accept()).status).toBe(409);
  expect((await accept(2)).status).toBe(200);
});

it('a migráció a régi ajánlatot megőrzi és megerősítéshez köti; újrafuttatása nem érvényteleníti az új ajánlatot', async () => {
  const p = await setup();
  const migration = require('fs').readFileSync(require('path').join(__dirname, '../db/migrations/093_job_terms_revision.sql'), 'utf8');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE jobs (LIKE public.jobs INCLUDING DEFAULTS) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE bids (LIKE public.bids INCLUDING DEFAULTS) ON COMMIT DROP');
    await client.query('INSERT INTO jobs SELECT * FROM public.jobs WHERE id=$1', [p.job.id]);
    await client.query('INSERT INTO bids SELECT * FROM public.bids WHERE id=$1', [p.bid.id]);
    await client.query('ALTER TABLE jobs DROP COLUMN terms_revision');
    await client.query('ALTER TABLE bids DROP COLUMN job_terms_revision');
    await client.query(migration);
    expect((await client.query('SELECT job_terms_revision,status,amount_huf FROM bids')).rows[0])
      .toEqual({ job_terms_revision: 0, status: 'pending', amount_huf: 20000 });
    await client.query('UPDATE bids SET job_terms_revision=1');
    await client.query(migration);
    expect((await client.query('SELECT job_terms_revision FROM bids')).rows[0].job_terms_revision).toBe(1);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
