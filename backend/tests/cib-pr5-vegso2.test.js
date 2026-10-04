// =====================================================================
//  CIB PR-5 — UTOLSÓ CSISZOLÓ KÖR (2026-10-03): a három jóváhagyó review
//  nem blokkoló megjegyzései. Mindegyik tétel a javítás nélkül (2c3b765) piros.
//   1. I2: a kézi „lejaratas" egy `closing` soron a motor saját
//      helyreállításával azonos várakozást kér (cib_close_sent_at + zárási
//      keret + 60 s) — egy épp kimenő MSGT32 mellett 409, nem lejárat; ha a
//      bank lezárt, de a siker már nem rögzíthető, tartós riasztás megy;
//   2. a „nem_lezarva" rendezés a MSGT32-re kapott, hiteles MSGT31 RC=00
//      (pl. AMO-eltérés) után is kifejezett megerősítést kér, és az
//      admin-részletek ezt a bizonyítékot mutatják;
//   3. a köztes „egyeztetés alatt" értesítés jelölése csak a tartós in-app
//      sor után;
//   4. a MSGT32-re kapott D04 nem kap 5 mp-es gyors újrapróbát a határidő
//      közelében, és a globális D04-visszalépést is elindítja;
//   5. a CIB_BEVEZETES valódi naptári nap (2026-09-31 → hibás konfig);
//   6. .env.example: nincs elavult UTC-figyelmeztetés, van élesítési sorrend;
//   7. a „visszaterites" eseménynaplója újrapróbálható (admin + söprés);
//   8. hibás CIB-konfignál a fee-payment „szunetel"-t ad; az eredményoldal
//      újrafizetése a szünetet és a próbálkozási korlátot is nézi.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

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
const p = () => require('../src/services/cibProtokoll');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

const KOTELEZO_URES = Object.fromEntries(['CIB_PID', 'CIB_KEY_B64', 'CIB_MARKET_URL', 'CIB_CUSTOMER_URL', 'CIB_KORNYEZET',
  'CIB_RETURN_URL', 'CIB_HMAC_TITOK'].map((k) => [k, '']));

let bank;
let visszaallit;
const INAPP = [];
let eredetiNotif;
/** Ha nem null: a createNotification erre a típusra (egyszer) null-t ad. */
let notifHiba = null;

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
  notifications.createNotification = async (n) => {
    if (notifHiba && n.type === notifHiba) {
      notifHiba = null;
      return null;
    }
    INAPP.push(n);
    return eredetiNotif(n);
  };
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
  notifHiba = null;
  bank.horog(null);
  cf().__resetCibAllapotForTests();
  cf().szivveres();
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
  await db.query(`UPDATE payment_sessions SET cib_notified_at = NOW()
                   WHERE provider = 'cib' AND cib_state IS NOT NULL AND cib_notified_at IS NULL AND state <> 'pending'`);
});
afterEach(() => { vi.useRealTimers(); });

// ── Segédek ──────────────────────────────────────────────────────────
async function elfogadottFuvar() {
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
  return { felado, szallito, job };
}
const fizet = (f, job, body = { consent: true, cib_adatkezelesi_hozzajarulas: true }) => request(app)
  .post(`/jobs/${job.id}/pay`).set(...auth(f)).send(body);
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
const bankDb = (trid, msgt) => bank.szamol(trid, msgt);
const riasztasok = (trid) => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid);
const feladoLevelek = (jobId, tipus) => LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === jobId
  && (!tipus || l.tipus === tipus));
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
async function kimenoZarasNaplo(trid, k = 1, mp = 0) {
  await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt, created_at)
                  VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', $2, NOW() - make_interval(secs => $3::int))`,
  [trid, k, mp]);
}
async function kovetkezoMp(trid) {
  const { rows } = await db.query(
    'SELECT EXTRACT(EPOCH FROM (cib_next_action_at - NOW()))::float AS mp FROM payment_sessions WHERE payment_id = $1', [trid],
  );
  return rows[0].mp;
}
const kezi = (admin, trid, muvelet, indoklas = 'A banki naplóval egyeztetve rendezem.') => request(app)
  .post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin)).send({ muvelet, indoklas });
