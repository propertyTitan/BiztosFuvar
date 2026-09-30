// =====================================================================
//  CIB FAGYASZTÁSI ŐR + A NEM FIZETHETŐ ÜGYLET (2026-09-29, CIB PR-2/B)
//
//  Két irányból zárja ugyanazt a rést — hogy a bank ne terhelhessen egy
//  olyan ügyletre, amit a platform már nem tud teljesíteni:
//
//   1. FAGYASZTÁS: amíg a fuvar kártyás díjfizetése lezárul (authorized /
//      closing / close_unknown / closed_ok + könyveletlen), MINDEN
//      ügyletmódosító út 409 CIB_PAYMENT_FINISHING-et ad és semmit nem
//      változtat; a napi körök kihagyják a fuvart.
//   2. NEM FIZETHETŐ ÜGYLET: ha a módosítás a jóváhagyás ELŐTT nyert
//      (lemondás, kupon, díjsáv- vagy szállítócsere), a jóváhagyott kísérlet
//      `not_closed` lesz — MSGT32 NINCS, a bank magától feloldja a
//      zárolást —, a feladó „nem terheltünk" levelet kap, „próbáld újra"
//      értesítést nem.
//   A lemondás–zárás verseny valódi DB-zár-szinkronnal: soha nem lehet
//   egyszerre terhelt és lemondott.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const LEVELEK = [];
const emailSzolg = require('../src/services/email');
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail', 'sendCibRiasztasEmail',
  'sendPaymentDueEmail', 'sendCancellationEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const {
  app, db, createUser, createJob, seenOffer,
} = require('./helpers');
const { inditHamisBank, beallitEnv } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const notifications = require('../src/services/notifications');

const cf = () => require('../src/services/cibFizetes');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

let bank;
let visszaallit;
const INAPP = [];
let eredetiNotif;

beforeAll(async () => {
  bank = await inditHamisBank();
  visszaallit = beallitEnv(bank.env({
    CIB_BEVEZETES: '2026-01-01',
    CIB_HTTP_TIMEOUT_MS: '1500',
    CIB_ZARAS_TIMEOUT_MS: '1500',
    CIB_INDITAS_OSSZKERET_MS: '5000',
    CIB_LEKERDEZES_KOZ_MS: '5000',
  }));
  eredetiNotif = notifications.createNotification;
  notifications.createNotification = async (n) => { INAPP.push(n); return eredetiNotif(n); };
});
afterAll(async () => {
  notifications.createNotification = eredetiNotif;
  visszaallit();
  await bank.leallit();
});
beforeEach(async () => {
  __resetRateLimitsForTests();
  LEVELEK.length = 0;
  INAPP.length = 0;
  bank.horog(null);
  try {
    cf().__resetCibAllapotForTests();
    cf().szivveres();
  } catch { /* piros-próba */ }
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei parkolnak.
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
});

async function elfogadottFuvar() {
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
  return { felado, szallito, job };
}
const fizet = (f, job) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send({ consent: true });
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
async function bankOldalon(felado, job) {
  const p = await fizet(felado, job);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  expect((await request(app).get(`/payments/cib/tovabb/${hopToken(p)}`).redirects(0)).status).toBe(302);
  return p.body.trid;
}
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
}
async function jobSor(id) {
  return (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
}
async function visszaterFizetve(trid) {
  bank.dont(trid, 'fizet');
  await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
  await cf().varjHatterre();
}
/** Egy lezáruló kísérlet a fuvaron (SQL-lel beállítva, bérlet nélkül, parkolva). */
async function fagyaszt(job, felado, allapot) {
  const trid = `55${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
  await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, provider, state, cib_state,
                                                cib_close_attempts, cib_next_action_at, cib_result)
                  VALUES ($1, $2, $3, $4, 500, 'cib', 'pending', $5, $6, NOW() + INTERVAL '1 day', '{}'::jsonb)`,
  [trid, job.id, felado.id, job.carrier_id, allapot, allapot === 'authorized' ? 0 : 1]);
  return trid;
}

