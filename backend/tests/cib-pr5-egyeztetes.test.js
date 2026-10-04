// =====================================================================
//  CIB PR-5 — AUTOMATIKUS EGYEZTETÉS, TARTÓS RIASZTÁSOK, IGAZ SZÖVEGEK
//  (2026-10-03)
//
//  Amit ez a fájl őriz (mindegyik tétel a javítás nélkül piros):
//   * a kétes (close_unknown) kísérlet nem kézi-only: az UTOLSÓ kimenő MSGT32
//     után CIB_EGYEZTETES_PERC (alap 25, legalább 20) perccel egy CSAK-OLVASÓ
//     MSGT33 eldönti — TO → nem terhelt (a fuvar újra fizethető), két, ≥15
//     perc különbségű 00 ugyanazzal az ANUM-mal egy KIMENT MSGT32 után →
//     könyvelés (MSGT32 soha), a TO-tól eltérő elutasító kód / eltérő ANUM →
//     riasztás + visszalépés (2026-10-04, 1. javítókör); MSGT32 nélküli
//     kísérlet 00-ra sem könyvelődik;
//   * a feladó a kétes kísérletről is értesül („egyeztetjük, ne fizess újra");
//   * összeomlás a zárási claim és a kimenő MSGT32-naplósor között: a hiányzó
//     „ki" sor bizonyítja, hogy a MSGT32 el sem ment → nem kétes; az admin
//     „lezarva" sem fogadható el kimenő napló nélkül;
//   * a riasztás egy DB-hibát is túlél (a sor a körben marad), a könyvelési
//     hiba és a könyvelési árva riaszt, a rendezetlen tételekről napi
//     összesítő megy; a rendszerszintű banki hibák (D-kódok, RC nélküli
//     HTTP-hiba, tartós D04) is riasztanak;
//   * a MSGT33-anomália (NT / mezőeltérés) MSGT32 nélkül nem blokkolja a
//     feladót, és nem okoz végtelen 23505-kört;
//   * az admin „nem_lezarva" és a bank visszafordítása után a feladó nem kap
//     hamis „a fuvar közben megváltozott" indoklást (C5); az admin „lezarva"
//     után az RT is kitöltött (C6); az admin-lista „ellenorzes" szűrője él.
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
const notifications = require('../src/services/notifications');
const feePayment = require('../src/services/feePayment');

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
  cf().__resetCibAllapotForTests();
  cf().szivveres();
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei parkolnak.
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
const fizet = (f, job) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f))
  .send({ consent: true, cib_adatkezelesi_hozzajarulas: true });
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
const bankDb = (trid, msgt) => bank.szamol(trid, msgt);
const riasztasok = (trid) => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid);
const rendszerRiasztasok = (ok) => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && !l.trid && l.ok === ok);
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
/** A kísérlet MSGT10-je `mp` másodperce ment ki (a napló és a létrehozás is). */
async function msgt10Ota(trid, mp) {
  await db.query('UPDATE payment_sessions SET created_at = NOW() - make_interval(secs => $2::int) WHERE payment_id = $1', [trid, mp]);
  await db.query(`UPDATE cib_messages SET created_at = NOW() - make_interval(secs => $2::int)
                   WHERE payment_id = $1 AND direction = 'ki' AND msgt = 10`, [trid, mp]);
}
/**
 * A kétes kísérlet idővonala: a MSGT10 `msgt10Mp`, a (kimenő) MSGT32
 * `msgt32Mp` másodperce ment ki. 2026-10-04 (javítókör): az egyeztetés
 * horgonya az UTOLSÓ kimenő MSGT32, nem a MSGT10.
 */