const dijAllapot = async (f, job) => (await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(f))).body;
let tridSzamlalo = 0;
function ujTrid() {
  tridSzamlalo += 1;
  return `7${String(Date.now()).slice(-9)}${String(tridSzamlalo).padStart(6, '0')}`;
}
async function cibSor(job, felado, {
  state = 'pending', cibState, eredmeny = {}, closedReason = null, kiserlet = 0,
}) {
  const trid = ujTrid();
  await db.query(
    `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, provider, state, cib_state,
                                   cib_close_attempts, cib_next_action_at, cib_result, closed_reason, cib_redirected_at,
                                   created_at, settled_at)
     VALUES ($1, $2, $3, $4, 500, 'cib', $5, $6, $7, NULL, $8::jsonb, $9, NOW() - INTERVAL '25 minutes',
             NOW() - INTERVAL '30 minutes', CASE WHEN $5 <> 'pending' THEN NOW() - INTERVAL '10 minutes' END)`,
    [trid, job.id, felado.id, job.carrier_id, state, cibState, kiserlet, JSON.stringify(eredmeny), closedReason],
  );
  return trid;
}
/** Egy lekérdezés egyszeri, szimulált DB-hibája (a szöveg-minta szerint). */
function egyszerHibas(minta) {
  const eredeti = db.query;
  let elhasznalt = false;
  db.query = function koztes(text, params) {
    if (!elhasznalt && typeof text === 'string' && minta.test(text)) {
      elhasznalt = true;
      return Promise.reject(new Error('szimulált Neon-hiba'));
    }
    return eredeti.call(db, text, params);
  };
  return () => { db.query = eredeti; };
}
/**
 * A kimenő MSGT32 write-ahead naplósorának elakasztása (a review
 * hibainjektálása: a cib_messages-INSERT egy DB-akadás miatt áll). A
 * visszaadott `enged()` engedi tovább, a `megallt` ígéret akkor teljesül,
 * amikor a zárás elakadt.
 */
function zarasNaploElakad(trid) {
  const eredeti = db.query;
  let enged;
  const kapu = new Promise((r) => { enged = r; });
  let megallt;
  const megalltIgeret = new Promise((r) => { megallt = r; });
  db.query = async function koztes(text, params) {
    if (typeof text === 'string' && text.includes('INSERT INTO cib_messages') && Array.isArray(params)
      && params[0] === trid && params[1] === 'ki' && params[2] === 32) {
      megallt();
      await kapu;
    }
    return eredeti.call(db, text, params);
  };
  return { enged, megallt: megalltIgeret, visszaallit: () => { db.query = eredeti; } };
}
async function varjAmig(feltetel, ms = 8000) {
  const vege = Date.now() + ms;
  while (Date.now() < vege) {
    // eslint-disable-next-line no-await-in-loop
    if (await feltetel()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 25); });
  }
  return false;
}

