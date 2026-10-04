// =====================================================================
//  CIB PR-5 — VÉGSŐ KÖR (2026-10-04): a 3. review és az éles banki
//  újrafuttatás után maradt tételek. Mindegyik tétel a javítás nélkül
//  (c63fc55) piros.
//   1. I8: a végállapot UTÁN elvesző feladói értesítést a söprés pótolja
//      (a lezárt, értesítetlen sorok), pontosan egyszer; az értesítés a
//      végállapot-esemény ELŐTT megy, és csak tartós in-app sor után jelöl;
//   2. egyetlen közös feltétel: „a MSGT32 bizonyíthatóan kiment" (a
//      kísérletszám a ki nem ment zárásokon felül ÉS kimenő naplósor) — az
//      automatikus egyeztetés, a kézi lejáratás és a rendezés ugyanezt nézi;
//   3. a „nem_lezarva" rendezés 409, ha az egyeztetés már feljegyzett egy
//      ANUM-os 00-t — kifejezett megerősítés nélkül nem írható felül;
//   4. a CIB_BEVEZETES a budapesti naptári nap szerint (a DB-oldal is);
//   5. a szünet alatt használt, még fel nem használt link → ?fizetes=szunetel;
//   6. élő konfig melletti árva-riasztás saját okkal és igaz szöveggel;
//   7. a riasztás-söprés a már riasztott sorokat SQL-ben szűri;
//   8. /config/public: zárt éles teszt-allowlist mellett nincs kártyás út,
//      és a szimulált (stub) fizetés elérhetősége külön jelző;
//   9. a bent felejtett szünet induláskor Sentry-figyelmeztetést kap;
//  10. az admin-lista sorai a közölt okot (ok) is adják.
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
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei parkolnak,
  // a lezárt, értesítetlen sorok pedig „értesítettek" (a söprés ne vegye fel).
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
const fizet = (f, job) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f))
  .send({ consent: true, cib_adatkezelesi_hozzajarulas: true });
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
async function ketesOta(trid, msgt10Mp, msgt32Mp = msgt10Mp) {
  await msgt10Ota(trid, msgt10Mp);
  await db.query(`UPDATE cib_messages SET created_at = NOW() - make_interval(secs => $2::int)
                   WHERE payment_id = $1 AND direction = 'ki' AND msgt = 32`, [trid, msgt32Mp]);
}
async function kimenoZarasNaplo(trid, k = 1, mp = 0) {
  await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt, created_at)
                  VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', $2, NOW() - make_interval(secs => $3::int))`,
  [trid, k, mp]);
}
/** A végállapot (és vele a 087-es trigger settled_at-je) `mp` másodperce. */
async function lezarvaOta(trid, mp) {
  await db.query('UPDATE payment_sessions SET settled_at = NOW() - make_interval(secs => $2::int) WHERE payment_id = $1', [trid, mp]);
}
let tridSzamlalo = 0;
function ujTrid() {
  tridSzamlalo += 1;
  return `8${String(Date.now()).slice(-9)}${String(tridSzamlalo).padStart(6, '0')}`;
}
/**
 * Egy SQL-lel épített CIB-kísérlet. Alapból a bank oldaláig eljutott
 * (cib_redirected_at), 30 perccel ezelőtt indult.
 */
