// =====================================================================
//  CIB PR-4 — A BANK ÍRÁSOS VÁLASZAI A KÓDBAN (2026-10-01)
//
//  A CIB 2026-10-01-én írásban válaszolt a nyitott kérdéseinkre. Ami a
//  pénz útját érinti, és amit ez a fájl őriz (a hamis bankkal — a valódi
//  bankot semmi nem hívja):
//
//   (a) „Csak akkor tekinthető sikeresnek a tranzakció, ha a kapott MSGT32-es
//       üzenetre teljes értékű választ adunk vissza. Előfordulhat, hogy az
//       MSGT32-es üzenetre S05 választ adunk; […] ha 10 percen belül nem kerül
//       lezárásra MSGT32-es üzenettel, még visszautalásra kerülhet."
//       → a MSGT32-re kapott RC=S05 (és S04) a bizonyítottan FEL NEM
//       DOLGOZOTT zárás: vissza `authorized`-ba, rövid várakozás után ÚJ
//       zárási claim, legfeljebb 3 MSGT32. Eddig `close_unknown` lett belőle
//       (ember), és a MSGT32 soha nem ment ki újra — a jóváhagyott díjat a
//       bank 10 perc múlva visszautalta, a feladó pedig „Ne fizess újra"
//       képernyőt kapott. A többi S-kód a zárásra változatlanul kétes.
//   (b) „10 perc a lezárási határidő, ami a kapott 10-es üzenet beérkezésétől
//       számítódik." → MINDEN helyi zárási ablak a MSGT10-től számított
//       legfeljebb 9 perc 30 mp-ig tart (CIB_ZARAS_HATARIDO_MP, alap 570),
//       a DB órájával mérve. Eddig a jóváhagyástól (authorized_at) számolt
//       8 perc volt — egy a bank oldalán 5 percig tartó fizetés után ez a
//       MSGT10-től 13 percet jelentett, a bank határideje után.
//   (d) Az adattovábbítási hozzájárulás kötelező, akkor is, ha vásárlói
//       adatot nem küldünk: a CIB-úton a /pay a nyilatkozat nélkül 400
//       CIB_CONSENT_REQUIRED-et ad — MINDEN DB-írás és banki hívás ELŐTT.
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
const p = require('../src/services/cibProtokoll');

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
/** /pay + hop: a vásárló a bank oldalán van (redirected). */
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
/**
 * A kísérlet MSGT10-je `mp` másodperce ment ki: a kimenő MSGT10 naplósora
 * és a kísérlet létrehozása is ennyivel korábbra kerül (DB-óra). Az
 * authorized_at NEM változik — épp azt mérjük, hogy a zárási ablak a
 * MSGT10-től számít, nem a jóváhagyástól.
 */
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

