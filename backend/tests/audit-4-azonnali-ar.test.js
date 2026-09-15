import { describe, it, expect } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob } = require('./helpers');
const auth = u => ({ Authorization: `Bearer ${u.token}` });
async function fixture() {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', priceHuf: 20000 });
  await db.query('UPDATE jobs SET is_instant = TRUE WHERE id = $1', [job.id]);
  return { shipper, carrier, job };
}
describe('Audit 4 — azonnali fuvar ármegállapodása', () => {
  it('szerkesztéskor sem lehet nulla a fix ár', async () => {
    const { shipper, job } = await fixture();
    const r = await request(app).patch(`/jobs/${job.id}`).set(auth(shipper)).send({ suggested_price_huf: 0 });
    expect(r.status).toBe(400);
    expect((await db.query('SELECT suggested_price_huf FROM jobs WHERE id = $1', [job.id])).rows[0].suggested_price_huf).toBe(20000);
  });
  it('régi árral nincs megállapodás; az új ár kifejezett megerősítésével van', async () => {
    const { shipper, carrier, job } = await fixture();
    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(shipper)).send({ suggested_price_huf: 5000 })).status).toBe(200);
    const old = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(carrier)).send({ expected_price_huf: 20000 });
    expect(old.status).toBe(409);
    expect(old.body.code).toBe('PRICE_CHANGED');
    expect((await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id])).rows[0]).toMatchObject({ status: 'bidding', carrier_id: null });
    expect((await db.query('SELECT * FROM escrow_transactions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    const accepted = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(carrier)).send({ expected_price_huf: 5000 });
    expect(accepted.status).toBe(200);
    expect(accepted.body.amount_huf).toBe(5000);
  });
  it.each([undefined, null, 0, -1, 1.5, '20000'])('a látott ár megadását nem lehet megkerülni (%s)', async price => {
    const { carrier, job } = await fixture();
    const r = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(carrier)).send({ expected_price_huf: price });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PRICE_CONFIRMATION_REQUIRED');
  });
});
