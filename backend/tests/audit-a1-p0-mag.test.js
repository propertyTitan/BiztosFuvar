// =====================================================================
//  TELJES AUDIT — A1 csomag (2026-09-11): a backend P0-mag négy őre
//   1. Késleltetett fizetési webhook LEMONDOTT fuvarra nem könyvel.
//   2. Kuponos (0 Ft) fuvar újraválasztás után nem válik „fizetetté".
//   3. Szállítói dashboard + adatexport: utca-szint a díj előtt.
//   4. Foglalás-felvétel: a közben lemondott foglalás nem támad fel.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, TINY_PNG, seenOffer } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const webhook = (body) => request(app).post('/payments/cib/callback').send(body);

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

describe('1. webhook: lemondott fuvarra nem könyvel', () => {
  it('cancelled fuvar Succeeded webhookja: paid_at marad NULL, árva napló, nincs értesítés', async () => {
    const { job, paymentId, szallito } = await fizetesreVaro();
    // A feladó lemondja (a díj-sor 'refunded' lesz, a PSP-nél viszont a fizetés fut tovább)
    await db.query(`UPDATE jobs SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [job.id]);
    await db.query(`UPDATE escrow_transactions SET status = 'refunded' WHERE job_id = $1`, [job.id]);
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.orphan, 'a webhook nem jelezte árvának a lemondott fuvarra érkezett fizetést').toBe(true);
    const { rows } = await db.query('SELECT paid_at, status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'LEMONDOTT fuvar lett fizetetté').toBeNull();
    expect(rows[0].status).toBe('cancelled');
    const { rows: ev } = await db.query('SELECT processed, summary, event_type FROM payment_events WHERE payment_id = $1', [paymentId]);
    expect(ev.length).toBe(1);
    // processed=true (végleges: nem próbáljuk újra), de event_type='orphan' + ÁRVA
    // összefoglaló — az admin naplójában és az ajánlói őrben így különül el.
    expect(ev[0].processed).toBe(true);
    expect(ev[0].event_type).toBe('orphan');
    expect(ev[0].summary).toMatch(/ÁRVA/);
    const { rows: notif } = await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'job_paid'`, [szallito.id]);
    expect(notif.length, 'a szállító „Indulhat a fuvar!" értesítést kapott egy lemondott fuvarra').toBe(0);
  });

  it('kontroll: accepted fuvar Succeeded webhookja könyvel', async () => {
    const { job, paymentId } = await fizetesreVaro();
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBe(200);
    expect(res.body.orphan).toBeUndefined();
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
  });
});

describe('2. kuponos fuvar újraválasztása', () => {
  it('a 0 Ft-os díj újraválasztás után is 0 marad (nem lesz „valódi" fizetés)', async () => {
    const felado = await createUser();
    const elso = await createUser({ role: 'carrier' });
    const masodik = await createUser({ role: 'carrier' });
    // kuponnal „fizetett" fuvar: paid_at van, díj 0
    const job = await createJob({ shipperId: felado.id, carrierId: elso.id, status: 'accepted', paid: true });
    await db.query(`UPDATE jobs SET connection_fee_huf = 0 WHERE id = $1`, [job.id]);
    // a szállító visszalép → díjmentes újranyitás (a valódi végpont)
    const cancel = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(elso.token)).send({ reason: 'nem érek rá' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    // új ajánlat + elfogadás
    const { rows: bid } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 60000, 'pending', 'included') RETURNING id`,
      [job.id, masodik.id],
    );
    const acc = await request(app).post(`/bids/${bid[0].id}/accept`).send(await seenOffer(bid[0].id)).set(auth(felado.token));
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const { rows } = await db.query('SELECT connection_fee_huf, paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(Number(rows[0].connection_fee_huf), 'a kuponos 0 Ft-os díj újraválasztáskor 500/1000-re íródott át').toBe(0);
    expect(rows[0].paid_at).not.toBeNull();
  });
});

describe('3. szállítói dashboard + export: utca-szint a díj előtt', () => {
  it('accepted + fizetetlen fuvarnál nincs házszám; fizetés után van', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
      pickupAddress: 'Budapest, Váci út 12., 1134',
    });
    let dash = await request(app).get('/auth/me/driver-dashboard').set(auth(szallito.token));
    expect(dash.status, JSON.stringify(dash.body)).toBe(200);
    let sor = (dash.body.active_jobs || dash.body.activeJobs || []).find((j) => j.id === job.id);
    expect(sor, 'nincs a fuvar a dashboardon').toBeTruthy();
    expect(sor.pickup_address, 'HÁZSZÁM a szállítói dashboardon fizetés előtt').not.toMatch(/\b12\b/);
    let exp = await request(app).get('/auth/me/export').set(auth(szallito.token));
    expect(exp.status).toBe(200);
    let e = exp.body.vallalt_fuvarok.find((j) => j.id === job.id);
    expect(e.pickup_address, 'HÁZSZÁM az exportban fizetés előtt').not.toMatch(/\b12\b/);

    await db.query('UPDATE jobs SET paid_at = NOW() WHERE id = $1', [job.id]);
    dash = await request(app).get('/auth/me/driver-dashboard').set(auth(szallito.token));
    sor = (dash.body.active_jobs || dash.body.activeJobs || []).find((j) => j.id === job.id);
    expect(sor.pickup_address, 'fizetés UTÁN a pontos cím jár').toMatch(/12/);
    exp = await request(app).get('/auth/me/export').set(auth(szallito.token));
    e = exp.body.vallalt_fuvarok.find((j) => j.id === job.id);
    expect(e.pickup_address).toMatch(/12/);
  });
});

describe('4. foglalás-felvétel: a közben lemondott foglalás nem támad fel', () => {
  it('SELECT után lemondva → 409 STATE_CHANGED, status marad cancelled', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true });
    const eredeti = db.query;
    let megtortent = false;
    db.query = async (text, p) => {
      const r = await eredeti(text, p);
      if (!megtortent && /FROM route_bookings/.test(String(text)) && /WHERE .*id = \$1/.test(String(text))) {
        megtortent = true;
        await eredeti(`UPDATE route_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [booking.id]);
      }
      return r;
    };
    try {
      const res = await request(app).post(`/route-bookings/${booking.id}/photos`).set(auth(szallito.token))
        .field('kind', 'pickup').attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' });
      expect(megtortent, 'a szimulált verseny nem futott le').toBe(true);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe('STATE_CHANGED');
    } finally {
      db.query = eredeti;
    }
    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status, 'a lemondott foglalás in_progress lett').toBe('cancelled');
  });
});