// =====================================================================
describe('1. Kézi „lejaratas" egy closing soron: a motoréval azonos repülési várakozás (I2)', () => {
  it('a review forgatókönyve: a MSGT32 write-ahead sora elakad, a bérlet lejár — az admin nem járathatja le; a késve kimenő zárás könyvelődik', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const elakad = zarasNaploElakad(trid);
    try {
      bank.dont(trid, 'fizet');
      await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
      await elakad.megallt;
      expect((await sor(trid)).cib_state).toBe('closing');
      // Eltelt idő: a bérlet lejárt (a valóságban 75 s), a zárás 30 mp-e
      // „repül" (a write-ahead INSERT áll), a MSGT10 óta 12 perc.
      await db.query(`UPDATE payment_sessions SET cib_lease_until = NOW() - INTERVAL '1 second',
                             cib_close_sent_at = NOW() - INTERVAL '30 seconds' WHERE payment_id = $1`, [trid]);
      await msgt10Ota(trid, 12 * 60);
      const r = await kezi(admin, trid, 'lejaratas');
      expect(r.status, `az admin lejáratta a repülő zárást: ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body.code).toBe('CIB_CLOSE_IN_FLIGHT');
      expect((await sor(trid)).cib_state).toBe('closing');
    } finally {
      elakad.enged();
      await cf().varjHatterre();
      elakad.visszaallit();
    }
    expect(bankDb(trid, 32)).toBe(1);
    const s = await sor(trid);
    expect(s, 'a bank lezárt (terhelt), de nálunk nem lett fizetett').toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect((await jobSor(job.id)).paid_at).not.toBeNull();
    expect(feladoLevelek(job.id, 'nem_zart')).toHaveLength(0);
  });

  it('a repülési ablak után a lejáratás megy (kiment MSGT32 → kétes); ablakon belül ki nem ment zárásra is 409', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 12 * 60);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1, cib_next_action_at = NULL,
                           cib_close_sent_at = NOW() - INTERVAL '20 seconds',
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"zaras_eredete":"authorized","msgt33_rc":"00"}'::jsonb
                     WHERE payment_id = $1`, [trid]);
    // Naplósor nélkül (a write-ahead INSERT még állhat) is repül.
    let r = await kezi(admin, trid, 'lejaratas');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_IN_FLIGHT');
    await kimenoZarasNaplo(trid, 1, 20);
    r = await kezi(admin, trid, 'lejaratas');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_IN_FLIGHT');
    // A keret (teszt: 1,5 s) + 60 s után már nem repülhet.
    await db.query(`UPDATE payment_sessions SET cib_close_sent_at = NOW() - INTERVAL '70 seconds' WHERE payment_id = $1`, [trid]);
    r = await kezi(admin, trid, 'lejaratas');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await cf().varjHatterre();
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    expect(bankDb(trid, 32)).toBe(0);
  });

  it('CIB-konfig nélkül a zárási keret felső határával (60 s) számol', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 12 * 60);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1, cib_next_action_at = NULL,
                           cib_close_sent_at = NOW() - INTERVAL '100 seconds',
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"zaras_eredete":"authorized"}'::jsonb
                     WHERE payment_id = $1`, [trid]);
    await kimenoZarasNaplo(trid, 1, 100);
    const nincs = beallitEnv(KOTELEZO_URES);
    try {
      const r = await kezi(admin, trid, 'lejaratas');
      expect(r.status, 'konfig nélkül a teszt-env rövid kerete számított').toBe(409);
      expect(r.body.code).toBe('CIB_CLOSE_IN_FLIGHT');
      await db.query(`UPDATE payment_sessions SET cib_close_sent_at = NOW() - INTERVAL '130 seconds' WHERE payment_id = $1`, [trid]);
      expect((await kezi(admin, trid, 'lejaratas')).status).toBe(200);
    } finally {
      nincs();
    }
  });

  it('a zárási jog a cib_close_sent_at-et és a bérletet a tényleges órából (clock_timestamp) írja', () => {
    const forras = fs.readFileSync(path.join(__dirname, '../src/services/cibFizetes.js'), 'utf8');
    const i = forras.indexOf('async function zarasiJog(');
    const fv = forras.slice(i, forras.indexOf('\nasync function ', i + 10));
    expect(fv).toMatch(/cib_close_sent_at = clock_timestamp\(\)/);
    expect(fv).toMatch(/cib_lease_until = clock_timestamp\(\) \+/);
  });

  it('ha a bank lezárt, de a tétel közben más állapotba került (a siker nem rögzíthető): tartós riasztás, nem csak Sentry', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const elakad = zarasNaploElakad(trid);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      bank.dont(trid, 'fizet');
      await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
      await elakad.megallt;
      // Egy külső szereplő (pl. kézi SQL) a repülő zárás alatt lezárta a tételt.
      await db.query(`UPDATE payment_sessions SET cib_state = 'expired', state = 'closed', cib_notified_at = NOW()
                       WHERE payment_id = $1`, [trid]);
    } finally {
      elakad.enged();
      await cf().varjHatterre();
      elakad.visszaallit();
      hiba.mockRestore();
    }
    expect(bankDb(trid, 32)).toBe(1);
    expect(riasztasok(trid).map((l) => l.ok), 'a terhelt, de rögzíthetetlen zárásról nem ment riasztás').toContain('zaras_iras_utkozes');
    expect(INAPP.some((n) => n.type === 'cib_review' && String(n.body).includes(trid))).toBe(true);
    const { html } = emailSzolg.cibRiasztasTartalom({ trid, jobId: job.id, ok: 'zaras_iras_utkozes' });
    expect(html).not.toMatch(/automatikusan eldönti/);
    expect(html).toMatch(/terhelt/);
  });
});

// =====================================================================
describe('2. „nem_lezarva" a MSGT32-re kapott hiteles MSGT31 RC=00 után', () => {
  /** A bank lezárt (00), de a válasz AMO-ja eltér → close_unknown (zaras_mezo_elteres). */
  async function amoElteres() {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ amo: '999' }]);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await visszater(trid);
    } finally {
      hiba.mockRestore();
    }
    const s = await sor(trid);
    expect(s.cib_state).toBe('close_unknown');
    expect(s.cib_result.ok).toBe('zaras_mezo_elteres');
    expect(s.cib_result.egyeztetes_elso_00).toBeUndefined();
    return { felado, job, trid };
  }

  it('megerősítés nélkül 409 CIB_BANK_00_RECORDED, a díj nem fizethető újra', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job, trid } = await amoElteres();
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nem zárult le.' });
    expect(r.status, `a banki 00 ellenére megerősítés nélkül rendezhető: ${JSON.stringify(r.body)}`).toBe(409);
    expect(r.body.code).toBe('CIB_BANK_00_RECORDED');
    expect(r.body.zaras_00).toMatchObject({ kiserlet: 1 });
    expect(typeof r.body.zaras_00.at).toBe('string');
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    expect((await dijAllapot(felado, job)).can_pay).toBe(false);
  });

  it('az admin-részletek mutatják a bizonyítékot; kifejezett megerősítéssel rendezhető', async () => {
    const admin = await createUser({ role: 'admin' });
    const { job, trid } = await amoElteres();
    const d = await request(app).get(`/payments/admin/cib/${trid}`).set(...auth(admin));
    expect(d.status).toBe(200);
    expect(d.body.zaras_00_valasz).toMatchObject({ kiserlet: 1 });
    expect(typeof d.body.zaras_00_valasz.at).toBe('string');
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank írásban: nem zárult le, a 00 tévedés.', elso_00_ellenere: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s.cib_result).toMatchObject({ ok: 'admin_nem_lezarva', admin_elso_00_ellenere: true });
    expect(feladoLevelek(job.id, 'admin_nem_lezarva')).toHaveLength(1);
  });

  it('válasz nélküli (bontott) zárás után nincs bizonyíték: a részletekben null, megerősítés nem kell', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    const d = await request(app).get(`/payments/admin/cib/${trid}`).set(...auth(admin));
    expect(d.body.zaras_00_valasz).toBeNull();
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nem zárult le.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

// =====================================================================
describe('3. A köztes „egyeztetés alatt" értesítés tartós', () => {
  it('a sikertelen in-app beszúrás után nem jelöl — a következő kör pótolja, egy levéllel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    notifHiba = 'payment_review';
    await visszater(trid);
    let s = await sor(trid);
    expect(s.cib_state).toBe('close_unknown');
    expect(s.cib_result.egyeztetes_ertesites_at, 'tartós in-app sor nélkül „értesítettnek" jelölt').toBeUndefined();
    expect(INAPP.filter((n) => n.user_id === felado.id && n.type === 'payment_review')).toHaveLength(0);
    expect(feladoLevelek(job.id, 'egyeztetes')).toHaveLength(0);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s.cib_result.egyeztetes_ertesites_at).toBeTruthy();
    expect(INAPP.filter((n) => n.user_id === felado.id && n.type === 'payment_review')).toHaveLength(1);
    expect(feladoLevelek(job.id, 'egyeztetes')).toHaveLength(1);
    expect(bankDb(trid, 32)).toBe(1);
  });
});

// =====================================================================
describe('4. MSGT32-re kapott D04 (rátakorlát)', () => {
  it('a határidő közelében nincs 5 mp-es gyors újrapróba — a normál várakozás nem fér be, MSGT32 nem megy újra', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 540);
    bank.tridre(trid, 32, [{ nyers: 'RC=D04', http: 200 }]);
    await visszater(trid);
    const s = await sor(trid);
    expect(s.cib_state === 'authorized' && (await kovetkezoMp(trid)) <= 6,
      'a D04 után 5 mp-es gyors újrapróba ütemeződött').toBe(false);
    expect(s.cib_state).not.toBe('authorized');
    expect(bankDb(trid, 32)).toBe(1);
  });

  it('a S05 a határidő közelében továbbra is megkapja a gyors újrapróbát', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 540);
    bank.tridre(trid, 32, [{ nyers: 'RC=S05', http: 200 }]);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect(await kovetkezoMp(trid)).toBeLessThanOrEqual(6);
  });

  it('a MSGT32 D04 a globális D04-visszalépést is elindítja: egy másik kísérlet MSGT33-ja vár', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    bank.tridre(ta, 32, [{ nyers: 'RC=D04', http: 200 }]);
    await visszater(ta);
    const s = await sor(ta);
    expect(s.cib_state, 'a D04 utáni normál újrapróba (60 s) elmaradt').toBe('authorized');
    expect(await kovetkezoMp(ta)).toBeGreaterThan(30);
    await esedekes(tb);
    await kor();
    await cf().varjHatterre();
    expect(bankDb(tb, 33), 'a MSGT32-re kapott D04 után a többi lekérdezés nem lépett vissza').toBe(0);
    expect(await kovetkezoMp(tb)).toBeGreaterThan(60);
  });
});

// =====================================================================
describe('5. CIB_BEVEZETES: valódi naptári nap', () => {
  it('a nem létező nap (2026-09-31, 2027-02-29, 2026-13-01, 2026-02-30) hibás konfig; a szökőnap és a valódi nap rendben', () => {
    for (const d of ['2026-09-31', '2027-02-29', '2026-13-01', '2026-02-30', '2026-04-31']) {
      const b = p().cibBeallitasok(bank.env({ CIB_BEVEZETES: d }));
      expect(b.allapot, `${d}: nem létező nap „teljes" konfigot adott`).toBe('hibas');
      expect(b.okok).toContain('bevezetes_ervenytelen');
      // A DB-oldali összevetés így sem kaphatja meg a nem létező napot.
      expect(b.bevezetes).toBe(p().CIB_BEVEZETES_ALAP);
    }
    for (const d of ['2024-02-29', '2026-09-30', '2026-01-01']) {
      expect(p().cibBeallitasok(bank.env({ CIB_BEVEZETES: d })).allapot, d).toBe('teljes');
    }
  });

  it('hangos: a boot-napló hibát ír (Sentry error), a /pay 503 — a kör nem fut a nem létező nappal', async () => {
    const naplo = [];
    const jelzes = [];
    const konzol = { log: () => {}, warn: () => {}, error: (m) => naplo.push(m) };
    const sentry = { captureMessage: (m, szint) => jelzes.push([m, szint]) };
    p().naplozCibKonfigot({ env: bank.env({ CIB_BEVEZETES: '2026-09-31' }), konzol, sentry });
    expect(naplo.join('\n')).toMatch(/bevezetes_ervenytelen/);
    expect(jelzes.some(([m, szint]) => /bevezetes_ervenytelen/.test(m) && szint === 'error')).toBe(true);
    const vissza = beallitEnv({ CIB_BEVEZETES: '2026-09-31' });
    try {
      const { felado, job } = await elfogadottFuvar();
      const r = await fizet(felado, job);
      expect(r.status).toBe(503);
      expect(await kor()).toBe(0);
    } finally {
      vissza();
    }
  });
});

