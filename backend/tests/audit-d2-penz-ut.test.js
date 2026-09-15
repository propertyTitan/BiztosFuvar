const { seenOffer } = require('./helpers');
// =====================================================================
//  TELJES AUDIT — D2 csomag (2026-09-13): a pénz-út P1-jei
//   1. Díjmentesen újranyitott (bidding) fuvarra késve érkező fizetés
//      KÖNYVELŐDIK (nem árva) — a következő elfogadás díjmentes.
//   2. Az azonnali elfogadás a már fizetett (újranyitott) fuvaron NEM indít
//      új fizetést, nem írja felül a díjat, nem írja vissza a díj-sort.
//   3. Sikeres fizetés ismeretlen PaymentId-vel → Sentry error.
//   4. Vita csak fizetett, várakozó/futó/lezárt ügyleten; a lemondott→vitás
//      fuvar nem könyvelhető a hátsó ajtón.
//  Minden teszt a javítás NÉLKÜL igazoltan piros (lásd a PR-t).
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const paymentProvider = require('../src/services/paymentProvider');
const realtime = require('../src/realtime');
const Sentry = require('@sentry/node');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const webhook = (body) => request(app).post('/payments/cib/callback').send(body);

afterEach(() => vi.restoreAllMocks());

/** Elfogadott, fizetetlen fuvar nyitott PSP-munkamenettel (a webhook így találja meg). */
async function fizetesreVaro({ status = 'accepted' } = {}) {
  __resetRateLimitsForTests();
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status, paid: false, priceHuf: 15000 });
  const paymentId = `teszt-pay-${job.id}`;
  await db.query(
    `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
     VALUES ($1, 500, 'held', $2, 0, 500)`,
    [job.id, paymentId],
  );
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  return { felado, szallito, job, paymentId };
}

describe('D2/1 — újranyitott fuvarra érkező fizetés könyvelődik', () => {
  it('szállító lemond (reopen → bidding) → a régi munkamenet Succeeded webhookja: paid_at beáll, díj-sor released, a következő elfogadás díjmentes', async () => {
    const { felado, szallito, job, paymentId } = await fizetesreVaro();
    const masik = await createUser({ role: 'carrier' });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status) VALUES ($1, $2, 15000, 'accepted'), ($1, $3, 14000, 'pending')`,
      [job.id, szallito.id, masik.id],
    );
    // A feladó a banki oldalon áll; közben a szállító visszalép → díjmentes újranyitás
    const lemond = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(szallito.token)).send({});
    expect(lemond.status, JSON.stringify(lemond.body)).toBe(200);
    expect(lemond.body.reopened).toBe(true);
    const { rows: ujra } = await db.query('SELECT status, reopened_count, paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(ujra[0].status).toBe('bidding');
    expect(ujra[0].reopened_count).toBe(1);

    // A feladó befejezi a fizetést a RÉGI munkameneten
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.orphan, 'az újranyitott fuvarra érkező fizetés ÁRVA lett — a feladó másodszor is fizetne').toBeUndefined();
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a paid_at nem állt be az újranyitott fuvaron').not.toBeNull();
    const { rows: esc } = await db.query('SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(esc[0].status).toBe('released');

    // A következő elfogadás díjmentes — nincs második munkamenet
    const { rows: bidRows } = await db.query(
      `SELECT id FROM bids WHERE job_id = $1 AND carrier_id = $2`, [job.id, masik.id],
    );
    const elfogad = await request(app).post(`/bids/${bidRows[0].id}/accept`).send(await seenOffer(bidRows[0].id)).set(auth(felado.token));
    expect(elfogad.status, JSON.stringify(elfogad.body)).toBe(200);
    expect(elfogad.body.fee_already_paid, 'a feladót másodszor is fizetésre szólítottuk').toBe(true);
    const { rows: esc2 } = await db.query('SELECT status, barion_payment_id FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(esc2[0].status).toBe('released');
    expect(esc2[0].barion_payment_id).toBe(paymentId);
  });

  it('nem újranyitott (friss) bidding fuvarra a fizetés továbbra is árva', async () => {
    const { job, paymentId } = await fizetesreVaro({ status: 'bidding' });
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBe(200);
    expect(res.body.orphan, 'reopen nélküli bidding fuvarra nem szabad könyvelni').toBe(true);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).toBeNull();
  });
});

describe('D2/4b — a lemondott→vitás fuvar nem könyvelhető', () => {
  it('disputed (status_before_dispute = cancelled) Succeeded webhookja árva; disputed (accepted) könyvel', async () => {
    const a = await fizetesreVaro();
    await db.query(
      `UPDATE jobs SET status = 'disputed', status_before_dispute = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [a.job.id],
    );
    const r1 = await webhook({ PaymentId: a.paymentId, Status: 'Succeeded' });
    expect(r1.status).toBe(200);
    expect(r1.body.orphan, 'a lemondott fuvar a vita hátsó ajtaján fizetetté vált').toBe(true);
    expect((await db.query('SELECT paid_at FROM jobs WHERE id = $1', [a.job.id])).rows[0].paid_at).toBeNull();

    const b = await fizetesreVaro();
    await db.query(`UPDATE jobs SET status = 'disputed', status_before_dispute = 'accepted' WHERE id = $1`, [b.job.id]);
    const r2 = await webhook({ PaymentId: b.paymentId, Status: 'Succeeded' });
    expect(r2.status).toBe(200);
    expect(r2.body.orphan).toBeUndefined();
    expect((await db.query('SELECT paid_at FROM jobs WHERE id = $1', [b.job.id])).rows[0].paid_at).not.toBeNull();
  });
});

