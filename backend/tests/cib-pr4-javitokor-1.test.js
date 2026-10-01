// =====================================================================
//  CIB PR-4 — 1. JAVÍTÓKÖR (2026-10-01, a PR-4 utóellenőrzése)
//
//  A PR-4 (a bank írásos válaszai) három független review-ja után maradt
//  hibák őrei — mind a hamis bankkal (a valódi bankot semmi nem hívja):
//
//   (1) BLOKKOLÓ: a határidőn túl JÓVÁHAGYOTT, ezért le nem zárt kísérlet
//       (expired / zarasi_hatarido) a vásárlónak „A bank nem fogadta el a
//       fizetést" szöveget mutatott, miközben a bank épp sikert jelzett neki,
//       és a kártyáján zárolt összeg áll. Most: „nem terhelt" kijelzés, saját
//       (a jóváhagyást és a zárolás feloldását is kimondó) értesítés, és a
//       díjfizetési kártya is EZT a kísérletet mutatja, nem egy régebbit. A
//       „másik kísérlet zár" miatt le nem zárt jóváhagyott tétel sem kapja
//       többé a hamis „fuvar megváltozott" indokot.
//   (2) A publikus visszatérés (MSGT21), a /pay „zárul" ága, az admin
//       „Újraellenőrzés" és bármely más belépési pont nem kerülheti meg az
//       S05/S04 (D03…) utáni várakozást:
//       egy visszajátszott visszatérés eddig néhány ms alatt elküldte a
//       maradék MSGT32-ket, és a javítható S05-ből kézi ügy lett.
//   (3) A MSGT32-re kapott S05/S04 a bank szerint normál válasz — nem
//       nyithatja a megszakítót (eddig két feladó S05-sorozata után 10 percig
//       nem indult új fizetés, „kulcs vagy környezet gyanú" riasztással).
//   (4) Egy MSGT32, ami bizonyítottan KI SEM MENT (a kapcsolódás előtti hiba,
//       vagy a kimenő napló hibája), nem „zárási kísérlet": ha a kísérlet
//       minden MSGT32-je ilyen volt, a határidő után expired (a bank
//       visszautal, terhelés nincs) — nem close_unknown + riasztás + kézi
//       munka. Ha EGY is kiment, marad a close_unknown (változatlan).
//   (5) A határidőn túli, már zárási kísérletet kapott tétel kétesre írása
//       23505-öt kaphat (a fuvar egy másik TRID-je kétes): eddig a sor
//       riasztás nélkül, csendben keringett — most egyszer riaszt.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const LEVELEK = [];
const emailSzolg = require('../src/services/email');
// A valódi sablon (a sablon-szöveg méréséhez), mielőtt az elfogó a helyére lép.
const valodiSikertelenLevel = emailSzolg.sendFeePaymentFailedEmail;
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail', 'sendCibRiasztasEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const { app, db, createUser, createJob } = require('./helpers');
const { inditHamisBank, zartPortUrl, beallitEnv } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const cf = () => require('../src/services/cibFizetes');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

let bank;
let visszaallit;

