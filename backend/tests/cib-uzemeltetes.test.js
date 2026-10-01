// =====================================================================
//  CIB EKI — ÜZEMELTETÉS (2026-09-29, CIB PR-2/C)
//
//  A pénz-út helyességét a cib-eki-fizetes / cib-lekerdezo / cib-fagyasztas
//  fájlok őrzik. Ez a fájl azt, ami ÜZEM közben dől el — amikor a Railway
//  újraindít, a Neon hibázik, vagy a kör elakad:
//
//   * SZÍVVERÉS: a /pay csak akkor engedélyeztet pénzt, ha van, ami lezárja.
//     A szívverés ezért csak SIKERES kiválasztás után frissül — egy minden
//     tickben DB-hibán elhasaló kör (pl. a 096-os migráció még nem futott
//     le) nem „él". A figyelő 3 perc csend után riaszt (Sentry + levél,
//     30 percenként legfeljebb egyszer), akkor is, ha a kör egyszer sem
//     futott le az indulás óta.
//   * RÁTAVÉDELEM: tickenként legfeljebb CIB_KOR_MAX_KERES MSGT33; a maradék
//     esedékes marad.
//   * LEÁLLÁS: a SIGTERM a futó CIB-MUNKÁT várja meg (a MSGT32 eredményének
//     rögzítéséig és a könyvelésig), nem csak a HTTP-hívást — különben a
//     bank lezárja a tranzakciót, a mi sorunk viszont `closing`-ban marad,
//     és egy hamis `close_unknown` embert riaszt. Leállás közben új MSGT10
//     sem indul (az RC=02 utáni újrapróba sem).
//   * ÉRTESÍTÉS-HELYREÁLLÍTÁS (a PR-1 folytatása): ha a folyamat a könyvelés
//     és az értesítési claim között halt el, a díj-visszaigazoló levél (a
//     45/2014. 18. § szerinti tartós visszaigazolás, a banki adatsorral)
//     5 perc múlva a körből kimegy — pontosan egyszer.
//   * ADMIN: a fizetési napló TrID-re (payment_id) szűrhető, és a munkamenet
//     szolgáltatóját / CIB-állapotát is mutatja; nem-admin próbálkozás nem
//     kerül az admin-naplóba.
//   * DOKUMENTÁCIÓ: minden a kódban olvasott CIB_* változó a .env.example-
//     ben — értékek nélkül.
//   * ÜTEMEZÉS: a kör csak teljes CIB-konfignál indul, a beállított tickkel;
//     a szívverés-figyelő mellette fut.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';
import request from 'supertest';
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const LEVELEK = [];
const emailSzolg = require('../src/services/email');
const EREDETI_LEVEL = { sendCibRiasztasEmail: emailSzolg.sendCibRiasztasEmail };
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail', 'sendCibRiasztasEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const { app, db, createUser, createJob } = require('./helpers');
const { inditHamisBank, beallitEnv } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const cf = () => require('../src/services/cibFizetes');
const lk = () => require('../src/services/cibLekerdezo');
const kor = () => lk().runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];
const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });

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
  try {
    cf().__resetCibAllapotForTests();
    cf().szivveres();
  } catch { /* piros-próba */ }
  // Tesztenkénti elszigetelés (mint a cib-lekerdezo-ban): a korábbi tesztek
  // függő kísérletei parkolnak, a kör csak az aktuális teszt sorait veszi fel.
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
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
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
/** Teljes, sikeres kártyás fizetés (bank → visszatérés → egy MSGT32 → könyvelés). */
async function sikeresFizetes(felado, job) {
  const trid = await bankOldalon(felado, job);
  bank.dont(trid, 'fizet');
  const v = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid)}`).redirects(0);
  expect(v.status).toBe(303);
  await cf().varjHatterre();
  expect(await sor(trid)).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
  return trid;
}
const msgt10Szam = () => bank.uzenetek.filter((u) => u.msgt === 10 && u.csatorna === 'market').length;

/** A db.query ideiglenes cseréje (a hívások a modul-objektumon át mennek). */
function dbHorog(fn) {
  const eredeti = db.query;
  db.query = async (...args) => fn(eredeti, ...args);
  return () => { db.query = eredeti; };
}

// =====================================================================
describe('Szívverés: csak a ténylegesen működő kör számít élőnek', () => {
  it('ha a kör a kiválasztásnál DB-hibán hasal el, a szívverés NEM frissül → a /pay 503, MSGT10 nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    cf().__resetCibAllapotForTests(); // a kör még egyszer sem futott le
    const vissza = dbHorog(async (eredeti, sql, ...rest) => {
      if (typeof sql === 'string' && sql.includes('SKIP LOCKED') && sql.includes('cib_lease_owner')) {
        throw Object.assign(new Error('column "cib_next_action_at" does not exist'), { code: '42703' });
      }
      return eredeti.call(db, sql, ...rest);
    });
    try {
      await expect(kor()).rejects.toThrow();
    } finally {
      vissza();
    }
    expect(
      cf().szivveresFriss(),
      'EGY ELHASALT KÖR „ÉLŐNEK" SZÁMÍT: a /pay új pénzt engedélyeztetne, miközben\n'
      + 'semmi nem tudja lezárni (a 10–15 perces banki ablak után a bank reverzál,\n'
      + 'a feladó „fizetett", a kontakt mégsem jelenik meg).',
    ).toBe(false);
    const elotte = msgt10Szam();
    const r = await fizet(felado, job);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('PAYMENT_TEMPORARILY_UNAVAILABLE');
    expect(msgt10Szam()).toBe(elotte);

    // Egy sikeres tick után a fizetés újra indulhat.
    await kor();
    expect(cf().szivveresFriss()).toBe(true);
    expect((await fizet(felado, job)).status).toBe(200);
  });

  it('a figyelő 3 perc csend után riaszt (Sentry + levél), 30 percenként legfeljebb egyszer; friss szívverésnél csendes', async () => {
    const most = Date.now();
    lk().__korAllapotForTests({ indulas: most, utolsoSzivRiasztas: 0 });
    cf().szivveres();
    const t0 = cf().utolsoSzivveres();
    const riasztasok = () => LEVELEK.filter((l) => l.nev === 'sendCibRiasztasEmail' && l.ok === 'szivveres');

    expect(lk().szivveresFigyelo(t0 + 60_000), 'friss szívverésre riasztott').toBe(false);
    expect(lk().szivveresFigyelo(t0 + 4 * 60_000), '4 perc csend után sem riasztott').toBe(true);
    expect(riasztasok()).toHaveLength(1);
    expect(riasztasok()[0].trid ?? null, 'a rendszer-riasztás nem egy TrID-hez tartozik').toBeNull();
    expect(lk().szivveresFigyelo(t0 + 6 * 60_000), '30 percen belül ismételt riasztás (levél-áradat)').toBe(false);
    expect(lk().szivveresFigyelo(t0 + 40 * 60_000)).toBe(true);
    expect(riasztasok()).toHaveLength(2);
  });

  it('a figyelő akkor is riaszt, ha a kör az indulás óta EGYSZER SEM futott le sikeresen; CIB nélkül és leállás közben csendes', async () => {
    const indulas = Date.now();
    cf().__resetCibAllapotForTests();
    lk().__korAllapotForTests({ indulas, utolsoSzivRiasztas: 0 });
    expect(lk().szivveresFigyelo(indulas + 2 * 60_000)).toBe(false);
    expect(
      lk().szivveresFigyelo(indulas + 4 * 60_000),
      'a SOHA el nem induló kör (pl. hiányzó migráció) némán 503-at adna minden fizetésre',
    ).toBe(true);

    lk().__korAllapotForTests({ indulas, utolsoSzivRiasztas: 0 });
    const vissza = beallitEnv({ PAYMENT_PROVIDER: 'qvik' });
    try {
      expect(lk().szivveresFigyelo(indulas + 10 * 60_000), 'CIB-konfig nélkül riasztott').toBe(false);
    } finally {
      vissza();
    }
    await cf().leallitas({ varakozasMs: 0 });
    expect(lk().szivveresFigyelo(indulas + 10 * 60_000), 'leállás közben riasztott').toBe(false);
  });

  it('a rendszer-riasztás levele nem egy fuvar kézi egyeztetéséről szól (nincs „fagyasztva", „ANUM")', async () => {
    const kimeno = [];
    const eredetiKulcs = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_teszt_kulcs_nem_eles';
    const kem = vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      kimeno.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 're_1' }), text: async () => '' };
    });
    try {
      await EREDETI_LEVEL.sendCibRiasztasEmail({ to: 'info@gofuvar.hu', trid: null, jobId: null, ok: 'szivveres' });
      await EREDETI_LEVEL.sendCibRiasztasEmail({ to: 'info@gofuvar.hu', trid: null, jobId: null, ok: 'megszakito' });
      await EREDETI_LEVEL.sendCibRiasztasEmail({ to: 'info@gofuvar.hu', trid: '1234567812345678', jobId: 'j', ok: 'zaras_d05' });
    } finally {
      kem.mockRestore();
      process.env.RESEND_API_KEY = eredetiKulcs ?? '';
    }
    expect(kimeno).toHaveLength(3);
    const [sziv, megsz, egyeztetes] = kimeno;
    for (const l of [sziv, megsz]) {
      expect(l.html, 'a rendszer-riasztás egy nem létező fuvar „fagyasztásáról" ír').not.toMatch(/fagyasztva|ANUM|lezárva" \(ANUM/);
      expect(l.subject).not.toMatch(/kézi egyeztetést igényel/);
    }
    expect(sziv.html).toMatch(/lekérdező kör/);
    expect(megsz.html).toMatch(/megszakító/i);
    expect(egyeztetes.subject).toMatch(/kézi egyeztetést igényel/);
    expect(egyeztetes.html).toMatch(/fagyasztva/);
  });
});

// =====================================================================
describe('Rátavédelem: tickenként legfeljebb CIB_KOR_MAX_KERES MSGT33', () => {
  it('3 esedékes kísérletből 2-es korlátnál 2 lekérdezés; a harmadik esedékes marad, és a következő tick viszi', async () => {
    const vissza = beallitEnv({ CIB_KOR_MAX_KERES: '2' });
    try {
      const tridek = [];
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { felado, job } = await elfogadottFuvar();
        // eslint-disable-next-line no-await-in-loop
        tridek.push(await bankOldalon(felado, job));
      }
      for (const t of tridek) {
        // eslint-disable-next-line no-await-in-loop
        await esedekes(t);
      }
      await kor();
      const szamok = () => tridek.map((t) => bank.szamol(t, 33));
      expect(szamok().reduce((a, b) => a + b, 0), 'a tick túllépte a banki kérés-korlátot (D04-kockázat)').toBe(2);
      const kimaradt = tridek[szamok().indexOf(0)];
      const s = await sor(kimaradt);
      expect(s.cib_lease_owner, 'a kimaradt sor bérlete bent ragadt').toBeNull();
      expect(new Date(s.cib_next_action_at).getTime(), 'a kimaradt sor nem maradt esedékes').toBeLessThanOrEqual(Date.now());
      await kor();
      expect(szamok()).toEqual([1, 1, 1]);
    } finally {
      vissza();
    }
  });
});

// =====================================================================
describe('Szabályos leállás: a futó CIB-munkát várja meg, nem csak a HTTP-hívást', () => {
  it('SIGTERM a MSGT32 alatt: a leállás a banki eredmény RÖGZÍTÉSÉT és a könyvelést is megvárja (nincs hamis close_unknown)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    await esedekes(trid);
    let leallas = null;
    bank.horog(async (u) => {
      if (u.msgt === 32 && u.trid === trid && !leallas) leallas = cf().leallitas({ varakozasMs: 5000 });
    });
    // A banki válasz UTÁNI DB-írás lassú (Neon): a closed_ok rögzítése 300 ms.
    const vissza = dbHorog(async (eredeti, sql, ...rest) => {
      if (typeof sql === 'string' && sql.includes("SET cib_state = 'closed_ok'")) await varj(300);
      return eredeti.call(db, sql, ...rest);
    });
    let korFutas;
    try {
      korFutas = kor();
      for (let i = 0; i < 200 && !leallas; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await varj(10);
      }
      expect(leallas, 'a MSGT32 el sem indult').toBeTruthy();
      await leallas;
      const s = await sor(trid);
      expect(
        s.cib_state,
        'A LEÁLLÁS A BANKI VÁLASZ RÖGZÍTÉSE ELŐTT ENGEDETT: élesben itt jön a pool.end(),\n'
        + 'a bank lezárta a tranzakciót, a sor viszont `closing`-ban marad → a következő\n'
        + 'példány `close_unknown`-ra teszi, a feladó „ellenőrzés alatt"-ot lát, admin kell.',
      ).toBe('closed_ok');
      expect(s.state, 'a könyvelés a leállás után futott volna (pool.end után)').toBe('succeeded');
    } finally {
      vissza();
      await korFutas;
    }
  });

  it('leállás közben nem indul új MSGT10 — az RC=02 utáni újrapróba sem', async () => {
    const { felado, job } = await elfogadottFuvar();
    bank.forgatokonyv(10, [{ rc: '02', kesleltetesMs: 150 }]);
    let leallas = null;
    bank.horog(async (u) => {
      if (u.msgt === 10 && !leallas) leallas = cf().leallitas({ varakozasMs: 5000 });
    });
    const elotte = msgt10Szam();
    const r = await fizet(felado, job);
    await leallas;
    expect(msgt10Szam() - elotte, 'a leállás után egy újabb engedélyeztetés indult').toBe(1);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('PAYMENT_TEMPORARILY_UNAVAILABLE');
    const { rows } = await db.query('SELECT cib_state, state FROM payment_sessions WHERE job_id = $1', [job.id]);
    expect(rows).toEqual([{ cib_state: 'init_failed', state: 'closed' }]);
  });

  it('a leállási időkeret: futó CIB-munka mellett a zárási keret + 10 s, egyébként 10 s', async () => {
    expect(cf().leallasiKeretMs()).toBe(10_000);
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.tridre(trid, 33, [{ rc: 'PR', kesleltetesMs: 300 }]);
    const futas = cf().feldolgoz(trid, 'teszt');
    await varj(60);
    expect(cf().leallasiKeretMs(), 'futó banki munka mellett is 10 s-ra vágná el a leállás').toBe(1500 + 10_000);
    await futas;
    expect(cf().leallasiKeretMs()).toBe(10_000);
  });
});

// =====================================================================
describe('Értesítés-helyreállítás: a könyvelés és a claim közti összeomlás után', () => {
  it('5 perc után a díj-visszaigazolás (banki adatsorral) és a szállítói levél kimegy — pontosan egyszer; frisset és a bevezetés előttit nem érinti', async () => {
    const { runDijErtesitesHelyreallitas } = require('../src/services/feeNotifications');
    const { felado, szallito, job } = await elfogadottFuvar();
    const trid = await sikeresFizetes(felado, job);
    LEVELEK.length = 0;
    // Összeomlás a könyvelés COMMIT-ja és az értesítési claim között:
    // a bizonylat megvan, az értesítés nem ment ki.
    const allit = (kif) => db.query(
      `UPDATE fee_payment_receipts SET notifications_sent_at = NULL, paid_at = ${kif} WHERE payment_id = $1`, [trid],
    );
    const sajat = () => LEVELEK.filter((l) => l.to === felado.email || l.to === szallito.email);
    // A levelek a háttérben (setImmediate) mennek: a DB-claim a döntő bizonyíték,
    // a levél-listát csak a háttérfeladatok lefutása után nézzük.
    const claimelve = async () => (await db.query(
      'SELECT notifications_sent_at FROM fee_payment_receipts WHERE payment_id = $1', [trid],
    )).rows[0].notifications_sent_at !== null;

    await allit("'2025-12-01'::timestamptz");
    await runDijErtesitesHelyreallitas({ since: '2026-01-01' });
    await cf().varjHatterre();
    expect(await claimelve(), 'a bevezetés-dátum előtti bizonylatra is küldött (D4-szabály)').toBe(false);
    expect(sajat()).toHaveLength(0);

    await allit("NOW() - INTERVAL '2 minutes'");
    await runDijErtesitesHelyreallitas({ since: '2026-01-01' });
    await cf().varjHatterre();
    expect(await claimelve(), 'a még futó könyvelés elől elvette az értesítést (5 perc előtt)').toBe(false);
    expect(sajat()).toHaveLength(0);

    await allit("NOW() - INTERVAL '6 minutes'");
    const e1 = await runDijErtesitesHelyreallitas({ since: '2026-01-01' });
    await cf().varjHatterre();
    expect(e1.kuldve).toBeGreaterThanOrEqual(1);
    const visszaig = LEVELEK.filter((l) => l.nev === 'sendFeeConfirmationEmail' && l.to === felado.email);
    expect(visszaig, 'az elveszett díj-visszaigazolás (45/2014. 18. §) nem ment ki').toHaveLength(1);
    expect(visszaig[0].bankiAdatok, 'a helyreállított levélből hiányzik a kötelező banki adatsor').toMatchObject({ trid, rc: '00', amo: 500, cur: 'HUF' });
    expect(LEVELEK.filter((l) => l.nev === 'sendJobPaidEmail' && l.to === szallito.email)).toHaveLength(1);

    await runDijErtesitesHelyreallitas({ since: '2026-01-01' });
    await cf().varjHatterre();
    expect(sajat(), 'a helyreállítás MÁSODSZOR is kiküldte').toHaveLength(2);
  });

  it('érvénytelen bevezetés-dátummal nem fut (a D4-szabály nem kerülhető meg)', async () => {
    const { runDijErtesitesHelyreallitas } = require('../src/services/feeNotifications');
    await expect(runDijErtesitesHelyreallitas({})).rejects.toThrow();
    await expect(runDijErtesitesHelyreallitas({ since: "2026-01-01' OR 1=1" })).rejects.toThrow();
  });

  it('a lekérdező kör hívja — a CIB-bevezetés dátumával, 5 percenként legfeljebb egyszer, leállás közben nem', async () => {
    const fn = require('../src/services/feeNotifications');
    const eredeti = fn.runDijErtesitesHelyreallitas;
    const hivasok = [];
    fn.runDijErtesitesHelyreallitas = async (o) => { hivasok.push(o); return { talalt: 0, kuldve: 0 }; };
    try {
      lk().__korAllapotForTests({ kovHelyreallitas: 0 });
      await kor();
      expect(hivasok, 'a kör nem futtatja a helyreállítást').toHaveLength(1);
      expect(hivasok[0].since).toBe('2026-01-01');
      await kor();
      expect(hivasok, 'minden tickben (30 s) lekérdez — 5 percenként elég').toHaveLength(1);
      // A helyreállítás hibája nem állíthatja meg a kört (a zárások a fontosabbak).
      fn.runDijErtesitesHelyreallitas = async (o) => { hivasok.push(o); throw new Error('DB-hiba a helyreállításban'); };
      lk().__korAllapotForTests({ kovHelyreallitas: 0 });
      await expect(kor(), 'a helyreállítás hibája elszállt a körből').resolves.toBeTypeOf('number');
      expect(hivasok).toHaveLength(2);
      lk().__korAllapotForTests({ kovHelyreallitas: 0 });
      await cf().leallitas({ varakozasMs: 0 });
      await kor();
      expect(hivasok, 'leállás közben is dolgozott').toHaveLength(2);
    } finally {
      fn.runDijErtesitesHelyreallitas = eredeti;
    }
  });
});

// =====================================================================
describe('Admin: fizetési napló TrID-szűrővel, munkamenet-adatokkal', () => {
  it('GET /payments/admin/log?payment_id= csak az adott fizetés eseményeit adja, a szolgáltatóval és a CIB-állapottal', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await sikeresFizetes(felado, job);
    // Egy másik (nem CIB) fizetés eseménye is legyen a naplóban.
    const f2 = await createUser();
    await createJob({ shipperId: f2.id, carrierId: (await createUser({ role: 'carrier' })).id, status: 'accepted', paid: true });

    const r = await request(app).get(`/payments/admin/log?payment_id=${trid}`).set(...auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.length, 'a TrID eseményei hiányoznak').toBeGreaterThanOrEqual(1);
    expect(r.body.every((e) => e.payment_id === trid), 'a szűrő figyelmen kívül maradt: az admin más fizetéseket is lát').toBe(true);
    expect(r.body[0]).toMatchObject({ provider: 'cib', cib_state: 'closed_ok', session_state: 'succeeded' });

    const ures = await request(app).get('/payments/admin/log?payment_id=9999000099990000').set(...auth(admin));
    expect(ures.status).toBe(200);
    expect(ures.body).toEqual([]);

    for (const szemet of ['a b', 'x'.repeat(200), "1' OR '1'='1", '%']) {
      // eslint-disable-next-line no-await-in-loop
      const h = await request(app).get(`/payments/admin/log?payment_id=${encodeURIComponent(szemet)}`).set(...auth(admin));
      expect(h.status, `„${szemet.slice(0, 20)}" → ${h.status}`).toBe(400);
      expect(h.body.code).toBe('INVALID_VALUE');
    }
    const tomb = await request(app).get(`/payments/admin/log?payment_id=${trid}&payment_id=x`).set(...auth(admin));
    expect(tomb.status).toBe(400);
    // A tört lapozó-paraméter nem 500 és nem hamis üres lista.
    const tort = await request(app).get('/payments/admin/log?limit=1.5&offset=0.5').set(...auth(admin));
    expect(tort.status).toBe(200);
    expect(tort.body).toHaveLength(1);
  });

  it('a CIB-admin végpontok: nem-admin 403, és a próbálkozás NEM kerül az admin-naplóba; a limit/offset határolt', async () => {
    const nemAdmin = await createUser();
    const admin = await createUser({ role: 'admin' });
    for (const ut of ['/payments/admin/cib', '/payments/admin/cib/1234567812345678', '/payments/admin/log']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get(ut).set(...auth(nemAdmin))).status).toBe(403);
    }
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM admin_access_log WHERE admin_id = $1', [nemAdmin.id]);
    expect(rows[0].n, 'egy nem-admin próbálkozás admin-hozzáférésként naplózódott').toBe(0);

    const nagy = await request(app).get('/payments/admin/cib?limit=99999&offset=-5').set(...auth(admin));
    expect(nagy.status).toBe(200);
    expect(nagy.body.items.length).toBeLessThanOrEqual(200);
    const { rows: n2 } = await db.query(
      "SELECT COUNT(*)::int AS n FROM admin_access_log WHERE admin_id = $1 AND action = 'cib_transactions'", [admin.id],
    );
    expect(n2[0].n, 'az admin CIB-keresése nem naplózódott').toBe(1);
  });
});

