// =====================================================================
//  CIB PR-5 — ÜTEMEZÉS, SZÜNET, KONFIG NÉLKÜLI ÜZEMELTETÉS, WEB-SZERZŐDÉS
//  (2026-10-03)
//
//  Amit ez a fájl őriz (mindegyik tétel a javítás nélkül piros):
//   * a vásárló visszatérése (MSGT21) AZONNAL kérdez (5 mp-es kalapálás-fék,
//     a TrID-enkénti köz nem tartja vissza), a visszajátszás nem kalapál, a
//     kör kérdése közben érkezett visszatérés után 5 mp-en belül újra kérdez;
//   * a D04-visszalépés a visszatért vásárló lekérdezését nem tolja a
//     zárási határidőn túlra;
//   * a bérlet rövid (a leghosszabb banki hívás + tartalék), nem 3 perc;
//   * CIB_UJ_FIZETES_TILTVA: új kártyás fizetés 503 CIB_PAUSED, a meglévő
//     kísérletek lezárulnak, a hop nem nyit bankot, a kupon működik;
//   * konfig nélkül maradt függő kísérletek: induláskori hangos riasztás
//     állapotonkénti darabszámmal; konfig nélküli admin-műveletek;
//   * a hop nem visz a bankhoz, ha a fuvar egy másik kísérlete épp zár;
//   * a hangolók felső határa a 9:30-as ablakhoz és a web 55 mp-éhez kötött;
//   * C1 GET /config/public, C3 pay_blocked_reason, C4 kupon a CIB-
//     hozzájárulás nélkül.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
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
const p = require('../src/services/cibProtokoll');

const cf = () => require('../src/services/cibFizetes');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

const KOTELEZO_URES = Object.fromEntries(['CIB_PID', 'CIB_KEY_B64', 'CIB_MARKET_URL', 'CIB_CUSTOMER_URL', 'CIB_KORNYEZET',
  'CIB_RETURN_URL', 'CIB_HMAC_TITOK'].map((k) => [k, '']));

let bank;
let visszaallit;

beforeAll(async () => {
  bank = await inditHamisBank();
  // A TrID-enkénti köz itt a valódi alapérték (60 s): a visszatérés
  // soron kívüli lekérdezését ehhez mérjük.
  visszaallit = beallitEnv(bank.env({
    CIB_BEVEZETES: '2026-01-01',
    CIB_HTTP_TIMEOUT_MS: '1500',
    CIB_ZARAS_TIMEOUT_MS: '1500',
    CIB_INDITAS_OSSZKERET_MS: '5000',
    CIB_LEKERDEZES_KOZ_MS: '60000',
  }));
});
afterAll(async () => {
  visszaallit();
  await bank.leallit();
});
beforeEach(async () => {
  __resetRateLimitsForTests();
  LEVELEK.length = 0;
  bank.horog(null);
  cf().__resetCibAllapotForTests();
  cf().szivveres();
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
});