// =====================================================================
describe('6. .env.example: a CIB_BEVEZETES és az élesítési sorrend', () => {
  const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  it('nincs elavult UTC-napos figyelmeztetés; a budapesti nap és a budapesti éjfél a leírás', () => {
    expect(env).not.toMatch(/UTC szerint értendő/);
    expect(env).not.toMatch(/UTC-éjfélként/);
    expect(env).not.toMatch(/nappal élesíts/);
    expect(env).toMatch(/budapesti naptári nap/);
    expect(env).toMatch(/budapesti éjfél/);
  });

  it('az élesítési / váltási sorrend: 098-as migráció → CIB_UJ_FIZETES_TILTVA=true → 0 nem végső kísérlet → a változtatás', () => {
    const i = env.indexOf('CIB ÉLESÍTÉSI / VÁLTÁSI SORREND');
    expect(i, 'hiányzik a sorrend-blokk').toBeGreaterThan(-1);
    const blokk = env.slice(i, i + 3000);
    const lepesek = [/098/, /CIB_UJ_FIZETES_TILTVA=true/, /0 nem végső/, /CIB_\* változtatás/];
    const helyek = lepesek.map((m) => blokk.search(m));
    for (const [j, h] of helyek.entries()) expect(h, `hiányzó lépés: ${lepesek[j]}`).toBeGreaterThan(-1);
    for (let j = 1; j < helyek.length; j += 1) expect(helyek[j], `rossz sorrend: ${lepesek[j]}`).toBeGreaterThan(helyek[j - 1]);
  });
});

