// =====================================================================
//  CIB EKI — LEKÉRDEZŐ KÖR ÉS PONTOSAN EGYSZERI ZÁRÁS (2026-09-29, PR-2/B)
//
//  A pénz a MSGT32-n dől el. Amit ez a fájl őriz:
//   * I1: CIB-es paid_at CSAK a MSGT32-re kapott, a DB-vel egyező MSGT31
//     RC=00-ból keletkezhet — a MSGT33 RC=00 önmagában nem siker;
//   * I3: egy TRID-re legfeljebb egy FELDOLGOZOTT MSGT32 megy ki — a
//     visszatérés, két párhuzamos kör és az eredmény-oldal együtt sem küld
//     kettőt; kétes kimenet (időtúllépés, D05, a zárás közben elhalt
//     folyamat) után SOHA nincs újraküldés, csak `close_unknown`;
//   * a bizonyítottan fel nem dolgozott kérés (D03/D04/D07, PR) után az
//     újrapróba pontosan egy feldolgozott zárással végződik;
//   * két fülön két jóváhagyás → egy terhelés; a könyvelés elbukása után a
//     kör MSGT32 nélkül könyvel újra, a levél egyszer megy ki;
//   * a köz (TRID-enként), a D04-visszalépés, a helyi határidő, a leállás
//     és a bevezetés-dátum küszöb;
//   * az admin rendezés (ANUM + indoklás) és a fióktörlés-blokk.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const LEVELEK = [];
const emailSzolg = require('../src/services/email');
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail', 'sendCibRiasztasEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const { app, db, createUser, createJob } = require('./helpers');
const { inditHamisBank, beallitEnv } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const notifications = require('../src/services/notifications');

