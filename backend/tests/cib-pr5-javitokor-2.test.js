// =====================================================================
//  CIB PR-5/B — 2. JAVÍTÓKÖR (2026-10-04): a két review nem blokkoló, de
//  olcsó és egyértelmű tételei. Mindegyik tétel a javítás nélkül piros.
//   * D05-tel („már kiszolgálva") kétes kísérletre a TO nem „nem terhelt":
//     a bank két válasza ellentmond, ember dönt (különben kettős terhelés);
//   * a megerősítő MSGT33 alatt egy másik munkás ugyanazzal az ANUM-mal már
//     könyvelt: nincs hamis „terhelt, nem rögzíthető" riasztás;
//   * a ki sem ment zárás (összeomlás a claim és a napló között) nem írja
//     felül az előző kísérlet banki kódját (S05) null-lal;
//   * szünet alatt a nyilatkozat nélküli CIB-indítás is 503 CIB_PAUSED (a
//     kupon-verseny ága, C2);
//   * a ki nem ment napi emlékeztető legfeljebb óránként próbálkozik (nincs
//     percenkénti Sentry-vihar levélkiesés alatt);
//   * a riasztó levél teendője minden riasztási okra saját (az egyeztetési
//     okok nem kapják az általános „automatikusan eldönti" szöveget);
//   * az admin kézi rendezése bérlet-feltételesen ír (SELECT és UPDATE között
//     átvett sor → 409 CIB_ROW_BUSY);
//   * a bootkor hibás, később teljessé váló konfigot a kör egyszer naplózza.
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
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
});

// ── Segédek (a cib-pr5-egyeztetes mintájára) ─────────────────────────
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
async function elso00Ota(trid, mp) {
  await db.query(`UPDATE payment_sessions
                     SET cib_result = jsonb_set(cib_result, '{egyeztetes_elso_00,at}', to_jsonb(NOW() - make_interval(secs => $2::int)))
                   WHERE payment_id = $1 AND cib_result ? 'egyeztetes_elso_00'`, [trid, mp]);
}
const dijAllapot = async (f, job) => (await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(f))).body;

/** S05-öt kap az első MSGT32, de a bank (a válasza ellenére) feldolgozta. */
function s05DeFeldolgozta(trid) {
  let egyszer = false;
  bank.tridre(trid, 32, [{ nyers: 'RC=S05', http: 200 }]);
  bank.horog(async (u) => {
    if (u.msgt !== 32 || u.trid !== trid || egyszer) return;
    egyszer = true;
    bank.tranzakciok.get(trid).zarva = true;
  });
}

// =====================================================================
describe('Egyeztetés: D05 után a TO nem dönt', () => {
  it('D05-tel („már kiszolgálva") kétes kísérletre a TO nem „nem terhelt" — kétes marad, riaszt, nem fizethető újra', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    s05DeFeldolgozta(trid);
    await visszater(trid);
    expect((await sor(trid)).cib_state, 'az S05 után nem jött újrazárás').toBe('authorized');
    bank.horog(null);
    // A 2. MSGT32-re a bank: „a kéréstípus már ki lett szolgálva".
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result.ok).toBe('zaras_d05');
    expect(bankDb(trid, 32)).toBe(2);

    await ketesOta(trid, 40 * 60, 30 * 60);
    bank.tridre(trid, 33, [{ rc: 'TO' }]);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s, 'a D05 utáni TO „nem terhelt"-ként feloldotta a fuvart (kettős terhelés lehet)')
      .toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(feladoLevelek(job.id, 'bank_visszaforditotta'), 'a feladó hamis „nem terheltük" levelet kapott').toHaveLength(0);
    expect(riasztasok(trid).map((l) => l.ok)).toContain('egyeztetes_nem_dontheto');
    expect((await dijAllapot(felado, job)).can_pay).toBe(false);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(bankDb(trid, 32), 'az egyeztetés MSGT32-t küldött').toBe(2);
  });

  it('a D05-tel kétes kísérlet két egyező 00-ra továbbra is lezárt és könyvelt', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    s05DeFeldolgozta(trid);
    await visszater(trid);
    bank.horog(null);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect((await sor(trid)).cib_result.ok).toBe('zaras_d05');
    await ketesOta(trid, 40 * 60, 30 * 60);
    await esedekes(trid);
    await kor();
    await elso00Ota(trid, 16 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
    expect(bankDb(trid, 32)).toBe(2);
  });
});

