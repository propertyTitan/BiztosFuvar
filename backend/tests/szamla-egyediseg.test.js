// =====================================================================
//  SZÁMLA-EGYEDISÉG — ügyletenként EGY számla, párhuzamos webhook mellett is
//
//  Audit 3. kör (2026-08-09). A `confirmFeePayment` nem tranzakcionális, és a
//  `payment_events` idempotencia-ellenőrzése csak a feldolgozás VÉGÉN írja ki
//  a `processed` flaget. A PSP-k rutinszerűen újraküldik a webhookot — két
//  PÁRHUZAMOS callback tehát mindkettő átment az ellenőrzésen, és MINDKETTŐ
//  kiállított volna egy valódi számlát a Számlázz.hu-n. Adóügyi dokumentumot
//  csak sztornóval lehet visszavonni, a vevő pedig két számlát kap ugyanarról
//  az 500 Ft-ról.
//
//  A védelem két rétegű: a 057-es migráció partial UNIQUE indexe (DB), és a
//  claim-sor a külső hívás ELŐTT (kód). Ez a suite mindkettőt méri.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db, createUser, createJob, createBooking } = require('./helpers');
const { generatePlatformFeeInvoice } = require('../src/services/invoicing');

async function szamlakSzama({ jobId, bookingId }) {
  const { rows } = await db.query(
    jobId
      ? `SELECT COUNT(*)::int AS c FROM invoices WHERE job_id = $1`
      : `SELECT COUNT(*)::int AS c FROM invoices WHERE booking_id = $1`,
    [jobId || bookingId],
  );
  return rows[0].c;
}

describe('Számla-generálás idempotenciája', () => {
  it('EGY fuvarhoz EGY számla, akkor is, ha 8 webhook fut egyszerre', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });

    // 8 párhuzamos kísérlet — ennyi kell, hogy a verseny valóban előálljon
    // (a kupon-double-spend vizsgálatnál 2 szál még „hamis zöldet" adott).
    const eredmenyek = await Promise.all(
      Array.from({ length: 8 }, () => generatePlatformFeeInvoice({
        jobId: job.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id,
      })),
    );

    expect(await szamlakSzama({ jobId: job.id }), 'DUPLA SZÁMLA: ugyanarról a díjról több adóügyi bizonylat készült!').toBe(1);
    // Minden hívó ugyanazt a számlát kapja vissza (nem null, nem eltérő id)
    const idk = new Set(eredmenyek.map((r) => r?.id));
    expect(idk.size).toBe(1);
    expect([...idk][0]).toBeTruthy();
  });

  it('a másodszori (soros) hívás sem állít ki új számlát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });

    const elso = await generatePlatformFeeInvoice({
      jobId: job.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id,
    });
    const masodik = await generatePlatformFeeInvoice({
      jobId: job.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id,
    });

    expect(masodik.id).toBe(elso.id);
    expect(await szamlakSzama({ jobId: job.id })).toBe(1);
  });

  it('a foglalási (Járat) ág is védett', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false,
    });

    await Promise.all(
      Array.from({ length: 6 }, () => generatePlatformFeeInvoice({
        bookingId: booking.id, platformFee: 1000, currency: 'HUF', buyerUserId: felado.id,
      })),
    );

    expect(await szamlakSzama({ bookingId: booking.id })).toBe(1);
  });

  it('két KÜLÖNBÖZŐ fuvar természetesen két számlát kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const a = await createJob({ shipperId: felado.id, status: 'accepted' });
    const b = await createJob({ shipperId: felado.id, status: 'accepted' });

    await generatePlatformFeeInvoice({ jobId: a.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id });
    await generatePlatformFeeInvoice({ jobId: b.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id });

    expect(await szamlakSzama({ jobId: a.id })).toBe(1);
    expect(await szamlakSzama({ jobId: b.id })).toBe(1);
  });

  it('a DB-index önmagában is véd: kézi INSERT-tel sem lehet második számla', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });
    await generatePlatformFeeInvoice({
      jobId: job.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id,
    });

    await expect(db.query(
      `INSERT INTO invoices (job_id, buyer_user_id, currency, net_amount, vat_amount, gross_amount, status)
       VALUES ($1, $2, 'HUF', 394, 106, 500, 'sent')`,
      [job.id, felado.id],
    )).rejects.toThrow();
  });

  it("sikertelen ('failed') kiállítás után lehet újrapróbálni", async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });

    // Kudarc-sor kézzel (ezt hagyja a provider-hiba ága)
    await db.query(
      `INSERT INTO invoices (job_id, buyer_user_id, currency, net_amount, vat_amount, gross_amount, status)
       VALUES ($1, $2, 'HUF', 394, 106, 500, 'failed')`,
      [job.id, felado.id],
    );

    const ujra = await generatePlatformFeeInvoice({
      jobId: job.id, platformFee: 500, currency: 'HUF', buyerUserId: felado.id,
    });
    expect(ujra, 'a failed sor blokkolta az újrapróbálkozást').toBeTruthy();
    expect(ujra.status).toBe('sent');
  });
});
