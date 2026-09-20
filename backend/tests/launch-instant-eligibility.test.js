import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer, TINY_PNG } = require('./helpers');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());

it.each(['suspension', 'phone-clear'])('instant acceptance rechecks eligibility after %s completed', async change => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' }), admin = await createUser({ role: 'admin' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', priceHuf: 15000 });
  await db.query("UPDATE jobs SET is_instant=TRUE,instant_expires_at=NOW()+INTERVAL '1 hour' WHERE id=$1", [job.id]);
  const query = db.query, captured = gate(), resume = gate();
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (!paused && String(sql).includes('SELECT identity_kyc_status, driver_terms_accepted_at,') && args[0]?.[0] === carrier.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  const accepting = request(app).post(`/jobs/${job.id}/instant-accept`).set(...auth(carrier)).send({ expected_price_huf: 15000 }).then(r => r);
  await captured.promise;
  try {
    const changed = change === 'suspension'
      ? await request(app).patch(`/admin/users/${carrier.id}`).set(...auth(admin)).send({ can_bid: false })
      : await request(app).patch('/auth/me').set(...auth(carrier)).send({ phone: '' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  } finally { resume.resolve(); }
  const result = await accepting;
  const current = (await db.query('SELECT carrier_id,status FROM jobs WHERE id=$1', [job.id])).rows[0];
  const carrierState = (await db.query('SELECT can_bid,phone FROM users WHERE id=$1', [carrier.id])).rows[0];
  expect(change === 'suspension' ? carrierState.can_bid : carrierState.phone).toBe(change === 'suspension' ? false : null);
  const fresh = await request(app).post(`/jobs/${job.id}/instant-accept`).set(...auth(carrier)).send({ expected_price_huf: 15000 });
  expect(fresh.status).toBe(403);
  expect(current, `Delayed instant acceptance returned ${result.status} after eligibility was revoked.`).toMatchObject({ carrier_id: null, status: 'bidding' });
});

it('control: a normal bid cannot be accepted after carrier suspension', async () => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' }), admin = await createUser({ role: 'admin' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  const offer = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({ amount_huf: 15000, return_policy: 'included' });
  expect(offer.status).toBe(201);
  expect((await request(app).patch(`/admin/users/${carrier.id}`).set(...auth(admin)).send({ can_bid: false })).status).toBe(200);
  const accepted = await request(app).post(`/bids/${offer.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(offer.body.id));
  expect(accepted.status).toBe(409);
  expect((await db.query('SELECT carrier_id FROM jobs WHERE id=$1', [job.id])).rows[0].carrier_id).toBe(null);
});