// ── Segédek ──────────────────────────────────────────────────────────
async function elfogadottFuvar() {
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
  return { felado, szallito, job };
}
const HOZZAJARULASSAL = { consent: true, cib_adatkezelesi_hozzajarulas: true };
const fizet = (f, job, body = HOZZAJARULASSAL) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send(body);
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
const bankDb = (trid, msgt) => bank.szamol(trid, msgt);
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
}
async function jobSor(id) {
  return (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
}
async function esedekes(trid) {
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 second',
                  cib_last_query_at = CASE WHEN cib_last_query_at IS NULL THEN NULL ELSE NOW() - INTERVAL '1 hour' END,
                  cib_lease_until = NULL, cib_lease_owner = NULL WHERE payment_id = $1`, [trid]);
}
async function bankOldalon(felado, job) {
  const r = await fizet(felado, job);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await request(app).get(`/payments/cib/tovabb/${hopToken(r)}`).redirects(0)).status).toBe(302);
  return r.body.trid;
}
async function visszater(trid, dontes = 'fizet') {
  if (dontes) bank.dont(trid, dontes);
  const r = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
  await cf().varjHatterre();
  return r;
}
async function msgt10Ota(trid, mp) {
  await db.query('UPDATE payment_sessions SET created_at = NOW() - make_interval(secs => $2::int) WHERE payment_id = $1', [trid, mp]);
  await db.query(`UPDATE cib_messages SET created_at = NOW() - make_interval(secs => $2::int)
                   WHERE payment_id = $1 AND direction = 'ki' AND msgt = 10`, [trid, mp]);
}
async function kovetkezoMp(trid) {
  const { rows } = await db.query(
    'SELECT EXTRACT(EPOCH FROM (cib_next_action_at - NOW()))::float AS mp FROM payment_sessions WHERE payment_id = $1', [trid],
  );
  return rows[0].mp;
}
const dijAllapot = async (f, job) => (await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(f))).body;

// =====================================================================
describe('Visszatérés: azonnali MSGT33 a TrID-enkénti köz ellenére', () => {
  it('a kör 6 mp-e kérdezett (PR); a visszatérés azonnal kérdez és zár', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33)).toBe(1);
    await db.query(`UPDATE payment_sessions SET cib_last_query_at = NOW() - INTERVAL '6 seconds' WHERE payment_id = $1`, [trid]);
    await visszater(trid);
    expect(bankDb(trid, 33), 'a visszatérés után a köz miatt nem kérdeztünk').toBe(2);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  });

  it('a visszajátszott visszatérés nem kalapál: a visszatérés utáni első lekérdezés után a köz újra él', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }, { rc: 'PR' }]);
    await visszater(trid, null);
    expect(bankDb(trid, 33)).toBe(1);
    // A visszatérés 10 mp-e volt, az utána küldött lekérdezés 6 mp-e: a
    // visszajátszott MSGT21 a visszatérés idejét nem írja felül.
    await db.query(`UPDATE payment_sessions SET cib_returned_at = NOW() - INTERVAL '10 seconds',
                    cib_last_query_at = NOW() - INTERVAL '6 seconds' WHERE payment_id = $1`, [trid]);
    await visszater(trid, null);
    await visszater(trid, null);
    expect(bankDb(trid, 33), 'a visszajátszás soron kívül kérdezett').toBe(1);
  });

  it('5 mp-en belüli lekérdezés után a visszatérés nem kérdez azonnal, de 5 mp-en belül esedékes', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33)).toBe(1);
    await visszater(trid);
    expect(bankDb(trid, 33), 'a kalapálás-fék nem él').toBe(1);
    expect(await kovetkezoMp(trid)).toBeLessThanOrEqual(6);
  });

  it('a kör kérdése közben érkező visszatérés után a következő lekérdezés 5 mp-en belül esedékes', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    let lefutott = false;
    bank.horog(async (u) => {
      if (u.msgt !== 33 || u.trid !== trid || lefutott) return;
      lefutott = true;
      bank.dont(trid, 'fizet');
      await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
    });
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    bank.horog(null);
    expect(lefutott).toBe(true);
    expect((await sor(trid)).cib_state).toBe('redirected');
    expect(await kovetkezoMp(trid), 'a visszatérés a kör 60 mp-es köze mögé szorult').toBeLessThanOrEqual(6);
  });
});

// =====================================================================
describe('D04-visszalépés és a zárási határidő', () => {
  it('a visszatért vásárló lekérdezését a visszalépés nem tolja a határidőn túlra', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    bank.tridre(ta, 33, [{ nyers: 'RC=D04', http: 500 }]);
    await visszater(ta, null);

    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    await msgt10Ota(tb, 500);
    await visszater(tb);
    expect(bankDb(tb, 33)).toBe(0);
    expect(await kovetkezoMp(tb), 'a visszalépés a 570 mp-es határidőn túlra ütemezett').toBeLessThan(70);

    await msgt10Ota(tb, 560);
    await esedekes(tb);
    await kor();
    await cf().varjHatterre();
    expect(bankDb(tb, 33), 'a határidő előtt a visszalépés alatt sem kérdeztünk').toBe(1);
    expect(await sor(tb)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  });
});

// =====================================================================
describe('Bérlet: rövid, de a leghosszabb banki hívásnál hosszabb', () => {
  it('a bérlet a leghosszabb banki hívás + tartalék, nem 3 perc', async () => {
    const env = bank.env();
    const alap = p.cibBeallitasok(env);
    expect(cf().berletMp(alap)).toBeLessThan(120);
    expect(cf().berletMp(alap) * 1000).toBeGreaterThan(Math.max(alap.hangolok.httpIdokeretMs, alap.hangolok.zarasIdokeretMs) + 20000);
    const max = p.cibBeallitasok({ ...env, CIB_HTTP_TIMEOUT_MS: '60000', CIB_ZARAS_TIMEOUT_MS: '60000' });
    expect(cf().berletMp(max) * 1000).toBeGreaterThan(60000 + 20000);

    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR' }]);
    let berletMp = null;
    bank.horog(async (u) => {
      if (u.msgt !== 33 || u.trid !== trid) return;
      const { rows } = await db.query('SELECT EXTRACT(EPOCH FROM (cib_lease_until - NOW()))::float AS mp FROM payment_sessions WHERE payment_id = $1', [trid]);
      berletMp = rows[0].mp;
    });
    await esedekes(trid);
    await kor();
    bank.horog(null);
    expect(berletMp).not.toBeNull();
    expect(berletMp, 'a 3 perces bérlet késlelteti az összeomlás utáni helyreállítást').toBeLessThan(120);
  });
});

// =====================================================================
describe('Szünet-kapcsoló: CIB_UJ_FIZETES_TILTVA', () => {
  it('új kártyás fizetés 503 CIB_PAUSED; a meglévő lezárul; a hop nem nyit bankot; a kupon működik', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const b = await elfogadottFuvar();
    const kesz = await fizet(b.felado, b.job);
    expect(kesz.status).toBe(200);
    const vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      const c = await elfogadottFuvar();
      const elotte = bank.uzenetek.length;
      const r = await fizet(c.felado, c.job);
      expect(r.status, JSON.stringify(r.body)).toBe(503);
      expect(r.body.code).toBe('CIB_PAUSED');
      expect(bank.uzenetek.length, 'szünet alatt MSGT10 ment ki').toBe(elotte);
      expect(await dijAllapot(c.felado, c.job)).toMatchObject({ can_pay: false, pay_blocked_reason: 'szunetel' });

      const hop = await request(app).get(`/payments/cib/tovabb/${hopToken(kesz)}`).redirects(0);
      expect(hop.status, 'szünet alatt a hop a bankhoz vitt').toBe(303);
      expect(hop.headers.location).toMatch(/fizetes=link-lejart/);

      await visszater(ta);
      expect(await sor(ta)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });

      const d = await elfogadottFuvar();
      await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                      VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [d.felado.id]);
      const k = await fizet(d.felado, d.job);
      expect(k.status, JSON.stringify(k.body)).toBe(200);
      expect(k.body.paid_via_voucher).toBe(true);
    } finally {
      vissza();
    }
    expect(p.OLVASOTT_ENV).toContain('CIB_UJ_FIZETES_TILTVA');
  });

  it('szünet alatt a CIB-nyilatkozat nélküli /pay is 503 CIB_PAUSED (nem „fogadd el a nyilatkozatot")', async () => {
    const vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      const c = await elfogadottFuvar();
      for (const body of [{ consent: true }, {}]) {
        const r = await fizet(c.felado, c.job, body);
        expect(r.status, `szünet alatt ${JSON.stringify(body)} → ${JSON.stringify(r.body)}`).toBe(503);
        expect(r.body.code).toBe('CIB_PAUSED');
      }
      expect((await jobSor(c.job.id)).fee_consent_at, 'szünet alatt a nyilatkozat rögzült').toBeNull();
    } finally {
      vissza();
    }
  });

  it('érvénytelen szünet-érték (pl. „yes") → SZÜNET (fail-closed) + hangos hiba', () => {
    const env = bank.env({ CIB_BEVEZETES: '2026-01-01' });
    for (const ertek of ['yes', 'on', 'tru']) {
      const b = p.cibBeallitasok({ ...env, CIB_UJ_FIZETES_TILTVA: ertek });
      expect(b.ujFizetesTiltva, `CIB_UJ_FIZETES_TILTVA=${ertek} mellett új banki zárolások indulnának`).toBe(true);
    }
    expect(p.cibBeallitasok({ ...env, CIB_UJ_FIZETES_TILTVA: 'false' }).ujFizetesTiltva).toBe(false);
    expect(p.cibBeallitasok({ ...env, CIB_SIKERTELEN_LEZARAS: 'yes' }).sikertelenLezaras, 'más kapcsoló marad').toBe(true);
    const hibak = [];
    const sentry = { captureMessage: (m, szint) => hibak.push({ m, szint }) };
    const konzol = { log() {}, warn() {}, error: (m) => hibak.push({ m, szint: 'konzol' }) };
    p.naplozCibKonfigot({ env: { ...env, CIB_UJ_FIZETES_TILTVA: 'yes' }, konzol, sentry });
    expect(hibak.some((h) => h.szint === 'error' && /CIB_UJ_FIZETES_TILTVA/.test(h.m)), 'nincs Sentry error').toBe(true);
    expect(hibak.some((h) => h.szint === 'konzol' && /CIB_UJ_FIZETES_TILTVA/.test(h.m))).toBe(true);
  });
});

// =====================================================================
describe('Konfig nélkül maradt függő kísérletek', () => {
  it('induláskor: hangos hiba + riasztó levél állapotonkénti darabszámmal; teljes konfignál csend', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized' WHERE payment_id = $1`, [tb]);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nincs = beallitEnv(KOTELEZO_URES);
    try {
      const r = await cf().arvaKiserletekEllenorzese();
      expect(r.osszes).toBeGreaterThanOrEqual(2);
      expect(r.allapotok.redirected).toBeGreaterThanOrEqual(1);
      expect(r.allapotok.authorized).toBeGreaterThanOrEqual(1);
      const l = LEVELEK.filter((x) => x.nev === 'sendCibRiasztasEmail' && x.ok === 'arva_kiserletek');
      expect(l, 'konfig nélkül maradt függő kísérletekről nincs riasztás').toHaveLength(1);
      expect(JSON.stringify(l[0])).toMatch(/authorized/);
      expect(hiba.mock.calls.some((c) => /CIB/.test(String(c[0])))).toBe(true);
    } finally {
      nincs();
      hiba.mockRestore();
    }
    LEVELEK.length = 0;
    const r2 = await cf().arvaKiserletekEllenorzese();
    expect(r2.osszes).toBe(0);
    expect(LEVELEK.filter((x) => x.ok === 'arva_kiserletek')).toHaveLength(0);
    expect(ta).toBeTruthy();
  });

  it('élő konfig mellett a bevezetés (CIB_BEVEZETES) előtti nem végső kísérlet is riaszt — azt a kör nem látja', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', created_at = '2025-12-15T12:00:00Z'
                    WHERE payment_id = $1`, [ta]);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await cf().arvaKiserletekEllenorzese();
      expect(r.osszes, 'a bevezetés előtti függő kísérlet láthatatlan').toBeGreaterThanOrEqual(1);
      const l = LEVELEK.filter((x) => x.nev === 'sendCibRiasztasEmail' && x.ok === 'arva_kiserletek');
      expect(l).toHaveLength(1);
      expect(JSON.stringify(l[0])).toMatch(/close_unknown/);
      expect(hiba.mock.calls.some((c) => /CIB_BEVEZETES/.test(String(c[0])))).toBe(true);
    } finally {
      hiba.mockRestore();
      await db.query(`UPDATE payment_sessions SET state = 'closed', cib_state = 'expired' WHERE payment_id = $1`, [ta]);
    }
  });

  it('konfig nélküli admin-műveletek: könyvelés, lejáratás (MSGT32 nélkül), kétesre állítás (kiment MSGT32), rendezés', async () => {
    const admin = await createUser({ role: 'admin' });
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt)
                    VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', 1)`, [ta]);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closed_ok', cib_close_attempts = 1,
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('rc', '00', 'rt', 'Sikeres tranzakció',
                      'anum', '123456', 'amo', 500, 'cur', 'HUF', 'forras', '32', 'closed_at', NOW())
                    WHERE payment_id = $1`, [ta]);
    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    await msgt10Ota(tb, 700);
    const b2 = await elfogadottFuvar();
    const tb2 = await bankOldalon(b2.felado, b2.job);
    const c = await elfogadottFuvar();
    const tc = await bankOldalon(c.felado, c.job);
    await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt)
                    VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', 1)`, [tc]);
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized', cib_close_attempts = 1 WHERE payment_id = $1`, [tc]);
    await msgt10Ota(tc, 700);

    const nincs = beallitEnv(KOTELEZO_URES);
    const kezi = (trid, body) => request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin)).send(body);
    const INDOK = 'A CIB-konfiguráció visszaállítva, a tételt kézzel zárom.';
    try {
      const r1 = await kezi(ta, { muvelet: 'konyveles', indoklas: INDOK });
      expect(r1.status, JSON.stringify(r1.body)).toBe(200);
      await cf().varjHatterre();
      expect(await sor(ta)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
      expect((await jobSor(a.job.id)).paid_at).toBeTruthy();

      const r2 = await kezi(tb, { muvelet: 'lejaratas', indoklas: INDOK });
      expect(r2.status, JSON.stringify(r2.body)).toBe(200);
      expect(await sor(tb)).toMatchObject({ cib_state: 'expired', state: 'closed' });
      expect((await dijAllapot(b.felado, b.job)).open_attempt).toBeNull();

      const korai = await kezi(tb2, { muvelet: 'lejaratas', indoklas: INDOK });
      expect(korai.status, 'a határidő előtt lejárattuk').toBe(409);

      const r3 = await kezi(tc, { muvelet: 'lejaratas', indoklas: INDOK });
      expect(r3.status, JSON.stringify(r3.body)).toBe(200);
      expect(r3.body.allapot).toBe('ellenorzes');
      expect(await sor(tc)).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
      const rend = await request(app).post(`/payments/admin/cib/${tc}/rendezes`).set(...auth(admin))
        .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint a tranzakció reverzálva.' });
      expect(rend.status).toBe(200);

      const rossz = await kezi(ta, { muvelet: 'semmi', indoklas: INDOK });
      expect(rossz.status).toBe(400);
    } finally {
      nincs();
    }
  });
});

