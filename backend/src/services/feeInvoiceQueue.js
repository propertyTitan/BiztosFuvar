// A könyvelt díj számlázási feladata a fizetési tranzakcióban jön létre.
// Külső számlázóhívást nem tartunk adatbázis-tranzakcióban.
const db = require('../db');
const { generatePlatformFeeInvoice } = require('./invoicing');
const { jelezSorHibak } = require('./utemezo');

async function invoiceReceipt(receipt) {
  if (!receipt.invoice_pending) return null;
  if (!receipt.shipper_id || (!receipt.job_id && !receipt.booking_id)) {
    throw new Error('A függő díjszámla vevőjét vagy ügyletét kézzel kell egyeztetni.');
  }
  const { rows } = await db.query(
    `SELECT * FROM invoices WHERE job_id = $1 OR booking_id = $2
      ORDER BY (status = 'sent') DESC, created_at DESC LIMIT 1`,
    [receipt.job_id, receipt.booking_id],
  );
  // Megszakadt külső hívás után nem tudjuk, kiállt-e a számla. A meglévő
  // pending/failed számlát nem küldjük ki vakon újra: operátori egyeztetés kell.
  let invoice = rows[0];
  if (invoice && invoice.status !== 'sent') {
    throw new Error('A megkezdett díjszámla állapota bizonytalan; számlázói egyeztetés szükséges.');
  }
  if (!invoice) {
    if (!receipt.invoice_snapshot) {
      throw new Error('A régi díjbizonylat fizetéskori vevőadatai hiányoznak; kézi számlázási egyeztetés szükséges.');
    }
    invoice = await generatePlatformFeeInvoice({
      jobId: receipt.job_id, bookingId: receipt.booking_id,
      platformFee: receipt.fee_huf, currency: receipt.currency,
      buyerUserId: receipt.shipper_id,
      invoiceSnapshot: receipt.invoice_snapshot,
    });
  }
  if (invoice?.status !== 'sent') throw new Error('A díjszámla még nincs kiállítva.');
  await db.query('UPDATE fee_payment_receipts SET invoice_pending = FALSE WHERE payment_id = $1', [receipt.payment_id]);
  return invoice;
}

async function runPendingFeeInvoices() {
  // A foglalás rövid, atomi UPDATE: több példány sem dolgozza fel ugyanazt
  // a sort egyidejűleg. Összeomlás után tíz perc múlva újra próbálható.
  const { rows } = await db.query(
    `UPDATE fee_payment_receipts SET last_invoice_attempt_at = NOW()
      WHERE payment_id IN (
        SELECT payment_id FROM fee_payment_receipts WHERE invoice_pending
          AND (last_invoice_attempt_at IS NULL OR last_invoice_attempt_at < NOW() - INTERVAL '10 minutes')
        ORDER BY paid_at LIMIT 50 FOR UPDATE SKIP LOCKED
      ) RETURNING *`,
  );
  const errors = [];
  for (const receipt of rows) {
    try { await invoiceReceipt(receipt); } catch (err) { errors.push(err); }
  }
  jelezSorHibak('fee-invoices', errors);
  return { attempted: rows.length, failed: errors.length };
}

module.exports = { invoiceReceipt, runPendingFeeInvoices };
