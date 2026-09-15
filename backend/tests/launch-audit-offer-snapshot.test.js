import { expect, it } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob } = require('./helpers');
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

async function offer(accepting) {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier))
    .send({ amount_huf: 20000, return_policy: 'included' });
  expect(bid.status).toBe(201);
  const author = accepting === 'shipper' ? carrier : shipper;
  const actor = accepting === 'shipper' ? shipper : carrier;
  const counter = (amount) => request(app).post(`/bids/${bid.body.id}/counter`).set(...auth(author)).send({ amount });
  expect((await counter(20000)).status).toBe(200);
  const read = async () => {
    const response = await request(app).get(`/jobs/${job.id}/bids`).set(...auth(actor));
    expect(response.status).toBe(200);
    const b = response.body.find(b => b.id === bid.body.id);
    return { expected_revision: b.revision, expected_amount_huf: b.counter_amount_huf ?? b.amount_huf };
  };
  const accept = (body) => request(app).post(`/bids/${bid.body.id}/${accepting === 'shipper' ? 'accept' : 'accept-counter'}`)
    .set(...auth(actor)).send(body);
  return { job, counter, read, accept };
}

it.each(['shipper', 'carrier'])('%s: megváltozott árra nem születhet megállapodás; új elfogadással sikerül', async (role) => {
  const { job, counter, read, accept } = await offer(role);
  const seen = await read();
  const changed = role === 'shipper' ? 100000 : 1000;
  expect((await counter(changed)).status).toBe(200);
  const rejected = await accept(seen);
  expect(rejected.status).toBe(409); expect(rejected.body.code).toBe('OFFER_CHANGED');
  expect((await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id])).rows[0])
    .toEqual({ status: 'bidding', carrier_id: null });
  expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
  const accepted = await accept(await read());
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  expect(accepted.body.amount_huf).toBe(changed);
  expect((await db.query('SELECT accepted_price_huf FROM jobs WHERE id = $1', [job.id])).rows[0].accepted_price_huf).toBe(changed);
});

it.each(['shipper', 'carrier'])('%s: hiányzó/verzió nélküli/más árú elfogadást sem engedünk', async (role) => {
  const { read, accept } = await offer(role);
  const seen = await read();
  for (const body of [{}, { expected_amount_huf: 20000 }, { expected_revision: seen.expected_revision },
    { ...seen, expected_amount_huf: 19999 }, { ...seen, expected_revision: String(seen.expected_revision) }]) {
    const response = await accept(body);
    expect(response.status).toBe(409); expect(response.body.code).toBe('OFFER_CHANGED');
  }
  expect((await accept(seen)).status).toBe(200);
});

it.each(['shipper', 'carrier'])('%s: az azonos árra visszamódosított ajánlat is új verzió', async (role) => {
  const { counter, read, accept } = await offer(role);
  const seen = await read();
  expect((await counter(30000)).status).toBe(200);
  expect((await counter(20000)).status).toBe(200);
  expect((await accept(seen)).status).toBe(409);
  expect((await accept(await read())).status).toBe(200);
});
