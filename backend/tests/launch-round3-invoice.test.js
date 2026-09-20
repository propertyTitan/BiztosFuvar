import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, seenOffer } = require('./helpers');
const { runPendingFeeInvoices } = require('../src/services/feeInvoiceQueue');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => vi.restoreAllMocks());

it('átmeneti számlahiba után a törlés megőrzi a vevőt, a pótlás után engedett', async () => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({ amount_huf: 20000, return_policy: 'included' });
  expect(bid.status).toBe(201);
  expect((await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(bid.body.id))).status).toBe(200);
  expect((await request(app).post(`/jobs/${job.id}/pay`).set(...auth(shipper)).send({ consent: true })).status).toBe(200);
  await db.query(`CREATE FUNCTION round3_invoice_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary invoice insert failure'; END $$`);
  await db.query(`CREATE TRIGGER round3_invoice_fault BEFORE INSERT ON invoices FOR EACH ROW WHEN (NEW.job_id='${job.id}'::uuid) EXECUTE FUNCTION round3_invoice_fault()`);
  try {
    expect((await request(app).post(`/jobs/${job.id}/confirm-payment`).set(...auth(shipper)).send({})).status).toBe(200);
  } finally { await db.query('DROP FUNCTION round3_invoice_fault() CASCADE'); }
  expect((await db.query('SELECT 1 FROM invoices WHERE job_id=$1', [job.id])).rowCount).toBe(0);
  expect((await request(app).post(`/jobs/${job.id}/cancel`).set(...auth(shipper)).send({})).status).toBe(200);
  const blocked = await request(app).delete('/auth/me').set(...auth(shipper));
  expect(blocked.status).toBe(409); expect(blocked.body.error).toContain('számlázás');
  const receipt = (await db.query('SELECT * FROM fee_payment_receipts WHERE job_id=$1', [job.id])).rows[0];
  expect(receipt).toMatchObject({ shipper_id: shipper.id, invoice_pending: true });
  await db.query('UPDATE fee_payment_receipts SET last_invoice_attempt_at=NULL WHERE payment_id=$1', [receipt.payment_id]);
  await runPendingFeeInvoices();
  await runPendingFeeInvoices();
  const invoices = (await db.query('SELECT * FROM invoices WHERE job_id=$1', [job.id])).rows;
  expect(invoices).toHaveLength(1); expect(invoices[0].status).toBe('sent');
  expect((await request(app).delete('/auth/me').set(...auth(shipper))).status).toBe(200);
  expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id=$1', [receipt.payment_id])).rows[0].invoice_pending).toBe(false);
});

it.each(['job', 'booking', 'route'])('%s: admin sem törölhet függő díjszámla mellől', async type => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' }), admin = await createUser({ role: 'admin' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id };
  const booking = type === 'job' ? null : await createBooking({ ...opts, status: 'confirmed' });
  const entity = booking?.booking || await createJob({ ...opts, status: 'accepted' });
  const field = type === 'job' ? 'job_id' : 'booking_id';
  await require('../src/services/feePayment').konyvelDijFizetes({
    entityType: type === 'job' ? 'job' : 'booking', entityId: entity.id,
    shipperId: shipper.id, paymentId: `round3-${entity.id}`, feeHuf: 500, eventType: 'manual',
  });
  // Valós könyvelés hozza létre a fizetéskori snapshotot. A törlési őr
  // tesztjéhez ezután egy hiányzó számla miatti függő feladatot állítunk be.
  await db.query(`DELETE FROM invoices WHERE ${field}=$1`, [entity.id]);
  await db.query('UPDATE fee_payment_receipts SET invoice_pending=TRUE WHERE payment_id=$1', [`round3-${entity.id}`]);
  await db.query(`UPDATE ${type === 'job' ? 'jobs' : 'route_bookings'} SET status='delivered' WHERE id=$1`, [entity.id]);
  const path = `/admin/${{ job: 'jobs', booking: 'bookings', route: 'routes' }[type]}/${type === 'route' ? booking.routeId : entity.id}`;
  expect((await request(app).delete(path).set(...auth(admin))).status).toBe(409);
  expect((await request(app).delete(`/admin/users/${shipper.id}`).set(...auth(admin))).status).toBe(409);
  if (booking) expect((await request(app).delete('/auth/me').set(...auth(carrier))).status).toBe(409);
  await db.query('UPDATE fee_payment_receipts SET last_invoice_attempt_at=NULL WHERE payment_id=$1', [`round3-${entity.id}`]);
  await runPendingFeeInvoices();
  expect((await request(app).delete(path).set(...auth(admin))).status).toBe(200);
});
