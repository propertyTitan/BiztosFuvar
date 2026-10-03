// =====================================================================
//  CIB EKI — AZ 1. JAVÍTÓKÖR ŐREI (2026-09-29, CIB PR-2 utóaudit)
//
//  Három független átvizsgálás (pénzút + párhuzamosság, banki protokoll,
//  regresszió + stub-együttélés) leletei. Mindegyik teszt a javítás NÉLKÜL
//  igazoltan piros (a 31c7bc2-n lemérve), a hamis bankkal — a valódi bankot
//  semmi nem hívja.
//
//  A BLOKKOLÓ lelet: a CIB-úton az elfogadáskor nincs függő fizetési
//  munkamenet, így a szállító az elfogadás és a /pay között törölheti a
//  fiókját. A fuvar `accepted` marad `carrier_id = NULL`-lal (ON DELETE SET
//  NULL), és eddig SEMMI nem szűrte: a MSGT32 kiment, a feladót megterheltük
//  egy nem létező kapcsolatért (üres kontakt, a díj nem visszatérítendő).
//  Szállító nélküli fuvar NEM fizethető — egyik lépésben sem.
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
const { inditHamisBank, beallitEnv, ujKulcs } = require('./cibHamisBank');
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
  vi.useRealTimers();
  __resetRateLimitsForTests();
  LEVELEK.length = 0;
  bank.horog(null);
  cf().__resetCibAllapotForTests();
  cf().szivveres();
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
const fizet = (f, job) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send({ consent: true, cib_adatkezelesi_hozzajarulas: true });
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
const atiranyit = (token) => request(app).get(`/payments/cib/tovabb/${token}`).redirects(0);
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
  const p = await fizet(felado, job);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  expect((await atiranyit(hopToken(p))).status).toBe(302);
  return p.body.trid;
}
async function visszater(trid, dontes = 'fizet') {
  if (dontes) bank.dont(trid, dontes);
  const r = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
  await cf().varjHatterre();
  return r;
}
const riasztasok = (trid) => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.trid === trid);

/** A `db.query` ideiglenes cseréje: a megadott SQL-t `n`-szer hibára futtatja. */
function dbHiba(mintazat, n) {
  const eredeti = db.query;
  let maradek = n;
  db.query = (sql, params) => {
    if (typeof sql === 'string' && mintazat.test(sql) && maradek > 0) {
      maradek -= 1;
      return Promise.reject(new Error('átmeneti DB-hiba (teszt)'));
    }
    return eredeti(sql, params);
  };
  return () => { db.query = eredeti; };
}
const SIKER_UPDATE = /SET cib_state = 'closed_ok'/;