// =====================================================================
describe('Fagyasztás: minden ügyletmódosító út 409 CIB_PAYMENT_FINISHING', () => {
  it.each(['authorized', 'closing', 'close_unknown', 'closed_ok'])('%s kísérlet mellett', async (allapot) => {
    const { felado, szallito, job } = await elfogadottFuvar();
    await fagyaszt(job, felado, allapot);
    const elotte = await jobSor(job.id);
    const probak = [
      ['feladói lemondás', request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({})],
      ['szállítói lemondás', request(app).post(`/jobs/${job.id}/cancel`).set(...auth(szallito)).send({})],
      ['szállítócsere', request(app).post(`/jobs/${job.id}/reopen`).set(...auth(felado)).send({})],
    ];
    for (const [nev, keres] of probak) {
      const r = await keres;
      expect(r.status, `${nev}: ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body.code, nev).toBe('CIB_PAYMENT_FINISHING');
    }
    // Kupon: a /pay kuponága is fagyasztott (a díj a banknál épp lezárul).
    await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                    VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [felado.id]);
    const kupon = await fizet(felado, job);
    expect(kupon.status).toBe(409);
    expect(['CIB_PAYMENT_FINISHING', 'CIB_PAYMENT_REVIEW']).toContain(kupon.body.code);
    expect((await db.query('SELECT used_at FROM fee_vouchers WHERE user_id = $1', [felado.id])).rows[0].used_at).toBeNull();

    const admin = await createUser({ role: 'admin' });
    const a = await request(app).patch(`/admin/jobs/${job.id}`).set(...auth(admin)).send({ status: 'cancelled' });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe('CIB_PAYMENT_FINISHING');
    const kezi = await request(app).post(`/jobs/${job.id}/confirm-payment`).set(...auth(felado)).send({});
    expect(kezi.status).toBe(409);

    const utana = await jobSor(job.id);
    expect(utana).toMatchObject({
      status: elotte.status, carrier_id: elotte.carrier_id, paid_at: null, connection_fee_huf: elotte.connection_fee_huf,
    });
  });

  it('nyitott (újranyitott) fuvaron: elfogadás, ellenajánlat-elfogadás, PATCH és ajánlat-visszavonás is fagyasztott', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(szallito)).send({ amount_huf: 20000, return_policy: 'included' });
    expect(bid.status).toBe(201);
    await fagyaszt(job, felado, 'closing');
    const acc = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(felado)).send(await seenOffer(bid.body.id));
    expect(acc.status).toBe(409);
    expect(acc.body.code).toBe('CIB_PAYMENT_FINISHING');
    const patch = await request(app).patch(`/jobs/${job.id}`).set(...auth(felado)).send({ suggested_price_huf: 90000 });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('CIB_PAYMENT_FINISHING');
    const vissza = await request(app).post(`/bids/${bid.body.id}/withdraw`).set(...auth(szallito)).send({});
    expect(vissza.status).toBe(409);
    expect(vissza.body.code).toBe('CIB_PAYMENT_FINISHING');
    const j = await jobSor(job.id);
    expect(j).toMatchObject({ status: 'bidding', carrier_id: null, suggested_price_huf: 15000 });
    expect((await db.query('SELECT status FROM bids WHERE id = $1', [bid.body.id])).rows[0].status).toBe('pending');

    // Ellenajánlat-elfogadás és azonnali elfogadás is.
    const counter = await request(app).post(`/bids/${bid.body.id}/counter`).set(...auth(felado)).send({ amount: 18000 });
    expect(counter.status).toBe(200);
    const accC = await request(app).post(`/bids/${bid.body.id}/accept-counter`).set(...auth(szallito)).send(await seenOffer(bid.body.id));
    expect(accC.status).toBe(409);
    expect(accC.body.code).toBe('CIB_PAYMENT_FINISHING');
    await db.query(`UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [job.id]);
    const masik = await createUser({ role: 'carrier' });
    const inst = await request(app).post(`/jobs/${job.id}/instant-accept`).set(...auth(masik)).send({ expected_price_huf: 15000 });
    expect(inst.status).toBe(409);
    expect(inst.body.code).toBe('CIB_PAYMENT_FINISHING');
    expect((await jobSor(job.id)).status).toBe('bidding');
  });

  it('a napi körök kihagyják a függő CIB-kísérletű fuvart (lejáratás, emlékeztető, elhagyott fuvar)', async () => {
    const { runPaymentReminders, runPaymentExpiry } = require('../src/services/paymentReminders');
    const { expireAbandonedJobs } = require('../src/services/retention');
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job); // redirected: a vásárló a bank oldalán
    await db.query(`UPDATE jobs SET updated_at = NOW() - INTERVAL '2 years', payment_reminder_count = 2,
                    last_payment_reminder_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [job.id]);
    await runPaymentExpiry();
    await expireAbandonedJobs();
    expect((await jobSor(job.id)).status).toBe('accepted');
    await db.query(`UPDATE jobs SET payment_reminder_count = 0 WHERE id = $1`, [job.id]);
    await runPaymentReminders();
    expect((await jobSor(job.id)).payment_reminder_count).toBe(0);
    expect(INAPP.filter((n) => n.type === 'payment_reminder' && n.user_id === felado.id)).toHaveLength(0);
    // A kísérlet lezárása után a körök újra hatnak rá.
    await db.query(`UPDATE payment_sessions SET cib_state = 'failed', state = 'closed' WHERE payment_id = $1`, [trid]);
    await db.query(`UPDATE jobs SET payment_reminder_count = 2, last_payment_reminder_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [job.id]);
    await runPaymentExpiry();
    expect((await jobSor(job.id)).status).toBe('cancelled');
  });
});