const cf = () => require('../src/services/cibFizetes');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];
const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });

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
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei
  // parkolnak, így a kör csak az aktuális teszt sorait veszi fel.
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
const bankDb = (trid, msgt) => bank.szamol(trid, msgt);
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
}
async function jobSor(id) {
  return (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
}
/** Esedékessé teszi a sort (a köz és a teendő-idő átugrása, bérlet nélkül). */
async function esedekes(trid) {
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 second',
                  cib_last_query_at = CASE WHEN cib_last_query_at IS NULL THEN NULL ELSE NOW() - INTERVAL '1 hour' END,
                  cib_lease_until = NULL, cib_lease_owner = NULL WHERE payment_id = $1`, [trid]);
}
/** /pay + hop: a vásárló a bank oldalán van (redirected). */
async function bankOldalon(felado, job) {
  const p = await fizet(felado, job);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  expect((await request(app).get(`/payments/cib/tovabb/${hopToken(p)}`).redirects(0)).status).toBe(302);
  return p.body.trid;
}
async function visszater(trid, dontes = 'fizet') {
  if (dontes) bank.dont(trid, dontes);
  const r = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
  await cf().varjHatterre();
  return r;
}

// =====================================================================
describe('I1: a MSGT33 RC=00 önmagában nem siker', () => {
  it('33=00, majd a MSGT32 elutasít → failed, nincs paid_at, nyugta és kontakt; hiba-levél RC-csoporttal', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ rc: '51' }]);
    await visszater(trid);
    expect(bankDb(trid, 32)).toBe(1);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'failed', state: 'closed' });
    expect(s.cib_result).toMatchObject({ rc: '51', forras: '32' });
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE payment_id = $1', [trid])).rowCount).toBe(0);
    const reszlet = await request(app).get(`/jobs/${job.id}`).set(...auth(felado));
    expect(reszlet.body.contact).toBeFalsy();
    const hiba = LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === job.id);
    expect(hiba).toHaveLength(1);
    expect(hiba[0]).toMatchObject({ to: felado.email, tipus: 'sikertelen', rcCsoport: 'technikai' });
    expect(hiba[0].bankiAdatok).toMatchObject({ trid, rc: '51', amo: 500 });
  });

  it('33=00, majd a MSGT32 válasza elvész (időtúllépés) → close_unknown; N kör alatt sem megy második MSGT32', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true }]);
    await visszater(trid);
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result.ok).toBe('zaras_valasz_nelkul');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    const reszlet = await request(app).get(`/jobs/${job.id}`).set(...auth(felado));
    expect(reszlet.body.contact).toBeFalsy();
    for (let i = 0; i < 3; i += 1) {
      await esedekes(trid);
      await kor();
    }
    expect(bankDb(trid, 32), 'kétes zárás után újraküldött MSGT32').toBe(1);
    s = await sor(trid);
    expect(s.cib_state).toBe('close_unknown');
    // Riasztás egyszer, TrID-del.
    const riasztas = LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid);
    expect(riasztas).toHaveLength(1);
    expect(riasztas[0]).toMatchObject({ to: 'info@gofuvar.hu', trid, jobId: job.id });
    // Új fizetés tiltva, a fióktörlés blokkolva.
    const uj = await fizet(felado, job);
    expect(uj.status).toBe(409);
    expect(uj.body.code).toBe('CIB_PAYMENT_REVIEW');
    expect((await request(app).delete('/auth/me').set(...auth(felado)).send({ confirm: 'TÖRLÉS' })).status).toBe(409);
  });

  it('D05 a zárásra (a kérést már kiszolgálták) → close_unknown, újraküldés nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=D05', http: 500 }]);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'close_unknown' });
    expect((await sor(trid)).cib_result.ok).toBe('zaras_d05');
    expect(bankDb(trid, 32)).toBe(1);
  });

  it('D03 (bizonyítottan fel nem dolgozott) → vissza authorized; a következő esedékes kör egyetlen feldolgozott zárással fizet', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=D03', http: 500 }]);
    await visszater(trid);
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect((await jobSor(job.id)).paid_at).toBeNull();
    await esedekes(trid);
    await kor();
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded', cib_close_attempts: 2 });
    expect(bankDb(trid, 32)).toBe(2);
    expect(bank.tranzakciok.get(trid).zarva).toBe(true);
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });

  it('késői hiteles 00 ugyanarra a kísérletre a close_unknown-ból is elfogadható', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ kesleltetesMs: 600 }]);
    bank.horog(async (u) => {
      if (u.msgt !== 32) return;
      // Közben egy másik munkás „elhaltnak" látta és kétesre tette.
      await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown' WHERE payment_id = $1`, [trid]);
    });
    await visszater(trid);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });

  it('a kontakt a zárás alatt (MSGT32 úton) még rejtve van', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    let kozben = null;
    bank.horog(async (u) => {
      if (u.msgt !== 32) return;
      const r = await request(app).get(`/jobs/${job.id}`).set(...auth(felado));
      kozben = { contact: r.body.contact || null, paid_at: r.body.paid_at || null, allapot: (await sor(trid)).cib_state };
    });
    await visszater(trid);
    expect(kozben).toEqual({ contact: null, paid_at: null, allapot: 'closing' });
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });
});