// =====================================================================
describe('BLOKKOLÓ: szállító nélküli fuvar nem fizethető (a szállító fióktörlése után)', () => {
  it('a szállító az elfogadás után törli a fiókját → a /pay 409 STATE_CHANGED, MSGT10 nélkül', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    const torles = await request(app).delete('/auth/me').set(...auth(szallito)).send({ confirm: 'TÖRLÉS' });
    expect(torles.status, JSON.stringify(torles.body)).toBe(200);
    expect((await jobSor(job.id)).carrier_id).toBeNull();
    const elotte = bank.uzenetek.filter((u) => u.msgt === 10).length;
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(409);
    expect(p.body.code).toBe('STATE_CHANGED');
    expect(bank.uzenetek.filter((u) => u.msgt === 10).length, 'szállító nélküli fuvarra banki kísérlet indult').toBe(elotte);
  });

  it('ha a szállító a MSGT10 alatt tűnik el, a kísérlet nem lesz „ready" (link nélkül abandoned)', async () => {
    const { felado, job } = await elfogadottFuvar();
    bank.horog(async (u) => {
      if (u.msgt === 10) await db.query('UPDATE jobs SET carrier_id = NULL WHERE id = $1', [job.id]);
    });
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(409);
    expect(p.body.code).toBe('STATE_CHANGED');
    const { rows } = await db.query('SELECT cib_state FROM payment_sessions WHERE job_id = $1 AND cib_state IS NOT NULL', [job.id]);
    expect(rows.map((r) => r.cib_state)).toEqual(['abandoned']);
  });

  it('a hop-link nem visz a bankhoz, ha a fuvarnak közben elfogyott a szállítója', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    expect(p.status).toBe(200);
    await db.query('UPDATE jobs SET carrier_id = NULL WHERE id = $1', [job.id]);
    const h = await atiranyit(hopToken(p));
    expect(h.status, 'MSGT20 ment ki egy szállító nélküli fuvarra').toBe(303);
    expect(h.headers.location).toMatch(/fizetes=link-lejart/);
    expect((await sor(p.body.trid)).cib_state).toBe('abandoned');
  });

  it('a jóváhagyás a banki oldalon, de a fuvarnak már nincs szállítója → not_closed, MSGT32 NÉLKÜL, nincs paid_at', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    // A fióktörlés hatása: a fuvar ON DELETE SET NULL, és a kísérlet is
    // szállító nélkül született (a legrosszabb eset: NULL = NULL).
    await db.query('UPDATE jobs SET carrier_id = NULL WHERE id = $1', [job.id]);
    await db.query('UPDATE payment_sessions SET carrier_id = NULL WHERE payment_id = $1', [trid]);
    await visszater(trid);
    expect(bankDb(trid, 32), 'szállító nélküli fuvar díját lezártuk (terhelés)').toBe(0);
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'not_closed', state: 'closed' });
    expect(s.cib_result.ok).toBe('nem_fizetheto');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE payment_id = $1', [trid])).rowCount).toBe(0);
  });
});