async function ketesOta(trid, msgt10Mp, msgt32Mp = msgt10Mp) {
  await msgt10Ota(trid, msgt10Mp);
  await db.query(`UPDATE cib_messages SET created_at = NOW() - make_interval(secs => $2::int)
                   WHERE payment_id = $1 AND direction = 'ki' AND msgt = 32`, [trid, msgt32Mp]);
}
/** Az egyeztetés első (megerősítendő) 00-ja `mp` másodperce jött. */
async function elso00Ota(trid, mp) {
  await db.query(`UPDATE payment_sessions
                     SET cib_result = jsonb_set(cib_result, '{egyeztetes_elso_00,at}', to_jsonb(NOW() - make_interval(secs => $2::int)))
                   WHERE payment_id = $1 AND cib_result ? 'egyeztetes_elso_00'`, [trid, mp]);
}
async function kovetkezoMp(trid) {
  const { rows } = await db.query(
    'SELECT EXTRACT(EPOCH FROM (cib_next_action_at - NOW()))::float AS mp FROM payment_sessions WHERE payment_id = $1', [trid],
  );
  return rows[0].mp;
}
/** A kimenő MSGT32 write-ahead naplósora (ahogy a kliens a küldés ELŐTT írja). */
async function kimenoZarasNaplo(trid, k = 1) {
  await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt)
                  VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', $2)`, [trid, k]);
}
async function eredmeny(trid) {
  const r = await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(cf().eredmenyToken(trid))}`);
  expect(r.status).toBe(200);
  return r.body;
}
const dijAllapot = async (f, job) => (await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(f))).body;

// =====================================================================
describe('Automatikus egyeztetés: a kétes kísérlet csak-olvasó MSGT33-mal dől el', () => {
  it('a MSGT32 válasza elvész, a bank nem zárt: a feladó értesül; az utolsó MSGT32 után 25 perccel TO → nem terhelt, újra fizethető', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    await visszater(trid);
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_next_action_at, 'a kétes kísérlet parkol: a kör soha nem veszi fel').not.toBeNull();
    // A feladó a kétes kísérletről is értesül („ne fizess újra").
    expect(feladoLevelek(job.id, 'egyeztetes'), 'a kétes kísérletről a feladó nem kapott levelet').toHaveLength(1);
    expect(INAPP.filter((n) => n.user_id === felado.id && n.type === 'payment_review')).toHaveLength(1);
    expect(riasztasok(trid)).toHaveLength(1);

    // Az egyeztetési idő előtt: nincs banki lekérdezés.
    const elotte33 = bankDb(trid, 33);
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33), 'az egyeztetési idő előtt kérdezett').toBe(elotte33);
    // A horgony az UTOLSÓ kimenő MSGT32, nem a MSGT10: a MSGT10 után 29, a
    // MSGT32 után 20 perccel még nem kérdezünk (a régi szabály már kérdezett).
    await ketesOta(trid, 29 * 60, 20 * 60);
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33), 'az utolsó MSGT32 után 25 percen belül kérdezett').toBe(elotte33);

    // 26 perccel az utolsó MSGT32 után a bank már visszafordította: TO.
    await ketesOta(trid, 35 * 60, 26 * 60);
    bank.tridre(trid, 33, [{ rc: 'TO' }]);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect(bankDb(trid, 33)).toBe(elotte33 + 1);
    expect(bankDb(trid, 32), 'az egyeztetés MSGT32-t küldött').toBe(1);
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('bank_visszaforditotta');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    const l = feladoLevelek(job.id, 'bank_visszaforditotta');
    expect(l, 'a visszafordításról nem ment igaz szövegű levél').toHaveLength(1);
    expect(INAPP.filter((n) => n.user_id === felado.id && /megváltozott/.test(n.body || ''))).toHaveLength(0);
    expect(riasztasok(trid), 'az automatikus rendezés után újra riasztott').toHaveLength(1);

    const e = await eredmeny(trid);
    expect(e).toMatchObject({ allapot: 'nem_terhelt', ok: 'bank_visszaforditotta', trid });
    const fp = await dijAllapot(felado, job);
    expect(fp).toMatchObject({ can_pay: true, pay_blocked_reason: null });
    expect(fp.last_result).toMatchObject({ allapot: 'nem_terhelt', ok: 'bank_visszaforditotta' });
    const uj = await fizet(felado, job);
    expect(uj.status, JSON.stringify(uj.body)).toBe(200);
  });

  it('a MSGT32 feldolgozva, a válasz elvész (a bank terhelt): két, ≥15 perc különbségű 00 + ugyanaz az ANUM → könyvelve, MSGT32 nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    const elotte33 = bankDb(trid, 33);
    await ketesOta(trid, 35 * 60, 26 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    // Az első 00 csak feljegyzés: egy le nem zárt jóváhagyásra is 00 jön, amíg
    // a bank nem reverzál — könyvelni csak a megerősítő 00 után szabad.
    let elso = await sor(trid);
    expect(elso, 'egyetlen egyeztető 00-ra könyvelt').toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(elso.cib_result.egyeztetes_elso_00).toMatchObject({ anum: bank.tranzakciok.get(trid).anum });
    expect(await kovetkezoMp(trid), 'a megerősítő lekérdezés 15 percen belül esedékes').toBeGreaterThan(14 * 60);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    // Esedékessé téve, de a 15 perc még nem telt le: újabb 00-ra sem könyvel.
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    elso = await sor(trid);
    expect(elso.state, 'a megerősítés a 15 perc előtt könyvelt').toBe('pending');
    await elso00Ota(trid, 16 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect(bankDb(trid, 33)).toBeGreaterThanOrEqual(elotte33 + 2);
    const s = await sor(trid);
    expect(s, 'a bank által lezárt kétes kísérlet nem könyvelődött').toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(s.cib_result).toMatchObject({ rc: '00', anum: bank.tranzakciok.get(trid).anum });
    expect(s.cib_result.rt).toBeTruthy();
    expect(bankDb(trid, 32), 'az egyeztetés MSGT32-t küldött').toBe(1);
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
    expect(LEVELEK.filter((x) => x.nev === 'sendFeeConfirmationEmail' && x.to === felado.email)).toHaveLength(1);
    const reszlet = await request(app).get(`/jobs/${job.id}`).set(...auth(felado));
    expect(reszlet.body.contact).toBeTruthy();
  });

  it('nem eldönthető válasz (NT) után visszalépés, a riasztás nem ismétlődik', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    await visszater(trid);
    const elotte33 = bankDb(trid, 33);
    await ketesOta(trid, 35 * 60, 26 * 60);
    bank.tridre(trid, 33, [{ rc: 'NT' }]);
    await esedekes(trid);
    await kor();
    expect(bankDb(trid, 33)).toBe(elotte33 + 1);
    expect(await sor(trid)).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(await kovetkezoMp(trid), 'a nem eldönthető egyeztetés után azonnal újra kérdez').toBeGreaterThan(5 * 60);
    expect(riasztasok(trid)).toHaveLength(1);
    expect(bankDb(trid, 32)).toBe(1);
  });

  it('MSGT32 nélküli kétes kísérletet (régi NT-sor) a bank 00-ja sem könyveli: a határidő után nem terheltként zárul', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 0,
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'nt_ismetlodo')
                    WHERE payment_id = $1`, [trid]);
    await msgt10Ota(trid, 21 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect((await jobSor(job.id)).paid_at, 'MSGT32 nélkül könyveltünk').toBeNull();
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('bank_visszaforditotta');
    expect(bankDb(trid, 32)).toBe(0);
  });

  it('egyeztetett 00, de a fuvar közben nem fizethető → felülvizsgálat + riasztás (nem csendben)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [job.id]);
    await ketesOta(trid, 35 * 60, 26 * 60);
    await esedekes(trid);
    await kor();
    await elso00Ota(trid, 16 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s.state).toBe('needs_review');
    expect(riasztasok(trid).map((l) => l.ok)).toContain('konyvelesi_arva');
    expect(bankDb(trid, 32)).toBe(1);
  });
});