// =====================================================================
describe('I3: pontosan egy MSGT32 — párhuzamos források, két fül, index', () => {
  it('visszatérés + két kör + eredmény-lekérdezés egyszerre → pontosan egy MSGT32', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await esedekes(trid);
    // A MSGT33-at a bank lassan válaszolja: így minden forrás, ami a sort
    // (tévesen) megkaphatná, BIZTOSAN egyszerre van úton — a verseny nem a
    // szerencsén múlik (lemérve: bérlet és claim nélkül 2–3 MSGT32 megy ki).
    bank.tridre(trid, 33, Array.from({ length: 6 }, () => ({ kesleltetesMs: 300 })));
    bank.tridre(trid, 32, [{ kesleltetesMs: 150 }]);
    const vissza = request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
    const eredmeny = request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(cf().eredmenyToken(trid))}`);
    await Promise.all([vissza, eredmeny, kor(), kor(), cf().feldolgoz(trid, 'admin')]);
    await cf().varjHatterre();
    expect(bankDb(trid, 33), 'egy TRID-en egyszerre több munkás kérdezett').toBe(1);
    expect(bankDb(trid, 32), 'kettős MSGT32').toBe(1);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(LEVELEK.filter((l) => l.nev === 'sendFeeConfirmationEmail' && l.to === felado.email)).toHaveLength(1);
  });

  it('két fül, két jóváhagyás: egy zárás; a másik not_closed (mar_fizetve), MSGT32 nélkül, magyarázó levéllel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    expect(t1).not.toBe(t2);
    bank.dont(t1, 'fizet');
    bank.dont(t2, 'fizet');
    await Promise.all([cf().feldolgoz(t1, 'visszateres'), cf().feldolgoz(t2, 'visszateres')]);
    await cf().varjHatterre();
    // A vesztes vagy már not_closed, vagy vár (másik zárás) — egy esedékes kör eldönti.
    for (const t of [t1, t2]) {
      if ((await sor(t)).cib_state === 'authorized') {
        await esedekes(t);
        await kor();
      }
    }
    const allapotok = [(await sor(t1)).cib_state, (await sor(t2)).cib_state].sort();
    expect(allapotok).toEqual(['closed_ok', 'not_closed']);
    expect(bankDb(t1, 32) + bankDb(t2, 32), 'mindkét kísérletre ment MSGT32 — kettős terhelés').toBe(1);
    const vesztes = (await sor(t1)).cib_state === 'not_closed' ? t1 : t2;
    expect(await sor(vesztes)).toMatchObject({ state: 'closed' });
    expect((await sor(vesztes)).cib_result.ok).toBe('mar_fizetve');
    const levelek = LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === job.id);
    expect(levelek).toHaveLength(1);
    expect(levelek[0].tipus).toBe('mar_fizetve');
  });

  it('a DB-index kizárja a második zárási sort ugyanarra a fuvarra (23505)', async () => {
    const { felado, job } = await elfogadottFuvar();
    await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_close_attempts)
                    VALUES ('3333000033330001', $1, $2, 500, 'cib', 'pending', 'closing', 1)`, [job.id, felado.id]);
    await expect(db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_close_attempts)
                    VALUES ('3333000033330002', $1, $2, 500, 'cib', 'pending', 'close_unknown', 1)`, [job.id, felado.id]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('a zárás közben elhalt folyamat (lejárt bérlet, régi closing) → close_unknown, MSGT32 NÉLKÜL', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1,
                    cib_close_sent_at = NOW() - INTERVAL '10 minutes', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_lease_owner = 'halott:1', cib_lease_until = NOW() - INTERVAL '1 minute' WHERE payment_id = $1`, [trid]);
    await kor();
    expect(bankDb(trid, 32)).toBe(0);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result.ok).toBe('zaras_valasz_nelkul');
    expect(s.cib_next_action_at).toBeNull();
  });
});