beforeAll(async () => {
  bank = await inditHamisBank();
  visszaallit = beallitEnv(bank.env({
    CIB_BEVEZETES: '2026-01-01',
    CIB_HTTP_TIMEOUT_MS: '1500',
    CIB_ZARAS_TIMEOUT_MS: '1500',
    CIB_INDITAS_OSSZKERET_MS: '5000',
    CIB_LEKERDEZES_KOZ_MS: '5000',
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
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei parkolnak.
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
});

// ── Segédek ──────────────────────────────────────────────────────────
const HOZZAJARULASSAL = { consent: true, cib_adatkezelesi_hozzajarulas: true };
const S05 = { nyers: 'RC=S05', http: 200 };

async function elfogadottFuvar() {
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
  return { felado, szallito, job };
}
const fizet = (f, job, body = HOZZAJARULASSAL) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send(body);
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
const bankDb = (trid, msgt) => bank.szamol(trid, msgt);
const riasztasok = (trid) => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid);
const sikertelenLevelek = (jobId) => LEVELEK.filter((l) => l.nev === 'sendFeePaymentFailedEmail' && l.jobId === jobId);
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
const visszaQuery = (trid) => `/payments/cib/vissza?${bank.msgt21Query(trid)}`;
async function visszater(trid, dontes = 'fizet') {
  if (dontes) bank.dont(trid, dontes);
  const r = await request(app).get(visszaQuery(trid)).redirects(0);
  await cf().varjHatterre();
  return r;
}
async function msgt10Ota(trid, mp) {
  await db.query('UPDATE payment_sessions SET created_at = NOW() - make_interval(secs => $2::int) WHERE payment_id = $1', [trid, mp]);
  await db.query(`UPDATE cib_messages SET created_at = NOW() - make_interval(secs => $2::int)
                   WHERE payment_id = $1 AND direction = 'ki' AND msgt = 10`, [trid, mp]);
}
/** A kísérlet jóváhagyott (a MSGT33 RC=00 után), zárásra esedékes — banki hívás nélkül. */
async function jovahagyottraAllit(trid) {
  await db.query(`UPDATE payment_sessions SET cib_state = 'authorized',
                         cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"msgt33_rc":"00","zaras_eredete":"authorized"}'::jsonb,
                         cib_next_action_at = NOW() - INTERVAL '1 second', cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE payment_id = $1`, [trid]);
}
/** Egy kör, amiben a bank piaci végpontja nem fogad kapcsolatot (a MSGT32 KI SEM MEGY). */
async function korElerhetetlenBankkal() {
  const vissza = beallitEnv({ CIB_MARKET_URL: await zartPortUrl() });
  try {
    await kor();
  } finally {
    vissza();
  }
}

// =====================================================================
describe('(1) BLOKKOLÓ: a határidőn túl jóváhagyott (le nem zárt) kísérlet a vásárlónak „nem terhelt"', () => {
  it('eredményoldal, díjfizetési kártya, értesítés és e-mail: a jóváhagyást és a zárolás feloldását mondja, nem „elutasítást"', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 575);
    const r = await visszater(trid);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed', cib_close_attempts: 0 });
    expect(s.cib_result.ok).toBe('zarasi_hatarido');
    expect(bankDb(trid, 32)).toBe(0);

    // Az eredményoldal (ide érkezik a visszatérő vásárló).
    const token = decodeURIComponent(/[?&]e=([^&]+)/.exec(r.headers.location)[1]);
    const e = await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(token)}`);
    expect(e.status).toBe(200);
    expect(e.body.allapot, 'A BANK JÓVÁHAGYTA, a vásárló mégis „A bank nem fogadta el" szöveget lát')
      .toBe('nem_terhelt');
    expect(e.body.ujra_fizetheto).toBe(true);

    // A fuvar díjfizetési kártyája.
    const fp = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(fp.status).toBe(200);
    expect(fp.body.last_result).toMatchObject({ trid, allapot: 'nem_terhelt' });
    expect(fp.body.can_pay).toBe(true);

    // Az e-mail és az in-app értesítés saját típust kap — nem a „fuvar közben
    // megváltozott" indokot, és nem az „elutasítva" szöveget.
    expect(sikertelenLevelek(job.id).map((l) => l.tipus)).toEqual(['nem_zart']);
    const { rows: ertesitesek } = await db.query(
      "SELECT body, title FROM notifications WHERE user_id = $1 AND type LIKE 'payment_%'", [felado.id],
    );
    expect(ertesitesek).toHaveLength(1);
    expect(ertesitesek[0].body).toMatch(/jóváhagyta/);
    expect(ertesitesek[0].body).toMatch(/nem terheltük/);
    expect(ertesitesek[0].body).toMatch(/feloldja/);
    expect(ertesitesek[0].body).not.toMatch(/megváltozott/);
    expect(riasztasok(trid)).toHaveLength(0);
  });

  it('a levél szövege: jóváhagyva, határidőn belül nem véglegesítve, nem terheltük, a zárolást a bank feloldja, újrapróba felkínálva', async () => {
    // Éles (nem stub) mód, a Resend-hívás elfogva — valódi levél nem megy ki.
    const vissza = beallitEnv({ RESEND_API_KEY: 're_teszt_kulcs_nem_eles' });
    const kimeno = [];
    const fetchKem = vi.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      kimeno.push(JSON.parse((opts && opts.body) || '{}'));
      return {
        ok: true, status: 200, json: async () => ({ id: 're_1' }), text: async () => '',
      };
    });
    try {
      await valodiSikertelenLevel({
        to: 'felado@example.com',
        shipperName: 'Teszt Feladó',
        jobTitle: 'Kanapé',
        jobId: '00000000-0000-4000-8000-000000000001',
        bankiAdatok: {
          trid: '1234567812345678', rc: null, rt: null, amo: 500, cur: 'HUF', anum: null,
        },
        tipus: 'nem_zart',
      });
    } finally {
      fetchKem.mockRestore();
      vissza();
    }
    expect(kimeno).toHaveLength(1);
    const { html, subject } = kimeno[0];
    expect(subject).toMatch(/nem terheltük/i);
    expect(html).toMatch(/jóváhagyta/);
    expect(html).toMatch(/nem terheltük/);
    expect(html).toMatch(/feloldja/);
    expect(html, 'a „fuvar közben megváltozott" indok került a levélbe').not.toMatch(/megváltozott/);
    expect(html, 'a levél elutasítást állít egy jóváhagyott fizetésről').not.toMatch(/nem sikerült|nem fogadta el/);
    expect(html, 'nincs újrapróba-felkínálás').toMatch(/fizetes=ujra/);
  });

  it('a díjfizetési kártya a LEGÚJABB kísérletet mutatja: egy korábbi, RC-vel elutasított kísérlet nem takarja el', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    await visszater(t1, 'elutasit');
    const s1 = await sor(t1);
    expect(['failed', 'expired']).toContain(s1.cib_state);
    expect(typeof s1.cib_result.rc).toBe('string');
    // Az első kísérlet valóban korábbi (a második MSGT10-jét lent 575 mp-cel
    // visszadatáljuk — a sorrend így is a valós marad).
    await db.query(`UPDATE payment_sessions SET created_at = NOW() - INTERVAL '30 minutes' WHERE payment_id = $1`, [t1]);

    const t2 = await bankOldalon(felado, job);
    await msgt10Ota(t2, 575);
    await visszater(t2);
    expect((await sor(t2)).cib_state).toBe('expired');

    const fp = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(fp.body.last_result, 'a kártya egy régebbi, elutasított kísérletet mutat a friss, jóváhagyott helyett')
      .toMatchObject({ trid: t2, allapot: 'nem_terhelt' });
  });

  it('a „másik kísérlet zár" miatt le nem zárt jóváhagyott kísérlet sem „a fuvar megváltozott", és új fizetést sem ígér', async () => {
    // A fuvar nem változott: egy MÁSIK TRID zárása volt folyamatban (az
    // sikerülhet, vagy egyeztetés alá kerülhet) — a feladó a „fuvar közben
    // megváltozott" indokot kapta, ami hamis.
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1, cib_close_sent_at = NOW(),
                    cib_lease_owner = 'masik:1', cib_lease_until = NOW() + INTERVAL '3 minutes' WHERE payment_id = $1`, [t2]);
    await visszater(t1);
    expect(await sor(t1)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 0 });
    await msgt10Ota(t1, 575);
    await esedekes(t1);
    await kor();
    const s = await sor(t1);
    expect(s).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect(s.cib_result.ok).toBe('masik_zaras');
    expect(bankDb(t1, 32)).toBe(0);
    expect(cf().lekepez(s)).toBe('nem_terhelt');
    expect(sikertelenLevelek(job.id).map((l) => l.tipus), 'a „fuvar megváltozott" levéltípus ment ki')
      .toEqual(['masik_kiserlet']);
    const { rows: ertesitesek } = await db.query(
      "SELECT body FROM notifications WHERE user_id = $1 AND type LIKE 'payment_%'", [felado.id],
    );
    expect(ertesitesek).toHaveLength(1);
    expect(ertesitesek[0].body).toMatch(/jóváhagyta/);
    expect(ertesitesek[0].body).toMatch(/másik fizetésed/);
    expect(ertesitesek[0].body).toMatch(/nem terheltük/);
    expect(ertesitesek[0].body).not.toMatch(/megváltozott/);
    expect(ertesitesek[0].body).not.toMatch(/Új fizetést/);
    expect(riasztasok(t1)).toHaveLength(0);
  });

  it('a „másik kísérlet" levele: jóváhagyva, nem zártuk le, nem terheltük — „fuvar megváltozott" és újrapróba nélkül', async () => {
    const vissza = beallitEnv({ RESEND_API_KEY: 're_teszt_kulcs_nem_eles' });
    const kimeno = [];
    const fetchKem = vi.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      kimeno.push(JSON.parse((opts && opts.body) || '{}'));
      return {
        ok: true, status: 200, json: async () => ({ id: 're_2' }), text: async () => '',
      };
    });
    try {
      await valodiSikertelenLevel({
        to: 'felado@example.com',
        shipperName: 'Teszt Feladó',
        jobTitle: 'Kanapé',
        jobId: '00000000-0000-4000-8000-000000000002',
        bankiAdatok: {
          trid: '1234567812345679', rc: null, rt: null, amo: 500, cur: 'HUF', anum: null,
        },
        tipus: 'masik_kiserlet',
      });
    } finally {
      fetchKem.mockRestore();
      vissza();
    }
    expect(kimeno).toHaveLength(1);
    const { html, subject } = kimeno[0];
    expect(subject).toMatch(/nem terheltük/i);
    expect(html).toMatch(/jóváhagyta/);
    expect(html).toMatch(/másik fizetésed/);
    expect(html).toMatch(/feloldja/);
    expect(html).not.toMatch(/megváltozott/);
    expect(html).not.toMatch(/nem sikerült|nem fogadta el/);
    expect(html, 'új fizetést ígér, pedig a másik kísérlet épp sikerülhet / egyeztetés alatt állhat').not.toMatch(/fizetes=ujra/);
  });

  it('a többi lejárat (pl. a bank RC=TO-ja) változatlanul „sikertelen"', () => {
    expect(cf().lekepez({ cib_state: 'expired', state: 'closed', cib_result: { ok: 'bank_to', rc: 'TO' } })).toBe('sikertelen');
    expect(cf().lekepez({ cib_state: 'expired', state: 'closed', cib_result: { ok: 'helyi_hatarido' } })).toBe('sikertelen');
    expect(cf().lekepez({ cib_state: 'expired', state: 'closed', cib_result: { ok: 'zarasi_hatarido' } })).toBe('nem_terhelt');
  });
});