// =====================================================================
describe('Nem fizethető ügylet a jóváhagyáskor → not_closed, MSGT32 nélkül', () => {
  it('lemondás a banki oldal alatt → not_closed (nem_fizetheto), Canceled, session closed, „nem terheltünk" levél, próbáld-újra nincs', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const lemond = await request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({});
    expect(lemond.status, JSON.stringify(lemond.body)).toBe(200);
    await visszaterFizetve(trid);
    expect(bank.szamol(trid, 32), 'lemondott fuvarra MSGT32 ment — terhelés').toBe(0);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect(s.cib_result.ok).toBe('nem_fizetheto');
    expect((await db.query(`SELECT 1 FROM payment_events WHERE payment_id = $1 AND status = 'Canceled' AND processed`, [trid])).rowCount).toBe(1);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    const levelek = LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === job.id);
    expect(levelek).toHaveLength(1);
    expect(levelek[0].tipus).toBe('nem_terhelt');
    expect(INAPP.filter((n) => n.type === 'payment_failed')).toHaveLength(0);
  });

  it('kupon a banki oldal alatt → not_closed (kupon), „mar_fizetve" levél', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                    VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [felado.id]);
    const k = await fizet(felado, job);
    expect(k.status, JSON.stringify(k.body)).toBe(200);
    expect(k.body.paid_via_voucher).toBe(true);
    await visszaterFizetve(trid);
    expect(bank.szamol(trid, 32)).toBe(0);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect(s.cib_result.ok).toBe('kupon');
    expect(LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === job.id).map((l) => l.tipus)).toEqual(['mar_fizetve']);
  });

  it('díjsáv-váltás és szállítócsere a banki oldal alatt → not_closed, MSGT32 nélkül', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    await db.query('UPDATE jobs SET connection_fee_huf = 1000 WHERE id = $1', [a.job.id]);
    await visszaterFizetve(ta);
    expect(bank.szamol(ta, 32)).toBe(0);
    expect((await sor(ta)).cib_result.ok).toBe('dijsav_valtozott');

    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    const uj = await createUser({ role: 'carrier' });
    await db.query('UPDATE jobs SET carrier_id = $2 WHERE id = $1', [b.job.id, uj.id]);
    await visszaterFizetve(tb);
    expect(bank.szamol(tb, 32)).toBe(0);
    expect((await sor(tb)).cib_result.ok).toBe('szallito_valtozott');
  });
});

// =====================================================================
describe('Lemondás–zárás verseny valódi zár-szinkronnal', () => {
  it('ha a lemondás tartja a fuvarsort, a zárás megvárja → not_closed, nincs terhelés', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    const kliens = await db.pool.connect();
    try {
      await kliens.query('BEGIN');
      await kliens.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [job.id]);
      const feldolgozas = cf().feldolgoz(trid, 'kor');
      // Megvárjuk, hogy a zárási claim a fuvarsorra várjon.
      for (let i = 0; i < 100; i += 1) {
        const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                                         WHERE NOT l.granted AND l.locktype IN ('transactionid', 'tuple', 'relation')`);
        if (rows[0].n > 0) break;
        await new Promise((r) => { setTimeout(r, 20); });
      }
      await kliens.query(`UPDATE jobs SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [job.id]);
      await kliens.query('COMMIT');
      await feldolgozas;
    } finally {
      kliens.release();
    }
    expect(bank.szamol(trid, 32)).toBe(0);
    expect(await sor(trid)).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect((await jobSor(job.id)).paid_at).toBeNull();
  });

  it('ha a zárás nyert (MSGT32 úton), a lemondás 409 — soha nem lehet egyszerre terhelt és lemondott', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    let lemondas = null;
    bank.horog(async (u) => {
      if (u.msgt !== 32) return;
      lemondas = await request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({});
    });
    await visszaterFizetve(trid);
    expect(lemondas.status).toBe(409);
    expect(lemondas.body.code).toBe('CIB_PAYMENT_FINISHING');
    const j = await jobSor(job.id);
    expect(j.status).toBe('accepted');
    expect(j.paid_at).toBeTruthy();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  });
});