// =====================================================================
describe('Lekérdező kör: köz, visszalépés, határidő, bevezetés, leállás', () => {
  it('PR után a köz alatt nincs új MSGT33; esedékesen 00 → zárás', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    await visszater(trid, null);
    expect(bankDb(trid, 33)).toBe(1);
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 second' WHERE payment_id = $1`, [trid]);
    await kor();
    expect(bankDb(trid, 33), 'a köz alatt újra lekérdezett').toBe(1);
    bank.dont(trid, 'fizet');
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33)).toBe(2);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  });

  it('visszatérés nélkül is: a kör a bankot kérdezi, és lezár (bezárt böngésző)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await esedekes(trid);
    await kor();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });

  it('D04 a MSGT33-ra → globális visszalépés: másik sorra sem megy MSGT33, de a zárás igen', async () => {
    const a = await elfogadottFuvar();
    const b = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const tb = await bankOldalon(b.felado, b.job);
    bank.tridre(ta, 33, [{ nyers: 'RC=D04', http: 500 }]);
    await esedekes(ta);
    await kor();
    expect(bankDb(ta, 33)).toBe(1);
    // A másik sor esedékes, de a visszalépés alatt nem kérdezünk.
    await esedekes(tb);
    await kor();
    expect(bankDb(tb, 33)).toBe(0);
    // Egy jóváhagyott (authorized) sor zárása viszont megy.
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized', cib_result = jsonb_build_object('msgt33_rc', '00')
                    WHERE payment_id = $1`, [tb]);
    bank.dont(tb, 'fizet');
    await esedekes(tb);
    await kor();
    expect(bankDb(tb, 32)).toBe(1);
    expect((await sor(tb)).cib_state).toBe('closed_ok');
  });

  it('30 perc PR után helyi határidő → expired, hiba-levéllel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_redirected_at = NOW() - INTERVAL '31 minutes' WHERE payment_id = $1`, [trid]);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    await esedekes(trid);
    await kor();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result).toMatchObject({ ok: 'helyi_hatarido', forras: 'helyi' });
    expect(LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.tipus === 'sikertelen' && l.jobId === job.id)).toHaveLength(1);
  });

  it('elutasított authorizáció (51): a zárási jog alatt MSGT32 → failed; kikapcsolva MSGT32 nélkül failed', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await visszater(trid, 'elutasit');
    expect(bankDb(trid, 32)).toBe(1);
    expect(await sor(trid)).toMatchObject({ cib_state: 'failed', state: 'closed' });

    const vissza = beallitEnv({ CIB_SIKERTELEN_LEZARAS: 'false' });
    try {
      const b = await elfogadottFuvar();
      const t2 = await bankOldalon(b.felado, b.job);
      await visszater(t2, 'elutasit');
      expect(bankDb(t2, 32)).toBe(0);
      const s = await sor(t2);
      expect(s).toMatchObject({ cib_state: 'failed', state: 'closed' });
      expect(s.cib_result).toMatchObject({ rc: '51', forras: '33' });
    } finally {
      vissza();
    }
  });

  it('2 percnél régebbi „initializing" → abandoned banki hívás nélkül; a bevezetés előtti, a nem-CIB és a szimulált sorhoz nem nyúl', async () => {
    const { felado, job } = await elfogadottFuvar();
    await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_next_action_at, created_at)
                    VALUES ('4444000044440001', $1, $2, 500, 'cib', 'pending', 'initializing', NOW() - INTERVAL '1 minute', NOW() - INTERVAL '3 minutes'),
                           ('4444000044440002', $1, $2, 500, 'cib', 'pending', 'redirected', NOW() - INTERVAL '1 minute', '2025-06-01')`,
    [job.id, felado.id]);
    const elotte = bank.uzenetek.length;
    await kor();
    expect(bank.uzenetek.length).toBe(elotte);
    expect(await sor('4444000044440001')).toMatchObject({ cib_state: 'abandoned', state: 'closed' });
    expect(await sor('4444000044440002')).toMatchObject({ cib_state: 'redirected', state: 'pending', cib_lease_owner: null });
  });

  it('leállás után nincs új bérlet és nincs új MSGT32; a leállás megvárja a futó banki hívást', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    bank.tridre(trid, 32, [{ kesleltetesMs: 400 }]);
    await esedekes(trid);
    // A leállás pontosan akkor indul, amikor a MSGT32 már úton van.
    let leallas = null;
    let kezd = 0;
    bank.horog(async (u) => {
      if (u.msgt !== 32) return;
      kezd = Date.now();
      leallas = cf().leallitas({ varakozasMs: 5000 });
    });
    await kor();
    await leallas;
    expect(Date.now() - kezd, 'a leállás nem várta meg a futó MSGT32-t').toBeGreaterThanOrEqual(350);
    expect((await sor(trid)).cib_state).toBe('closed_ok');
    // Leállás közben a kör nem vesz fel új munkát.
    const masik = await elfogadottFuvar();
    await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_next_action_at)
                    VALUES ('6666000066660001', $1, $2, 500, 'cib', 'pending', 'authorized', NOW() - INTERVAL '1 second')`,
    [masik.job.id, masik.felado.id]);
    expect(await kor()).toBe(0);
    expect(bankDb('6666000066660001', 32)).toBe(0);
    expect((await sor('6666000066660001')).cib_lease_owner).toBeNull();

    const b = await elfogadottFuvar();
    const t2 = await bankOldalon(b.felado, b.job).catch(() => null);
    expect(t2, 'leállás közben új fizetés indult').toBeNull();
    await db.query(`UPDATE payment_sessions SET cib_state = 'failed', state = 'closed' WHERE payment_id = '6666000066660001'`);
  });
});

