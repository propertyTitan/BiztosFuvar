// =====================================================================
//  TELJES AUDIT — D4 csomag (2026-09-13): üzemeltetés
//   1. ütemező-burkoló: minden kör hibája Sentry-be jut; átfedés-őr
//   2. minden ütemezett kör riaszt DB-hiba mellett (a KYC-purge is)
//   3. külső HTTP-hívások (Resend, SeeMe, Expo push) időkerettel
//   4. DB-pool időkeretek
//   5. boot-idejű migráció-ellenőrzés
//   6. idő-alapú körök bevezetés-dátum küszöbe (nincs visszamenőleges futás)
//  Minden teszt a javítás NÉLKÜL igazoltan piros (lásd a PR-t).
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { db, createUser, createJob } = require('./helpers');
const Sentry = require('@sentry/node');
const { utemezettKor, __futasbanForTests } = require('../src/services/utemezo');
const { ellenorizMigraciok } = require('../src/services/migracioEllenorzes');
const { migrationFiles } = require('../scripts/migrate');
const { purgeOldKycFiles } = require('../src/services/kyc');
const { runPaymentReminders, runPaymentExpiry } = require('../src/services/paymentReminders');
const { runNoOfferNudges } = require('../src/services/noOfferNudge');
const { runDailyDac7Reminders } = require('../src/services/dac7');
const { runInstantExpiry } = require('../src/services/instantExpiry');
const email = require('../src/services/email');
const sms = require('../src/services/sms');
const push = require('../src/services/push');

afterEach(() => { vi.restoreAllMocks(); __futasbanForTests.clear(); });

describe('D4/1 — ütemező-burkoló', () => {
  it('dobó kör → Sentry captureException a kör nevével; a burkoló nem dob', async () => {
    const capture = vi.spyOn(Sentry, 'captureException').mockImplementation(() => 'x');
    const kor = utemezettKor('teszt-kor', async () => { throw new Error('column "x" does not exist'); });
    await expect(kor()).resolves.toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]?.tags?.kor).toBe('teszt-kor');
  });

  it('átfedés-őr: amíg az előző futás tart, a következő tick kimarad', async () => {
    let feloldas;
    let futott = 0;
    const kor = utemezettKor('lassu-kor', () => new Promise((r) => { futott += 1; feloldas = r; }));
    const elso = kor();
    const masodik = await kor();
    expect(masodik, 'a második tick elindította a párhuzamos futást').toBeNull();
    expect(futott).toBe(1);
    feloldas('kesz');
    await expect(elso).resolves.toBe('kesz');
    expect(__futasbanForTests.has('lassu-kor'), 'a futás-jelző nem szabadult fel').toBe(false);
  });
});

describe('D4/2 — minden ütemezett kör riaszt DB-hiba mellett', () => {
  const KOROK = {
    'kyc-retention': purgeOldKycFiles,
    'payment-reminder': runPaymentReminders,
    'no-offer-nudge': runNoOfferNudges,
    dac7: runDailyDac7Reminders,
    'instant-expiry': runInstantExpiry,
  };
  for (const [nev, fn] of Object.entries(KOROK)) {
    it(`${nev}: DB-hiba → Sentry (nem néma)`, async () => {
      vi.spyOn(db, 'query').mockRejectedValue(new Error('column "elirt_oszlop" does not exist'));
      const capture = vi.spyOn(Sentry, 'captureException').mockImplementation(() => 'x');
      await utemezettKor(nev, fn)();
      expect(capture, `a(z) ${nev} kör DB-hibája sehova nem jutott el`).toHaveBeenCalled();
    });
  }

  it('az index.js mind a 7 kört a burkolón át ütemezi', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    for (const nev of ['kyc-retention', 'retention', 'dac7', 'payment-reminder', 'no-offer-nudge', 'instant-expiry', 'sms-retry']) {
      expect(src, `a(z) ${nev} kör nincs a burkolón`).toMatch(new RegExp(`utemezettKor\\('${nev}'`));
    }
  });
});

