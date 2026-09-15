import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { runPendingFeeInvoices } = require('../src/services/feeInvoiceQueue');
afterEach(() => vi.restoreAllMocks());
const callback = (id) => request(app).post('/payments/cib/callback').send({ PaymentId: id, Status: 'Succeeded' });

async function pendingJob() {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id });
  const paymentId = `recovery-${job.id}`;
  await db.query(`INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
    VALUES ($1, 500, 'held', $2, 0, 500)`, [job.id, paymentId]);
  return { shipper, carrier, job, paymentId };
}

describe('Audit 1 — fizetés helyreállítása', () => {
  it.each(['escrow_transactions', 'fee_payment_receipts'])('%s írási hibája visszavonja a paid_at-ot; az ismétlés teljesen könyvel', async table => {
    const { job, paymentId } = await pendingJob();
    await db.query(`CREATE FUNCTION audit_escrow_hiba() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit escrow hiba'; END $$;
      CREATE TRIGGER audit_escrow_hiba BEFORE ${table === 'escrow_transactions' ? 'UPDATE' : 'INSERT'} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION audit_escrow_hiba()`);
    try {
      expect((await callback(paymentId)).status).toBe(500);
      expect((await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id])).rows[0].paid_at).toBeNull();
      expect((await db.query('SELECT * FROM fee_payment_receipts WHERE payment_id = $1', [paymentId])).rowCount).toBe(0);
    } finally {
      await db.query(`DROP TRIGGER audit_escrow_hiba ON ${table}; DROP FUNCTION audit_escrow_hiba()`);
    }
    const retry = await callback(paymentId);
    expect(retry.status).toBe(200);
    expect(retry.body.orphan).not.toBe(true);
    expect((await db.query('SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id])).rows[0].status).toBe('released');
    expect((await db.query("SELECT * FROM invoices WHERE job_id = $1 AND status = 'sent'", [job.id])).rowCount).toBe(1);
  });

  it('a napló kiesése után ugyanaz a könyvelt fizetés nem válik árvává', async () => {
    const { job, paymentId } = await pendingJob();
    const original = db.query.bind(db);
    const spy = vi.spyOn(db, 'query').mockImplementation((sql, args) => {
      if (/INSERT INTO payment_events/i.test(sql)) throw new Error('audit naplóhiba');
      return original(sql, args);
    });
    expect((await callback(paymentId)).status).toBe(200);
    spy.mockRestore();
    const retry = await callback(paymentId);
    expect(retry.status).toBe(200);
    expect(retry.body.orphan).not.toBe(true);
    expect((await db.query('SELECT * FROM invoices WHERE job_id = $1', [job.id])).rowCount).toBe(1);
    expect((await db.query('SELECT event_type, processed FROM payment_events WHERE payment_id = $1', [paymentId])).rows[0])
      .toMatchObject({ event_type: 'webhook', processed: true });
  });

  it('a számla létrehozásának hibája tartós feladat marad, és a következő kör pótolja', async () => {
    const { job, paymentId } = await pendingJob();
    const original = db.query.bind(db);
    const spy = vi.spyOn(db, 'query').mockImplementation((sql, args) => {
      if (/INSERT INTO invoices/i.test(sql)) throw new Error('audit számlahiba');
      return original(sql, args);
    });
    expect((await callback(paymentId)).status).toBe(200);
    spy.mockRestore();
    expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id = $1', [paymentId])).rows[0].invoice_pending).toBe(true);
    await db.query("UPDATE fee_payment_receipts SET last_invoice_attempt_at = NOW() - INTERVAL '11 minutes' WHERE payment_id = $1", [paymentId]);
    await runPendingFeeInvoices();
    expect((await db.query("SELECT * FROM invoices WHERE job_id = $1 AND status = 'sent'", [job.id])).rowCount).toBe(1);
    expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id = $1', [paymentId])).rows[0].invoice_pending).toBe(false);
    await runPendingFeeInvoices();
    expect((await db.query('SELECT * FROM invoices WHERE job_id = $1', [job.id])).rowCount).toBe(1);
  });

  it('a foglalás fizetése is kap helyreállítási bizonylatot; az ismétlés nem dupláz', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id });
    const id = `recovery-booking-${booking.id}`;
    await db.query('UPDATE route_bookings SET barion_payment_id = $1, connection_fee_huf = 500 WHERE id = $2', [id, booking.id]);
    expect((await callback(id)).status).toBe(200);
    expect((await callback(id)).body.skipped).toBe(true);
    expect((await db.query('SELECT * FROM fee_payment_receipts WHERE booking_id = $1', [booking.id])).rowCount).toBe(1);
  });

  it('bizonytalan külső számlázásnál riaszt, és nem állít ki automatikusan új számlát', async () => {
    const { job, paymentId } = await pendingJob();
    expect((await callback(paymentId)).status).toBe(200);
    await db.query("UPDATE invoices SET status = 'pending' WHERE job_id = $1", [job.id]);
    await db.query("UPDATE fee_payment_receipts SET invoice_pending = TRUE, last_invoice_attempt_at = NOW() - INTERVAL '11 minutes' WHERE payment_id = $1", [paymentId]);
    const sentry = vi.spyOn(require('@sentry/node'), 'captureMessage').mockImplementation(() => 'test');
    expect((await runPendingFeeInvoices()).failed).toBeGreaterThan(0);
    expect(sentry).toHaveBeenCalled();
    expect((await db.query('SELECT * FROM invoices WHERE job_id = $1', [job.id])).rowCount).toBe(1);
    expect((await db.query('SELECT invoice_pending FROM fee_payment_receipts WHERE payment_id = $1', [paymentId])).rows[0].invoice_pending).toBe(true);
  });

  it('a díjbizonylat csak a fizető saját adatexportjába kerül', async () => {
    const { shipper, carrier, job, paymentId } = await pendingJob();
    expect((await callback(paymentId)).status).toBe(200);
    const sajat = await request(app).get('/auth/me/export').set('Authorization', `Bearer ${shipper.token}`);
    expect(sajat.status).toBe(200);
    expect(sajat.body.dijbefizeteseim).toEqual([
      expect.objectContaining({ payment_id: paymentId, job_id: job.id, fee_huf: 500, invoice_pending: false }),
    ]);
    const masik = await request(app).get('/auth/me/export').set('Authorization', `Bearer ${carrier.token}`);
    expect(masik.status).toBe(200);
    expect(masik.body.dijbefizeteseim).toEqual([]);
  });

  it('a nyolcéves megőrzés csak a lejárt díjbizonylatot törli', async () => {
    const regi = await pendingJob();
    const friss = await pendingJob();
    expect((await callback(regi.paymentId)).status).toBe(200);
    expect((await callback(friss.paymentId)).status).toBe(200);
    await db.query("UPDATE fee_payment_receipts SET paid_at = NOW() - INTERVAL '8 years 1 day' WHERE payment_id = $1", [regi.paymentId]);
    await require('../src/services/retention').purgeOldInvoices();
    expect((await db.query('SELECT * FROM fee_payment_receipts WHERE payment_id = $1', [regi.paymentId])).rowCount).toBe(0);
    expect((await db.query('SELECT * FROM fee_payment_receipts WHERE payment_id = $1', [friss.paymentId])).rowCount).toBe(1);
  });
});