// =====================================================================
describe('Könyvelés: a banki tény után, újrapróbálhatóan', () => {
  it('a könyvelés egyszer elbukik → a kör MSGT32 nélkül újrakönyvel; a levél egyszer megy ki', async () => {
    const feePayment = require('../src/services/feePayment');
    const eredeti = feePayment.konyvelDijFizetes;
    let hiba = true;
    feePayment.konyvelDijFizetes = async (...a) => {
      if (hiba) { hiba = false; throw new Error('Neon cold start (teszt)'); }
      return eredeti(...a);
    };
    try {
      const { felado, job } = await elfogadottFuvar();
      const trid = await bankOldalon(felado, job);
      await visszater(trid);
      expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'pending' });
      expect((await jobSor(job.id)).paid_at).toBeNull();
      await esedekes(trid);
      await kor();
      await cf().varjHatterre();
      expect(bankDb(trid, 32)).toBe(1);
      expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
      expect((await jobSor(job.id)).paid_at).toBeTruthy();
      await esedekes(trid);
      await kor();
      await cf().varjHatterre();
      expect(LEVELEK.filter((l) => l.nev === 'sendFeeConfirmationEmail' && l.to === felado.email)).toHaveLength(1);
    } finally {
      feePayment.konyvelDijFizetes = eredeti;
    }
  });

  it('könyvelési árva (egy őrt megkerülő út) → needs_review, riasztás; MSGT32 nincs újra', async () => {
    const feePayment = require('../src/services/feePayment');
    const eredeti = feePayment.konyvelDijFizetes;
    let hiba = true;
    feePayment.konyvelDijFizetes = async (...a) => {
      if (hiba) { hiba = false; throw new Error('átmeneti (teszt)'); }
      return eredeti(...a);
    };
    try {
      const { felado, job } = await elfogadottFuvar();
      const trid = await bankOldalon(felado, job);
      await visszater(trid);
      // Egy őr nélküli út (közvetlen SQL) közben lemondja a fuvart.
      await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [job.id]);
      await esedekes(trid);
      await kor();
      const s = await sor(trid);
      expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'needs_review' });
      expect(s.cib_result.ok).toBe('konyvelesi_arva');
      expect(bankDb(trid, 32)).toBe(1);
      expect(LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid)).toHaveLength(1);
    } finally {
      feePayment.konyvelDijFizetes = eredeti;
    }
  });
});

