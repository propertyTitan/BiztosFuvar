// TELJES AUDIT — C1 (2026-09-11): backend P2-tételek őrei
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, TINY_PNG } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const realtime = require('../src/realtime');
const { runInstantExpiry } = require('../src/services/instantExpiry');
const { corsOriginsFromEnv } = require('../src/utils/corsOrigins');
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ertesites = async (userId, tipus) => (await db.query(
  'SELECT link, body FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1', [userId, tipus],
)).rows[0];

afterEach(() => vi.restoreAllMocks());

describe('lejárt azonnali fuvar', () => {
  it('normál ajánlatgyűjtésre vált + a feladó értesül; a friss és az elfogadott érintetlen', async () => {
    const felado = await createUser();
    const lejart = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() - INTERVAL '2 hours' WHERE id = $1`, [lejart.id]);
    const friss = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '2 hours' WHERE id = $1`, [friss.id]);
    const elfogadott = await createJob({ shipperId: felado.id, status: 'accepted' });
    await db.query(`UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() - INTERVAL '2 hours' WHERE id = $1`, [elfogadott.id]);
    await runInstantExpiry();
    const st = async (id) => (await db.query('SELECT is_instant, instant_expires_at, status FROM jobs WHERE id = $1', [id])).rows[0];
    expect((await st(lejart.id)).is_instant, 'a lejárt azonnali fuvar örökre azonnali maradt').toBe(false);
    expect((await st(lejart.id)).status).toBe('bidding');
    expect((await st(friss.id)).is_instant).toBe(true);
    expect((await st(elfogadott.id)).is_instant).toBe(true);
    expect(await ertesites(felado.id, 'instant_expired'), 'a feladó nem tudta meg, hogy lejárt az azonnali ablak').toBeTruthy();
  });
});

describe('lemondás-értesítés linkje', () => {
  it('a szállító a SZÁLLÍTÓI fuvar-oldalra kap linket, ha a feladó mond le', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    const r = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(felado.token)).send({ reason: 'mégsem' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const n = await ertesites(szallito.id, 'job_cancelled');
    expect(n?.link, 'a szállító a feladói oldalra kapott linket (403)').toBe(`/sofor/fuvar/${job.id}`);
  });
});

describe('vita alatti kézbesítés utóhatása', () => {
  it('a feladó értesítést kap a kézbesítésről, a vita nyitva marad', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    await db.query(`UPDATE jobs SET status = 'disputed', status_before_dispute = 'in_progress', photo_retention_hold = TRUE WHERE id = $1`, [job.id]);
    await db.query(`INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1, $2, 'pickup', 'https://example.com/p.png')`, [job.id, szallito.id]);
    const r = await request(app).post(`/jobs/${job.id}/photos`).set(auth(szallito.token))
      .field('kind', 'dropoff').field('delivery_code', job.delivery_code)
      .attach('file', TINY_PNG, { filename: 'd.png', contentType: 'image/png' });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    const { rows } = await db.query('SELECT status, delivered_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('disputed');
    expect(rows[0].delivered_at).not.toBeNull();
    expect(await ertesites(felado.id, 'job_delivered'), 'a vita alatti kézbesítésről a feladó semmit nem tudott meg').toBeTruthy();
  });
});

describe('kód-zár a WHERE-ben', () => {
  it('a SELECT után beállt zár mellett a rossz kód 429-et kap, a számláló nem nő', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    await db.query(`INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1, $2, 'pickup', 'https://example.com/p.png')`, [job.id, szallito.id]);
    await db.query('UPDATE jobs SET delivery_code_attempts = 4 WHERE id = $1', [job.id]);
    const eredeti = db.query;
    let megtortent = false;
    db.query = async (t, p) => {
      const r = await eredeti(t, p);
      if (!megtortent && /SELECT \* FROM jobs WHERE id = \$1/.test(String(t))) {
        megtortent = true;
        await eredeti(`UPDATE jobs SET delivery_code_locked_until = NOW() + INTERVAL '1 hour', delivery_code_attempts = 5 WHERE id = $1`, [job.id]);
      }
      return r;
    };
    let r;
    try {
      r = await request(app).post(`/jobs/${job.id}/photos`).set(auth(szallito.token))
        .field('kind', 'dropoff').field('delivery_code', '000000')
        .attach('file', TINY_PNG, { filename: 'd.png', contentType: 'image/png' });
    } finally { db.query = eredeti; }
    expect(megtortent).toBe(true);
    expect(r.status, JSON.stringify(r.body)).toBe(429);
    const { rows } = await db.query('SELECT delivery_code_attempts FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].delivery_code_attempts, 'zárolt soron is nőtt a számláló (és hosszabbodott a zár)').toBe(5);
  });
});