async function cibSor(job, felado, {
  state = 'pending', cibState, eredmeny = {}, closedReason = null, atiranyitva = true, kiserlet = 0, letrejott = null,
}) {
  const trid = ujTrid();
  await db.query(
    `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, provider, state, cib_state,
                                   cib_close_attempts, cib_next_action_at, cib_result, closed_reason, cib_redirected_at,
                                   created_at, settled_at)
     VALUES ($1, $2, $3, $4, 500, 'cib', $5, $6, $7, NULL, $8::jsonb, $9,
             CASE WHEN $10::boolean THEN NOW() - INTERVAL '25 minutes' END,
             COALESCE($11::timestamptz, NOW() - INTERVAL '30 minutes'),
             CASE WHEN $5 <> 'pending' THEN NOW() - INTERVAL '10 minutes' END)`,
    [trid, job.id, felado.id, job.carrier_id, state, cibState, kiserlet, JSON.stringify(eredmeny), closedReason,
      atiranyitva, letrejott],
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
const ERTESITES_SELECT = /cib_notified_at IS NULL AND ps\.cib_redirected_at IS NOT NULL/;
const feladoInapp = (felado) => INAPP.filter((n) => n.user_id === felado.id && ['payment_not_charged', 'payment_failed', 'payment_refunded'].includes(n.type));

// =====================================================================
describe('1. I8: a végállapot után elvesző feladói értesítést a söprés pótolja', () => {
  it('a review forgatókönyve: kétes → egyeztetés → TO, és egy DB-hiba az értesítés lekérdezésén — a söprés pontosan egyszer pótolja', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    await ketesOta(trid, 40 * 60, 26 * 60);
    bank.tridre(trid, 33, [{ rc: 'TO' }]);
    const vissza = egyszerHibas(ERTESITES_SELECT);
    try {
      await esedekes(trid);
      await kor();
      await cf().varjHatterre();
    } finally {
      vissza();
    }
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('bank_visszaforditotta');
    expect(s.cib_notified_at).toBeNull();
    expect(feladoLevelek(job.id, 'bank_visszaforditotta')).toHaveLength(0);
    // A kör a lezárt sort nem veszi fel — eddig semmi nem pótolta.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await kor();
    }
    await lezarvaOta(trid, 5 * 60);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'bank_visszaforditotta'), 'az elveszett értesítést semmi nem pótolta').toHaveLength(1);
    expect(feladoInapp(felado).filter((n) => n.type === 'payment_not_charged')).toHaveLength(1);
    s = await sor(trid);
    expect(s.cib_notified_at).not.toBeNull();
    // Idempotens: a következő söprés nem küld második levelet (az egyeztetésről
    // szóló közbenső levél mellett pontosan egy végső).
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'bank_visszaforditotta')).toHaveLength(1);
    expect(feladoLevelek(job.id).map((l) => l.tipus).sort()).toEqual(['bank_visszaforditotta', 'egyeztetes']);
    expect((await jobSor(job.id)).paid_at).toBeNull();
  });

  it('összeomlás az esemény és az értesítés között: minden értesítendő végállapotot a söprés pótol, a többit nem', async () => {
    const esetek = [
      { cibState: 'failed', ok: 'bank_elutasitas', tipus: 'sikertelen' },
      { cibState: 'failed', ok: 'admin_nem_lezarva', tipus: 'admin_nem_lezarva' },
      { cibState: 'expired', ok: 'bank_visszaforditotta', tipus: 'bank_visszaforditotta' },
      { cibState: 'expired', ok: 'zarasi_hatarido', tipus: 'nem_zart' },
      { cibState: 'not_closed', ok: 'masik_zaras', tipus: 'masik_kiserlet' },
      { cibState: 'not_closed', ok: 'amo_elteres', tipus: 'osszeg_elteres' },
      {
        cibState: 'closed_ok', ok: 'admin_visszaterites', tipus: 'visszateritve', closedReason: 'admin_visszaterites', rc: '00',
      },
    ];
    const sorok = [];
    for (const e of esetek) {
      // eslint-disable-next-line no-await-in-loop
      const f = await elfogadottFuvar();
      // eslint-disable-next-line no-await-in-loop
      const trid = await cibSor(f.job, f.felado, {
        state: 'closed', cibState: e.cibState, closedReason: e.closedReason || null, eredmeny: { ok: e.ok, rc: e.rc || null },
      });
      sorok.push({ ...e, ...f, trid });
    }
    // Ezekről NEM jár értesítés: a bankig sem jutott, félbehagyott, vagy a
    // CIB_BEVEZETES előtti.
    const n1 = await elfogadottFuvar();
    const nemAtiranyitott = await cibSor(n1.job, n1.felado, { state: 'closed', cibState: 'failed', eredmeny: { ok: 'bank_elutasitas' }, atiranyitva: false });
    const n2 = await elfogadottFuvar();
    const felbehagyott = await cibSor(n2.job, n2.felado, { state: 'closed', cibState: 'abandoned', eredmeny: { ok: 'hop_lejart' } });
    const n3 = await elfogadottFuvar();
    const regi = await cibSor(n3.job, n3.felado, {
      state: 'closed', cibState: 'failed', eredmeny: { ok: 'bank_elutasitas' }, letrejott: '2025-12-20T12:00:00Z',
    });

    await cf().riasztasSopres();
    await cf().varjHatterre();
    for (const e of sorok) {
      expect(feladoLevelek(e.job.id, e.tipus), `${e.cibState}/${e.ok}: az értesítést semmi nem pótolta`).toHaveLength(1);
      expect(feladoLevelek(e.job.id)).toHaveLength(1);
      // eslint-disable-next-line no-await-in-loop
      expect((await sor(e.trid)).cib_notified_at).not.toBeNull();
    }
    for (const [f, trid] of [[n1, nemAtiranyitott], [n2, felbehagyott], [n3, regi]]) {
      expect(feladoLevelek(f.job.id), `${trid}: értesítés ment, holott nem jár`).toHaveLength(0);
    }
    await cf().riasztasSopres();
    await cf().varjHatterre();
    for (const e of sorok) expect(feladoLevelek(e.job.id), 'második levél ment').toHaveLength(1);
  });

  it('a frissen lezárt (épp értesítő) sorhoz a söprés nem nyúl — csak a türelmi idő után', async () => {
    const f = await elfogadottFuvar();
    const trid = await cibSor(f.job, f.felado, { state: 'closed', cibState: 'failed', eredmeny: { ok: 'bank_elutasitas' } });
    await lezarvaOta(trid, 5);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(feladoLevelek(f.job.id)).toHaveLength(0);
    await lezarvaOta(trid, 5 * 60);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(feladoLevelek(f.job.id, 'sikertelen')).toHaveLength(1);
  });

  it('az in-app értesítés sikertelen beszúrása után nem jelöl — a söprés tartósan pótolja, egy levéllel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    notifHiba = 'payment_failed';
    await visszater(trid, 'elutasit');
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'failed', state: 'closed' });
    expect(s.cib_notified_at, 'a tartós in-app sor nélkül „értesítettnek" jelölt').toBeNull();
    expect(feladoInapp(felado)).toHaveLength(0);
    await lezarvaOta(trid, 5 * 60);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s.cib_notified_at).not.toBeNull();
    expect(feladoInapp(felado).filter((n) => n.type === 'payment_failed')).toHaveLength(1);
    expect(feladoLevelek(job.id, 'sikertelen')).toHaveLength(1);
  });

  it('az admin „visszaterites" után elvesző értesítést a söprés pótolja', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const arva = await cibSor(job, felado, {
      state: 'needs_review', cibState: 'closed_ok', eredmeny: { rc: '00', anum: 'A1B2C3', ok: 'konyvelesi_arva' }, kiserlet: 1,
    });
    const vissza = egyszerHibas(ERTESITES_SELECT);
    try {
      const r = await request(app).post(`/payments/admin/cib/${arva}/kezi-rendezes`).set(...auth(admin))
        .send({ muvelet: 'visszaterites', indoklas: 'A banknál visszatérítve, ügyszám a levelezésben.' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    } finally {
      vissza();
    }
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'visszateritve')).toHaveLength(0);
    await lezarvaOta(arva, 5 * 60);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'visszateritve')).toHaveLength(1);
    expect(feladoInapp(felado).filter((n) => n.type === 'payment_refunded')).toHaveLength(1);
  });

  it('admin „visszaterites": az értesítés az eseménynapló ELŐTT megy — egy elbukó napló nem viszi el', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const arva = await cibSor(job, felado, {
      state: 'needs_review', cibState: 'closed_ok', eredmeny: { rc: '00', anum: 'A1B2C3', ok: 'konyvelesi_arva' }, kiserlet: 1,
    });
    const vissza = egyszerHibas(/INSERT INTO payment_events/);
    try {
      await request(app).post(`/payments/admin/cib/${arva}/kezi-rendezes`).set(...auth(admin))
        .send({ muvelet: 'visszaterites', indoklas: 'A banknál visszatérítve, ügyszám a levelezésben.' });
    } finally {
      vissza();
    }
    await cf().varjHatterre();
    const s = await sor(arva);
    expect(s).toMatchObject({ state: 'closed', closed_reason: 'admin_visszaterites' });
    expect(s.cib_notified_at, 'az eseménynapló hibája elvitte az értesítést').not.toBeNull();
    expect(feladoLevelek(job.id, 'visszateritve')).toHaveLength(1);
    expect(feladoInapp(felado).filter((n) => n.type === 'payment_refunded')).toHaveLength(1);
  });

  it('az értesítés a végállapot-esemény ELŐTT megy: ha az esemény elakad (összeomlás), a feladó már értesült', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const payments = require('../src/routes/payments');
    const eredeti = payments.confirmFeePayment;
    let felold;
    const elakadt = new Promise((r) => { felold = r; });
    payments.confirmFeePayment = async (id, status, opts) => {
      if (id === trid && status !== 'Succeeded') await elakadt;
      return eredeti(id, status, opts);
    };
    let ertesult = false;
    try {
      bank.dont(trid, 'elutasit');
      await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
      for (let i = 0; i < 80 && !ertesult; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 50); });
        // eslint-disable-next-line no-await-in-loop
        ertesult = !!(await sor(trid)).cib_notified_at;
      }
      expect((await sor(trid)).state, 'az esemény nem akadt el').toBe('pending');
    } finally {
      felold();
      payments.confirmFeePayment = eredeti;
      await cf().varjHatterre();
    }
    expect(ertesult, 'az értesítés a végállapot-esemény UTÁN ment (egy közbeni összeomlás elnyelte volna)').toBe(true);
    expect((await sor(trid)).state).toBe('closed');
    expect(feladoLevelek(job.id, 'sikertelen')).toHaveLength(1);
  });
});

