// TELJES AUDIT — B3 (2026-09-11): a feladó szerkesztheti a nyitott fuvarját;
// a 24 órája ajánlat nélkül álló fuvar feladója egyszer tippeket kap.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const emailSzolgaltatas = require('../src/services/email');
const { runNoOfferNudges } = require('../src/services/noOfferNudge');
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ertesitesek = async (userId, tipus) => (await db.query(
  'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2', [userId, tipus],
)).rows[0].n;

afterEach(() => vi.restoreAllMocks());

describe('PATCH /jobs/:id — a nyitott fuvar szerkesztése', () => {
  it('a feladó módosíthatja a címet/árat/időablakot; a függő ajánlattevő értesül; idegen 403; elfogadott 409', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser();
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 12000, 'pending', 'included')`, [job.id, szallito.id]);
    const kezd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const veg = new Date(Date.now() + 28 * 3600 * 1000).toISOString();
    const r = await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token))
      .send({ title: 'Javított cím', suggested_price_huf: 18000, pickup_window_start: kezd, pickup_window_end: veg });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.title).toBe('Javított cím');
    expect(Number(r.body.suggested_price_huf)).toBe(18000);
    expect(r.body.pickup_window_start).toBeTruthy();
    expect(await ertesitesek(szallito.id, 'job_updated'), 'a függő ajánlattevő nem tudta meg, hogy változott a hirdetés').toBe(1);

    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(idegen.token)).send({ title: 'Hack' })).status).toBe(403);
    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token)).send({ title: 'Hívj: 06301234567' })).body.code).toBe('CONTACT_LEAK');
    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token)).send({ pickup_window_start: veg, pickup_window_end: kezd })).body.code).toBe('PICKUP_WINDOW_ORDER');
    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token)).send({})).status).toBe(400);
    expect((await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token)).send({ suggested_price_huf: -5 })).status).toBe(400);

    await db.query(`UPDATE jobs SET status = 'accepted', carrier_id = $2 WHERE id = $1`, [job.id, szallito.id]);
    const zart = await request(app).patch(`/jobs/${job.id}`).set(auth(felado.token)).send({ title: 'Késő' });
    expect(zart.status).toBe(409);
    expect(zart.body.code).toBe('JOB_NOT_EDITABLE');
  });
});

describe('„nincs ajánlat" nudge', () => {
  it('24 h + 0 ajánlat → egyszer in-app + e-mail; friss vagy ajánlatos fuvar nem kap; második kör nem duplikál', async () => {
    const levelek = [];
    vi.spyOn(emailSzolgaltatas, 'sendEmail').mockImplementation(async (o) => { levelek.push(o); return { stub: true }; });
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const regi = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1`, [regi.id]);
    const friss = await createJob({ shipperId: felado.id, status: 'bidding' });
    const ajanlatos = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1`, [ajanlatos.id]);
    await db.query(`INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 12000, 'pending', 'included')`, [ajanlatos.id, szallito.id]);

    const n = await runNoOfferNudges();
    expect(n).toBeGreaterThanOrEqual(1);
    const { rows } = await db.query('SELECT id, no_offer_nudge_at FROM jobs WHERE id = ANY($1::uuid[])', [[regi.id, friss.id, ajanlatos.id]]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.no_offer_nudge_at]));
    expect(by[regi.id], 'a 25 órája ajánlat nélkül álló fuvar nem kapott tippet').not.toBeNull();
    expect(by[friss.id], 'a friss fuvar is kapott tippet').toBeNull();
    expect(by[ajanlatos.id], 'az ajánlatos fuvar is kapott tippet').toBeNull();
    expect(await ertesitesek(felado.id, 'no_offer_nudge')).toBe(1);
    expect(levelek.filter((l) => l.to === felado.email).length).toBe(1);
    expect(levelek[0].html).toMatch(/emeld|Ár/);

    await runNoOfferNudges();
    expect(await ertesitesek(felado.id, 'no_offer_nudge'), 'a második kör duplán küldött').toBe(1);
  });

  it('a nudge időbélyeg nem szivárog kívülállónak', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const kivul = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query('UPDATE jobs SET no_offer_nudge_at = NOW() WHERE id = $1', [job.id]);
    const r = await request(app).get(`/jobs/${job.id}`).set(auth(kivul.token));
    expect(r.status).toBe(200);
    expect(r.body.no_offer_nudge_at).toBeUndefined();
  });
});