// =====================================================================
describe('(2) Az S05 utáni várakozást egyetlen belépési pont sem kerülheti meg', () => {
  it('a visszajátszott visszatérés (MSGT21), a /pay és az eredményoldal NEM küld azonnal új MSGT32-t; a kör a várakozás után igen', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [S05]);
    const r = await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect(bankDb(trid, 32)).toBe(1);

    // A böngésző visszalép / a bank újra átirányít: kétszer ugyanaz a MSGT21.
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const v = await request(app).get(visszaQuery(trid)).redirects(0);
      expect(v.status).toBe(303);
      // eslint-disable-next-line no-await-in-loop
      await cf().varjHatterre();
    }
    expect(bankDb(trid, 32), 'a visszajátszott visszatérés megkerülte az S05 utáni várakozást').toBe(1);

    // Egy elavult fülről újra a /pay: „épp lezárul", MSGT32 nélkül.
    const p = await fizet(felado, job);
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('CIB_PAYMENT_FINISHING');
    await cf().varjHatterre();
    expect(bankDb(trid, 32), 'a /pay „zárul" ága megkerülte az S05 utáni várakozást').toBe(1);

    // Az eredményoldal 3 mp-es lekérdezése.
    const token = decodeURIComponent(/[?&]e=([^&]+)/.exec(r.headers.location)[1]);
    await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(token)}`);
    await cf().varjHatterre();
    expect(bankDb(trid, 32)).toBe(1);
    expect(await sor(trid)).toMatchObject({ cib_state: 'authorized', state: 'pending', cib_close_attempts: 1 });

    // A várakozás lejárt: a kör zár — pontosan egy siker.
    await esedekes(trid);
    await kor();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded', cib_close_attempts: 2 });
    expect(bankDb(trid, 32)).toBe(2);
    expect(riasztasok(trid)).toHaveLength(0);
  });

  it('az admin „Újraellenőrzés" sem húzza előre az S05 utáni várakozást (egy zárási kísérlet nem ég el)', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [S05]);
    await visszater(trid);
    const elotte = await sor(trid);
    expect(elotte).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect(bankDb(trid, 32)).toBe(1);

    const r = await request(app).post(`/payments/admin/cib/${trid}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(r.status).toBe(200);
    await cf().varjHatterre();
    expect(bankDb(trid, 32), 'az admin-újraellenőrzés azonnal újraküldte a MSGT32-t').toBe(1);
    const utana = await sor(trid);
    expect(utana).toMatchObject({ cib_state: 'authorized', state: 'pending', cib_close_attempts: 1 });
    expect(new Date(utana.cib_next_action_at).getTime()).toBeGreaterThanOrEqual(new Date(elotte.cib_next_action_at).getTime());

    // A várakozás után a kör zár — pontosan egy siker.
    await esedekes(trid);
    await kor();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded', cib_close_attempts: 2 });
    expect(bankDb(trid, 32)).toBe(2);
  });

  it('esedékes jóváhagyott sort a visszatérés továbbra is azonnal zár (a fék csak a várakozást védi)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded', cib_close_attempts: 1 });
  });
});