// =====================================================================
describe('7. A „visszaterites" pénzügyi nyoma nem veszhet el', () => {
  async function arvaSor() {
    const { felado, job } = await elfogadottFuvar();
    const trid = await cibSor(job, felado, {
      state: 'needs_review', cibState: 'closed_ok', eredmeny: { rc: '00', anum: 'A1B2C3', ok: 'konyvelesi_arva' }, kiserlet: 1,
    });
    return { felado, job, trid };
  }
  const refunded = async (trid) => (await db.query(
    `SELECT * FROM payment_events WHERE payment_id = $1 AND status = 'Refunded'`, [trid],
  )).rows;

  it('az elbukó eseménynapló után a második admin-kísérlet nem 409: pótolja a naplót, pontosan egyszer', async () => {
    const admin = await createUser({ role: 'admin' });
    const { job, trid } = await arvaSor();
    const vissza = egyszerHibas(/INSERT INTO payment_events/);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await kezi(admin, trid, 'visszaterites', 'A banknál visszatérítve, ügyszám a levelezésben.');
      expect(r.status).toBeGreaterThanOrEqual(500);
    } finally {
      vissza();
      hiba.mockRestore();
    }
    await cf().varjHatterre();
    expect(await sor(trid)).toMatchObject({ state: 'closed', closed_reason: 'admin_visszaterites' });
    expect(await refunded(trid)).toHaveLength(0);
    const r2 = await kezi(admin, trid, 'visszaterites', 'Másodszor: a pénzügyi nyom pótlása.');
    expect(r2.status, `a hiányzó pénzügyi nyom mellett 409: ${JSON.stringify(r2.body)}`).toBe(200);
    const ev = await refunded(trid);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_type: 'admin', processed: true });
    expect(Number(ev[0].total_amount)).toBe(500);
    // A nyom megvan: a harmadik kísérlet már állapot-ütközés, és értesítés sem megy kétszer.
    const r3 = await kezi(admin, trid, 'visszaterites', 'Harmadszor: ennek már nincs teendője.');
    expect(r3.status).toBe(409);
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'visszateritve')).toHaveLength(1);
    // Az eredeti admin-döntés marad (a pótlás nem írja felül).
    expect((await sor(trid)).cib_result.visszaterites.admin_indoklas).toBe('A banknál visszatérítve, ügyszám a levelezésben.');
  });

  it('admin nélkül is: a riasztás-söprés pótolja a hiányzó Refunded eseményt', async () => {
    const admin = await createUser({ role: 'admin' });
    const { trid } = await arvaSor();
    const vissza = egyszerHibas(/INSERT INTO payment_events/);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await kezi(admin, trid, 'visszaterites', 'A banknál visszatérítve, ügyszám a levelezésben.');
    } finally {
      vissza();
      hiba.mockRestore();
    }
    expect(await refunded(trid)).toHaveLength(0);
    await db.query('UPDATE payment_sessions SET settled_at = NOW() - INTERVAL \'5 minutes\' WHERE payment_id = $1', [trid]);
    await cf().riasztasSopres();
    expect(await refunded(trid), 'az elveszett pénzügyi nyomot semmi nem pótolta').toHaveLength(1);
    await cf().riasztasSopres();
    expect(await refunded(trid)).toHaveLength(1);
  });
});