// =====================================================================
describe('Egyeztetés: a párhuzamosan már rögzített eredmény nem riaszt', () => {
  async function megerositesElott() {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    await ketesOta(trid, 35 * 60, 26 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect((await sor(trid)).cib_result.egyeztetes_elso_00).toBeTruthy();
    await elso00Ota(trid, 16 * 60);
    await esedekes(trid);
    LEVELEK.length = 0;
    return { felado, job, trid };
  }

  it('a megerősítő MSGT33 alatt egy másik munkás ugyanazzal az ANUM-mal már lezárta: nincs „terhelt, nem rögzíthető" riasztás', async () => {
    const { trid } = await megerositesElott();
    const anum = bank.tranzakciok.get(trid).anum;
    // A megerősítő MSGT33 közben lejár a bérlet, egy másik munkás átveszi és
    // ugyanazzal a banki eredménnyel lezárja (a könyvelése még fut).
    bank.horog(async (u) => {
      if (u.msgt !== 33 || u.trid !== trid) return;
      await db.query(`UPDATE payment_sessions SET cib_state = 'closed_ok', cib_lease_owner = 'masik:1',
                        cib_lease_until = NOW() + INTERVAL '1 minute',
                        cib_result = cib_result || jsonb_build_object('rc', '00', 'anum', $2::text, 'ok', 'egyeztetes_lezarva')
                      WHERE payment_id = $1`, [trid, anum]);
    });
    await kor();
    await cf().varjHatterre();
    bank.horog(null);
    expect(riasztasok(trid).map((l) => l.ok), 'egy rendben lévő tételről „téríts vissza" riasztás ment')
      .not.toContain('egyeztetes_iras_utkozes');
    expect((await sor(trid)).cib_state).toBe('closed_ok');
  });

  it('ha közben más lett az eredmény (admin „nem_lezarva"), a riasztás megmarad', async () => {
    const { trid } = await megerositesElott();
    bank.horog(async (u) => {
      if (u.msgt !== 33 || u.trid !== trid) return;
      await db.query(`UPDATE payment_sessions SET cib_state = 'failed', cib_lease_owner = NULL, cib_lease_until = NULL,
                        cib_result = cib_result || jsonb_build_object('ok', 'admin_nem_lezarva')
                      WHERE payment_id = $1`, [trid]);
    });
    await kor();
    await cf().varjHatterre();
    bank.horog(null);
    expect(riasztasok(trid).map((l) => l.ok)).toContain('egyeztetes_iras_utkozes');
  });
});

// =====================================================================
describe('Zárás: a ki sem ment kísérlet nem törli az előző banki kódot', () => {
  it('S05 után a 2. claim és a napló között elhalt folyamat: vissza authorized-ba, a zaras_bank_rc S05 marad', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=S05', http: 200 }]);
    await visszater(trid);
    let s = await sor(trid);
    expect(s.cib_state).toBe('authorized');
    expect(s.cib_result.zaras_bank_rc).toBe('S05');
    // A 2. zárási claim megtörtént, a kimenő napló (és a MSGT32) nem.
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 2,
                    cib_close_sent_at = NOW() - INTERVAL '10 minutes', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_lease_owner = 'halott:1', cib_lease_until = NOW() - INTERVAL '1 minute' WHERE payment_id = $1`, [trid]);
    await kor();
    s = await sor(trid);
    expect(s.cib_state).toBe('authorized');
    expect(s.cib_result.zaras_nem_kuldott).toBe(1);
    expect(s.cib_result.zaras_bank_rc, 'a ki sem ment zárás null-lal felülírta a valódi utolsó banki kódot').toBe('S05');
    expect(bankDb(trid, 32)).toBe(1);
  });
});

// =====================================================================
describe('Szünet: a nyilatkozat előtt dönt (C2)', () => {
  it('szünet alatt a nyilatkozat nélküli CIB-indítás is 503 CIB_PAUSED (a kupon közben elfogyott)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const msgt10Elotte = bank.uzenetek.filter((u) => u.msgt === 10).length;
    const vissza = beallitEnv({ CIB_UJ_FIZETES_TILTVA: 'true' });
    try {
      const v = await cf().inditCibDijFizetes({
        entityType: 'job', entityId: job.id, shipperId: felado.id, adatkezelesiHozzajarulas: undefined,
      });
      expect(v.http, JSON.stringify(v.body)).toBe(503);
      expect(v.body.code).toBe('CIB_PAUSED');
    } finally {
      vissza();
    }
    // Szünet nélkül a nyilatkozat továbbra is kötelező.
    const v2 = await cf().inditCibDijFizetes({
      entityType: 'job', entityId: job.id, shipperId: felado.id, adatkezelesiHozzajarulas: undefined,
    });
    expect(v2.body.code).toBe('CIB_CONSENT_REQUIRED');
    expect(bank.uzenetek.filter((u) => u.msgt === 10).length, 'nyilatkozat vagy szünet mellett banki kísérlet indult')
      .toBe(msgt10Elotte);
  });
});

// =====================================================================
describe('Napi emlékeztető: levélkiesés alatt nincs percenkénti vihar', () => {
  it('a ki nem ment emlékeztető legfeljebb óránként próbálkozik újra (napló + Sentry + levél)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    await db.query(`UPDATE payment_sessions SET cib_result = cib_result || jsonb_build_object('riasztas_at', NOW() - INTERVAL '25 hours')
                    WHERE payment_id = $1`, [trid]);
    const probak = [];
    const eredeti = emailSzolg.sendCibRiasztasEmail;
    // A sendEmail végleges kiesésnél null-t ad (és maga riaszt).
    emailSzolg.sendCibRiasztasEmail = async (arg) => {
      if (arg.ok === 'napi_emlekezteto' && String(arg.reszletek).includes(trid)) probak.push(arg);
      return null;
    };
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await cf().riasztasSopres();
      }
      expect(probak, 'levélkiesés alatt minden söprés (percenként) újra próbálkozott').toHaveLength(1);
      expect(hiba.mock.calls.filter((c) => /⏰/.test(String(c[0])))).toHaveLength(1);
      expect((await sor(trid)).cib_result.emlekezteto_at).toBeUndefined();
      // Egy óra múlva újra próbálkozik.
      await db.query(`UPDATE payment_sessions SET cib_result = cib_result
                        || jsonb_build_object('emlekezteto_probalkozas_at', NOW() - INTERVAL '61 minutes')
                      WHERE payment_id = $1`, [trid]);
      await cf().riasztasSopres();
      expect(probak).toHaveLength(2);
    } finally {
      hiba.mockRestore();
      emailSzolg.sendCibRiasztasEmail = eredeti;
    }
    await db.query(`UPDATE payment_sessions SET cib_result = cib_result
                      || jsonb_build_object('emlekezteto_probalkozas_at', NOW() - INTERVAL '61 minutes')
                    WHERE payment_id = $1`, [trid]);
    await cf().riasztasSopres();
    expect(LEVELEK.filter((l) => l.ok === 'napi_emlekezteto' && String(l.reszletek).includes(trid))).toHaveLength(1);
    expect((await sor(trid)).cib_result.emlekezteto_at).toBeTruthy();
  });
});

// =====================================================================
describe('Riasztó levél: minden okra saját teendő', () => {
  const SAJAT_TEENDOS = ['konyvelesi_arva', 'konyvelesi_hiba', 'nt_ismetlodo', 'lekerdezes_mezo_elteres',
    'egyeztetes_nem_dontheto', 'egyeztetes_iras_utkozes'];

  it('az egyeztetési okok nem kapják az általános „a rendszer automatikusan eldönti" szöveget', () => {
    const tartalom = emailSzolg.cibRiasztasTartalom;
    for (const ok of SAJAT_TEENDOS) {
      const { subject, html } = tartalom({ trid: '1234567890123456', jobId: 'fuvar-1', ok });
      expect(html, `${ok}: a levél az általános (kétes) teendőt adja`).not.toMatch(/automatikusan eldönti/);
      if (ok.startsWith('egyeztetes_')) expect(subject).toMatch(/kézi egyeztetést/);
    }
    // A kétes okok (close_unknown, zaras_*) változatlanul az általános szöveget kapják.
    expect(tartalom({ trid: '1234567890123456', jobId: 'fuvar-1', ok: 'zaras_valasz_nelkul' }).html).toMatch(/automatikusan eldönti/);
  });

  it('szinkron: a cibFizetes minden saját teendős riasztási oka a levélben is saját teendőt kap', () => {
    const okok = Object.keys(cf().RIASZTAS_TEENDO || {});
    expect(okok.length).toBeGreaterThan(0);
    for (const ok of okok) {
      const { html } = emailSzolg.cibRiasztasTartalom({ trid: '1234567890123456', jobId: 'fuvar-1', ok });
      expect(html, `új riasztási ok (${ok}): a levél teendő-szótárából hiányzik (az általános szöveget kapja)`)
        .not.toMatch(/automatikusan eldönti/);
    }
  });
});

// =====================================================================
describe('Admin kézi rendezés: bérlet-feltételes írás', () => {
  it('„lejaratas": ha a SELECT után a kör bérletet vesz, 409 CIB_ROW_BUSY és nincs írás', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 700);
    const eredetiQuery = db.query;
    let atvett = false;
    db.query = async function koztes(sql, params) {
      if (!atvett && typeof sql === 'string' && sql.includes('FROM cib_messages') && sql.includes('msgt = 32')
        && Array.isArray(params) && params[0] === trid) {
        atvett = true;
        // A kör épp most veszi fel a sort (a SELECT és az UPDATE között).
        await eredetiQuery.call(db, `UPDATE payment_sessions SET cib_lease_owner = 'kor:1', cib_lease_until = NOW() + INTERVAL '1 minute'
                                      WHERE payment_id = $1`, [trid]);
      }
      return eredetiQuery.call(db, sql, params);
    };
    let r;
    try {
      r = await request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin))
        .send({ muvelet: 'lejaratas', indoklas: 'A határidő lejárt, a bank visszafordítja.' });
    } finally {
      db.query = eredetiQuery;
    }
    expect(atvett, 'a teszt nem érte el a bérlet-ablakot').toBe(true);
    expect(r.status, 'élő bérlet alatt (a kör dolgozik) a kézi lejáratás írt').toBe(409);
    expect(r.body.code).toBe('CIB_ROW_BUSY');
    expect(await sor(trid)).toMatchObject({ cib_state: 'redirected', state: 'pending' });
  });
});

// =====================================================================
describe('Lekérdező kör: a később teljessé váló konfig', () => {
  it('a bootkor hibás (jövőbeli CIB_BEVEZETES), később teljes konfigot a kör egyszer naplózza', async () => {
    await kor(); // alapállapot: teljes konfig
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => {});
    const figy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const vissza = beallitEnv({ CIB_BEVEZETES: '2099-01-01' });
      try {
        expect(await kor()).toBe(0);
      } finally {
        vissza();
      }
      await kor();
      await kor();
      const sorok = naplo.mock.calls.map((c) => String(c[0]));
      expect(sorok.filter((x) => /most teljes lett/.test(x)), 'a konfig teljessé válásáról nincs napló').toHaveLength(1);
      expect(sorok.filter((x) => /EKI-konfiguráció teljes/.test(x))).toHaveLength(1);
    } finally {
      naplo.mockRestore();
      figy.mockRestore();
      hiba.mockRestore();
    }
  });
});
