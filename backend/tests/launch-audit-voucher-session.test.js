import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const fs = require('fs');
const path = require('path');
const { app, db, createUser, createJob } = require('./helpers');
const { grantVoucher } = require('../src/services/gamification');
const provider = require('../src/services/paymentProvider');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function accepted({ real = false, stubPrefix = false } = {}) {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  if (real) vi.spyOn(provider, 'startFeePayment').mockResolvedValue({ paymentId: `${stubPrefix ? 'cib-stub' : 'bank'}-${job.id}`,
    gatewayUrl: `https://bank.example/pay/${job.id}`, stub: false });
  const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier))
    .send({ amount_huf: 20000, return_policy: 'included' });
  expect(bid.status).toBe(201);
  const accept = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(shipper))
    .send({ expected_revision: bid.body.revision, expected_amount_huf: bid.body.amount_huf });
  expect(accept.status, JSON.stringify(accept.body)).toBe(200);
  await grantVoucher(shipper.id, 'referral', 60, null);
  const pay = () => request(app).post(`/jobs/${job.id}/pay`).set(...auth(shipper)).send({ consent: true });
  const cancel = () => request(app).post(`/jobs/${job.id}/cancel`).set(...auth(shipper)).send({ reason: 'A szállításra már nincs szükség.' });
  const session = async () => (await db.query('SELECT * FROM payment_sessions WHERE job_id = $1', [job.id])).rows[0];
  return { shipper, carrier, job, pay, cancel, session };
}

it.each(['cib', 'qvik'])('%s: kupon és lemondás után mindkét fél fiókja törölhető', async (name) => {
  vi.stubEnv('PAYMENT_PROVIDER', name);
  const { shipper, carrier, job, pay, cancel, session } = await accepted();
  expect(await session()).toMatchObject({ provider: name, is_simulated: true, state: 'pending' });
  // A már létrejött session besorolását egy környezetváltás nem változtatja meg.
  vi.stubEnv('PAYMENT_PROVIDER', name === 'cib' ? 'qvik' : 'cib');
  const paid = await pay();
  expect(paid.status).toBe(200); expect(paid.body.paid_via_voucher).toBe(true);
  expect(await session()).toMatchObject({ provider: name, is_simulated: true, state: 'closed', closed_reason: 'voucher' });
  expect((await db.query('SELECT 1 FROM payment_events WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
  expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
  expect((await cancel()).status).toBe(200);
  expect((await request(app).delete('/auth/me').set(...auth(shipper))).status).toBe(200);
  expect((await request(app).delete('/auth/me').set(...auth(carrier))).status).toBe(200);
});

it.each([false, true])('valódi/ismeretlen session védelme kupon mellett is megmarad (stub prefix=%s)', async (stubPrefix) => {
  const { shipper, carrier, pay, cancel, session } = await accepted({ real: true, stubPrefix });
  expect(await session()).toMatchObject({ provider: 'unknown', is_simulated: false });
  expect((await pay()).body.paid_via_voucher).toBe(true);
  expect((await cancel()).status).toBe(200);
  expect(await session()).toMatchObject({ state: 'pending', closed_reason: null });
  expect((await request(app).delete('/auth/me').set(...auth(shipper))).status).toBe(409);
  expect((await request(app).delete('/auth/me').set(...auth(carrier))).status).toBe(409);
});

it('a session lezárási hibája a kupont és a díjrendezést is visszagörgeti', async () => {
  const { job, pay, session } = await accepted();
  await db.query(`CREATE FUNCTION fail_session_close() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'session update failure'; END $$`);
  await db.query(`CREATE TRIGGER fail_session_close BEFORE UPDATE ON payment_sessions
    FOR EACH ROW WHEN (OLD.job_id = '${job.id}'::uuid) EXECUTE FUNCTION fail_session_close()`);
  try {
    expect((await pay()).status).toBe(500);
    expect(await session()).toMatchObject({ state: 'pending', closed_reason: null });
    expect((await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id])).rows[0].paid_at).toBeNull();
    expect((await db.query('SELECT 1 FROM fee_vouchers WHERE used_on_job = $1', [job.id])).rows).toHaveLength(0);
  } finally { await db.query('DROP FUNCTION fail_session_close() CASCADE'); }
  expect((await pay()).body.paid_via_voucher).toBe(true);
  expect((await session()).state).toBe('closed');
});

it('a migráció a régi, bizonyítottan kuponos stubot rendezi, az ismeretlen fizetést megőrzi', async () => {
  const simulated = await accepted();
  expect((await simulated.pay()).body.paid_via_voucher).toBe(true);
  const real = await accepted({ real: true, stubPrefix: true });
  expect((await real.pay()).body.paid_via_voucher).toBe(true);
  await db.query(`UPDATE payment_sessions SET provider = 'unknown', is_simulated = FALSE,
    state = 'pending', closed_reason = NULL, settled_at = NULL WHERE job_id = ANY($1)`, [[simulated.job.id, real.job.id]]);
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/089_simulated_payment_sessions.sql'), 'utf8');
  await db.query(migration);
  expect(await simulated.session()).toMatchObject({ provider: 'cib', is_simulated: true, state: 'closed', closed_reason: 'voucher' });
  expect(await real.session()).toMatchObject({ provider: 'unknown', is_simulated: false, state: 'pending', closed_reason: null });
});
