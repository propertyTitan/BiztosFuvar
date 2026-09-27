import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const provider = require('../src/services/paymentProvider');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const auth = u => ['Authorization', `Bearer ${u.token}`];
beforeEach(() => __resetRateLimitsForTests());
afterEach(() => vi.restoreAllMocks());
async function setup(price = 21000) {
  const shipper = await createUser(), a = await createUser({ role: 'carrier' }), b = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  let n = 0;
  const start = vi.spyOn(provider, 'startFeePayment').mockImplementation(async () => ({
    paymentId: `bank-test-${job.id}-${++n}`, gatewayUrl: `https://psp.invalid/${job.id}/${n}`, stub: false,
  }));
  const offers = [];
  for (const [user, amount] of [[a, 20000], [b, price]]) {
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(user)).send({ amount_huf: amount, return_policy: 'included' });
    expect(bid.status).toBe(201); offers.push(bid.body);
  }
  const accept = async bid => request(app).post(`/bids/${bid.id}/accept`).set(...auth(shipper)).send(await seenOffer(bid.id));
  const first = await accept(offers[0]); expect(first.status).toBe(200);
  expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
  return { job, shipper, b, second: offers[1], first: first.body, start, accept };
}

it('új szállító választása és a /pay ugyanazt az egyetlen függő banki sessiont használja', async () => {
  const p = await setup(); const result = await p.accept(p.second);
  expect(result.status).toBe(200); expect(result.body.barion).toEqual(p.first.barion);
  const paid = await request(app).post(`/jobs/${p.job.id}/pay`).set(...auth(p.shipper)).send({ consent: true });
  expect(paid.status).toBe(200); expect(paid.body.reused).toBe(true);
  expect(p.start).toHaveBeenCalledTimes(1);
  expect((await db.query('SELECT state FROM payment_sessions WHERE job_id=$1', [p.job.id])).rows).toEqual([{ state: 'pending' }]);
  const callback = await request(app).post('/payments/cib/callback').send({ PaymentId: paid.body.payment_id, Status: 'Succeeded' });
  expect(callback.status).toBe(200);
  const entity = (await db.query('SELECT carrier_id,paid_at FROM jobs WHERE id=$1', [p.job.id])).rows[0];
  expect(entity.carrier_id).toBe(p.b.id); expect(entity.paid_at).toBeTruthy();
});

it('más díjsávba kerülő új ajánlatnál előbb le kell zárni a régi fizethető sessiont', async () => {
  const p = await setup(60000);
  const blocked = await p.accept(p.second);
  expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
  expect(p.start).toHaveBeenCalledTimes(1);
  expect((await db.query('SELECT status,carrier_id FROM jobs WHERE id=$1', [p.job.id])).rows[0]).toEqual({ status: 'bidding', carrier_id: null });
  expect((await request(app).post('/payments/cib/callback').send({ PaymentId: p.first.barion.payment_id, Status: 'Expired' })).status).toBe(200);
  expect((await p.accept(p.second)).status).toBe(200); expect(p.start).toHaveBeenCalledTimes(2);
  expect((await db.query('SELECT state,amount_huf FROM payment_sessions WHERE job_id=$1 ORDER BY amount_huf', [p.job.id])).rows)
    .toEqual([{ state: 'closed', amount_huf: 500 }, { state: 'pending', amount_huf: 1000 }]);
});

it('egy régebbi, már felülírt függő session is blokkolja az új fizetést', async () => {
  const p = await setup();
  await db.query(`INSERT INTO payment_sessions(payment_id,job_id,shipper_id,amount_huf) VALUES($1,$2,$3,500)`,
    [`orphan-${p.job.id}`, p.job.id, p.shipper.id]);
  const result = await p.accept(p.second);
  expect(result.status).toBe(409); expect(result.body.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
  expect(p.start).toHaveBeenCalledTimes(1);
});