// =====================================================================
describe('Dokumentáció: minden CIB_* változó a .env.example-ben', () => {
  it('a kód által olvasott összes CIB-változó dokumentált (érték nélkül), és a lista nem avulhat el', () => {
    const p = require('../src/services/cibProtokoll');
    expect(Array.isArray(p.OLVASOTT_ENV), 'a cibProtokoll nem sorolja fel az olvasott változókat').toBe(true);
    const pelda = readFileSync(`${__dirname}/../.env.example`, 'utf8');
    const hianyzo = p.OLVASOTT_ENV.filter((n) => !new RegExp(`\\b${n}\\b`).test(pelda));
    expect(hianyzo, `Nem dokumentált CIB-változó a .env.example-ben:\n  ${hianyzo.join('\n  ')}`).toEqual([]);
    // Értéket soha: a CIB_* sorok vagy kommentek, vagy üres értékűek.
    const ertekes = pelda.split('\n').filter((s) => /^\s*CIB_[A-Z0-9_]+=\S/.test(s));
    expect(ertekes, 'CIB-érték került a .env.example-be').toEqual([]);

    // A lista nem avulhat el: minden `env.CIB_X` olvasás a src-ben szerepel benne.
    const olvasott = new Set();
    const bejar = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const ut = `${dir}/${f.name}`;
        if (f.isDirectory()) bejar(ut);
        else if (f.name.endsWith('.js')) {
          // A kommentek nem olvasások (egy példa-szöveg ne kerüljön a listára).
          const forras = readFileSync(ut, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
          for (const m of forras.matchAll(/env\.(CIB_[A-Z0-9_]+)/g)) olvasott.add(m[1]);
        }
      }
    };
    bejar(`${__dirname}/../src`);
    expect(olvasott.size).toBeGreaterThan(5);
    const listanKivul = [...olvasott].filter((n) => !p.OLVASOTT_ENV.includes(n));
    expect(listanKivul, 'a kód olyan CIB-változót olvas, ami nincs az OLVASOTT_ENV-ben').toEqual([]);
  });
});