// =====================================================================
//  2026-10-04 (a PR-5 1. javítóköre, BLOKKOLÓ): az egyeztetés csak a banki
//  dokumentáció szerinti reverzál-jelre (TO) dönt „nem terhelt"-et, és a
//  „lezárt"-at két, időben távoli 00 erősíti meg.
// =====================================================================
describe('Egyeztetés: csak a TO „nem terhelt", a 00-t megerősítjük', () => {
  it('terhelt kétes kísérlet: az egyeztető MSGT33 nem-TO elutasító kódja (02, 96) NEM „nem terhelt" — kétes marad, riaszt, nem fizethető újra', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    // A bank a MSGT32-t FELDOLGOZTA (terhelt), a válasz elveszett.
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    for (const rc of ['02', '96']) {
      await ketesOta(trid, 40 * 60, 30 * 60);
      bank.tridre(trid, 33, [{ rc }]);
      await esedekes(trid);
      await kor();
      await cf().varjHatterre();
      const s = await sor(trid);
      expect(s, `az egyeztető MSGT33 RC=${rc}-ja „nem terhelt"-ként zárta a terhelt kísérletet`)
        .toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
      expect(await kovetkezoMp(trid), 'a nem eldönthető egyeztetés után nincs visszalépés').toBeGreaterThan(5 * 60);
    }
    expect(feladoLevelek(job.id, 'bank_visszaforditotta'), 'a feladó hamis „nem terheltük" levelet kapott').toHaveLength(0);
    expect(riasztasok(trid).map((l) => l.ok), 'a nem eldönthető banki kódról nincs riasztás')
      .toContain('egyeztetes_nem_dontheto');
    const fp = await dijAllapot(felado, job);
    expect(fp.can_pay, 'a terhelt kétes kísérlet mellett újra fizethető (kettős terhelés)').toBe(false);
    expect((await fizet(felado, job)).status).not.toBe(200);
    expect(bankDb(trid, 32)).toBe(1);
    expect((await jobSor(job.id)).paid_at).toBeNull();
  });

  it('CIB_EGYEZTETES_PERC 20 perc alatt nem fogadható el (alap 25)', () => {
    const p = require('../src/services/cibProtokoll');
    const env = bank.env({ CIB_BEVEZETES: '2026-01-01' });
    const h = (perc) => p.cibBeallitasok({ ...env, CIB_EGYEZTETES_PERC: perc }).hangolok.egyeztetesPerc;
    expect(h('12'), 'a 12 perc a mért reverzál-időn belül van').toBe(25);
    expect(h('19')).toBe(25);
    expect(h('20')).toBe(20);
    expect(h(undefined)).toBe(25);
  });

  it('a MSGT32 nem ért a bankhoz, a bank (még) 00-t ad: egyetlen 00 nem könyvel — a megerősítő lekérdezés TO → nem terhelt', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    // A régi szabály (MSGT10 + 20 perc) itt már kérdezett, és a 00-ra könyvelt.
    await ketesOta(trid, 21 * 60, 20 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect((await jobSor(job.id)).paid_at, 'a le nem zárt (még nem reverzált) jóváhagyás 00-jára könyveltünk').toBeNull();
    // 26 perccel az utolsó MSGT32 után: az első 00 csak feljegyzés.
    await ketesOta(trid, 27 * 60, 26 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect(s.cib_result.egyeztetes_elso_00).toBeTruthy();
    expect((await jobSor(job.id)).paid_at).toBeNull();
    // A bank közben reverzált: a megerősítő lekérdezés TO.
    await elso00Ota(trid, 16 * 60);
    bank.tridre(trid, 33, [{ rc: 'TO' }]);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('bank_visszaforditotta');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(bankDb(trid, 32)).toBe(1);
  });

  it('a megerősítő 00 más ANUM-mal jön: nem könyvel, riaszt (ember dönt)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ bont: true }]);
    await visszater(trid);
    await ketesOta(trid, 35 * 60, 26 * 60);
    await esedekes(trid);
    await kor();
    bank.tranzakciok.get(trid).anum = '999999';
    await elso00Ota(trid, 16 * 60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect(await sor(trid)).toMatchObject({ cib_state: 'close_unknown', state: 'pending' });
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(riasztasok(trid).map((l) => l.ok)).toContain('egyeztetes_nem_dontheto');
  });

  it('összeomlás a „nem terhelt" rögzítése és az értesítés között: a kör pótolja a feladó értesítését (I8)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'expired', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'bank_visszaforditotta')
                    WHERE payment_id = $1`, [trid]);
    await kor();
    await cf().varjHatterre();
    expect((await sor(trid)).state).toBe('closed');
    expect(feladoLevelek(job.id, 'bank_visszaforditotta'), 'az összeomlás után a feladó soha nem kapott értesítést')
      .toHaveLength(1);
    expect(INAPP.filter((n) => n.user_id === felado.id && n.type === 'payment_not_charged')).toHaveLength(1);
  });
});

// =====================================================================
describe('Összeomlás a zárási claim után, a kimenő MSGT32-naplósor előtt', () => {
  async function claimUtanHalt(trid) {
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1,
                    cib_close_sent_at = NOW() - INTERVAL '10 minutes', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('msgt33_rc', '00', 'zaras_eredete', 'authorized'),
                    cib_lease_owner = 'halott:1', cib_lease_until = NOW() - INTERVAL '1 minute' WHERE payment_id = $1`, [trid]);
  }

  it('a határidőn belül: a MSGT32 el sem ment → vissza authorized-ba, egyszer zár, riasztás nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await claimUtanHalt(trid);
    await kor();
    let s = await sor(trid);
    expect(s.cib_state, 'a bizonyítottan el sem küldött zárásból kétes lett').toBe('authorized');
    expect(s.cib_result.zaras_nem_kuldott).toBe(1);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(bankDb(trid, 32)).toBe(1);
    expect(riasztasok(trid)).toHaveLength(0);
  });

  it('a határidőn túl: expired (nem zárt), MSGT32 és riasztás nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await claimUtanHalt(trid);
    await msgt10Ota(trid, 600);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('zarasi_hatarido');
    expect(bankDb(trid, 32)).toBe(0);
    expect(riasztasok(trid)).toHaveLength(0);
    expect(feladoLevelek(job.id, 'nem_zart')).toHaveLength(1);
  });

  it('admin „lezarva" a kimenő MSGT32-napló nélkül → 409 CIB_CLOSE_NOT_SENT (a számláló nem elég)', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [trid]);
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: 'AB1234' });
    expect(r.status, 'el sem küldött MSGT32 mellett lezártnak jelölhető').toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_NOT_SENT');
    expect((await jobSor(job.id)).paid_at).toBeNull();
  });
});