describe('D2/2 — azonnali elfogadás a már fizetett, újranyitott fuvaron', () => {
  it('nincs új munkamenet, a kuponos 0 Ft díj marad, a released díj-sor marad, a feladó nem kap fizetési felhívást', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallitoA = await createUser({ role: 'carrier' });
    const szallitoB = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', priceHuf: 12000 });
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '2 hours', carrier_id = NULL WHERE id = $1`,
      [job.id],
    );
    const elso = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(szallitoA.token)).send({ expected_price_huf: job.suggested_price_huf });
    expect(elso.status, JSON.stringify(elso.body)).toBe(200);
    expect(elso.body.fee_already_paid).toBe(false);
    // A feladó KUPONNAL fizet (0 Ft): paid_at + díj 0 + a díj-sor released
    await db.query(
      `UPDATE jobs SET paid_at = NOW(), fee_consent_at = NOW(), connection_fee_huf = 0 WHERE id = $1`, [job.id],
    );
    await db.query(`UPDATE escrow_transactions SET status = 'released', released_at = NOW() WHERE job_id = $1`, [job.id]);
    const { rows: escElott } = await db.query('SELECT barion_payment_id FROM escrow_transactions WHERE job_id = $1', [job.id]);

    // A szállító visszalép → díjmentes újranyitás (is_instant marad)
    const lemond = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(szallitoA.token)).send({});
    expect(lemond.body.reopened).toBe(true);

    const start = vi.spyOn(paymentProvider, 'startFeePayment');
    const emit = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});
    const masodik = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(szallitoB.token)).send({ expected_price_huf: job.suggested_price_huf });
    expect(masodik.status, JSON.stringify(masodik.body)).toBe(200);
    expect(masodik.body.fee_already_paid, 'az azonnali ág nem ismerte fel a már rendezett díjat').toBe(true);
    expect(masodik.body.connection_fee_huf, 'a kuponos 0 Ft díjat felülírtuk').toBe(0);
    expect(start, 'új PSP-munkamenet indult egy már fizetett fuvarra').not.toHaveBeenCalled();

    const { rows } = await db.query('SELECT paid_at, connection_fee_huf, carrier_id FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
    expect(Number(rows[0].connection_fee_huf)).toBe(0);
    expect(rows[0].carrier_id).toBe(szallitoB.id);
    const { rows: esc } = await db.query('SELECT status, barion_payment_id FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(esc[0].status, 'a kifizetett díj-sor visszaíródott held-re').toBe('released');
    expect(esc[0].barion_payment_id).toBe(escElott[0].barion_payment_id);

    const elfogadas = emit.mock.calls.find((c) => c[1] === 'job:accepted');
    expect(elfogadas[2].barion_gateway_url, 'fizetési link ment a feladónak egy rendezett díjra').toBeNull();
    expect(elfogadas[2].fee_already_paid).toBe(true);
    const { rows: notif } = await db.query(
      `SELECT body FROM notifications WHERE user_id = $1 AND type = 'instant_accepted' ORDER BY created_at DESC LIMIT 1`, [felado.id],
    );
    expect(notif[0].body).not.toMatch(/Fizesd meg/);
    expect(notif[0].body).toMatch(/már korábban megfizetted/);
  });
});

describe('D2/3 — ismeretlen PaymentId', () => {
  it('Succeeded webhook ismeretlen azonosítóval → 200 + Sentry error; sikertelen státusznál nincs riasztás', async () => {
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    const r = await webhook({ PaymentId: `ismeretlen-${Date.now()}`, Status: 'Succeeded' });
    expect(r.status).toBe(200);
    expect(r.body.unknown).toBe(true);
    expect(capture, 'a beérkezett, nem könyvelt pénzről senki nem értesült').toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].level).toBe('error');
    capture.mockClear();
    const r2 = await webhook({ PaymentId: `ismeretlen-${Date.now()}-b`, Status: 'Canceled' });
    expect(r2.status).toBe(200);
    expect(capture, 'sikertelen státuszú ismeretlen id nem pénz-eltérés').not.toHaveBeenCalled();
  });
});

describe('D2/4 — vita csak fizetett, értelmes állapotú ügyleten', () => {
  const nyit = (token, body) => request(app).post('/disputes').set(auth(token)).send({ description: 'Gond van.', ...body });

  it('fizetetlen elfogadott fuvaron a szállító nem fagyaszthatja be a feladót (409), nyitott hirdetésen sem', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const fizetetlen = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    const r = await nyit(szallito.token, { job_id: fizetetlen.id });
    expect(r.status, 'fizetés előtt egy kattintással befagyasztható volt a fuvar').toBe(409);
    expect(r.body.code).toBe('DISPUTE_NOT_ALLOWED');
    expect((await db.query('SELECT status FROM jobs WHERE id = $1', [fizetetlen.id])).rows[0].status).toBe('accepted');

    const hirdetes = await createJob({ shipperId: felado.id, status: 'bidding' });
    const r2 = await nyit(felado.token, { job_id: hirdetes.id });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('DISPUTE_NOT_ALLOWED');
  });

  it('fizetett futó és fizetett LEMONDOTT fuvaron nyitható (a mátrix szabálya marad)', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const futo = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    expect((await nyit(felado.token, { job_id: futo.id })).status).toBe(201);
    const lemondott = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'cancelled', paid: true });
    expect((await nyit(szallito.token, { job_id: lemondott.id })).status).toBe(201);
  });

  it('foglalás: fizetetlen confirmed → 409; fizetett → 201', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const { booking: fizetetlen } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false });
    const r = await nyit(szallito.token, { booking_id: fizetetlen.id });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DISPUTE_NOT_ALLOWED');
    const { booking: fizetett } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true });
    expect((await nyit(felado.token, { booking_id: fizetett.id })).status).toBe(201);
  });
});
