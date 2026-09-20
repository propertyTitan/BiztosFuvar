import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, seenOffer } = require('./helpers');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => vi.restoreAllMocks());

async function accept(job, carrier, shipper, amount) {
  const offer = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({ amount_huf: amount, return_policy: 'included' });
  expect(offer.status, JSON.stringify(offer.body)).toBe(201);
  const accepted = await request(app).post(`/bids/${offer.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(offer.body.id));
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
}

it.each([['job', false], ['job', true], ['booking', false], ['booking', true]])('%s invoice retry keeps payment-time buyer details; later profile change=%s', async (type, changed) => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  await db.query("UPDATE users SET account_type='company' WHERE id=$1", [shipper.id]);
  const original = { company_name: 'Eredeti Mintacég', tax_id: '12345678-1-42', billing_address: 'Budapest, Eredeti utca 1.' };
  const later = { company_name: 'Másik Mintacég', tax_id: '87654321-1-42', billing_address: 'Szeged, Másik utca 2.' };
  expect((await request(app).patch('/auth/me').set(...auth(shipper)).send(original)).status).toBe(200);
  const job = type === 'job' ? await createJob({ shipperId: shipper.id, status: 'bidding' })
    : (await createBooking({ shipperId: shipper.id, carrierId: carrier.id })).booking;
  if (type === 'job') await accept(job, carrier, shipper, 15000);
  const field = type === 'job' ? 'job_id' : 'booking_id';
  const path = `${type === 'job' ? '/jobs' : '/route-bookings'}/${job.id}`;
  expect((await request(app).post(`${path}/pay`).set(...auth(shipper)).send({ consent: true })).status).toBe(200);
  await db.query(`CREATE FUNCTION audit_post244_invoice_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary invoice insert failure'; END $$`);
  await db.query(`CREATE TRIGGER audit_post244_invoice_fault BEFORE INSERT ON invoices FOR EACH ROW WHEN (NEW.${field}='${job.id}'::uuid) EXECUTE FUNCTION audit_post244_invoice_fault()`);
  try {
    expect((await request(app).post(`${path}/confirm-payment`).set(...auth(shipper)).send({})).status).toBe(200);
  } finally { await db.query('DROP FUNCTION audit_post244_invoice_fault() CASCADE'); }
  const receipt = (await db.query(`SELECT * FROM fee_payment_receipts WHERE ${field}=$1`, [job.id])).rows[0];
  expect(receipt.invoice_pending).toBe(true);
  expect(receipt.invoice_snapshot.buyer).toMatchObject(original);
  if (changed) expect((await request(app).patch('/auth/me').set(...auth(shipper)).send(later)).status).toBe(200);
  await db.query('UPDATE fee_payment_receipts SET last_invoice_attempt_at=NULL WHERE payment_id=$1', [receipt.payment_id]);
  await require('../src/services/feeInvoiceQueue').runPendingFeeInvoices();
  const invoice = (await db.query(`SELECT buyer_name,buyer_tax_id,buyer_address,status FROM invoices WHERE ${field}=$1`, [job.id])).rows[0];
  expect(invoice.status).toBe('sent');
  const exported = await request(app).get('/auth/me/export').set(...auth(shipper));
  expect(exported.body.dijbefizeteseim.find(r => r.payment_id === receipt.payment_id).invoice_snapshot.buyer).toMatchObject(original);
  expect(invoice).toMatchObject({ buyer_name: original.company_name, buyer_tax_id: original.tax_id, buyer_address: original.billing_address });
});

it('the retry preserves the original VAT decision even if VIES or the profile changes', async () => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  await db.query("UPDATE users SET company_name='EU Mintacég',tax_id='DE123456789',billing_country='DE' WHERE id=$1", [shipper.id]);
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id });
  const fetch = global.fetch;
  const vies = vi.spyOn(global, 'fetch').mockImplementation((url, ...args) => String(url).includes('/vies/')
    ? Promise.resolve({ ok: true, json: async () => ({ isValid: true }) }) : fetch(url, ...args));
  const query = db.query;
  const fault = vi.spyOn(db, 'query').mockImplementation((sql, ...args) => {
    if (String(sql).includes('INSERT INTO invoices')) throw new Error('temporary invoice insert failure');
    return query(sql, ...args);
  });
  const payment = { entityType: 'job', entityId: job.id, shipperId: shipper.id,
    paymentId: `vat-snapshot-${job.id}`, feeHuf: 500, eventType: 'manual' };
  const first = await require('../src/services/feePayment').konyvelDijFizetes(payment);
  expect(first.vatResult).toMatchObject({ vatRate: 0, isReverseCharge: true });
  expect(vies.mock.calls.filter(([url]) => String(url).includes('/vies/'))).toHaveLength(1);
  fault.mockRestore();
  vies.mockImplementation((url, ...args) => {
    if (String(url).includes('/vies/')) throw new Error('VIES unavailable');
    return fetch(url, ...args);
  });
  await db.query("UPDATE users SET company_name='Új belföldi cég',tax_id='12345678-1-42',billing_country='HU' WHERE id=$1", [shipper.id]);
  const receipt = (await db.query('SELECT * FROM fee_payment_receipts WHERE payment_id=$1', [payment.paymentId])).rows[0];
  const invoice = await require('../src/services/feeInvoiceQueue').invoiceReceipt(receipt);
  expect(invoice).toMatchObject({ buyer_name: 'EU Mintacég', buyer_tax_id: 'DE123456789', buyer_country: 'DE', is_reverse_charge: true });
  expect(Number(invoice.vat_amount)).toBe(0);
  expect(vies.mock.calls.filter(([url]) => String(url).includes('/vies/'))).toHaveLength(1);
  const duplicate = await require('../src/services/feePayment').konyvelDijFizetes(payment);
  expect(duplicate.alreadyBooked).toBe(true);
  expect(duplicate.vatResult).toEqual(first.vatResult);
  const event = (await db.query('SELECT vat_amount,is_reverse_charge FROM payment_events WHERE payment_id=$1', [payment.paymentId])).rows[0];
  expect(event.is_reverse_charge).toBe(true);
  expect(Number(event.vat_amount)).toBe(0);
  expect((await db.query('SELECT 1 FROM invoices WHERE job_id=$1', [job.id])).rowCount).toBe(1);
});

it.each([false, true])('legacy receipt without snapshot: existing sent invoice=%s', async alreadySent => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id });
  const paymentId = `legacy-snapshot-${job.id}`;
  await require('../src/services/feePayment').konyvelDijFizetes({
    entityType: 'job', entityId: job.id, shipperId: shipper.id, paymentId, feeHuf: 500, eventType: 'manual',
  });
  await db.query('UPDATE fee_payment_receipts SET invoice_pending=TRUE,invoice_snapshot=NULL WHERE payment_id=$1', [paymentId]);
  if (!alreadySent) await db.query('DELETE FROM invoices WHERE job_id=$1', [job.id]);
  const receipt = (await db.query('SELECT * FROM fee_payment_receipts WHERE payment_id=$1', [paymentId])).rows[0];
  const invoicing = require('../src/services/feeInvoiceQueue').invoiceReceipt(receipt);
  if (alreadySent) expect((await invoicing).status).toBe('sent');
  else await expect(invoicing).rejects.toThrow('fizetéskori vevőadatai hiányoznak');
  expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id=$1', [paymentId])).rows[0].invoice_pending).toBe(!alreadySent);
  expect((await db.query('SELECT 1 FROM invoices WHERE job_id=$1', [job.id])).rowCount).toBe(alreadySent ? 1 : 0);
});