// =====================================================================
describe('Riasztások: tartósak, a könyvelési hiba és az árva is riaszt, napi összesítő', () => {
  it('a riasztás jelölésének DB-hibája után sem vész el: a kör újra riaszt', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    const eredeti = db.query;
    let hibazott = false;
    db.query = function hibas(sql, ...rest) {
      if (!hibazott && typeof sql === 'string' && /riaszt/.test(sql)) {
        hibazott = true;
        return Promise.reject(new Error('Connection terminated unexpectedly'));
      }
      return eredeti.call(this, sql, ...rest);
    };
    try {
      await visszater(trid);
    } finally {
      db.query = eredeti;
    }
    expect(hibazott).toBe(true);
    expect((await sor(trid)).cib_state).toBe('close_unknown');
    // A sort a kör a saját ütemezése szerint veszi fel (esedékessé tétel nélkül).
    await kor();
    await cf().varjHatterre();
    expect(riasztasok(trid).length, 'a kétes kísérletről soha nem ment riasztás').toBeGreaterThan(0);
    expect((await sor(trid)).cib_result.riasztas_at).toBeTruthy();
  });

  it('könyvelési hiba (a bank terhelt): a 3. hibánál egyszer riaszt, visszalépéssel újrapróbál, majd könyvel', async () => {
    await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const eredeti = feePayment.konyvelDijFizetes;
    feePayment.konyvelDijFizetes = async () => { throw new Error('séma-eltérés'); };
    try {
      await visszater(trid);
      for (let i = 0; i < 3; i += 1) {
        await esedekes(trid);
        await kor();
      }
      await cf().varjHatterre();
    } finally {
      feePayment.konyvelDijFizetes = eredeti;
    }
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'pending' });
    expect(riasztasok(trid).filter((l) => l.ok === 'konyvelesi_hiba'), 'a terhelt, de könyveletlen fizetésről nincs riasztás')
      .toHaveLength(1);
    expect(INAPP.filter((n) => n.type === 'cib_review' && /konyvelesi_hiba/.test(n.body || ''))).not.toHaveLength(0);
    expect(await kovetkezoMp(trid), 'tartós hiba mellett 30 mp-enként újrapróbál').toBeGreaterThan(60);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(riasztasok(trid).filter((l) => l.ok === 'konyvelesi_hiba')).toHaveLength(1);
  });

  it('könyvelési árva: a riasztó levél visszatérítést kér; az admin „visszaterites" lezárja, a feladó értesül, a fiók törölhető', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const eredeti = feePayment.konyvelDijFizetes;
    let egyszer = true;
    feePayment.konyvelDijFizetes = async (...a) => {
      if (egyszer) { egyszer = false; throw new Error('átmeneti'); }
      return eredeti(...a);
    };
    try {
      await visszater(trid);
    } finally {
      feePayment.konyvelDijFizetes = eredeti;
    }
    await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [job.id]);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    expect((await sor(trid)).state).toBe('needs_review');
    expect(riasztasok(trid).map((l) => l.ok)).toContain('konyvelesi_arva');
    const t = emailSzolg.cibRiasztasTartalom({ trid, jobId: job.id, ok: 'konyvelesi_arva' });
    expect(t.html, 'a könyvelési árvánál a „lezárva / ANUM" utasítás lehetetlen lépés').not.toMatch(/ANUM/);
    expect(t.html).toMatch(/visszatérít/i);

    const rossz = await request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'visszaterites', indoklas: 'rövid' });
    expect(rossz.status).toBe(400);
    const r = await request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'visszaterites', indoklas: 'A banknál a díjat visszautaltuk 2026-10-03-án.', banki_hivatkozas: 'REF123' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s).toMatchObject({ state: 'closed', closed_reason: 'admin_visszaterites' });
    expect(s.cib_result.ok).toBe('admin_visszaterites');
    expect(feladoLevelek(job.id, 'visszateritve')).toHaveLength(1);
    expect((await request(app).delete('/auth/me').set(...auth(felado)).send({ confirm: 'TÖRLÉS' })).status).not.toBe(409);
  });

  it('napi emlékeztető: a 24 óránál régebbi, rendezetlen tételekről egy összesítő levél, naponta egyszer', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ lefagy: true, feldolgoz: false }]);
    await visszater(trid);
    await db.query(`UPDATE payment_sessions SET cib_result = cib_result || jsonb_build_object('riasztas_at', NOW() - INTERVAL '25 hours')
                    WHERE payment_id = $1`, [trid]);
    // 2026-10-04 (javítókör): a levél kiesése után az emlékeztető nem
    // jelölődik — a következő söprés újra küldi (eddig 24 órára kimaradt).
    const eredetiLevel = emailSzolg.sendCibRiasztasEmail;
    emailSzolg.sendCibRiasztasEmail = async () => { throw new Error('Resend 503'); };
    try {
      await expect(cf().riasztasSopres()).rejects.toThrow(/Resend/);
    } finally {
      emailSzolg.sendCibRiasztasEmail = eredetiLevel;
    }
    expect((await sor(trid)).cib_result.emlekezteto_at, 'a ki nem ment emlékeztető jelölve').toBeUndefined();
    // 2026-10-04 (2. javítókör): az újrapróba legkorábban 60 perc múlva jön
    // (levélkiesés alatt ne percenként) — a próbálkozást visszadátumozzuk.
    await db.query(`UPDATE payment_sessions SET cib_result = cib_result
                      || jsonb_build_object('emlekezteto_probalkozas_at', NOW() - INTERVAL '61 minutes')
                    WHERE payment_id = $1`, [trid]);
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await cf().riasztasSopres();
      // A naplóba és a Sentrybe csak maszkolt TrID megy (a 16 jegyű szám
      // kártyaszámnak látszhat); a teljes lista csak a levélben.
      expect(hiba.mock.calls.some((c) => c.some((x) => String(x).includes(trid))), 'teljes TrID a naplóban').toBe(false);
    } finally {
      hiba.mockRestore();
    }
    const e = rendszerRiasztasok('napi_emlekezteto');
    expect(e, 'a napokig rendezetlen kétes tételről nincs emlékeztető').toHaveLength(1);
    expect(JSON.stringify(e[0])).toContain(trid);
    await cf().riasztasSopres();
    expect(rendszerRiasztasok('napi_emlekezteto')).toHaveLength(1);
  });

  it('ha az admin in-app riasztás beszúrása elbukik, a riasztás nem jelölődik — a söprés újraküldi', async () => {
    await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await kimenoZarasNaplo(trid);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1, cib_next_action_at = NULL,
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'zaras_valasz_nelkul')
                    WHERE payment_id = $1`, [trid]);
    const eredeti = notifications.createNotification;
    notifications.createNotification = async (n) => (n.type === 'cib_review' ? null : eredeti(n));
    try {
      await cf().riasztasSopres();
    } finally {
      notifications.createNotification = eredeti;
    }
    expect((await sor(trid)).cib_result.riasztva, 'a tartós nyom nélküli riasztás jelölve (a söprés soha nem pótolja)')
      .toBeUndefined();
    // A félbemaradt claim lejárta után a söprés újra riaszt — most tartósan.
    await db.query(`UPDATE payment_sessions SET cib_result = cib_result
                      || jsonb_build_object('riasztas_folyamatban', jsonb_build_object('ok', 'zaras_valasz_nelkul', 'at', NOW() - INTERVAL '10 minutes'))
                    WHERE payment_id = $1`, [trid]);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect((await sor(trid)).cib_result.riasztva).toHaveProperty('zaras_valasz_nelkul');
  });

  it('a parkoló (next_action NULL), riasztás nélküli régi kétes sort a söprés felébreszti és riaszt', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await kimenoZarasNaplo(trid);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1, cib_next_action_at = NULL,
                    cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'zaras_valasz_nelkul')
                    WHERE payment_id = $1`, [trid]);
    await cf().riasztasSopres();
    await cf().varjHatterre();
    expect(riasztasok(trid)).toHaveLength(1);
    expect((await sor(trid)).cib_next_action_at).not.toBeNull();
  });
});