describe('SOS koordináta-kapu', () => {
  it('999-es szélesség → 400; érvényes → 201; hely nélkül → 201', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    const rossz = await request(app).post('/sos').set(auth(szallito.token)).send({ job_id: job.id, lat: 999, lng: 19, message: 'Elakadtam.' });
    expect(rossz.status, JSON.stringify(rossz.body)).toBe(400);
    const jo = await request(app).post('/sos').set(auth(szallito.token)).send({ job_id: job.id, lat: 47.5, lng: 19.05, message: 'Elakadtam.' });
    expect(jo.status, JSON.stringify(jo.body)).toBeLessThan(300);
    const nelkul = await request(app).post('/sos').set(auth(szallito.token)).send({ job_id: job.id, message: 'Elakadtam.' });
    expect(nelkul.status, JSON.stringify(nelkul.body)).toBeLessThan(300);
  });
});

describe('sablon-járat nem megy a feedbe', () => {
  it('is_template: nincs routes:new broadcast; normál nyitott járat: van', async () => {
    __resetRateLimitsForTests();
    const szallito = await createUser({ role: 'carrier' });
    const emit = vi.spyOn(realtime, 'emitToFeed').mockImplementation(() => {});
    const base = {
      title: 'BP-Szeged járat', departure_at: new Date(Date.now() + 86400000).toISOString(),
      waypoints: [{ lat: 47.5, lng: 19.0 }, { lat: 46.2, lng: 20.1 }],
      prices: [{ size: 'M', price_huf: 5000 }],
    };
    const sablon = await request(app).post('/carrier-routes').set(auth(szallito.token)).send({ ...base, is_template: true });
    expect(sablon.status, JSON.stringify(sablon.body)).toBe(201);
    expect(emit.mock.calls.filter((c) => c[0] === 'routes:new').length, 'a SABLON kiment a feladói feedbe').toBe(0);
    __resetRateLimitsForTests();
    const normal = await request(app).post('/carrier-routes').set(auth(szallito.token)).send(base);
    expect(normal.status, JSON.stringify(normal.body)).toBe(201);
    expect(emit.mock.calls.filter((c) => c[0] === 'routes:new').length).toBe(1);
  });
});

describe('messages XOR + CORS boot', () => {
  it('a DB a kettős szülőjű üzenetet elutasítja', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true });
    const { createBooking } = require('./helpers');
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id });
    await expect(db.query(
      `INSERT INTO messages (job_id, booking_id, sender_id, recipient_id, body) VALUES ($1, $2, $3, $4, 'x')`,
      [job.id, booking.id, felado.id, szallito.id],
    )).rejects.toThrow(/messages_parent_xor|check constraint/i);
  });
  it('élesben CORS_ORIGIN nélkül figyelmeztet; beállítva listát ad', () => {
    expect(corsOriginsFromEnv({}, 'production').warning).toMatch(/CORS_ORIGIN/);
    expect(corsOriginsFromEnv({ CORS_ORIGIN: 'https://www.gofuvar.hu, https://gofuvar.hu' }, 'production')).toEqual({
      origins: ['https://www.gofuvar.hu', 'https://gofuvar.hu'], warning: null,
    });
    expect(corsOriginsFromEnv({}, 'test').warning).toBeNull();
  });
});