// =====================================================================
describe('2. „A MSGT32 bizonyíthatóan kiment" — egy közös feltétel', () => {
  /** Jóváhagyott kísérlet, amelynek EGYETLEN zárási kísérlete bizonyítottan ki sem ment (kimenő naplósorral). */
  async function kiNemMentZaras(cibState, okMezo = {}) {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await db.query(`UPDATE payment_sessions SET cib_state = $2, cib_close_attempts = 1, cib_next_action_at = NULL,
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb
                     WHERE payment_id = $1`,
    [trid, cibState, JSON.stringify({ zaras_nem_kuldott: 1, zaras_eredete: 'authorized', msgt33_rc: '00', ...okMezo })]);
    await kimenoZarasNaplo(trid, 1);
    return { felado, job, trid };
  }

  it('kézi „lejaratas" egy ki sem ment zárás után: lejárt / „nem zárt", nem kétes', async () => {
    const admin = await createUser({ role: 'admin' });
    const { job, trid } = await kiNemMentZaras('authorized');
    await ketesOta(trid, 12 * 60, 11 * 60);
    const r = await request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'lejaratas', indoklas: 'A határidő lejárt, a bank nem zárhatott.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s.cib_state, 'a ki sem ment zárásból kétes lett (fagyasztás, „ne fizess újra")').toBe('expired');
    expect(s.cib_result.ok).toBe('admin_lejaratas_jovahagyott');
    expect(feladoLevelek(job.id, 'nem_zart')).toHaveLength(1);
    expect(feladoLevelek(job.id, 'egyeztetes')).toHaveLength(0);
    expect(riasztasok(trid)).toHaveLength(0);
    expect(bankDb(trid, 32)).toBe(0);
  });

  it('az automatikus egyeztetés egy ki sem ment zárásra nem kérdez, és 00-ra sem könyvel', async () => {
    const { job, trid } = await kiNemMentZaras('close_unknown', { ok: 'admin_ketes' });
    await ketesOta(trid, 40 * 60, 30 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    // Második kör is (a megerősítő 00 sem könyvelhet).
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(bankDb(trid, 33), 'a bankig sem jutott zárásra MSGT33-mal „egyeztetett"').toBe(0);
    expect(s.cib_state).toBe('expired');
    expect(s.cib_result.ok).toBe('bank_visszaforditotta');
    expect(s.cib_result.egyeztetes_forras).toBe('zaras_nem_ment_ki');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(bankDb(trid, 32)).toBe(0);
  });

  it('a „lezarva" rendezés ugyanezt a feltételt nézi (409 CIB_CLOSE_NOT_SENT)', async () => {
    const admin = await createUser({ role: 'admin' });
    const { trid } = await kiNemMentZaras('close_unknown', { ok: 'admin_ketes' });
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'lezarva', anum: 'AB1234', indoklas: 'A bank e-mailben megerősítette.' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_NOT_SENT');
  });

  it('a közös feltétel exportált, és mindhárom hely azt használja (nem a csak-naplósort néző változatot)', () => {
    expect(typeof cf().zarasKiment).toBe('function');
    const forras = fs.readFileSync(path.join(__dirname, '../src/services/cibFizetes.js'), 'utf8');
    const fv = (nev) => {
      const i = forras.indexOf(`async function ${nev}(`);
      const j = forras.indexOf('\nasync function ', i + 10);
      return forras.slice(i, j > 0 ? j : undefined);
    };
    for (const nev of ['closeUnknownLepes', 'keziRendezes', 'rendezes']) {
      expect(fv(nev), `${nev}: nem a közös „bizonyíthatóan kiment" feltételt használja`).toMatch(/zarasKiment/);
      expect(fv(nev)).not.toMatch(/kimenoZarasVan\(/);
    }
  });
});

// =====================================================================
describe('3. „nem_lezarva" egy feljegyzett ANUM-os 00 után', () => {
  async function ketesElso00val() {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1, cib_next_action_at = NULL,
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'zaras_valasz_nelkul',
                             'egyeztetes_elso_00', jsonb_build_object('anum', '654321', 'rt', 'Tranzakció elfogadva', 'at', NOW()))
                     WHERE payment_id = $1`, [trid]);
    await kimenoZarasNaplo(trid, 1, 30 * 60);
    return { felado, job, trid };
  }

  it('megerősítés nélkül 409 CIB_BANK_00_RECORDED, a fuvar fagyva marad', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job, trid } = await ketesElso00val();
    for (const zaszlo of [undefined, false, 'true', 1]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
        .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nem zárult le.', elso_00_ellenere: zaszlo });
      expect(r.status, `zászló: ${JSON.stringify(zaszlo)}`).toBe(409);
      expect(r.body.code).toBe('CIB_BANK_00_RECORDED');
      expect(r.body.error).toMatch(/00/);
    }
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    expect(feladoLevelek(job.id, 'admin_nem_lezarva')).toHaveLength(0);
    const fp = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(fp.body.can_pay).toBe(false);
  });

  it('kifejezett megerősítéssel (elso_00_ellenere: true) rendezhető — az admin-részletek mutatják az első 00-t', async () => {
    const admin = await createUser({ role: 'admin' });
    const { job, trid } = await ketesElso00val();
    const d = await request(app).get(`/payments/admin/cib/${trid}`).set(...auth(admin));
    expect(d.status).toBe(200);
    expect(d.body.result.egyeztetes_elso_00).toMatchObject({ anum: '654321' });
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank írásban: nem zárult le, a 00 tévedés.', elso_00_ellenere: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await cf().varjHatterre();
    expect((await sor(trid)).cib_result.ok).toBe('admin_nem_lezarva');
    expect(feladoLevelek(job.id, 'admin_nem_lezarva')).toHaveLength(1);
  });

  it('első 00 nélkül a „nem_lezarva" továbbra is megerősítés nélkül megy', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1, cib_next_action_at = NULL,
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"zaras_valasz_nelkul"}'::jsonb
                     WHERE payment_id = $1`, [trid]);
    await kimenoZarasNaplo(trid, 1, 30 * 60);
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nem zárult le.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

// =====================================================================
describe('4. CIB_BEVEZETES: a budapesti naptári nap', () => {
  it('00:00–02:00 budapesti időben a „mai" CIB_BEVEZETES nem jövőbeli (a launch-recept éjfél után is működik)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-10-06 00:30 Budapest (CEST) = 2026-10-05 22:30 UTC
    vi.setSystemTime(new Date('2026-10-05T22:30:00Z'));
    const ma = p().cibBeallitasok(bank.env({ CIB_BEVEZETES: '2026-10-06' }));
    expect(ma.okok, 'a budapesti „ma" jövőbelinek számított (UTC-nap)').not.toContain('bevezetes_jovobeli');
    expect(ma.allapot).toBe('teljes');
    vi.setSystemTime(new Date('2026-10-05T23:59:00Z'));
    expect(p().cibBeallitasok(bank.env({ CIB_BEVEZETES: '2026-10-06' })).allapot).toBe('teljes');
    // 2026-10-05 23:30 Budapest: a holnapi dátum még jövőbeli.
    vi.setSystemTime(new Date('2026-10-05T21:30:00Z'));
    const holnap = p().cibBeallitasok(bank.env({ CIB_BEVEZETES: '2026-10-06' }));
    expect(holnap.okok).toContain('bevezetes_jovobeli');
    // Télen (CET, +1 óra) is: 2026-12-01 00:30 Budapest = 11-30 23:30 UTC.
    vi.setSystemTime(new Date('2026-11-30T23:30:00Z'));
    expect(p().cibBeallitasok(bank.env({ CIB_BEVEZETES: '2026-12-01' })).allapot).toBe('teljes');
  });

  it('a DB-oldal is a budapesti éjféltől számol: a bevezetés napján 00:30-kor (UTC-ben még előző nap) indult kísérletet a kör felveszi', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    // 2026-03-10 00:30 Budapest (CET) = 2026-03-09 23:30 UTC
    await db.query(`UPDATE payment_sessions SET created_at = '2026-03-09T23:30:00Z' WHERE payment_id = $1`, [trid]);
    await esedekes(trid);
    const env = beallitEnv({ CIB_BEVEZETES: '2026-03-10' });
    // A Neon munkamenete GMT: a teszt-DB-t is UTC-re állítjuk minden lekérdezésnél.
    const eredeti = db.query;
    db.query = async function utcMunkamenet(text, params) {
      const c = await db.pool.connect();
      try {
        await c.query("SET TIME ZONE 'UTC'");
        return await c.query(text, params);
      } finally {
        await c.query('RESET TIME ZONE').catch(() => {});
        c.release();
      }
    };
    try {
      await kor();
      await cf().varjHatterre();
    } finally {
      db.query = eredeti;
      env();
    }
    expect(bankDb(trid, 33), 'a bevezetés napján, budapesti éjfél után indult kísérlet láthatatlan a körnek').toBe(1);
  });

  it('a DB-összevetés a közös, budapesti éjfélt adó kifejezéssel megy (nem nyers ::date)', async () => {
    expect(typeof p().bevezetesKezdetSql).toBe('function');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL TIME ZONE 'UTC'");
      const { rows } = await c.query(
        `SELECT ${p().bevezetesKezdetSql('$1')} AS kezdet`, ['2026-10-06'],
      );
      expect(new Date(rows[0].kezdet).toISOString()).toBe('2026-10-05T22:00:00.000Z');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
    const forrasok = ['../src/services/cibFizetes.js', '../src/services/cibLekerdezo.js', '../src/services/feeNotifications.js']
      .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'));
    for (const f of forrasok) {
      expect(f, 'nyers ::date összevetés a bevezetés-dátummal').not.toMatch(/(created_at|paid_at)\s*[<>]=?\s*\$\d+::date/);
    }
  });
});

// =====================================================================
describe('5. Szünet alatt a még fel nem használt link', () => {
  it('?fizetes=szunetel (nem „lejárt link"), és a banki oldal nem nyílik', async () => {
    const { felado, job } = await elfogadottFuvar();
    const kesz = await fizet(felado, job);
    expect(kesz.status).toBe(200);
    const vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      const hop = await request(app).get(`/payments/cib/tovabb/${hopToken(kesz)}`).redirects(0);
      expect(hop.status).toBe(303);
      expect(hop.headers.location).toBe(`https://www.gofuvar.hu/dashboard/fuvar/${job.id}?fizetes=szunetel`);
    } finally {
      vissza();
    }
    const s = await sor(kesz.body.trid);
    expect(s.cib_state).toBe('abandoned');
    expect(s.cib_result.ok).toBe('szunet');
    // A már felhasznált / lejárt link szünet nélkül továbbra is „link-lejart".
    const masodik = await request(app).get(`/payments/cib/tovabb/${hopToken(kesz)}`).redirects(0);
    expect(masodik.headers.location).toMatch(/fizetes=link-lejart/);
  });
});

// =====================================================================
describe('6. Árva kísérletek élő konfig mellett', () => {
  it('saját ok (arva_bevezetes_elott) és igaz szöveg — nem „a CIB EKI nem működik"', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', created_at = '2025-12-15T12:00:00Z'
                    WHERE payment_id = $1`, [trid]);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await cf().arvaKiserletekEllenorzese();
    } finally {
      hiba.mockRestore();
      await db.query(`UPDATE payment_sessions SET state = 'closed', cib_state = 'expired', cib_notified_at = NOW() WHERE payment_id = $1`, [trid]);
    }
    const l = LEVELEK.filter((x) => x.nev === 'sendCibRiasztasEmail' && !x.trid);
    expect(l.map((x) => x.ok)).toContain('arva_bevezetes_elott');
    expect(l.map((x) => x.ok)).not.toContain('arva_kiserletek');
    const { subject, html } = emailSzolg.cibRiasztasTartalom({ trid: null, jobId: null, ok: 'arva_bevezetes_elott', reszletek: 'close_unknown: 1' });
    expect(html).not.toMatch(/nem működik/);
    expect(html).toMatch(/CIB_BEVEZETES előtti függő kísérlet/);
    expect(html).toMatch(/rendezd az adminban/);
    expect(html).toMatch(/állítsd korábbra/);
    expect(subject).not.toMatch(/konfig nélkül/);
    // A konfig nélküli (nem működő) eset szövege változatlan.
    expect(emailSzolg.cibRiasztasTartalom({ trid: null, jobId: null, ok: 'arva_kiserletek' }).html).toMatch(/nem működik/);
  });
});

// =====================================================================
describe('7. A riasztás-söprés nem éheztethető ki', () => {
  it('100-nál több, már riasztott régi tétel mellett az új, riasztatlan tétel is riasztást kap', async () => {
    const elotag = `9${String(Date.now()).slice(-9)}`;
    await db.query(
      `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_close_attempts,
                                     cib_next_action_at, cib_result, created_at)
       SELECT $1 || lpad(g::text, 6, '0'), gen_random_uuid(), gen_random_uuid(), 500, 'cib', 'pending', 'close_unknown', 1,
              NOW() + INTERVAL '1 day',
              jsonb_build_object('ok', 'zaras_valasz_nelkul', 'riasztas_at', NOW(),
                                 'riasztva', jsonb_build_object('zaras_valasz_nelkul', NOW())),
              '2026-02-01T00:00:00Z'::timestamptz + make_interval(secs => g)
         FROM generate_series(1, 101) g`,
      [elotag],
    );
    const uj = `${elotag}999999`;
    await db.query(
      `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_close_attempts,
                                     cib_next_action_at, cib_result, created_at)
       VALUES ($1, gen_random_uuid(), gen_random_uuid(), 500, 'cib', 'pending', 'close_unknown', 1, NOW() + INTERVAL '1 day',
               '{"ok":"zaras_valasz_nelkul"}'::jsonb, '2026-02-02T00:00:00Z')`,
      [uj],
    );
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await cf().riasztasSopres();
      await cf().varjHatterre();
      expect(riasztasok(uj), 'a 100 régi, már riasztott tétel kiéheztette az újat').toHaveLength(1);
      expect(LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && String(l.trid || '').startsWith(elotag) && l.trid !== uj))
        .toHaveLength(0);
    } finally {
      hiba.mockRestore();
      await db.query('DELETE FROM payment_sessions WHERE payment_id LIKE $1', [`${elotag}%`]);
    }
  });
});

// =====================================================================
describe('8. /config/public: a kártyás út és a szimulált fizetés igaz jelzése', () => {
  const { publikusKonfig } = require('../src/services/publikusKonfig');
  it('éles futás, teszt-környezet, zárt allowlist: senki nem fizet kártyával → kartyas_fizetes null', () => {
    const eles = (tobb) => bank.env({
      NODE_ENV: 'production',
      CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki',
      CIB_CUSTOMER_URL: 'https://ekit.cib.hu/customer.saki',
      CIB_TESZT_FELHASZNALOK: '',
      ...tobb,
    });
    const vissza = beallitEnv(eles({ ALLOW_STUB_PAYMENTS: '' }));
    try {
      expect(p().cibKonfig()).toBe('teljes');
      expect(p().cibBeallitasok().tesztAllowlistZart).toBe(true);
      expect(publikusKonfig()).toEqual({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: false });
    } finally {
      vissza();
    }
    const stubbal = beallitEnv(eles({ ALLOW_STUB_PAYMENTS: 'true' }));
    try {
      expect(publikusKonfig()).toEqual({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: true });
    } finally {
      stubbal();
    }
  });

  it('a hibás teszt-konfig (503) mellett sincs szimuláció — szimulalt_fizetes false', () => {
    const vissza = beallitEnv(bank.env({ CIB_BEVEZETES: '2099-01-01' }));
    try {
      expect(p().cibKonfig()).toBe('hibas');
      expect(publikusKonfig()).toEqual({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: false });
    } finally {
      vissza();
    }
  });

  it('a mai teszt-mód (nyitott allowlist): kártyás „teszt"; a listán kívüliek stub-ja szimuláció', async () => {
    const r = await request(app).get('/config/public');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ teszt_uzem: true, kartyas_fizetes: 'teszt', szimulalt_fizetes: false });
    const lista = beallitEnv({ CIB_TESZT_FELHASZNALOK: '00000000-0000-4000-8000-000000000001' });
    try {
      expect((await request(app).get('/config/public')).body)
        .toEqual({ teszt_uzem: true, kartyas_fizetes: 'teszt', szimulalt_fizetes: true });
    } finally {
      lista();
    }
  });
});

// =====================================================================
describe('9. A bent felejtett szünet induláskor Sentry-figyelmeztetést kap', () => {
  it('CIB_UJ_FIZETES_TILTVA=true → warning-szintű Sentry-esemény (a konzol-sor mellett)', () => {
    const jelzes = [];
    const konzol = { log: () => {}, warn: () => {}, error: () => {} };
    const sentry = { captureMessage: (m, szint) => jelzes.push([m, szint]) };
    p().naplozCibKonfigot({ env: bank.env({ CIB_BEVEZETES: '2026-01-01', CIB_UJ_FIZETES_TILTVA: 'true' }), konzol, sentry });
    expect(jelzes.some(([m, szint]) => /CIB_UJ_FIZETES_TILTVA/.test(m) && szint === 'warning'),
      'a szünetről csak konzol-sor szólt').toBe(true);
    jelzes.length = 0;
    p().naplozCibKonfigot({ env: bank.env({ CIB_BEVEZETES: '2026-01-01' }), konzol, sentry });
    expect(jelzes.some(([m]) => /CIB_UJ_FIZETES_TILTVA/.test(m))).toBe(false);
  });
});

// =====================================================================
describe('10. Az admin-lista sorai a közölt okot is adják', () => {
  it('ok: admin_visszaterites / bank_visszaforditotta / admin_nem_lezarva / null', async () => {
    const admin = await createUser({ role: 'admin' });
    const a = await elfogadottFuvar();
    const visszateritett = await cibSor(a.job, a.felado, {
      state: 'closed', cibState: 'closed_ok', closedReason: 'admin_visszaterites', eredmeny: { ok: 'admin_visszaterites', rc: '00', anum: 'X1' },
    });
    const b = await elfogadottFuvar();
    const visszafordult = await cibSor(b.job, b.felado, { state: 'closed', cibState: 'expired', eredmeny: { ok: 'bank_visszaforditotta', rc: 'TO' } });
    const c = await elfogadottFuvar();
    const elutasitott = await cibSor(c.job, c.felado, { state: 'closed', cibState: 'failed', eredmeny: { ok: 'bank_elutasitas', rc: '51' } });
    const d = await elfogadottFuvar();
    const adminNem = await cibSor(d.job, d.felado, { state: 'closed', cibState: 'failed', eredmeny: { ok: 'admin_nem_lezarva' } });
    for (const [trid, ok, allapot] of [
      [visszateritett, 'admin_visszaterites', 'nem_terhelt'],
      [visszafordult, 'bank_visszaforditotta', 'nem_terhelt'],
      [elutasitott, null, 'sikertelen'],
      [adminNem, 'admin_nem_lezarva', 'nem_terhelt'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).get(`/payments/admin/cib?q=${trid}`).set(...auth(admin));
      expect(r.status).toBe(200);
      const elem = r.body.items.find((x) => x.trid === trid);
      expect(elem, trid).toBeTruthy();
      expect(elem.allapot).toBe(allapot);
      expect(elem.ok, `${trid}: a lista sorában nincs közölt ok`).toBe(ok);
      expect('ok' in elem).toBe(true);
    }
  });
});
