import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const provider = require('../src/services/paymentProvider');
const auth = user => ['Authorization', `Bearer ${user.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => __resetRateLimitsForTests());
afterEach(() => vi.restoreAllMocks());

async function pending(type) {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const entity = type === 'job'
    ? await createJob({ shipperId: shipper.id, carrierId: carrier.id })
    : (await createBooking({ shipperId: shipper.id, carrierId: carrier.id })).booking;
  return { shipper, carrier, entity, type,
    table: type === 'job' ? 'jobs' : 'route_bookings',
    field: type === 'job' ? 'job_id' : 'booking_id',
    path: type === 'job' ? `/jobs/${entity.id}` : `/route-bookings/${entity.id}` };
}

const pay = p => request(app).post(`${p.path}/pay`).set(...auth(p.shipper)).send({ consent: true });
const webhook = (paymentId, status = 'Succeeded') => request(app).post('/payments/cib/callback').send({ PaymentId: paymentId, Status: status });

it.each([['job', 'webhook'], ['booking', 'webhook'], ['job', 'manual'], ['booking', 'manual']])(
  '%s %s: final payment-event failure rolls back the complete local booking; a retry succeeds once', async (type, mode) => {
    const p = await pending(type);
    const started = await pay(p);
    expect(started.status).toBe(200);
    const paymentId = started.body.payment_id;
    const confirm = () => mode === 'webhook' ? webhook(paymentId)
      : request(app).post(`${p.path}/confirm-payment`).set(...auth(p.shipper)).send({});

    // Actual PostgreSQL trigger: catches both pool.query and transaction client.query.
    // The initial processed=false claim is allowed; only the financial finalization fails.
    await db.query(`CREATE FUNCTION audit_20260924_payment_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.processed THEN RAISE EXCEPTION 'audit final event failure'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER audit_20260924_payment_event_failure BEFORE INSERT OR UPDATE ON payment_events
      FOR EACH ROW EXECUTE FUNCTION audit_20260924_payment_event_failure()`);
    try {
      const failed = await confirm();
      expect(failed.status, JSON.stringify(failed.body)).toBe(500);
      expect((await db.query(`SELECT paid_at FROM ${p.table} WHERE id=$1`, [p.entity.id])).rows[0].paid_at).toBeNull();
      expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(0);
      expect((await db.query(`SELECT 1 FROM invoices WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(0);
      expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [paymentId])).rows[0].state).toBe('pending');
      if (type === 'job') expect((await db.query('SELECT status FROM escrow_transactions WHERE job_id=$1', [p.entity.id])).rows[0].status).toBe('held');
    } finally {
      await db.query('DROP TRIGGER audit_20260924_payment_event_failure ON payment_events');
      await db.query('DROP FUNCTION audit_20260924_payment_event_failure()');
    }

    expect((await confirm()).status).toBe(200);
    expect((await confirm()).status).toBe(200);
    expect((await db.query(`SELECT paid_at FROM ${p.table} WHERE id=$1`, [p.entity.id])).rows[0].paid_at).toBeTruthy();
    expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [paymentId])).rows[0].state).toBe('succeeded');
    expect((await db.query('SELECT processed, event_type, platform_fee FROM payment_events WHERE payment_id=$1 AND status=$2', [paymentId, 'Succeeded'])).rows[0])
      .toMatchObject({ processed: true, event_type: mode, platform_fee: 500 });
    expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
    expect((await db.query(`SELECT 1 FROM invoices WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
  },
);

function distinctSessions(p) {
  let sequence = 0;
  return vi.spyOn(provider, 'startFeePayment').mockImplementation(async () => {
    sequence++;
    return { paymentId: `bank-test-${p.entity.id}-${sequence}`, gatewayUrl: `https://psp.invalid/${p.entity.id}/${sequence}`, stub: false };
  });
}

it.each([['job', 'Expired'], ['job', 'Canceled'], ['booking', 'Expired'], ['booking', 'Canceled']])(
  '%s %s: a terminal session is replaced once, retained, and the fresh session can settle', async (type, status) => {
    const p = await pending(type);
    const start = distinctSessions(p);
    const first = await pay(p);
    expect(first.status).toBe(200);
    expect((await webhook(first.body.payment_id, status)).status).toBe(200);
    const retry = await pay(p);
    expect(retry.status).toBe(200);
    expect(retry.body.reused).toBe(false);
    expect(retry.body.payment_id).not.toBe(first.body.payment_id);
    expect(start).toHaveBeenCalledTimes(2);
    expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [first.body.payment_id])).rows[0].state).toBe('closed');
    expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [retry.body.payment_id])).rows[0].state).toBe('pending');
    const repeated = await pay(p);
    expect(repeated.body).toMatchObject({ reused: true, payment_id: retry.body.payment_id });
    expect(start).toHaveBeenCalledTimes(2);
    expect((await webhook(retry.body.payment_id)).status).toBe(200);
    expect((await db.query(`SELECT paid_at FROM ${p.table} WHERE id=$1`, [p.entity.id])).rows[0].paid_at).toBeTruthy();
    expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
  },
);