// =====================================================================
describe('(3) A MSGT32-re kapott S05/S04 nem nyitja a megszakítót', () => {
  it('két feladó S05-sorozata (5 egymás utáni S05) után is indulhat új kártyás fizetés, rendszer-riasztás nélkül', async () => {
    const a = await elfogadottFuvar();
    const b = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const tb = await bankOldalon(b.felado, b.job);
    bank.tridre(ta, 32, [S05, S05, S05]);
    bank.tridre(tb, 32, [S05, S05, S05]);
    await visszater(ta);
    await visszater(tb);
    // Két kör, mindkét sor esedékes: további 4 S05 — közben értelmes banki
    // válasz (MSGT31) nem jön, tehát 5 egymás utáni „S-hiba" lenne.
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await esedekes(ta);
      // eslint-disable-next-line no-await-in-loop
      await esedekes(tb);
      // eslint-disable-next-line no-await-in-loop
      await kor();
    }
    expect(bankDb(ta, 32) + bankDb(tb, 32)).toBe(6);

    const c = await elfogadottFuvar();
    const r = await fizet(c.felado, c.job);
    expect(r.status, `a megszakító S05-ökre kinyílt: ${JSON.stringify(r.body)}`).toBe(200);
    expect(LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.ok === 'megszakito')).toHaveLength(0);
  });
});