// =====================================================================
describe('Rendszerszintű banki hibák riasztanak (összesítve, rátakorláttal)', () => {
  it('MSGT33 D06-sorozat (több TrID) → egy rendszer-riasztás', async () => {
    const tridek = [];
    for (let i = 0; i < 3; i += 1) {
      const { felado, job } = await elfogadottFuvar();
      const trid = await bankOldalon(felado, job);
      bank.tridre(trid, 33, [{ nyers: 'RC=D06', http: 500 }]);
      tridek.push(trid);
    }
    for (const trid of tridek) await visszater(trid);
    expect(rendszerRiasztasok('bank_rendszerhiba'), 'tartós banki elutasításról nincs riasztás').toHaveLength(1);
    for (let i = 0; i < 3; i += 1) {
      const { felado, job } = await elfogadottFuvar();
      const trid = await bankOldalon(felado, job);
      bank.tridre(trid, 33, [{ ures: true, http: 502 }]);
      await visszater(trid);
    }
    expect(rendszerRiasztasok('bank_rendszerhiba'), 'a rátakorlát nem fékez').toHaveLength(1);
  });

  it('MSGT10 D-kód → rendszer-riasztás', async () => {
    const { felado, job } = await elfogadottFuvar();
    bank.forgatokonyv(10, [{ nyers: 'RC=D01', http: 500 }]);
    const r = await fizet(felado, job);
    expect(r.status).toBe(502);
    expect(rendszerRiasztasok('bank_rendszerhiba')).toHaveLength(1);
  });

  it('ismétlődő D04 (a visszalépés duplázódik) → rendszer-riasztás', async () => {
    const a = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    bank.tridre(ta, 33, [{ nyers: 'RC=D04', http: 500 }]);
    await visszater(ta, null);
    expect(rendszerRiasztasok('bank_rendszerhiba')).toHaveLength(0);
    cf().__visszalepesVegeForTests();
    const b = await elfogadottFuvar();
    const tb = await bankOldalon(b.felado, b.job);
    bank.tridre(tb, 33, [{ nyers: 'RC=D04', http: 500 }]);
    await visszater(tb, null);
    expect(rendszerRiasztasok('bank_rendszerhiba'), 'a tartós D04 néma').toHaveLength(1);
  });
});