describe('D4/3 — külső HTTP-hívások időkerete', () => {
  const ok = { ok: true, status: 200, text: async () => 'result=OK&code=0&price=19', json: async () => ({ id: 're_ok' }) };
  it('Resend: a fetch signal-t kap', async () => {
    const eredeti = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_teszt';
    global.fetch = vi.fn(async () => ok);
    try {
      await email.sendEmail({ to: 'x@example.com', subject: 't', html: '<p>x</p>' });
      const opts = global.fetch.mock.calls[0][1];
      expect(opts?.signal, 'a Resend-hívásnak nincs időkerete').toBeInstanceOf(AbortSignal);
    } finally {
      if (eredeti === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = eredeti;
      email.__resetEmailAlertsForTests?.();
    }
  });
  it('SeeMe: a fetch signal-t kap', async () => {
    const eredeti = process.env.SEEME_API_KEY;
    process.env.SEEME_API_KEY = 'teszt-kulcs';
    global.fetch = vi.fn(async () => ok);
    try {
      await sms.sendSms('+36201234567', 'teszt', { queueOnFailure: false });
      const opts = global.fetch.mock.calls[0][1];
      expect(opts?.signal, 'a SeeMe-hívásnak nincs időkerete').toBeInstanceOf(AbortSignal);
    } finally {
      if (eredeti === undefined) delete process.env.SEEME_API_KEY; else process.env.SEEME_API_KEY = eredeti;
    }
  });
  it('Expo push: a fetch signal-t kap', async () => {
    vi.spyOn(db, 'query').mockResolvedValueOnce({ rows: [{ token: 'ExponentPushToken[teszt]' }] });
    global.fetch = vi.fn(async () => ok);
    await push.sendPushToUser('00000000-0000-0000-0000-000000000000', { title: 't', body: 'b' });
    const opts = global.fetch.mock.calls[0][1];
    expect(opts?.signal, 'az Expo-hívásnak nincs időkerete').toBeInstanceOf(AbortSignal);
  });
});

describe('D4/4 — DB-pool időkeretek', () => {
  it('connectionTimeoutMillis / query_timeout / idleTimeoutMillis be van állítva', () => {
    const o = db.pool.options;
    expect(o.connectionTimeoutMillis, 'a pool örökké vár kapcsolatra').toBeGreaterThan(0);
    expect(o.query_timeout, 'a lekérdezésnek nincs kliens-oldali plafonja').toBeGreaterThan(0);
    expect(o.idleTimeoutMillis).toBeGreaterThan(0);
  });
});

describe('D4/5 — migráció-ellenőrzés', () => {
  const csend = { warn() {}, error() {} };
  it('hiányzó migráció → hianyzo lista + Sentry error; teljes lista → ok', async () => {
    const mind = migrationFiles();
    expect(mind.length).toBeGreaterThan(80);
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    const hianyos = { query: async () => ({ rows: mind.slice(0, -1).map((filename) => ({ filename })) }) };
    const r = await ellenorizMigraciok(hianyos, { log: csend });
    expect(r.ok).toBe(false);
    expect(r.hianyzo).toEqual([mind[mind.length - 1]]);
    expect(capture, 'a lefuttatatlan migrációról nem ment riasztás').toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]?.level).toBe('error');
    capture.mockClear();
    const teljes = { query: async () => ({ rows: mind.map((filename) => ({ filename })) }) };
    expect((await ellenorizMigraciok(teljes, { log: csend })).ok).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });
  it('ha a schema_migrations nem olvasható: ok=null, nincs riasztás, nem dob', async () => {
    const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
    const nincs = { query: async () => { throw new Error('relation "schema_migrations" does not exist'); } };
    const r = await ellenorizMigraciok(nincs, { log: csend });
    expect(r.ok).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('D4/6 — idő-alapú körök bevezetés-dátum küszöbe', () => {
  it('lejáratás: a bevezetés ELŐTT keletkezett fuvarhoz nem nyúl, a frisshez igen', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const regi = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    const friss = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    await db.query(
      `UPDATE jobs SET payment_reminder_count = 2, last_payment_reminder_at = NOW() - INTERVAL '100 hours' WHERE id = ANY($1::uuid[])`,
      [[regi.id, friss.id]],
    );
    await db.query(`UPDATE jobs SET created_at = '2026-09-01' WHERE id = $1`, [regi.id]);
    await runPaymentExpiry();
    const st = async (id) => (await db.query('SELECT status FROM jobs WHERE id = $1', [id])).rows[0].status;
    expect(await st(regi.id), 'a bevezetés előtti (történelmi) fuvart visszamenőleg lezárta').toBe('accepted');
    expect(await st(friss.id)).toBe('cancelled');
  });

  it('nudge: a bevezetés ELŐTT feladott hirdetés nem kap tippet, a friss igen', async () => {
    const felado = await createUser();
    const regi = await createJob({ shipperId: felado.id, status: 'bidding' });
    const friss = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET created_at = '2026-09-01' WHERE id = $1`, [regi.id]);
    // 30 óra: a 24 órás küszöbön túl, de a bevezetés (2026-09-12) után
    await db.query(`UPDATE jobs SET created_at = NOW() - INTERVAL '30 hours' WHERE id = $1`, [friss.id]);
    await runNoOfferNudges();
    const n = async (id) => (await db.query('SELECT no_offer_nudge_at FROM jobs WHERE id = $1', [id])).rows[0].no_offer_nudge_at;
    expect(await n(regi.id), 'a bevezetés előtti hirdetésre visszamenőleg ment a nudge').toBeNull();
    expect(await n(friss.id)).not.toBeNull();
  });
});