// =====================================================================
describe('8. Szünet és hibás konfig: igaz tiltási ok és újrafizethetőség', () => {
  it('hibás CIB-konfig + nem végső kísérlet: a fee-payment „szunetel" (nem „másik kísérlet folyamatban")', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized' WHERE payment_id = $1`, [trid]);
    expect(await dijAllapot(felado, job)).toMatchObject({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban' });
    const vissza = beallitEnv({ CIB_KORNYEZET: 'rossz' });
    try {
      expect(p().cibKonfig()).toBe('hibas');
      const r = await dijAllapot(felado, job);
      expect(r.provider_kind).toBe('cib');
      expect(r.open_attempt).toMatchObject({ trid });
      expect(r, 'hibás konfignál a kör áll — a „pár másodperc" ígéret hamis').toMatchObject({ can_pay: false, pay_blocked_reason: 'szunetel' });
    } finally {
      vissza();
    }
  });

  it('az eredményoldal ujra_fizetheto-ja a szünetet és a próbálkozási korlátot is nézi (kupon mellett a szünet nem tilt)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await visszater(trid, 'elutasit');
    expect((await sor(trid)).cib_state).toBe('failed');
    const eredmeny = async () => (await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(cf().eredmenyToken(trid))}`)).body;
    expect((await eredmeny()).ujra_fizetheto).toBe(true);
    let vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      expect((await eredmeny()).ujra_fizetheto, 'szünet alatt „újrafizethető"').toBe(false);
    } finally {
      vissza();
    }
    vissza = beallitEnv({ CIB_MAX_INDITAS_ORANKENT: '1' });
    try {
      expect((await eredmeny()).ujra_fizetheto, 'a próbálkozási korláton túl „újrafizethető"').toBe(false);
    } finally {
      vissza();
    }
    await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                    VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [felado.id]);
    vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      expect((await eredmeny()).ujra_fizetheto, 'a kupon a bankot nem érinti — a szünet alatt is beváltható').toBe(true);
    } finally {
      vissza();
    }
  });
});