// =====================================================================
describe('(a) S05/S04 a MSGT32-re: bizonyítottan fel nem dolgozott zárás', () => {
  it('a kimenet-osztályozó: S05 és S04 → nem_feldolgozott (rövid visszalépés); a többi S-kód kétes marad', () => {
    const S = { payment_id: '0123456789012345', amount_huf: 500, currency: 'HUF' };
    const bankiHiba = (rc, http) => ({
      kuldve: true, http, mezok: null, bankRc: rc, hibaOsztaly: 'bank_S',
    });
    for (const rc of ['S05', 'S04']) {
      for (const http of [200, 403, 500]) {
        expect(p.zarasKimenet(bankiHiba(rc, http), S, 'TST0001'), `${rc} HTTP ${http}`)
          .toMatchObject({ kimenet: 'nem_feldolgozott', bankRc: rc, visszalepesMs: 30000 });
      }
    }
    for (const rc of ['S01', 'S02', 'S03', 'S06', 'S99']) {
      expect(p.zarasKimenet(bankiHiba(rc, 200), S, 'TST0001'), rc).toMatchObject({ kimenet: 'ketes', ok: 'zaras_s', bankRc: rc });
    }
    // Elutasított eredetű zárásnál továbbra is minden nem-00 „elutasitva".
    expect(p.zarasKimenet(bankiHiba('S05', 200), S, 'TST0001', { eredete: 'declined' })).toMatchObject({ kimenet: 'elutasitva' });
    // A MSGT33-ra kapott S05 NEM zárás: ott változatlanul a kör-megszakító ág.
    expect(p.lekerdezesKimenet(bankiHiba('S05', 200), S, 'TST0001')).toMatchObject({ kimenet: 'bank_s' });
  });

  it.each([
    ['S05 HTTP 200-zal', { nyers: 'RC=S05', http: 200 }, 'S05'],
    ['S04 HTTP 403-mal', { nyers: 'RC=S04', http: 403 }, 'S04'],
  ])('%s → vissza authorized-ba, rövid várakozás, a 2. MSGT32 lezár: pontosan egy siker, egy könyvelés', async (_n, lepes, rc) => {
    const { felado, szallito, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [lepes]);
    await visszater(trid);

    let s = await sor(trid);
    expect(s, 'a bank S05/S04-e után a zárás kétesre (ember) került — a MSGT32 soha nem ment volna ki újra')
      .toMatchObject({ cib_state: 'authorized', state: 'pending', cib_close_attempts: 1 });
    expect(s.cib_result.zaras_bank_rc).toBe(rc);
    expect(bankDb(trid, 32)).toBe(1);
    const mp = await kovetkezoMp(trid);
    expect(mp, 'az újrapróba nem rövid várakozással ütemeződött').toBeGreaterThan(0);
    expect(mp).toBeLessThanOrEqual(61);
    expect((await jobSor(job.id)).paid_at, 'S05/S04 után könyveltünk').toBeNull();
    expect(riasztasok(trid)).toHaveLength(0);
    // A kontakt a fel nem dolgozott zárás után rejtve marad.
    expect((await request(app).get(`/jobs/${job.id}`).set(...auth(felado))).body.contact).toBeFalsy();

    // A várakozás lejárt: a kör ÚJ zárási claimmel újraküldi a MSGT32-t.
    await esedekes(trid);
    await kor();
    s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded', cib_close_attempts: 2 });
    expect(s.cib_result).toMatchObject({ rc: '00', forras: '32' });
    expect(bankDb(trid, 32)).toBe(2);
    expect(bank.tranzakciok.get(trid).zarva).toBe(true);
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
    expect((await db.query(`SELECT 1 FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded'`, [trid])).rowCount).toBe(1);
    expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE payment_id = $1', [trid])).rowCount).toBe(1);
    expect(LEVELEK.filter((l) => l.nev === 'sendFeeConfirmationEmail' && l.to === felado.email)).toHaveLength(1);
    expect(LEVELEK.filter((l) => l.nev === 'sendJobPaidEmail' && l.to === szallito.email)).toHaveLength(1);
    expect(riasztasok(trid)).toHaveLength(0);

    // További körök után sem megy ki harmadik MSGT32.
    for (let i = 0; i < 2; i += 1) {
      await esedekes(trid);
      await kor();
    }
    expect(bankDb(trid, 32)).toBe(2);
  });

  it('háromszori S05: legfeljebb 3 MSGT32, utána close_unknown (zaras_nem_feldolgozott) + egy riasztás', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=S05', http: 200 }, { nyers: 'RC=S05', http: 200 }, { nyers: 'RC=S05', http: 200 }]);
    await visszater(trid);
    expect((await sor(trid)).cib_state).toBe('authorized');
    for (let i = 0; i < 4; i += 1) {
      await esedekes(trid);
      await kor();
    }
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending', cib_close_attempts: 3 });
    expect(s.cib_result).toMatchObject({ ok: 'zaras_nem_feldolgozott', zaras_bank_rc: 'S05' });
    expect(bankDb(trid, 32), 'háromnál több MSGT32').toBe(3);
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('S01 a MSGT32-re változatlanul kétes: close_unknown (zaras_s), riasztás, újraküldés SOHA', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=S01', http: 200 }]);
    await visszater(trid);
    let s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending', cib_close_attempts: 1 });
    expect(s.cib_result).toMatchObject({ ok: 'zaras_s', zaras_bank_rc: 'S01' });
    for (let i = 0; i < 3; i += 1) {
      await esedekes(trid);
      await kor();
    }
    s = await sor(trid);
    expect(s.cib_state).toBe('close_unknown');
    expect(bankDb(trid, 32)).toBe(1);
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('egy függő újrapróba (authorized, már ment MSGT32) alatt egy MÁSIK kísérlet nem zárhat; a végén egy terhelés', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    bank.dont(t1, 'fizet');
    bank.tridre(t1, 32, [{ nyers: 'RC=S05', http: 200 }]);
    await cf().feldolgoz(t1, 'visszateres');
    await cf().varjHatterre();
    expect(await sor(t1)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });

    // A második fül jóváhagyása: az S05 után a bank a t1-et még lezárhatja
    // (a MSGT33 sikert is mutathat) — a t2 zárása kettős terhelés lenne.
    bank.dont(t2, 'fizet');
    await cf().feldolgoz(t2, 'visszateres');
    await cf().varjHatterre();
    expect(bankDb(t2, 32), 'a függő újrapróba mellett egy másik TRID-re is ment MSGT32').toBe(0);
    expect(await sor(t2)).toMatchObject({ cib_state: 'authorized', state: 'pending', cib_close_attempts: 0 });

    await esedekes(t1);
    await kor();
    expect(await sor(t1)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    await esedekes(t2);
    await kor();
    const s2 = await sor(t2);
    expect(s2).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect(s2.cib_result.ok).toBe('mar_fizetve');
    expect(bankDb(t1, 32) + bankDb(t2, 32)).toBe(2);
    expect(bankDb(t2, 32)).toBe(0);
  });
});

// =====================================================================
describe('(b) Zárási határidő: a MSGT10-től számított 9 perc 30 mp, DB-órával', () => {
  it.each([
    ['D03', { nyers: 'RC=D03', http: 500 }],
    ['S05', { nyers: 'RC=S05', http: 200 }],
  ])('fel nem dolgozott zárás (%s) 9:10-kor: az újrapróba a határidőn túl esne → close_unknown (zaras_hatarido), újraküldés nélkül', async (_n, lepes) => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 550);
    bank.tridre(trid, 32, [lepes]);
    await visszater(trid);
    const s = await sor(trid);
    expect(s, 'a MSGT10-től számított határidőn túlra ütemeztünk újra MSGT32-t').toMatchObject({
      cib_state: 'close_unknown', state: 'pending', cib_close_attempts: 1,
    });
    expect(s.cib_result.ok).toBe('zaras_hatarido');
    expect(s.cib_next_action_at).toBeNull();
    expect(bankDb(trid, 32)).toBe(1);
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('a függő újrapróba esedékessége a határidő után: MSGT32 NEM megy ki, close_unknown + riasztás', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=D03', http: 500 }]);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 1 });
    await msgt10Ota(trid, 575);
    await esedekes(trid);
    await kor();
    const s = await sor(trid);
    expect(bankDb(trid, 32), 'a határidő után újra kiment a MSGT32').toBe(1);
    expect(s).toMatchObject({ cib_state: 'close_unknown', state: 'pending', cib_close_attempts: 1 });
    expect(s.cib_result.ok).toBe('zaras_hatarido');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(riasztasok(trid)).toHaveLength(1);
  });

  it('a határidő után jóváhagyott kísérlet (MSGT32 még nem ment): expired, MSGT32 nélkül, terhelés nincs, riasztás nincs', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 575);
    await visszater(trid);
    const s = await sor(trid);
    expect(bankDb(trid, 33)).toBe(1);
    expect(bankDb(trid, 32), 'a bank határidején túl jóváhagyott tételt zártunk').toBe(0);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed', cib_close_attempts: 0 });
    expect(s.cib_result.ok).toBe('zarasi_hatarido');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(riasztasok(trid)).toHaveLength(0);
    const l = LEVELEK.filter((x) => x.nev === 'sendFeePaymentFailedEmail' && x.jobId === job.id);
    expect(l.map((x) => x.tipus)).toEqual(['sikertelen']);
    // Új fizetés azonnal indítható.
    const uj = await fizet(felado, job);
    expect(uj.status, JSON.stringify(uj.body)).toBe(200);
  });

  it('a határidőn belül jóváhagyott kísérlet (9:00) lezárul — a határ nem túl szigorú', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await msgt10Ota(trid, 540);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(bankDb(trid, 32)).toBe(1);
  });

  it('„másik zárás" várakozás: a MSGT10-től számított határidőig tart, nem a jóváhagyástól 8 percig', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1, cib_close_sent_at = NOW(),
                    cib_lease_owner = 'masik:1', cib_lease_until = NOW() + INTERVAL '3 minutes' WHERE payment_id = $1`, [t2]);
    await visszater(t1);
    // Most hagyták jóvá, a másik zár: vár.
    expect(await sor(t1)).toMatchObject({ cib_state: 'authorized', cib_close_attempts: 0 });
    expect(bankDb(t1, 32)).toBe(0);
    // A MSGT10 óta 9:35 telt el (a jóváhagyás óta csak másodpercek): feladja.
    await msgt10Ota(t1, 575);
    await esedekes(t1);
    await kor();
    const s = await sor(t1);
    expect(s, 'a jóváhagyástól számolt 8 perc a bank MSGT10-es határidején túl is várna').toMatchObject({
      cib_state: 'not_closed', state: 'closed',
    });
    expect(s.cib_result.ok).toBe('masik_zaras');
    expect(bankDb(t1, 32)).toBe(0);
  });

  it('a horgony a MSGT10 KIMENŐ naplósora (a küldés pillanata), nem egy későbbi időpont', async () => {
    // Ha csak a kísérlet létrehozása régi, de a MSGT10 naplósora friss, a
    // határidő a naplósorhoz igazodik (az a közelebbi a bank beérkezéséhez).
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET created_at = NOW() - INTERVAL '20 minutes' WHERE payment_id = $1`, [trid]);
    await visszater(trid);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  });

  it('a határidő a .env-ből hangolható (CIB_ZARAS_HATARIDO_MP), alapértéke 570, legfeljebb 590', () => {
    expect(p.cibBeallitasok().hangolok.zarasHataridoMp).toBe(570);
    const env = { ...process.env };
    expect(p.cibBeallitasok({ ...env, CIB_ZARAS_HATARIDO_MP: '300' }).hangolok.zarasHataridoMp).toBe(300);
    // A bank határidején (600) túl soha: érvénytelen → az alapérték marad.
    const tul = p.cibBeallitasok({ ...env, CIB_ZARAS_HATARIDO_MP: '600' });
    expect(tul.hangolok.zarasHataridoMp).toBe(570);
    expect(tul.figyelmeztetesek.join(' ')).toMatch(/CIB_ZARAS_HATARIDO_MP/);
    expect(p.OLVASOTT_ENV).toContain('CIB_ZARAS_HATARIDO_MP');
  });
});