it.each(['job', 'booking'])('%s: two simultaneous lazy pay requests share one session', async type => {
  const p = await pending(type);
  const original = db.query.bind(db); const readBoth = gate(); let reads = 0;
  vi.spyOn(db, 'query').mockImplementation(async (sql, args) => {
    const result = await original(sql, args);
    const initialRead = type === 'job' ? String(sql).includes('e.barion_gateway_url')
      : String(sql).includes('s.email AS shipper_email, c.email AS carrier_email');
    if (initialRead && args?.[0] === p.entity.id) {
      reads++;
      if (reads === 2) readBoth.resolve();
      await readBoth.promise;
    }
    return result;
  });
  const start = distinctSessions(p);
  const results = await Promise.all([pay(p), pay(p)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(results[0].body.payment_id).toBe(results[1].body.payment_id);
  expect((await db.query(`SELECT 1 FROM payment_sessions WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
});

it.each(['job', 'booking'])('%s: a pending payment ID without a gateway needs reconciliation, not another charge', async type => {
  const p = await pending(type);
  const started = await pay(p);
  expect(started.status).toBe(200);
  await db.query(type === 'job' ? 'UPDATE escrow_transactions SET barion_gateway_url=NULL WHERE job_id=$1'
    : 'UPDATE route_bookings SET barion_gateway_url=NULL WHERE id=$1', [p.entity.id]);
  const start = vi.spyOn(provider, 'startFeePayment');
  const retry = await pay(p);
  expect(retry.status).toBe(409);
  expect(retry.body.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
  expect(start).not.toHaveBeenCalled();
  expect((await db.query(`SELECT 1 FROM payment_sessions WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
});

it.each(['job', 'booking'])('%s: concurrent retries replace one expired session with exactly one fresh session', async type => {
  const p = await pending(type);
  const start = distinctSessions(p);
  const first = await pay(p);
  expect((await webhook(first.body.payment_id, 'Expired')).status).toBe(200);
  const retries = await Promise.all([pay(p), pay(p)]);
  expect(retries.map(r => r.status)).toEqual([200, 200]);
  expect(start).toHaveBeenCalledTimes(2);
  expect(retries[0].body.payment_id).toBe(retries[1].body.payment_id);
  expect(retries[0].body.payment_id).not.toBe(first.body.payment_id);
  expect((await db.query(`SELECT state FROM payment_sessions WHERE ${p.field}=$1 ORDER BY state`, [p.entity.id])).rows)
    .toEqual([{ state: 'closed' }, { state: 'pending' }]);
});

it('job: a second pay waiting on the first provider call reads the committed escrow gateway', async () => {
  const p = await pending('job');
  const entered = gate(); const resume = gate(); let sequence = 0;
  const start = vi.spyOn(provider, 'startFeePayment').mockImplementation(async () => {
    const n = ++sequence;
    entered.resolve();
    await resume.promise;
    return { paymentId: `locked-bank-${p.entity.id}-${n}`, gatewayUrl: `https://psp.invalid/locked/${n}`, stub: false };
  });
  const first = pay(p).then(r => r);
  await entered.promise;
  const second = pay(p).then(r => r);
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const blocked = await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM jobs WHERE id = $1 FOR UPDATE%'");
      if (blocked.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting, 'The second pay must actually wait for the first transaction.').toBe(true);
  } finally { resume.resolve(); }
  const results = await Promise.all([first, second]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(results[0].body.payment_id).toBe(results[1].body.payment_id);
});

async function oldIncompleteReceipt(type, mode = 'webhook') {
  const p = await pending(type);
  const started = await pay(p);
  expect(started.status).toBe(200);
  p.paymentId = started.body.payment_id;
  const settled = mode === 'webhook' ? await webhook(p.paymentId)
    : await request(app).post(`${p.path}/confirm-payment`).set(...auth(p.shipper)).send({});
  expect(settled.status).toBe(200);
  // Historical state: the receipt/invoice exists, but the post-COMMIT event
  // write was lost. No subsequent webhook will be sent by this test.
  await db.query("UPDATE fee_payment_receipts SET paid_at=paid_at-INTERVAL '3 minutes' WHERE payment_id=$1", [p.paymentId]);
  await db.query(`UPDATE ${p.table} SET paid_at=(SELECT paid_at FROM fee_payment_receipts WHERE payment_id=$1) WHERE id=$2`, [p.paymentId, p.entity.id]);
  await db.query(`UPDATE payment_events SET processed=FALSE, job_id=NULL, booking_id=NULL,
    shipper_id=NULL, carrier_id=NULL, total_amount=NULL, platform_fee=NULL,
    summary='feldolgozás alatt' WHERE payment_id=$1 AND status='Succeeded'`, [p.paymentId]);
  await db.query("UPDATE payment_sessions SET state='pending' WHERE payment_id=$1", [p.paymentId]);
  return p;
}

it.each([['job', 'webhook'], ['booking', 'webhook'], ['job', 'manual'], ['booking', 'manual']])('%s %s: the periodic worker repairs an old incomplete financial event without another callback', async (type, mode) => {
  const p = await oldIncompleteReceipt(type, mode);
  const start = vi.spyOn(provider, 'startFeePayment');
  const state = vi.spyOn(provider, 'getPaymentState');
  const queue = require('../src/services/feeInvoiceQueue');
  await queue.runPendingFeeInvoices();
  await queue.runPendingFeeInvoices();
  expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [p.paymentId])).rows[0].state).toBe('succeeded');
  expect((await db.query("SELECT processed, event_type, platform_fee FROM payment_events WHERE payment_id=$1 AND status='Succeeded'", [p.paymentId])).rows[0])
    .toMatchObject({ processed: true, event_type: mode, platform_fee: 500 });
  expect((await db.query(`SELECT 1 FROM invoices WHERE ${p.field}=$1`, [p.entity.id])).rowCount).toBe(1);
  expect(start).not.toHaveBeenCalled();
  expect(state).not.toHaveBeenCalled();
});

it.each(['missing_event', 'missing_snapshot', 'mismatching_amount'])('%s: ambiguous historical money records are not guessed or silently accepted', async defect => {
  const p = await oldIncompleteReceipt('job');
  if (defect === 'missing_event') await db.query('DELETE FROM payment_events WHERE payment_id=$1', [p.paymentId]);
  if (defect === 'missing_snapshot') await db.query('UPDATE fee_payment_receipts SET invoice_snapshot=NULL WHERE payment_id=$1', [p.paymentId]);
  if (defect === 'mismatching_amount') await db.query('UPDATE payment_sessions SET amount_huf=1000 WHERE payment_id=$1', [p.paymentId]);
  const sentry = vi.spyOn(require('@sentry/node'), 'captureMessage').mockImplementation(() => 'test');
  const result = await require('../src/services/feePaymentRecovery').recoverFeePaymentLedger();
  expect(result.needsReview).toBeGreaterThan(0);
  expect(sentry).toHaveBeenCalled();
  expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [p.paymentId])).rows[0].state).toBe('pending');
  expect((await db.query("SELECT 1 FROM payment_events WHERE payment_id=$1 AND status='Succeeded' AND processed", [p.paymentId])).rowCount).toBe(0);
});