// =====================================================================
describe('Admin: keresés, részletek, újraellenőrzés, rendezés', () => {
  it('a lista és a részletek csak adminnak; a napló a TrID-hez tartozó üzeneteket adja', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const nemAdmin = await request(app).get('/payments/admin/cib').set(...auth(felado));
    expect(nemAdmin.status).toBe(403);
    const lista = await request(app).get(`/payments/admin/cib?q=${trid}`).set(...auth(admin));
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBe(1);
    expect(lista.body.items[0]).toMatchObject({ trid, job_id: job.id, cib_state: 'redirected', amount_huf: 500 });
    const reszlet = await request(app).get(`/payments/admin/cib/${trid}`).set(...auth(admin));
    expect(reszlet.status).toBe(200);
    expect(reszlet.body.session.payment_id).toBe(trid);
    expect(reszlet.body.messages.map((m) => [m.direction, m.msgt])).toEqual(expect.arrayContaining([['ki', 10], ['be', 11], ['bongeszo_ki', 20]]));
    expect(reszlet.body.messages[0].raw).toMatch(/^PID=/);
    for (const rossz of ['-5', 'abc', '1e309']) {
      const r = await request(app).get(`/payments/admin/cib?limit=${rossz}&offset=${rossz}&from=${rossz}&q=${rossz}`).set(...auth(admin));
      expect(r.status).toBeLessThan(500);
    }
    expect((await request(app).get('/payments/admin/cib/123').set(...auth(admin))).status).toBe(404);
    const ujra = await request(app).post(`/payments/admin/cib/${trid}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(ujra.status).toBe(200);
    expect(ujra.body).toEqual({ ok: true });
    await cf().varjHatterre();
  });

  it('rendezés: csak close_unknown-ra, kötelező indoklással és ANUM-mal; „lezarva" → fizetve, „nem_lezarva" → closed + levél', async () => {
    const admin = await createUser({ role: 'admin' });
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const nemKetes = await request(app).post(`/payments/admin/cib/${ta}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: '123456' });
    expect(nemKetes.status).toBe(409);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [ta]);
    for (const rossz of [{ eredmeny: 'lezarva', indoklas: 'rövid', anum: '123456' },
      { eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.' },
      { eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: '12 34' },
      { eredmeny: 'mas', indoklas: 'A bank írásban megerősítette.' }]) {
      const r = await request(app).post(`/payments/admin/cib/${ta}/rendezes`).set(...auth(admin)).send(rossz);
      expect(r.status, JSON.stringify(rossz)).toBe(400);
    }
    const ok = await request(app).post(`/payments/admin/cib/${ta}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette a zárást.', anum: 'AB1234' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ ok: true, allapot: 'sikeres' });
    const sa = await sor(ta);
    expect(sa).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(sa.cib_result).toMatchObject({ forras: 'admin', anum: 'AB1234', admin_id: admin.id });
    expect((await jobSor(a.job.id)).paid_at).toBeTruthy();

    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [tb]);
    const nem = await request(app).post(`/payments/admin/cib/${tb}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint a tranzakció reverzálva.' });
    expect(nem.status).toBe(200);
    expect(nem.body.allapot).toBe('sikertelen');
    expect(await sor(tb)).toMatchObject({ cib_state: 'failed', state: 'closed' });
    expect(LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.tipus === 'nem_terhelt' && l.jobId === b.job.id)).toHaveLength(1);
    expect(INAPP.filter((n) => n.type === 'payment_failed' && n.user_id === b.felado.id)).toHaveLength(0);
  });
});