// =====================================================================
describe('(d) Adattovábbítási hozzájárulás a CIB-úton', () => {
  const HIBA = 'A bankkártyás fizetéshez el kell fogadnod a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.';

  it.each([
    ['hiányzik', { consent: true }],
    ['false', { consent: true, cib_adatkezelesi_hozzajarulas: false }],
    ['"true" szövegként', { consent: true, cib_adatkezelesi_hozzajarulas: 'true' }],
    ['1', { consent: true, cib_adatkezelesi_hozzajarulas: 1 }],
    ['null', { consent: true, cib_adatkezelesi_hozzajarulas: null }],
  ])('a nyilatkozat %s → 400 CIB_CONSENT_REQUIRED; nincs DB-írás, nincs banki üzenet', async (_n, body) => {
    const { felado, job } = await elfogadottFuvar();
    await db.query(`INSERT INTO fee_vouchers (user_id, reason, valid_from, valid_until)
                    VALUES ($1, 'referral', CURRENT_DATE, CURRENT_DATE + 30)`, [felado.id]);
    const elotte = bank.uzenetek.length;
    const r = await fizet(felado, job, body);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toEqual({ code: 'CIB_CONSENT_REQUIRED', error: HIBA });
    expect(bank.uzenetek.length, 'a nyilatkozat nélkül banki üzenet ment ki').toBe(elotte);
    expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM escrow_transactions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    const j = await jobSor(job.id);
    expect(j.fee_consent_at, 'a 45/2014-es nyilatkozat a CIB-hozzájárulás nélkül is rögzült').toBeNull();
    expect(j.paid_at).toBeNull();
    // A kupon sem váltódott be (az is DB-írás lett volna).
    expect((await db.query('SELECT used_at FROM fee_vouchers WHERE user_id = $1', [felado.id])).rows[0].used_at).toBeNull();
  });

  it('a 45/2014-es nyilatkozat hiánya továbbra is CONSENT_REQUIRED (előbb az)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const r = await fizet(felado, job, { cib_adatkezelesi_hozzajarulas: true });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CONSENT_REQUIRED');
  });

  it('a nyilatkozattal 200, és az időpontja a kísérleten van (cib_result.hozzajarulas_at = DB-óra, az A-fázisban)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const r = await fizet(felado, job);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = await sor(r.body.trid);
    expect(s.cib_result.hozzajarulas_at, 'a hozzájárulás időpontja nincs rögzítve').toBeTruthy();
    const h = Date.parse(s.cib_result.hozzajarulas_at);
    // Ugyanabban a tranzakcióban, mint a kísérlet létrehozása (NOW()).
    expect(Math.abs(h - new Date(s.created_at).getTime())).toBeLessThan(5);
    const { rows } = await db.query('SELECT EXTRACT(EPOCH FROM NOW())::float * 1000 AS most');
    expect(Math.abs(rows[0].most - h)).toBeLessThan(60_000);
  });

  it('a nyilatkozat nem írja felül a kísérlet többi adatát (TS megmarad)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const r = await fizet(felado, job);
    const s = await sor(r.body.trid);
    expect(s.cib_result.ts).toMatch(/^[0-9]{14}$/);
  });

  it('a stub-út (teszt-allowlisten kívüli feladó) változatlan: nyilatkozat nélkül is indul', async () => {
    const listas = await createUser();
    const vissza = beallitEnv({ CIB_TESZT_FELHASZNALOK: listas.id });
    try {
      const { felado, job } = await elfogadottFuvar();
      const r = await fizet(felado, job, { consent: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ is_stub: true, payment_id: `cib-stub-${job.id}` });
    } finally {
      vissza();
    }
  });
});