// =====================================================================
describe('(4) A bizonyítottan KI SEM MENT MSGT32 nem zárási kísérlet', () => {
  it('egy ki nem ment MSGT32 után lejár a határidő: expired (nem close_unknown), riasztás nélkül, „nem zárt" értesítéssel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await jovahagyottraAllit(trid);
    await korElerhetetlenBankkal();
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    expect(s.cib_result.zaras_nem_kuldott).toBe(1);
    expect(bankDb(trid, 32)).toBe(0);

    await msgt10Ota(trid, 575);
    await esedekes(trid);
    await kor();
    s = await sor(trid);
    expect(bankDb(trid, 32)).toBe(0);
    expect(s, 'egy soha ki nem ment MSGT32 miatt kétes lett a kísérlet (fölösleges riasztás + kézi munka)')
      .toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('zarasi_hatarido');
    expect(riasztasok(trid)).toHaveLength(0);
    expect(sikertelenLevelek(job.id).map((l) => l.tipus)).toEqual(['nem_zart']);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    // A feladó azonnal újra fizethet.
    expect((await fizet(felado, job)).status).toBe(200);
  });

  it('háromszor ki sem ment MSGT32: expired (zaras_nem_kuldott), riasztás nélkül — a bank nem zárhatott', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await jovahagyottraAllit(trid);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await esedekes(trid);
      // eslint-disable-next-line no-await-in-loop
      await korElerhetetlenBankkal();
    }
    const s = await sor(trid);
    expect(bankDb(trid, 32)).toBe(0);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed', cib_close_attempts: 3 });
    expect(s.cib_result).toMatchObject({ ok: 'zaras_nem_kuldott', zaras_nem_kuldott: 3 });
    expect(riasztasok(trid)).toHaveLength(0);
    expect(cf().lekepez(s)).toBe('nem_terhelt');
  });

  it('ha EGY MSGT32 kiment (S05), a határidő után változatlanul kétes: close_unknown + egy riasztás', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await jovahagyottraAllit(trid);
    await korElerhetetlenBankkal();
    bank.tridre(trid, 32, [S05]);
    await esedekes(trid);
    await kor();
    expect(await sor(trid)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 2 });
    expect(bankDb(trid, 32)).toBe(1);
    await msgt10Ota(trid, 575);
    await esedekes(trid);
    await kor();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result.ok).toBe('zaras_hatarido');
    expect(bankDb(trid, 32)).toBe(1);
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('admin-rendezés: a csak ki sem ment MSGT32-vel rendelkező kétes kísérlet nem „lezarva"-zható', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1,
                           cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"zaras_nem_kuldott":1,"ok":"zaras_valasz_nelkul"}'::jsonb
                     WHERE payment_id = $1`, [trid]);
    const admin = await createUser({ role: 'admin' });
    const r = await cf().rendezes(trid, { eredmeny: 'lezarva', indoklas: 'A bank szerint lezárva — teszt.', anum: 'AB1234' }, admin.id);
    expect(r.http).toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_NOT_SENT');
    expect((await sor(trid)).cib_state).toBe('close_unknown');
  });
});

// =====================================================================
describe('(5) A határidőn túli kétesre írás ütközése (23505) egyszer riaszt', () => {
  it('a fuvar másik TRID-je kétes: a függő újrapróba nem kering csendben — egy riasztás, MSGT32 nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    bank.tridre(t1, 32, [S05]);
    await visszater(t1);
    expect(await sor(t1)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1,
                           cib_next_action_at = NULL WHERE payment_id = $1`, [t2]);
    await msgt10Ota(t1, 575);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await esedekes(t1);
      // eslint-disable-next-line no-await-in-loop
      await kor();
    }
    expect(bankDb(t1, 32)).toBe(1);
    expect(await sor(t1)).toMatchObject({ cib_state: 'authorized', state: 'pending' });
    expect(riasztasok(t1), 'a határidőn túli függő újrapróba riasztás nélkül kering').toHaveLength(1);
    expect((await jobSor(job.id)).paid_at).toBeNull();
  });
});
