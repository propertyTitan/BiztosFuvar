import { it, expect, afterEach, vi } from 'vitest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const request = require('supertest');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => vi.restoreAllMocks());

it('public tracking must not label the previous carrier GPS as the replacement carrier location', async () => {
  const shipper = await createUser(), first = await createUser({role:'carrier'}), second = await createUser({role:'carrier'});
  const job = await createJob({shipperId:shipper.id, status:'bidding', paid:true});
  async function accept(carrier, amount) {
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({amount_huf:amount,return_policy:'included'});
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    const selected = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(bid.body.id));
    expect(selected.status, JSON.stringify(selected.body)).toBe(200);
  }
  await accept(first, 15000);
  expect((await request(app).post(`/jobs/${job.id}/location`).set(...auth(first)).send({lat:47.481234,lng:19.051234})).status).toBe(200);
  expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
  await accept(second,17000);
  const token = (await db.query('SELECT tracking_token FROM jobs WHERE id=$1',[job.id])).rows[0].tracking_token;
  const authenticated = await request(app).get(`/jobs/${job.id}/location/last`).set(...auth(second));
  const publicView = await request(app).get(`/tracking/${token}`);
  expect(authenticated.status).toBe(200);
  expect(authenticated.body).toBeNull();
  expect(publicView.status).toBe(200);
  expect(publicView.body.last_position, 'Public tracking must share the current-carrier filter of authenticated tracking').toBeNull();
  expect((await request(app).post(`/jobs/${job.id}/location`).set(...auth(second)).send({lat:47.6,lng:19.2})).status).toBe(200);
  const fresh = await request(app).get(`/tracking/${token}`);
  expect(Number(fresh.body.last_position.lat)).toBe(47.6);
  expect(Number(fresh.body.last_position.lng)).toBe(19.2);
});
