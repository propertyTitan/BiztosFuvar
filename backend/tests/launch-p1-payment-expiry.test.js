import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const { runPaymentExpiry } = require('../src/services/paymentReminders');
const email = require('../src/services/email');
const auth = user => ['Authorization', `Bearer ${user.token}`];
const jobs = [];
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  require('../src/middleware/rateLimit').__resetRateLimitsForTests();
  vi.spyOn(email, 'sendEmail').mockResolvedValue({ stub: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (jobs.length) await db.query("UPDATE jobs SET status='cancelled' WHERE id=ANY($1::uuid[])", [jobs.splice(0)]);
});
async function expired() {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id });
  jobs.push(job.id);
  await db.query(`UPDATE jobs SET payment_reminder_count=2,
    last_payment_reminder_at=NOW()-INTERVAL '4 days', created_at=NOW() WHERE id=$1`, [job.id]);
  await db.query(`INSERT INTO escrow_transactions
    (job_id, amount_huf, status, carrier_share_huf, platform_share_huf)
    VALUES ($1,500,'held',0,500)`, [job.id]);
  return { shipper, carrier, job };
}
function pauseSelection() {
  const selected = gate(), resume = gate();
  const original = db.query.bind(db);
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
    const result = await original(sql, params);
    if (!paused && String(sql).includes('SELECT j.id') && String(sql).includes('j.payment_reminder_count >= $1')) {
      paused = true;
      selected.resolve();
      await resume.promise;
    }
    return result;
  });
  return { selected, resume };
}
async function state(id) {
  return (await db.query(`SELECT j.status, j.carrier_id, j.paid_at, j.payment_reminder_count,
    j.last_payment_reminder_at, e.status AS fee_status
    FROM jobs j JOIN escrow_transactions e ON e.job_id=j.id WHERE j.id=$1`, [id])).rows[0];
}
async function expiredNotices(user) {
  return (await db.query("SELECT * FROM notifications WHERE user_id=$1 AND type='payment_expired'", [user.id])).rows;
}

it('a közben új szállítóval újrakötött megállapodást nem járatja le', async () => {
  const { shipper, carrier, job } = await expired();
  const replacement = await createUser({ role: 'carrier' });
  const { selected, resume } = pauseSelection();
  const running = runPaymentExpiry();
  try {
    await selected.promise;
    expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(replacement))
      .send({ amount_huf: 23000, return_policy: 'included' });
    expect(bid.status).toBe(201);
    const accepted = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(bid.body.id));
    expect(accepted.status).toBe(200);
  } finally { resume.resolve(); }
  expect(await running).toBe(0);
  expect(await state(job.id)).toMatchObject({ status: 'accepted', carrier_id: replacement.id,
    payment_reminder_count: 0, last_payment_reminder_at: null, fee_status: 'held' });
  for (const user of [shipper, carrier, replacement]) expect(await expiredNotices(user)).toEqual([]);
});

it('a közben frissített határidőt újraellenőrzi a lejáratás előtt', async () => {
  const { shipper, job } = await expired();
  const { selected, resume } = pauseSelection();
  const running = runPaymentExpiry();
  try {
    await selected.promise;
    await db.query('UPDATE jobs SET last_payment_reminder_at=NOW() WHERE id=$1', [job.id]);
  } finally { resume.resolve(); }
  expect(await running).toBe(0);
  expect(await state(job.id)).toMatchObject({ status: 'accepted', fee_status: 'held' });
  expect(await expiredNotices(shipper)).toEqual([]);
});

it('a közben beérkező sikeres fizetés után nem mondja le a fuvart', async () => {
  const { shipper, job } = await expired();
  const pay = await request(app).post(`/jobs/${job.id}/pay`).set(...auth(shipper)).send({ consent: true });
  expect(pay.status).toBe(200);
  const { selected, resume } = pauseSelection();
  const running = runPaymentExpiry();
  try {
    await selected.promise;
    const paid = await request(app).post('/payments/cib/callback').send({ PaymentId: pay.body.payment_id, Status: 'Succeeded' });
    expect(paid.status).toBe(200);
  } finally { resume.resolve(); }
  expect(await running).toBe(0);
  const current = await state(job.id);
  expect(current.status).toBe('accepted');
  expect(current.paid_at).toBeTruthy();
  expect(current.fee_status).toBe('released');
  expect(await expiredNotices(shipper)).toEqual([]);
});

it('díjsor-íráshibánál az ügylet lemondását is visszagörgeti, a következő kör javít', async () => {
  const { shipper, carrier, job } = await expired();
  await db.query(`CREATE FUNCTION audit_expiry_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.job_id='${job.id}'::uuid THEN RAISE EXCEPTION 'audit expiry fee failure'; END IF;
    RETURN NEW; END $$`);
  await db.query('CREATE TRIGGER audit_expiry_fail BEFORE UPDATE ON escrow_transactions FOR EACH ROW EXECUTE FUNCTION audit_expiry_fail()');
  try {
    expect(await runPaymentExpiry()).toBe(0);
    expect(await state(job.id)).toMatchObject({ status: 'accepted', fee_status: 'held' });
    expect(await expiredNotices(shipper)).toEqual([]);
    expect(await expiredNotices(carrier)).toEqual([]);
  } finally {
    await db.query('DROP TRIGGER audit_expiry_fail ON escrow_transactions');
    await db.query('DROP FUNCTION audit_expiry_fail()');
  }
  expect(await runPaymentExpiry()).toBe(1);
  expect(await state(job.id)).toMatchObject({ status: 'cancelled', fee_status: 'refunded' });
  expect(await expiredNotices(shipper)).toHaveLength(1);
  expect(await expiredNotices(carrier)).toHaveLength(1);
});

it('két párhuzamos kör a lejárt megállapodást egyszer zárja és értesíti', async () => {
  const { shipper, carrier, job } = await expired();
  const original = db.query.bind(db), both = gate();
  let reads = 0;
  vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
    const result = await original(sql, params);
    if (String(sql).includes('SELECT j.id') && String(sql).includes('j.payment_reminder_count >= $1')) {
      reads += 1;
      if (reads === 2) both.resolve();
      await both.promise;
    }
    return result;
  });
  const counts = await Promise.all([runPaymentExpiry(), runPaymentExpiry()]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  expect(await state(job.id)).toMatchObject({ status: 'cancelled', fee_status: 'refunded' });
  expect(await expiredNotices(shipper)).toHaveLength(1);
  expect(await expiredNotices(carrier)).toHaveLength(1);
});
