import { describe, it, expect } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const auth = u => ({ Authorization: `Bearer ${u.token}` });

describe('Audit 2 — jogosultság az ajánlat véglegesítésekor', () => {
  for (const counter of [false, true]) {
    for (const restriction of ['can_bid = FALSE', "identity_kyc_status = 'rejected'", 'driver_terms_accepted_at = NULL', 'phone = NULL']) {
      it(`${counter ? 'ellenajánlat' : 'ajánlat'}: ${restriction} után nincs új megállapodás`, async () => {
        const shipper = await createUser();
        const carrier = await createUser({ role: 'carrier' });
        const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
        const bid = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier))
          .send({ amount_huf: 12000, return_policy: 'included' });
        expect(bid.status).toBe(201);
        if (counter) {
          expect((await request(app).post(`/bids/${bid.body.id}/counter`).set(auth(shipper)).send({ amount: 10000 })).status).toBe(200);
        }
        await db.query(`UPDATE users SET ${restriction} WHERE id = $1`, [carrier.id]);
        const response = await request(app).post(`/bids/${bid.body.id}/${counter ? 'accept-counter' : 'accept'}`)
          .set(auth(counter ? carrier : shipper)).send(await seenOffer(bid.body.id));
        expect(response.status, JSON.stringify(response.body)).toBe(409);
        expect(response.body.code).toBe('CARRIER_UNAVAILABLE');
        expect((await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id])).rows[0])
          .toMatchObject({ status: 'bidding', carrier_id: null });
        expect((await db.query('SELECT status FROM bids WHERE id = $1', [bid.body.id])).rows[0].status).toBe('pending');
        expect((await db.query('SELECT * FROM escrow_transactions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
        await db.query("UPDATE users SET can_bid = TRUE, identity_kyc_status = 'verified', driver_terms_accepted_at = NOW(), phone = '+36201234567' WHERE id = $1", [carrier.id]);
        expect((await request(app).post(`/bids/${bid.body.id}/${counter ? 'accept-counter' : 'accept'}`)
          .set(auth(counter ? carrier : shipper)).send(await seenOffer(bid.body.id))).status).toBe(200);
      });
    }
  }
});