// =====================================================================
//  ⚠️ A FÁJL VÉGÉN: az index.js újratöltése új appot és realtime-szervert
//  épít — a fenti tesztek már lefutottak.
// =====================================================================
describe('Ütemezés (index.js)', () => {
  function bootIdozitesek() {
    const eredetiInterval = global.setInterval;
    const eredetiTimeout = global.setTimeout;
    const idozitesek = [];
    global.setInterval = (fn, ms) => { idozitesek.push({ fn, ms }); return { unref() { return this; } }; };
    global.setTimeout = () => ({ unref() { return this; } });
    try {
      delete require.cache[require.resolve('../src/index')];
      require('../src/index');
    } finally {
      global.setInterval = eredetiInterval;
      global.setTimeout = eredetiTimeout;
    }
    return idozitesek;
  }
  function kemkedo() {
    const m = lk();
    const felvetel = require('../src/services/pickupNotifications');
    const eredeti = { runCibKor: m.runCibKor, szivveresFigyelo: m.szivveresFigyelo };
    const eredetiFelvetel = felvetel.runPickupNotifications;
    const hivas = { kor: 0, figyelo: 0 };
    m.runCibKor = async () => { hivas.kor += 1; return 0; };
    m.szivveresFigyelo = () => { hivas.figyelo += 1; return false; };
    // A percenkénti felvételi-értesítő kör is 60 s-os: a tesztben ne fusson.
    felvetel.runPickupNotifications = async () => 0;
    return {
      hivas,
      vissza: () => {
        Object.assign(m, eredeti);
        felvetel.runPickupNotifications = eredetiFelvetel;
      },
    };
  }
  /** Csak a CIB-hez köthető periódusú (tick, percenkénti figyelő) callbackek. */
  async function futtatCibIdozitok(idozitesek) {
    for (const i of idozitesek.filter((x) => x.ms === 17000 || x.ms === 60_000)) {
      // eslint-disable-next-line no-await-in-loop
      try { await i.fn(); } catch { /* más körök */ }
    }
  }

  it('teljes CIB-konfignál a kör CIB_KOR_TICK_MS periódussal fut, mellette a szívverés-figyelő', async () => {
    const vissza = beallitEnv({ CIB_KOR_TICK_MS: '17000' });
    const k = kemkedo();
    try {
      const idozitesek = bootIdozitesek();
      const tick = idozitesek.filter((i) => i.ms === 17000);
      expect(tick, 'a kör nem a beállított tickkel ütemezett').toHaveLength(1);
      await tick[0].fn();
      expect(k.hivas.kor, 'a tick callbackje nem a lekérdező kört futtatja').toBe(1);
      await futtatCibIdozitok(idozitesek.filter((x) => x.ms === 60_000));
      expect(k.hivas.figyelo, 'nincs szívverés-figyelő: egy elakadt kör mellett a fizetés némán 503').toBeGreaterThanOrEqual(1);
    } finally {
      k.vissza();
      vissza();
    }
  });

  it('CIB-konfig nélkül (ma a Railway-en) a kör el sem indul', async () => {
    const { KOTELEZO_ENV, cibKonfig } = require('../src/services/cibProtokoll');
    const vissza = beallitEnv({
      ...Object.fromEntries(KOTELEZO_ENV.map((n) => [n, undefined])),
      CIB_KOR_TICK_MS: '17000',
    });
    const k = kemkedo();
    try {
      expect(cibKonfig(), 'a teszt nem a „nincs" konfigot állította elő').toBe('nincs');
      const idozitesek = bootIdozitesek();
      expect(idozitesek.length, 'egyetlen időzítő sem — az őr vak').toBeGreaterThan(3);
      expect(idozitesek.filter((i) => i.ms === 17000), 'CIB-konfig nélkül is ütemezte a CIB-kört').toHaveLength(0);
      await futtatCibIdozitok(idozitesek);
      expect(k.hivas.kor + k.hivas.figyelo, 'CIB-konfig nélkül is fut a CIB-kör vagy a figyelője').toBe(0);
    } finally {
      k.vissza();
      vissza();
    }
  });
});