// =====================================================================
describe('MSGT33-anomália MSGT32 nélkül: nem blokkol, nem kering', () => {
  it('háromszori NT: nem kétes, a feladó újra fizethet; a határidő után nem terheltként zárul, egyszer riaszt', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'NT' }, { rc: 'NT' }, { rc: 'NT' }]);
    await visszater(trid, null);
    for (let i = 0; i < 2; i += 1) {
      await esedekes(trid);
      await kor();
    }
    let s = await sor(trid);
    expect(s.cib_state, 'MSGT32 nélkül is kétesbe került (blokkolja a feladót)').not.toBe('close_unknown');
    expect(riasztasok(trid)).toHaveLength(1);
    const fp = await dijAllapot(felado, job);
    expect(fp.can_pay).toBe(true);
    const uj = await fizet(felado, job);
    expect(uj.status, JSON.stringify(uj.body)).toBe(200);

    await msgt10Ota(trid, 600);
    await esedekes(trid);
    await kor();
    await cf().varjHatterre();
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('nt_ismetlodo');
    expect(bankDb(trid, 32)).toBe(0);
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('A lezárult, B MSGT31-eltérése: nincs végtelen 23505-kör, B a határidő után végállapotú', async () => {
    const { felado, job } = await elfogadottFuvar();
    const ta = await bankOldalon(felado, job);
    const tb = await bankOldalon(felado, job);
    await visszater(ta);
    expect(await sor(ta)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    bank.tridre(tb, 33, [{ amo: '999' }, { amo: '999' }, { amo: '999' }, { amo: '999' }]);
    const hiba = vi.spyOn(console, 'error');
    try {
      await visszater(tb, null);
      for (let i = 0; i < 3; i += 1) {
        await esedekes(tb);
        await kor();
      }
      await msgt10Ota(tb, 600);
      await esedekes(tb);
      await kor();
      await cf().varjHatterre();
      const duplikat = hiba.mock.calls.filter((c) => c.some((x) => /duplicate key|23505|payment_sessions_cib_egy_zaras_job/.test(String(x && x.message ? x.message : x))));
      expect(duplikat, 'a 23505 minden körben újra elszállt').toHaveLength(0);
    } finally {
      hiba.mockRestore();
    }
    const s = await sor(tb);
    expect(s.state).toBe('closed');
    expect(bankDb(tb, 32)).toBe(0);
  });
});