// =====================================================================
describe('A lekérdezés és a zárás további hibaágai', () => {
  it('MSGT33 RC=TO → expired (bank_to, a MSGT33 adataival), hiba-levél a kapcsolati csoporttal', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'TO' }]);
    await visszater(trid, null);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result).toMatchObject({ ok: 'bank_to', rc: 'TO', forras: '33' });
    expect(bankDb(trid, 32)).toBe(0);
    const l = LEVELEK.filter((x) => x.nev === 'sendFeePaymentFailedEmail' && x.jobId === job.id);
    expect(l.map((x) => [x.tipus, x.rcCsoport])).toEqual([['sikertelen', 'kapcsolat']]);
  });

  it('a DB-vel nem egyező MSGT31 (AMO) nem siker: harmadszorra close_unknown + riasztás, MSGT32 nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    bank.tridre(trid, 33, [{ amo: '999' }, { amo: '999' }, { amo: '999' }]);
    await visszater(trid, null);
    expect((await sor(trid)).cib_state).toBe('redirected');
    for (let i = 0; i < 2; i += 1) {
      await esedekes(trid);
      await kor();
    }
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result).toMatchObject({ ok: 'zaras_mezo_elteres', mezo_elteres_szam: 3 });
    expect(bankDb(trid, 32)).toBe(0);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid)).toHaveLength(1);
  });

  it('háromszori NT (a bank nem ismeri a TRID-et) → close_unknown (saját hiba gyanú)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'NT' }, { rc: 'NT' }, { rc: 'NT' }]);
    await visszater(trid, null);
    for (let i = 0; i < 2; i += 1) {
      await esedekes(trid);
      await kor();
    }
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown' });
    expect(s.cib_result).toMatchObject({ ok: 'nt_ismetlodo', nt_szam: 3 });
  });

  it('titkosítatlan S-hiba a MSGT33-ra → a tick megszakad, a többi esedékes sor a következő tickre marad', async () => {
    const a = await elfogadottFuvar();
    const b = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const tb = await bankOldalon(b.felado, b.job);
    bank.tridre(ta, 33, [{ nyers: 'RC=S01', http: 403 }]);
    bank.tridre(tb, 33, [{ rc: 'PR' }]);
    // A két sor a tick legelején legyen (a korábbi tesztek esedékes sorai elé).
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '2 days' WHERE payment_id = $1`, [ta]);
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 day' WHERE payment_id = $1`, [tb]);
    await kor();
    expect(bankDb(ta, 33)).toBe(1);
    expect(bankDb(tb, 33), 'az S-hiba után a tick folytatta').toBe(0);
    expect((await sor(ta)).cib_state).toBe('redirected');
    expect((await sor(tb)).cib_lease_owner).toBeNull();
  });

  it('MSGT32 RC=TO (elkéstünk) → expired; a 3. fel nem dolgozott zárás után close_unknown (zaras_nem_feldolgozott)', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    bank.tridre(ta, 32, [{ rc: 'TO' }]);
    await visszater(ta);
    expect(await sor(ta)).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect((await sor(ta)).cib_result).toMatchObject({ ok: 'bank_to', forras: '32' });

    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    bank.dont(tb, 'fizet');
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized', cib_close_attempts = 2,
                    cib_result = jsonb_build_object('msgt33_rc', '00', 'authorized_at', NOW())
                    WHERE payment_id = $1`, [tb]);
    bank.tridre(tb, 32, [{ nyers: 'RC=D07', http: 500 }]);
    await esedekes(tb);
    await kor();
    const s = await sor(tb);
    expect(s).toMatchObject({ cib_state: 'close_unknown', cib_close_attempts: 3 });
    expect(s.cib_result.ok).toBe('zaras_nem_feldolgozott');
    expect(bankDb(tb, 32)).toBe(1);
  });

  it('admin-keresés: állapot-, dátum- és fuvar-szűrő, ANUM, lapozás a végén túl', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await visszater(trid);
    const { anum } = (await sor(trid)).cib_result;
    const get = (q) => request(app).get(`/payments/admin/cib?${q}`).set(...auth(admin));
    expect((await get(`q=${job.id}`)).body.items.map((i) => i.trid)).toEqual([trid]);
    expect((await get(`q=${anum}`)).body.items.map((i) => i.trid)).toContain(trid);
    expect((await get(`q=${trid.slice(-8)}&allapot=closed_ok`)).body.items.map((i) => i.trid)).toContain(trid);
    expect((await get('allapot=needs_review')).status).toBe(200);
    const ma = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect((await get(`q=${job.id}&from=${ma}&to=2999-01-01`)).body.total).toBe(1);
    const tul = await get(`q=${job.id}&offset=50`);
    expect(tul.body).toEqual({ items: [], total: 1 });
    for (const rossz of ['allapot=semmi', 'from=tegnap', 'q=%25%25']) {
      expect((await get(rossz)).status, rossz).toBe(400);
    }
    expect((await request(app).post('/payments/admin/cib/1234123412341234/ujraellenorzes').set(...auth(admin)).send({})).status).toBe(404);
  });

  it('CIB-konfig nélkül: a visszatérés és az eredmény 404, a hop a hibaoldalra visz; hibás konfignál a fuvar nem fizethető', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const token = cf().eredmenyToken(trid);
    const nincs = beallitEnv(Object.fromEntries(['CIB_PID', 'CIB_KEY_B64', 'CIB_MARKET_URL', 'CIB_CUSTOMER_URL', 'CIB_KORNYEZET',
      'CIB_RETURN_URL', 'CIB_HMAC_TITOK'].map((k) => [k, ''])));
    try {
      expect((await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`)).status).toBe(404);
      expect((await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(token)}`)).status).toBe(404);
      const h = await request(app).get(`/payments/cib/tovabb/${'A'.repeat(43)}`).redirects(0);
      expect(h.status).toBe(303);
      expect(h.headers.location).toMatch(/\/fizetes\/eredmeny\?hiba=link$/);
      expect(await cf().feldolgoz(trid, 'admin')).toEqual({ kihagyva: 'konfig' });
    } finally {
      nincs();
    }
    const hibas = beallitEnv({ CIB_KORNYEZET: 'rossz' });
    try {
      const r = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
      expect(r.body).toMatchObject({ provider_kind: 'cib', can_pay: false });
    } finally {
      hibas();
    }
  });
});
