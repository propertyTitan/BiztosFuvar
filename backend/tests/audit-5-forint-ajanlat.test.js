import { describe, it, expect } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const auth = u => ({ Authorization: `Bearer ${u.token}` });

describe('Audit 5 — deviza nem értelmezhető át forintnak', () => {
  it('200 EUR ajánlatot elutasít mentés előtt, HUF-ban a szokásos ár és díj marad', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const eur = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier))
      .send({ amount: 200, currency: 'EUR', return_policy: 'included' });
    expect(eur.status).toBe(400);
    expect(eur.body.code).toBe('UNSUPPORTED_CURRENCY');
    expect((await db.query('SELECT * FROM bids WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    const huf = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier))
      .send({ amount: 80000, currency: 'HUF', return_policy: 'included' });
    expect(huf.status).toBe(201);
    const accepted = await request(app).post(`/bids/${huf.body.id}/accept`).send(await seenOffer(huf.body.id)).set(auth(shipper));
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ amount_huf: 80000, connection_fee_huf: 1000 });
  });
  it.each([false, true])('korábbi EUR-ajánlat véglegesítése is tiltott (ellenajánlat: %s)', async counter => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const bid = (await db.query(`INSERT INTO bids (job_id, carrier_id, amount_huf, currency, return_policy, counter_amount_huf, counter_by)
      VALUES ($1, $2, 200, 'EUR', 'included', $3, $4) RETURNING id`, [job.id, carrier.id, counter ? 150 : null, counter ? 'shipper' : null])).rows[0];
    const r = await request(app).post(`/bids/${bid.id}/${counter ? 'accept-counter' : 'accept'}`)
      .set(auth(counter ? carrier : shipper)).send(await seenOffer(bid.id));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('UNSUPPORTED_CURRENCY');
    expect((await db.query('SELECT status FROM jobs WHERE id = $1', [job.id])).rows[0].status).toBe('bidding');
  });
});
