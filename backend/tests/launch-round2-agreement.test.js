import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());
async function offer(job, carrier, amount = 20000) {
  const response = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier))
    .send({ amount_huf: amount, return_policy: 'included' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
const accept = async (bid, shipper) => request(app).post(`/bids/${bid.id}/accept`)
  .set(...auth(shipper)).send(await seenOffer(bid.id));

it.each(['replacement', 'same'])('%s: az elavult lemondás nem bonthatja fel az új megállapodást', async scenario => {
  const shipper = await createUser(); const first = await createUser({ role: 'carrier' });
  const next = scenario === 'same' ? first : await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', paid: true });
  const bid = await offer(job, first);
  expect((await accept(bid, shipper)).status).toBe(200);
  const captured = gate(); const resume = gate(); let paused = false;
  const query = db.query;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (!paused && String(sql).includes('s.full_name AS shipper_name, s.email AS shipper_email') && args[0]?.[0] === job.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  const cancelling = request(app).post(`/jobs/${job.id}/cancel`).set(...auth(first)).send({ reason: 'Visszalépek' }).then(r => r);
  let nextBid;
  try {
    await captured.promise;
    expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
    nextBid = await offer(job, next, 21000);
    expect((await accept(nextBid, shipper)).status).toBe(200);
  } finally { resume.resolve(); }
  const stale = await cancelling;
  expect(stale.status).toBe(409); expect(stale.body.code).toBe('STATE_CHANGED');
  expect((await db.query('SELECT status, carrier_id, accepted_price_huf, reopened_count FROM jobs WHERE id=$1', [job.id])).rows[0])
    .toMatchObject({ status: 'accepted', carrier_id: next.id, accepted_price_huf: 21000, reopened_count: 1 });
  expect((await db.query('SELECT status FROM bids WHERE id=$1', [nextBid.id])).rows[0].status).toBe('accepted');
});