// =====================================================================
describe('Zárás: összeomlás és átmeneti DB-hiba után sem kell ember, ha a bizonyíték megvan', () => {
  it('elutasított eredetű zárás közben elhalt folyamat → failed (nem close_unknown, nincs riasztás)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1,
                    cib_close_sent_at = NOW() - INTERVAL '10 minutes', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_result = jsonb_build_object('msgt33_rc', '51', 'rc', '51', 'zaras_eredete', 'declined'),
                    cib_lease_owner = 'halott:1', cib_lease_until = NOW() - INTERVAL '1 minute' WHERE payment_id = $1`, [trid]);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'failed', state: 'closed' });
    expect(bankDb(trid, 32)).toBe(0);
    expect(riasztasok(trid), 'elutasított authorizációból terhelés nem lehet — ember fölöslegesen riasztva').toHaveLength(0);
  });

  it('a hiteles MSGT31 RC=00 után egy átmeneti DB-hiba a rögzítésnél → újrapróba, closed_ok és könyvelés', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const vissza = dbHiba(SIKER_UPDATE, 1);
    try {
      await visszater(trid);
    } finally {
      vissza();
    }
    expect(bankDb(trid, 32)).toBe(1);
    expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });

  it('ha a rögzítés tartósan elbukik, a naplózott MSGT31 RC=00-ból a kör MSGT32 NÉLKÜL helyreállít (nincs close_unknown)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const vissza = dbHiba(SIKER_UPDATE, 50);
    try {
      await visszater(trid);
    } finally {
      vissza();
    }
    expect((await sor(trid)).cib_state).toBe('closing');
    // A zárás „elhaltnak" látszik: lejárt bérlet, régi closing.
    await db.query(`UPDATE payment_sessions SET cib_close_sent_at = NOW() - INTERVAL '10 minutes',
                    cib_next_action_at = NOW() - INTERVAL '1 second', cib_lease_owner = NULL, cib_lease_until = NULL
                    WHERE payment_id = $1`, [trid]);
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(s.cib_result).toMatchObject({ rc: '00', forras: '32' });
    expect(bankDb(trid, 32), 'a helyreállítás újraküldte a MSGT32-t').toBe(1);
    expect(riasztasok(trid)).toHaveLength(0);
    expect((await jobSor(job.id)).paid_at).toBeTruthy();
  });

  it('a naplóban nincs bejövő válasz → marad a close_unknown (a helyreállítás nem talál ki eredményt)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    // A kimenő MSGT32-sor megvan (a kérés kiment), csak a válasz nem — 2026-10-03
    // (PR-5) óta a kimenő sor HIÁNYA „nem küldött"-et jelent (cib-pr5-egyeztetes).
    await db.query(`INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, close_attempt)
                    VALUES ($1, 'ki', 32, 'market', 'PID=TST0001&CRYPTO=1&DATA=teszt', 1)`, [trid]);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1,
                    cib_close_sent_at = NOW() - INTERVAL '10 minutes', cib_next_action_at = NOW() - INTERVAL '1 second',
                    cib_lease_owner = NULL, cib_lease_until = NULL WHERE payment_id = $1`, [trid]);
    await kor();
    expect((await sor(trid)).cib_state).toBe('close_unknown');
  });

  it('elutasított eredetű kísérlet, miközben egy MÁSIK TRID zár → azonnal failed, MSGT32 és várakozás nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closing', cib_close_attempts = 1, cib_close_sent_at = NOW(),
                    cib_lease_owner = 'masik:1', cib_lease_until = NOW() + INTERVAL '3 minutes' WHERE payment_id = $1`, [t2]);
    await visszater(t1, 'elutasit');
    expect(bankDb(t1, 32)).toBe(0);
    expect(await sor(t1)).toMatchObject({ cib_state: 'failed', state: 'closed' });
  });
});

// =====================================================================
describe('Idő: minden határidő a DB órájából', () => {
  // 2026-10-01: a zárási ablak már a MSGT10-től számít (cib-pr4-banki-
  // valaszok), az authorized_at az admin-nézet adata — a DB-óra szabálya marad.
  it('az authorized_at a DB órája (egy elcsúszott alkalmazás-óra nem torzítja)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 32, [{ nyers: 'RC=D03', http: 500 }]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 2 * 3600 * 1000));
    try {
      await visszater(trid);
    } finally {
      vi.useRealTimers();
    }
    const { rows } = await db.query(
      `SELECT cib_state, ABS(EXTRACT(EPOCH FROM ((cib_result->>'authorized_at')::timestamptz - NOW()))) AS elteres
         FROM payment_sessions WHERE payment_id = $1`, [trid],
    );
    expect(rows[0].cib_state).toBe('authorized');
    expect(Number(rows[0].elteres), 'az authorized_at az alkalmazás órájából jött').toBeLessThan(300);
  });
});

// =====================================================================
describe('Lekérdezés: „egymás utáni" hibaszámlálók, D04 és határidő', () => {
  it('NT, PR, NT, NT → NEM close_unknown (a köztes érvényes PR nullázza a számlálót)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'NT' }, { rc: 'PR' }, { rc: 'NT' }, { rc: 'NT' }]);
    await visszater(trid, null);
    for (let i = 0; i < 3; i += 1) {
      await esedekes(trid);
      await kor();
    }
    expect(bankDb(trid, 33)).toBe(4);
    const s = await sor(trid);
    expect(s.cib_state, 'szórványos NT-k close_unknown-ba vitték a kísérletet').toBe('redirected');
    expect(s.cib_result.nt_szam).toBe(2);
  });

  it('tartós D04 mellett is lejár a 30 perces helyi határidő → expired', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_redirected_at = NOW() - INTERVAL '31 minutes' WHERE payment_id = $1`, [trid]);
    bank.tridre(trid, 33, [{ nyers: 'RC=D04', http: 500 }]);
    await esedekes(trid);
    await kor();
    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'expired', state: 'closed' });
    expect(s.cib_result.ok).toBe('helyi_hatarido');
  });

  it('a D04-visszalépés egy érvényes PR után alapra áll (nem duplázódik tovább)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ nyers: 'RC=D04', http: 500 }, { rc: 'PR' }, { nyers: 'RC=D04', http: 500 }]);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await esedekes(trid);
      await kor(); // D04 → 2 perc
      vi.setSystemTime(new Date(Date.now() + 3 * 60 * 1000));
      cf().szivveres();
      await esedekes(trid);
      await kor(); // PR
      vi.setSystemTime(new Date(Date.now() + 60 * 1000));
      cf().szivveres();
      await esedekes(trid);
      await kor(); // D04 újra
      const kov = new Date((await sor(trid)).cib_next_action_at).getTime();
      expect(bankDb(trid, 33)).toBe(3);
      expect(Math.round((kov - Date.now()) / 1000), 'a PR után a visszalépés nem állt alapra').toBeLessThanOrEqual(125);
    } finally {
      vi.useRealTimers();
    }
  });
});