// =====================================================================
describe('Hop: másik kísérlet zárása mellett nem nyit bankot', () => {
  it('B kész (ready), A közben jóváhagyott → B hop-ja a fuvaroldalra visz, nincs MSGT20', async () => {
    const { felado, job } = await elfogadottFuvar();
    const ta = await bankOldalon(felado, job);
    const kesz = await fizet(felado, job);
    expect(kesz.status).toBe(200);
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized',
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('msgt33_rc', '00') WHERE payment_id = $1`, [ta]);
    const hop = await request(app).get(`/payments/cib/tovabb/${hopToken(kesz)}`).redirects(0);
    expect(hop.status, 'a hop egy második banki zárolást nyitott').toBe(303);
    expect(hop.headers.location).toMatch(new RegExp(`/dashboard/fuvar/${job.id}`));
    expect(bank.uzenetek.filter((u) => u.trid === kesz.body.trid && u.csatorna === 'customer')).toHaveLength(0);
    expect((await sor(kesz.body.trid)).cib_state).toBe('abandoned');
  });
});

// =====================================================================
describe('Hangolók és a 9:30-as ablak', () => {
  it('túl nagy köz / tick / indítási keret → alapérték + figyelmeztetés; az összeg a határidőbe fér', () => {
    const env = bank.env();
    const koz = p.cibBeallitasok({ ...env, CIB_LEKERDEZES_KOZ_MS: '600000' });
    expect(koz.hangolok.lekerdezesKozMs).toBe(60000);
    expect(koz.figyelmeztetesek.join(' ')).toMatch(/CIB_LEKERDEZES_KOZ_MS/);
    const tick = p.cibBeallitasok({ ...env, CIB_KOR_TICK_MS: '300000' });
    expect(tick.hangolok.korTickMs).toBe(30000);
    const indit = p.cibBeallitasok({ ...env, CIB_INDITAS_OSSZKERET_MS: '60000' });
    expect(indit.hangolok.inditasOsszkeretMs, 'a web 55 mp után feladja a /pay-t').toBe(40000);
    const szuk = p.cibBeallitasok({ ...env, CIB_ZARAS_HATARIDO_MP: '120' });
    const h = szuk.hangolok;
    expect(h.korTickMs + h.lekerdezesKozMs + h.httpIdokeretMs + h.zarasIdokeretMs, 'a hangolók összege a zárási ablakon túl')
      .toBeLessThanOrEqual(h.zarasHataridoMp * 1000 - 30000);
    expect(szuk.figyelmeztetesek.join(' ')).toMatch(/ablak/);
    expect(p.cibBeallitasok({ ...env, CIB_ZARAS_HATARIDO_MP: '300' }).hangolok.zarasHataridoMp).toBe(300);
    expect(p.cibBeallitasok({ ...env, CIB_EGYEZTETES_PERC: '5' }).hangolok.egyeztetesPerc).toBe(25);
    expect(p.cibBeallitasok({ ...env, CIB_EGYEZTETES_PERC: '30' }).hangolok.egyeztetesPerc).toBe(30);
    expect(p.OLVASOTT_ENV).toContain('CIB_EGYEZTETES_PERC');
  });

  it('S05 9:20-kor: rövidebb újrapróba még a határidőn belül, nem azonnal kétes', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 560);
    bank.tridre(trid, 32, [{ nyers: 'RC=S05', http: 200 }]);
    await visszater(trid);
    const s = await sor(trid);
    expect(s, 'a 30 mp-es fix várakozás miatt kétes lett').toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect(await kovetkezoMp(trid)).toBeLessThanOrEqual(6);
  });
});

// =====================================================================
describe('C1: GET /config/public', () => {
  it('teszt-módban teszt_uzem igaz, kartyas_fizetes „teszt"; nincs hitelesítés, no-store', async () => {
    const r = await request(app).get('/config/public');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ teszt_uzem: true, kartyas_fizetes: 'teszt' });
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('CIB-konfig nélkül (stub) teszt_uzem igaz, kártyás fizetés nincs; éles konfignál hamis', async () => {
    const nincs = beallitEnv(KOTELEZO_URES);
    try {
      const r = await request(app).get('/config/public');
      expect(r.body).toEqual({ teszt_uzem: true, kartyas_fizetes: null });
    } finally {
      nincs();
    }
    const { publikusKonfig } = require('../src/services/publikusKonfig');
    expect(publikusKonfig({
      ut: 'cib', beall: { allapot: 'teljes', kornyezet: 'eles' }, cibEki: true, stubElerheto: false,
    })).toEqual({ teszt_uzem: false, kartyas_fizetes: 'eles' });
    expect(publikusKonfig({
      ut: 'stub', beall: { allapot: 'nincs' }, cibEki: false, stubElerheto: true,
    })).toEqual({ teszt_uzem: true, kartyas_fizetes: null });
    expect(publikusKonfig({
      ut: 'hibas', beall: { allapot: 'hibas', kornyezet: 'eles' }, cibEki: false, stubElerheto: false,
    })).toEqual({ teszt_uzem: false, kartyas_fizetes: null });
  });
});

// =====================================================================
describe('C3/C4: fee-payment pay_blocked_reason, kupon a CIB-hozzájárulás nélkül', () => {
  it('nem_fizetheto / masik_kiserlet_folyamatban / probalkozasi_limit', async () => {
    const a = await elfogadottFuvar();
    await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [a.job.id]);
    expect(await dijAllapot(a.felado, a.job)).toMatchObject({ can_pay: false, pay_blocked_reason: 'nem_fizetheto' });

    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    expect(await dijAllapot(b.felado, b.job)).toMatchObject({ can_pay: true, pay_blocked_reason: null });
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized' WHERE payment_id = $1`, [tb]);
    expect(await dijAllapot(b.felado, b.job)).toMatchObject({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban' });

    const vissza = beallitEnv({ CIB_MAX_INDITAS_ORANKENT: '1' });
    try {
      const c = await elfogadottFuvar();
      expect((await fizet(c.felado, c.job)).status).toBe(200);
      expect(await dijAllapot(c.felado, c.job)).toMatchObject({ can_pay: false, pay_blocked_reason: 'probalkozasi_limit' });
    } finally {
      vissza();
    }
  });

  it('stub-útra került feladó (allowlist-váltás) és konfig nélkül: a nem végső kísérlet látszik, stubbal nem fizethet', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const masik = beallitEnv({ CIB_TESZT_FELHASZNALOK: '00000000-0000-4000-8000-000000000001' });
    try {
      const r = await dijAllapot(felado, job);
      expect(r.provider_kind).toBe('stub');
      expect(r.open_attempt).toMatchObject({ trid });
      expect(r).toMatchObject({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban' });
    } finally {
      masik();
    }
    const nincs = beallitEnv(KOTELEZO_URES);
    try {
      const r = await dijAllapot(felado, job);
      expect(r.open_attempt).toMatchObject({ trid });
      expect(r).toMatchObject({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban' });
    } finally {
      nincs();
    }
  });

  it('kupon: csak a 45/2014-es nyilatkozat kell (a CIB-hozzájárulás nem), a fee-payment jelzi', async () => {
    const { felado, job } = await elfogadottFuvar();
    expect((await dijAllapot(felado, job)).kupon_elerheto).toBe(false);
    await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                    VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [felado.id]);
    expect((await dijAllapot(felado, job)).kupon_elerheto).toBe(true);
    const elotte = bank.uzenetek.length;
    const r = await fizet(felado, job, { consent: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.paid_via_voucher).toBe(true);
    expect(bank.uzenetek.length).toBe(elotte);
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });
});
