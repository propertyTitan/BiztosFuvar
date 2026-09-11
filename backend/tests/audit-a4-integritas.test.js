// =====================================================================
//  TELJES AUDIT — A4 csomag (2026-09-11): integritás + elakadt ügyletek
//   1. Vita: XOR (pontosan egy ügylet) + egyszerre EGY nyitott vita (DB-szinten is).
//   2. Ajánlat-visszavonás: POST /bids/:id/withdraw; a reopen nem éleszti újra.
//   3. Fizetetlen megállapodás lejáratása 2 emlékeztető + 72 h után.
//   4. FK-k: a törölt értékelő csillaga marad (szöveg nélkül), a díj-sor túléli a fuvar törlését.
//   5. Sugár-keresés az SQL-ben (a LIMIT 200 nem vágja le a közeli, régebbi fuvart).
//   6. Fotó-plafon típusonként.
//   7. Címzetti e-mail: feladáskor KÓD NÉLKÜL, felvételkor kóddal + szállítóval.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const emailSzolgaltatas = require('../src/services/email');
const { runPaymentReminders, runPaymentExpiry, EXPIRE_AFTER_HOURS, MAX_REMINDERS } = require('../src/services/paymentReminders');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
async function varakozz(feltetel, ms = 4000) {
  const vege = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await feltetel()) return true;
    if (Date.now() > vege) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 40));
  }
}
const ertesitesek = async (userId, tipus) => (await db.query(
  'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2', [userId, tipus],
)).rows[0].n;