// =====================================================================
describe('Eredmény-oldal: a kör ütemét tartja (nem indít köz nélküli munkát)', () => {
  it('closed_ok + függő könyvelés: nem esedékes sorra a lekérdezés nem könyvel; esedékesre igen', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'closed_ok', cib_close_attempts = 1,
                    cib_result = jsonb_build_object('rc', '00', 'forras', '32'),
                    cib_next_action_at = NOW() + INTERVAL '30 seconds' WHERE payment_id = $1`, [trid]);
    const token = encodeURIComponent(cf().eredmenyToken(trid));
    const r = await request(app).get(`/payments/cib/eredmeny?e=${token}`);
    expect(r.status).toBe(200);
    await cf().varjHatterre();
    expect((await sor(trid)).state, 'az eredmény-oldal a 30 s-os köz előtt újrakönyvelt').toBe('pending');
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 second' WHERE payment_id = $1`, [trid]);
    await request(app).get(`/payments/cib/eredmeny?e=${token}`);
    await cf().varjHatterre();
    expect((await sor(trid)).state).toBe('succeeded');
  });
});

// =====================================================================
describe('Két fül: a díj-sor a ténylegesen lezárt kísérletre mutat', () => {
  it('az ELSŐ kísérlet zár → az escrow barion_payment_id-je az első TRID (nem az utoljára indított)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const t1 = await bankOldalon(felado, job);
    const t2 = await bankOldalon(felado, job);
    bank.dont(t1, 'fizet');
    bank.dont(t2, 'fizet');
    await cf().feldolgoz(t1, 'visszateres');
    await cf().varjHatterre();
    expect(await sor(t1)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    await cf().feldolgoz(t2, 'visszateres');
    await cf().varjHatterre();
    expect((await sor(t2)).cib_state).toBe('not_closed');
    const { rows } = await db.query('SELECT barion_payment_id FROM escrow_transactions WHERE job_id = $1', [job.id]);
    expect(rows[0].barion_payment_id, 'a díj-sor a vesztes TRID-re mutat').toBe(t1);
  });
});