// =====================================================================
describe('Admin-rendezés: igaz szöveg (C5), kitöltött RT (C6), „ellenorzes" szűrő', () => {
  it('„nem_lezarva": a feladó nem kap „a fuvar megváltozott" indoklást; az eredmény nem_terhelt + ok', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await kimenoZarasNaplo(trid);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [trid]);
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint a tranzakció nem zárult le.' });
    expect(r.status).toBe(200);
    expect(r.body.allapot).toBe('nem_terhelt');
    await cf().varjHatterre();
    expect(feladoLevelek(job.id, 'nem_terhelt'), 'a feladó a „fuvar megváltozott" levelet kapta').toHaveLength(0);
    expect(feladoLevelek(job.id, 'admin_nem_lezarva')).toHaveLength(1);
    expect(INAPP.filter((n) => n.user_id === felado.id && /megváltozott/.test(n.body || ''))).toHaveLength(0);
    expect(await eredmeny(trid)).toMatchObject({ allapot: 'nem_terhelt', ok: 'admin_nem_lezarva' });
    const fp = await dijAllapot(felado, job);
    expect(fp.last_result).toMatchObject({ allapot: 'nem_terhelt', ok: 'admin_nem_lezarva' });
    expect(fp.can_pay).toBe(true);
  });

  it('élő bérlet alatt (az egyeztetés épp fut) a rendezés 409 CIB_ROW_BUSY — a futó banki eredmény nem vész el némán', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await kimenoZarasNaplo(trid);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1,
                    cib_lease_owner = 'masik:1', cib_lease_until = NOW() + INTERVAL '1 minute' WHERE payment_id = $1`, [trid]);
    for (const eredmenyKod of ['nem_lezarva', 'lezarva']) {
      const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
        .send({ eredmeny: eredmenyKod, indoklas: 'A bank írásban megerősítette.', anum: 'AB1234' });
      expect(r.status, `a futó egyeztetés közben „${eredmenyKod}" rendezhető`).toBe(409);
      expect(r.body.code).toBe('CIB_ROW_BUSY');
    }
    expect(await sor(trid)).toMatchObject({ cib_state: 'close_unknown', state: 'pending', cib_lease_owner: 'masik:1' });
  });

  it('„lezarva": az RT kitöltött (a bank szokásos szövege, vagy amit az admin megad)', async () => {
    const admin = await createUser({ role: 'admin' });
    for (const [rt, vart] of [[undefined, 'Tranzakció elfogadva'], ['Sikeres tranzakció', 'Sikeres tranzakció']]) {
      const { felado, job } = await elfogadottFuvar();
      const trid = await bankOldalon(felado, job);
      await kimenoZarasNaplo(trid);
      await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [trid]);
      const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
        .send({
          eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette a zárást.', anum: 'AB1234', ...(rt ? { rt } : {}),
        });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      await cf().varjHatterre();
      const s = await sor(trid);
      expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
      expect(s.cib_result.rt).toBe(vart);
      expect(await eredmeny(trid)).toMatchObject({
        allapot: 'sikeres', rc: '00', rt: vart, anum: 'AB1234', amo: 500,
      });
    }
  });

  it('az admin-lista „ellenorzes" szűrője a kétes és a felülvizsgálandó tételeket adja', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1 WHERE payment_id = $1`, [trid]);
    const r = await request(app).get('/payments/admin/cib?allapot=ellenorzes&limit=200').set(...auth(admin));
    expect(r.status, 'a web „Egyeztetésre vár" jelvénye 400-at kap').toBe(200);
    expect(r.body.items.map((i) => i.trid)).toContain(trid);
    expect(r.body.items.every((i) => i.allapot === 'ellenorzes')).toBe(true);
  });
});