it('a full page of records needing manual review does not block later ledger recovery or invoicing', async () => {
  const p = await oldIncompleteReceipt('job');
  const prefix = `aaa-review-${p.entity.id}-`;
  await db.query(`INSERT INTO fee_payment_receipts(payment_id,fee_huf,paid_at,invoice_pending)
    SELECT $1 || n, 500, NOW()-INTERVAL '3 minutes', FALSE FROM generate_series(1,50) n`, [prefix]);
  await db.query('DELETE FROM invoices WHERE job_id=$1', [p.entity.id]);
  await db.query('UPDATE fee_payment_receipts SET invoice_pending=TRUE,last_invoice_attempt_at=NULL WHERE payment_id=$1', [p.paymentId]);
  vi.spyOn(require('@sentry/node'), 'captureMessage').mockImplementation(() => 'test');
  try {
    await require('../src/services/feeInvoiceQueue').runPendingFeeInvoices();
    expect((await db.query('SELECT state FROM payment_sessions WHERE payment_id=$1', [p.paymentId])).rows[0].state).toBe('succeeded');
    expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id=$1', [p.paymentId])).rows[0].invoice_pending).toBe(false);
    expect((await db.query("SELECT 1 FROM invoices WHERE job_id=$1 AND status='sent'", [p.entity.id])).rowCount).toBe(1);
    expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE payment_id LIKE $1', [`${prefix}%`])).rowCount).toBe(50);
  } finally {
    await db.query('DELETE FROM fee_payment_receipts WHERE payment_id LIKE $1', [`${prefix}%`]);
  }
});