afterEach(() => { vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────
describe('1. vita: XOR + egy nyitott vita', () => {
  async function vitazhato() {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    return { felado, szallito, job, booking };
  }
  const nyit = (token, body) => request(app).post('/disputes').set(auth(token)).send(body);

  it('mindkét azonosítóval → 400; a DB a kettős sort sem engedi', async () => {
    const { felado, job, booking } = await vitazhato();
    const r = await nyit(felado.token, { job_id: job.id, booking_id: booking.id, description: 'Sérült csomag.' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('DISPUTE_ENTITY_XOR');
    await expect(db.query(
      `INSERT INTO disputes (job_id, booking_id, opened_by, description) VALUES ($1, $2, $3, 'x')`,
      [job.id, booking.id, felado.id],
    )).rejects.toThrow(/disputes_entitas_xor|check constraint/i);
  });

  it('öt párhuzamos nyitás ugyanarra a fuvarra: pontosan EGY 201, a többi 409; a DB-ben egy nyitott sor', async () => {
    const { felado, job } = await vitazhato();
    const valaszok = await Promise.all(Array.from({ length: 5 }, () => nyit(felado.token, { job_id: job.id, description: 'Sérült csomag érkezett.' })));
    const kodok = valaszok.map((r) => r.status).sort();
    expect(kodok.filter((k) => k === 201).length, `válaszok: ${kodok.join(',')}`).toBe(1);
    expect(kodok.filter((k) => k === 409).length).toBe(4);
    const { rows } = await db.query(`SELECT count(*)::int n FROM disputes WHERE job_id = $1 AND status IN ('open','under_review')`, [job.id]);
    expect(rows[0].n, 'párhuzamos nyitásból több nyitott vita lett').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('2. ajánlat visszavonása', () => {
  async function licites() {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const a = await createUser({ role: 'carrier' });
    const b = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = async (carrier, status = 'pending') => (await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 12000, $3, 'included') RETURNING id`,
      [job.id, carrier.id, status],
    )).rows[0].id;
    return { felado, a, b, job, bid };
  }
  const withdraw = (token, id) => request(app).post(`/bids/${id}/withdraw`).set(auth(token)).send({});

  it('a saját függő ajánlat visszavonható; a feladó értesül; más 403; elfogadott 409', async () => {
    const { felado, a, b, job, bid } = await licites();
    const idA = await bid(a);
    expect((await withdraw(b.token, idA)).status, 'idegen szállító visszavonhatta más ajánlatát').toBe(403);
    const r = await withdraw(a.token, idA);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const { rows } = await db.query('SELECT status FROM bids WHERE id = $1', [idA]);
    expect(rows[0].status).toBe('withdrawn');
    expect(await varakozz(async () => (await ertesitesek(felado.id, 'bid_withdrawn')) === 1)).toBe(true);
    expect((await withdraw(a.token, idA)).status, 'a már visszavont ajánlat újra visszavonható').toBe(409);
    // elfogadott ajánlat: nem itt, hanem a fuvar-lemondáson át
    const idB = await bid(b, 'accepted');
    await db.query(`UPDATE jobs SET status = 'accepted', carrier_id = $2 WHERE id = $1`, [job.id, b.id]);
    const r2 = await withdraw(b.token, idB);
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('BID_NOT_PENDING');
  });

  it('szállító-csere (reopen) után a VISSZAVONT ajánlat nem éled újra, az elutasított igen', async () => {
    const { felado, a, b, job, bid } = await licites();
    const c = await createUser({ role: 'carrier' });
    const idA = await bid(a, 'withdrawn');
    const idB = await bid(b, 'rejected');
    const idC = await bid(c, 'accepted');
    await db.query(`UPDATE jobs SET status = 'accepted', carrier_id = $2, paid_at = NOW() WHERE id = $1`, [job.id, c.id]);
    const cancel = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(c.token)).send({ reason: 'nem érek rá' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const st = async (id) => (await db.query('SELECT status FROM bids WHERE id = $1', [id])).rows[0].status;
    expect(await st(idA), 'a visszavont ajánlat újraéledt — a szállító akarata ellenére újra „elfogadható" lett').toBe('withdrawn');
    expect(await st(idB)).toBe('pending');
    expect(await st(idC)).toBe('rejected');
    void felado;
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('3. fizetetlen megállapodás lejáratása', () => {
  async function elfogadott({ reminderCount = MAX_REMINDERS, lastReminderAgoHours = EXPIRE_AFTER_HOURS + 1, paid = false } = {}) {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid });
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', $2, 0, 500) ON CONFLICT (job_id) DO NOTHING`, [job.id, `lejar-${job.id}`],
    );
    await db.query(
      `UPDATE jobs SET payment_reminder_count = $2, last_payment_reminder_at = NOW() - ($3 || ' hours')::interval WHERE id = $1`,
      [job.id, reminderCount, lastReminderAgoHours],
    );
    return { felado, szallito, job };
  }
  const allapot = async (id) => (await db.query('SELECT status, cancel_reason FROM jobs WHERE id = $1', [id])).rows[0];

  it('2 emlékeztető + 72 h fizetés nélkül → lezárva, díj-sor refunded, mindkét fél értesítve', async () => {
    const { felado, szallito, job } = await elfogadott();
    const n = await runPaymentExpiry();
    expect(n).toBeGreaterThanOrEqual(1);
    const a = await allapot(job.id);
    expect(a.status, 'a fizetetlen megállapodás örökre accepted maradt').toBe('cancelled');
    expect(a.cancel_reason).toBe('payment_expired');
    const { rows: dij } = await db.query('SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(dij[0].status).toBe('refunded');
    expect(await ertesitesek(felado.id, 'payment_expired')).toBe(1);
    expect(await ertesitesek(szallito.id, 'payment_expired')).toBe(1);
  });

  it('kontroll: friss emlékeztető / kevesebb emlékeztető / fizetett fuvar érintetlen; a napi kör hívja', async () => {
    const friss = await elfogadott({ lastReminderAgoHours: 10 });
    const keves = await elfogadott({ reminderCount: 1, lastReminderAgoHours: 200 });
    const fizetett = await elfogadott({ paid: true });
    await runPaymentReminders(); // a lejáratás a napi kör része
    expect((await allapot(friss.job.id)).status).toBe('accepted');
    expect((await allapot(keves.job.id)).status).toBe('accepted');
    expect((await allapot(fizetett.job.id)).status).toBe('accepted');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('4. FK-k: értékelő törlése, fuvar törlése', () => {
  it('a törölt értékelő csillaga megmarad „Törölt felhasználó" néven, a szövege törlődik; a rating_count nem csúszik el', async () => {
    __resetRateLimitsForTests();
    const admin = await createUser({ role: 'admin' });
    const ertekelo = await createUser();
    const ertekelt = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: ertekelo.id, carrierId: ertekelt.id, status: 'delivered', paid: true });
    await db.query(
      `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, stars, rating, comment) VALUES ($1, $2, $3, 5, 5, 'Nagyon kedves volt, a címet is pontosan tudta.')`,
      [job.id, ertekelo.id, ertekelt.id],
    );
    await db.query('UPDATE users SET rating_avg = 5, rating_count = 1 WHERE id = $1', [ertekelt.id]);
    const del = await request(app).delete(`/admin/users/${ertekelo.id}`).set(auth(admin.token));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const { rows } = await db.query('SELECT reviewer_id, stars, comment FROM reviews WHERE reviewee_id = $1', [ertekelt.id]);
    expect(rows.length, 'az értékelt fél értékelése ELTŰNT az értékelő fiók-törlésével').toBe(1);
    expect(rows[0].reviewer_id).toBeNull();
    expect(rows[0].stars).toBe(5);
    expect(rows[0].comment, 'a törölt felhasználó szabad szövege megmaradt').toBeNull();
    const prof = await request(app).get(`/auth/users/${ertekelt.id}/public`).set(auth(admin.token));
    if (prof.status === 200 && prof.body.recent_reviews) {
      expect(prof.body.recent_reviews[0].reviewer_name).toBe('Törölt felhasználó');
    }
  });

  it('a lezárt fuvar admin-törlése után a díj-könyvelés sora megmarad (job_id NULL)', async () => {
    __resetRateLimitsForTests();
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    const { rows: elotte } = await db.query('SELECT id FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(elotte.length).toBe(1);
    const del = await request(app).delete(`/admin/jobs/${job.id}`).set(auth(admin.token));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const { rows } = await db.query('SELECT job_id, status, amount_huf FROM escrow_transactions WHERE id = $1', [elotte[0].id]);
    expect(rows.length, 'a fuvar törlése a PÉNZÜGYI sort is elvitte (Számv. tv. 8 év)').toBe(1);
    expect(rows[0].job_id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('5. sugár-keresés az SQL-ben', () => {
  it('201 frissebb, távoli fuvar mellett a régebbi, 3 km-es fuvar is megjelenik a sugárban', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    // a KÖZELI fuvar régebbi (created_at hátra tolva)
    const kozeli = await createJob({ shipperId: felado.id, status: 'bidding' }); // Budapest 47.4979,19.0402
    await db.query(`UPDATE jobs SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [kozeli.id]);
    // 201 távoli, friss fuvar (Szeged környéke) egyetlen INSERT-tel
    await db.query(
      `INSERT INTO jobs (shipper_id, title, description, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
                         suggested_price_huf, status, delivery_code, sender_delivery_code, tracking_token)
       SELECT $1, 'Távoli ' || g, 't', 'Szeged, Teszt u. ' || g, 46.2530 + g * 0.0001, 20.1414, 'Pécs', 46.07, 18.23,
              10000, 'bidding', '111222', '333444', md5(random()::text || g)
         FROM generate_series(1, 201) g`,
      [felado.id],
    );
    const r = await request(app).get('/jobs').query({ lat: 47.4979, lng: 19.0402, radius_km: 5 }).set(auth(szallito.token));
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body.some((j) => j.id === kozeli.id), 'a 3 km-es fuvar hiányzik — a sugár-szűrés a LIMIT 200 UTÁN futott').toBe(true);
    expect(r.body.every((j) => j.distance_to_pickup_km <= 5)).toBe(true);
    const rossz = await request(app).get('/jobs').query({ lat: 'abc', lng: 19 }).set(auth(szallito.token));
    expect(rossz.status).toBe(400);
    const rosszSugar = await request(app).get('/jobs').query({ lat: 47.5, lng: 19, radius_km: -3 }).set(auth(szallito.token));
    expect(rosszSugar.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('6. fotó-plafon', () => {
  it('a 10. listing-fotó után a 11. feltöltés 400 PHOTO_LIMIT', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `INSERT INTO photos (job_id, uploader_id, kind, url) SELECT $1, $2, 'listing', 'https://example.com/p' || g FROM generate_series(1, 10) g`,
      [job.id, felado.id],
    );
    const r = await request(app).post(`/jobs/${job.id}/photos`).set(auth(felado.token))
      .field('kind', 'listing').attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('PHOTO_LIMIT');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('7. címzetti e-mail: kód a felvételkor, nem a feladáskor', () => {
  it('feladáskor a levél KÓD NÉLKÜL megy; felvételkor kóddal + a szállító elérhetőségével', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const feladas = vi.spyOn(emailSzolgaltatas, 'sendRecipientTrackingEmail').mockResolvedValue({ stub: true });
    const felvetel = vi.spyOn(emailSzolgaltatas, 'sendRecipientPickupEmail').mockResolvedValue({ stub: true });
    const r = await request(app).post('/jobs').set(auth(felado.token)).send({
      title: 'Kódos csomag', pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
      dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
      weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
      recipient_name: 'Címzett Cili', recipient_phone: '+36301112233', recipient_email: 'cimzett-a4@example.com',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await varakozz(async () => feladas.mock.calls.length === 1)).toBe(true);
    expect(feladas.mock.calls[0][0].deliveryCode, 'a feladáskori levél VITTE az átvételi kódot').toBeUndefined();

    // felvétel: elfogadott + fizetett, a szállító feltölti a pickup fotót
    await db.query(`UPDATE jobs SET status = 'accepted', carrier_id = $2, paid_at = NOW(), fee_consent_at = NOW() WHERE id = $1`, [r.body.id, szallito.id]);
    const up = await request(app).post(`/jobs/${r.body.id}/photos`).set(auth(szallito.token))
      .field('kind', 'pickup').attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(up.status, JSON.stringify(up.body)).toBeLessThan(300);
    expect(await varakozz(async () => felvetel.mock.calls.length === 1), 'felvételkor nem ment e-mail a címzettnek').toBe(true);
    const { rows } = await db.query('SELECT delivery_code FROM jobs WHERE id = $1', [r.body.id]);
    const hivas = felvetel.mock.calls[0][0];
    expect(hivas.to).toBe('cimzett-a4@example.com');
    expect(hivas.deliveryCode).toBe(rows[0].delivery_code);
    expect(hivas.carrierName, "a felvételi levélből hiányzik a szállító neve").toBeTruthy();
  });

  it('a feladáskori sablon kód nélkül is értelmes (megmondja, mikor jön a kód)', async () => {
    const eredetiFetch = global.fetch; const eredetiKulcs = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_teszt'; process.env.EMAIL_RETRY_BACKOFF_MS = '1';
    let html = '';
    global.fetch = vi.fn(async (url, opts) => { html = JSON.parse(opts.body).html; return { ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '' }; });
    try {
      await emailSzolgaltatas.sendRecipientTrackingEmail({ to: 'x@example.com', recipientName: 'X', jobTitle: 'T', trackingUrl: 'https://gofuvar.hu/nyomon-kovetes/abc' });
    } finally { global.fetch = eredetiFetch; process.env.RESEND_API_KEY = eredetiKulcs || ''; delete process.env.EMAIL_RETRY_BACKOFF_MS; }
    expect(html).not.toMatch(/undefined/);
    expect(html).toMatch(/felveszi a csomagot/);
    expect(html).not.toMatch(/\b\d{6}\b/);
  });
});
