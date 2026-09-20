import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const pickup = require('../src/services/pickupNotifications');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => vi.restoreAllMocks());

it.each([['job', false], ['job', true], ['booking', false], ['booking', true]])('%s: physical delivery during dispute; dispute before pickup=%s', async (type, beforePickup) => {
  vi.spyOn(pickup, 'dispatchPickupNotifications').mockImplementation(() => {});
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, paid: true };
  const entity = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const base = `/${type === 'job' ? 'jobs' : 'route-bookings'}/${entity.id}/photos`;
  const upload = (kind, code) => request(app).post(base).set(...auth(carrier)).field('kind', kind).field('delivery_code', code || '').attach('file', TINY_PNG, 'evidence.png');
  if (!beforePickup) expect((await upload('pickup')).status).toBe(201);
  const dispute = await request(app).post('/disputes').set(...auth(shipper)).send({ [type === 'job' ? 'job_id' : 'booking_id']: entity.id, description: 'A csomag megsérült, közben szeretnénk átvenni és dokumentálni.' });
  expect(dispute.status, JSON.stringify(dispute.body)).toBe(201);
  if (beforePickup) {
    expect((await upload('dropoff', entity.delivery_code)).status).toBe(409);
    expect((await upload('pickup')).status).toBe(201);
  }
  expect((await upload('dropoff', '000000')).status).toBe(403);
  const delivered = await upload('dropoff', entity.delivery_code);
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const row = (await db.query(`SELECT status,status_before_dispute,photo_retention_hold,delivered_at FROM ${table} WHERE id=$1`, [entity.id])).rows[0];
  expect(row).toMatchObject({ status: 'disputed', status_before_dispute: 'delivered', photo_retention_hold: true });
  expect(row.delivered_at).toBeTruthy();
  expect((await db.query('SELECT status FROM disputes WHERE id=$1', [dispute.body.id])).rows[0].status).toBe('open');
  expect((await upload('pickup')).status).toBe(409);
  expect((await upload('dropoff', entity.delivery_code)).status).toBe(409);
  const admin = await createUser({ role: 'admin' });
  const resolved = await request(app).patch(`/disputes/${dispute.body.id}`).set(...auth(admin)).send({ status: 'closed', resolution_note: 'A kézbesítés megtörtént, a panaszt rendeztük.' });
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
  expect((await db.query(`SELECT status,status_before_dispute,photo_retention_hold FROM ${table} WHERE id=$1`, [entity.id])).rows[0])
    .toMatchObject({ status: 'delivered', status_before_dispute: null, photo_retention_hold: true });
});