// =====================================================================
describe('Lekérdező kör: soronkénti bérlet-ellenőrzés a banki hívás előtt', () => {
  it('ha egy sor bérletét közben más vette át, a kör NEM küld rá MSGT33-at', async () => {
    const a = await elfogadottFuvar();
    const b = await elfogadottFuvar();
    const ta = await bankOldalon(a.felado, a.job);
    const tb = await bankOldalon(b.felado, b.job);
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '2 seconds', cib_lease_owner = NULL, cib_lease_until = NULL
                    WHERE payment_id = $1`, [ta]);
    await db.query(`UPDATE payment_sessions SET cib_next_action_at = NOW() - INTERVAL '1 second', cib_lease_owner = NULL, cib_lease_until = NULL
                    WHERE payment_id = $1`, [tb]);
    bank.tridre(ta, 33, [{ rc: 'PR' }]);
    bank.horog(async (u) => {
      if (u.msgt !== 33 || u.trid !== ta) return;
      // Az A sor lassú banki hívása alatt a B sor bérlete „lejárt", és egy
      // másik munkás átvette.
      await db.query(`UPDATE payment_sessions SET cib_lease_owner = 'masik:1', cib_lease_until = NOW() + INTERVAL '3 minutes'
                      WHERE payment_id = $1`, [tb]);
    });
    await kor();
    expect(bankDb(ta, 33)).toBe(1);
    expect(bankDb(tb, 33), 'elavult bérlettel ment MSGT33').toBe(0);
    expect((await sor(tb)).cib_lease_owner).toBe('masik:1');
  });
});

// =====================================================================
describe('Admin: rendezés és újraellenőrzés', () => {
  it('„lezarva" csak akkor, ha a zárás (MSGT32) ténylegesen kiment; MSGT32 nélküli kétesre 409', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 0,
                    cib_result = jsonb_build_object('ok', 'nt_ismetlodo') WHERE payment_id = $1`, [trid]);
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: 'AB1234' });
    expect(r.status, 'MSGT32 nélkül (a bank biztosan reverzált) lezárhatónak jelöltük').toBe(409);
    expect(r.body.code).toBe('CIB_CLOSE_NOT_SENT');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    const nem = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nincs terhelés.' });
    expect(nem.status).toBe(200);
  });

  it('a rendezés és az újraellenőrzés az admin-naplóba kerül, a fuvarhoz kötve', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const ujra = await request(app).post(`/payments/admin/cib/${trid}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(ujra.status).toBe(200);
    await cf().varjHatterre();
    await db.query(`UPDATE payment_sessions SET cib_state = 'close_unknown', cib_close_attempts = 1,
                    cib_lease_owner = NULL, cib_lease_until = NULL WHERE payment_id = $1`, [trid]);
    const r = await request(app).post(`/payments/admin/cib/${trid}/rendezes`).set(...auth(admin))
      .send({ eredmeny: 'nem_lezarva', indoklas: 'A bank szerint nincs terhelés.' });
    expect(r.status).toBe(200);
    await new Promise((res) => { setTimeout(res, 100); });
    const { rows } = await db.query(
      `SELECT action FROM admin_access_log WHERE admin_id = $1 AND target_id = $2 ORDER BY created_at`,
      [admin.id, job.id],
    );
    const muveletek = rows.map((x) => x.action);
    expect(muveletek, 'a pénzügyi hatású admin-döntés nem kötődik a fuvarhoz a naplóban')
      .toEqual(expect.arrayContaining(['cib_ujraellenorzes', 'cib_rendezes:nem_lezarva']));
  });
});

// =====================================================================
describe('Publikus visszatérés: a szemétforgalom nem tölti a naplót és a Sentryt', () => {
  it('azonosíthatatlan MSGT21: rövid napló-részlet, a Sentry-jelzés percenként legfeljebb egy', async () => {
    const sentry = require('@sentry/node');
    const eredetiCapture = sentry.captureMessage;
    const jelzesek = [];
    sentry.captureMessage = (m) => { jelzesek.push(m); };
    const vissza = beallitEnv({ SENTRY_DSN: 'https://kulcs@teszt.invalid/1' });
    try {
      const szemet = `PID=TST0001&CRYPTO=1&DATA=${'A'.repeat(3000)}`;
      const elotte = (await db.query('SELECT COALESCE(MAX(id), 0) AS m FROM cib_messages')).rows[0].m;
      for (let i = 0; i < 3; i += 1) {
        const r = await request(app).get(`/payments/cib/vissza?${szemet}`).redirects(0);
        expect(r.status).toBe(303);
      }
      const { rows } = await db.query('SELECT char_length(raw) AS h FROM cib_messages WHERE id > $1 AND direction = $2',
        [elotte, 'bongeszo_be']);
      expect(rows).toHaveLength(3);
      for (const x of rows) expect(Number(x.h), 'a hitelesítés nélküli végpont 4000 karaktert írt a naplóba').toBeLessThanOrEqual(300);
      expect(jelzesek.filter((m) => /visszatérés/.test(m)), 'minden szemét-kérés Sentry-jelzést küldött').toHaveLength(1);
    } finally {
      vissza();
      sentry.captureMessage = eredetiCapture;
    }
  });
});

// =====================================================================
describe('Teszt-üzem: a kézi nyugtázás nem írhat egy CIB-TRID-re', () => {
  it('az allowlistről lekerült feladó kézi nyugtázása a manual-<fuvar> azonosítóra könyvel, a sikertelen CIB-kísérlet érintetlen', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
    const listan = beallitEnv({ CIB_TESZT_FELHASZNALOK: felado.id });
    let trid;
    try {
      bank.forgatokonyv(10, [{ rc: '01' }]);
      const p = await fizet(felado, job);
      expect(p.status).toBe(502);
      const { rows } = await db.query('SELECT payment_id FROM payment_sessions WHERE job_id = $1 AND cib_state IS NOT NULL', [job.id]);
      trid = rows[0].payment_id;
      await cf().varjHatterre();
    } finally {
      listan();
    }
    const masik = await createUser();
    const lekerult = beallitEnv({ CIB_TESZT_FELHASZNALOK: masik.id });
    try {
      const k = await request(app).post(`/jobs/${job.id}/confirm-payment`).set(...auth(felado)).send({});
      expect(k.status, JSON.stringify(k.body)).toBe(200);
    } finally {
      lekerult();
    }
    const s = await sor(trid);
    expect(s.state, 'a kézi (teszt-üzemi) nyugtázás egy banki TRID-et tett „sikeressé"').not.toBe('succeeded');
    const { rows: ev } = await db.query(`SELECT payment_id FROM payment_events WHERE status = 'Succeeded' AND event_type = 'manual'
                                          AND (payment_id = $1 OR payment_id = $2)`, [trid, `manual-${job.id}`]);
    expect(ev.map((e) => e.payment_id)).toEqual([`manual-${job.id}`]);
  });
});

// =====================================================================
describe('Konfig és üzemeltetés', () => {
  it('nem forintos terminál PID-je (4. karakter ≠ 0) → hibás konfig, mert minden üzenet CUR=HUF', () => {
    const p = require('../src/services/cibProtokoll');
    const eur = ujKulcs('TST1001');
    const b = p.cibBeallitasok(bank.env({ CIB_PID: eur.pid, CIB_KEY_B64: eur.b64 }));
    expect(b.allapot).toBe('hibas');
    expect(b.okok).toContain('pid_nem_huf');
    expect(p.cibKonfig(bank.env())).toBe('teljes');
  });

  it('Railway-en futó teljes CIB-konfig rövid leürítési idővel → hangos boot-figyelmeztetés; 60 s-mal csendes', () => {
    const p = require('../src/services/cibProtokoll');
    const futtat = (env) => {
      const sorok = [];
      const fel = (...a) => sorok.push(a.map(String).join(' '));
      const sentry = { captureMessage: vi.fn() };
      p.naplozCibKonfigot({ env, konzol: { log: fel, warn: fel, error: fel }, sentry });
      return { osszes: sorok.join('\n'), sentry };
    };
    const rovid = futtat(bank.env({ RAILWAY_ENVIRONMENT: 'production' }));
    expect(rovid.osszes).toMatch(/RAILWAY_DEPLOYMENT_DRAINING_SECONDS/);
    expect(rovid.sentry.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/DRAINING/), expect.any(String));
    const eleg = futtat(bank.env({ RAILWAY_ENVIRONMENT: 'production', RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '60' }));
    expect(eleg.osszes).not.toMatch(/RAILWAY_DEPLOYMENT_DRAINING_SECONDS/);
    const helyi = futtat(bank.env());
    expect(helyi.osszes, 'Railway nélkül (helyben) nincs mit ellenőrizni').not.toMatch(/DRAINING/);
  });

  it('a hop-token az URL útvonalában sem juthat a Sentrybe', () => {
    const { scrubUrlLike } = require('../src/utils/sentryScrub');
    const token = 'A'.repeat(43);
    const ki = scrubUrlLike(`https://api.gofuvar.hu/payments/cib/tovabb/${token}`);
    expect(ki).not.toContain(token);
    expect(ki).toMatch(/\/payments\/cib\/tovabb\//);
  });
});
