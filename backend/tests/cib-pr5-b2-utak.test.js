// =====================================================================
//  CIB PR-5/B — PUBLIKUS VÉGPONTOK, ADMIN, SZÖVEGEK (2026-10-03)
//
//  Amit ez a fájl őriz (mindegyik a javítás nélkül piros):
//   * jövőbeli CIB_BEVEZETES: a /pay 503, a kör nem fut és nem „él";
//   * a publikus visszatérés (/vissza) azonosíthatatlan kérése NEM ír tartós
//     DB-sort (csak memória-számláló + ritkított napló); az azonosítható
//     visszatérés kanonikus alakban, TrID-enként egyszer kerül a naplóba;
//   * külön rate-limit vödrök: az eredményoldal lekérdezése nem éheztetheti
//     ki a /vissza-t és a /tovabb-ot; a /vissza túlterhelésnél sem ad nyers
//     JSON-t a böngészőnek (303 egy HTML hibaoldalra);
//   * az admin-szűrő a felület szótárát (CibFizetesekAdmin ALLAPOT_NEV) érti,
//     és pontosan azt adja, amit a lista pillje mutat (SQL = lekepez);
//   * JÁRAT-foglalás CIB-úton: őszinte, nem „átmeneti" szöveg, és a
//     megerősítés nem szólít fel lehetetlen fizetésre;
//   * a fagyasztási 409 szerep- és állapotfüggő (szállító / admin / kétes);
//   * az admin „Újraellenőrzés" megmondja, mi történik (és nem hazudik
//     „ütemezve"-t felülvizsgálandó vagy végállapotú tételre);
//   * a visszatérített könyvelési árva nem foglalja örökre a fuvar egyetlen
//     zárási helyét (részleges UNIQUE index);
//   * a banki összeg-eltérés miatt le nem zárt kísérlet értesítése nem
//     állítja, hogy „a fuvar közben megváltozott".
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

const LEVELEK = [];
const emailSzolg = require('../src/services/email');
// A valódi sablon (a sablon-teszthez), a csere ELŐTT eltéve.
const EREDETI_FOGLALAS_LEVEL = emailSzolg.sendBookingConfirmedEmail;
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail', 'sendCibRiasztasEmail',
  'sendBookingConfirmedEmail', 'sendCancellationEmail', 'sendPaymentDueEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { inditHamisBank, beallitEnv } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const notifications = require('../src/services/notifications');

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
const fizet = (f, job) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send(HOZZAJARULASSAL);
const hopToken = (v) => /\/tovabb\/([A-Za-z0-9_-]+)$/.exec(v.body.redirect_url || '')[1];
async function bankOldalon(felado, job) {
  const r = await fizet(felado, job);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await request(app).get(`/payments/cib/tovabb/${hopToken(r)}`).redirects(0)).status).toBe(302);
  return r.body.trid;
}
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
}
const napMulva = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let tridSzamlalo = 0;
function ujTrid() {
  tridSzamlalo += 1;
  return `7${String(Date.now()).slice(-9)}${String(tridSzamlalo).padStart(6, '0')}`;
}
/** Egy CIB-kísérlet SQL-lel, a megadott (fő- és CIB-) állapotban. */
async function cibSor(job, felado, {
  state = 'pending', cibState, eredmeny = {}, closedReason = null,
}) {
  const trid = ujTrid();
  await db.query(
    `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, provider, state, cib_state,
                                   cib_close_attempts, cib_next_action_at, cib_result, closed_reason)
     VALUES ($1, $2, $3, $4, 500, 'cib', $5, $6, $7, NOW() + INTERVAL '1 day', $8::jsonb, $9)`,
    [trid, job.id, felado.id, job.carrier_id, state, cibState,
      ['closing', 'close_unknown', 'closed_ok'].includes(cibState) ? 1 : 0, JSON.stringify(eredmeny), closedReason],
  );
  return trid;
}
async function naploSorok() {
  return Number((await db.query(
    "SELECT COUNT(*)::int AS n FROM cib_messages WHERE direction = 'bongeszo_be'",
  )).rows[0].n);
}

// =====================================================================
describe('Jövőbeli CIB_BEVEZETES: nem néma kikapcsolás', () => {
  it('a /pay 503, a kör nem fut, és a szívverés sem frissül (nincs „élő" kör, ami nem zár)', async () => {
    const { felado, job } = await elfogadottFuvar();
    const vissza = beallitEnv({ CIB_BEVEZETES: napMulva(30) });
    try {
      cf().__resetCibAllapotForTests();
      expect(await kor()).toBe(0);
      expect(cf().utolsoSzivveres(), 'a 0 soros kör „élőnek" jelölte magát').toBe(0);
      const r = await fizet(felado, job);
      expect(r.status).toBe(503);
      expect((await db.query('SELECT COUNT(*)::int AS n FROM payment_sessions WHERE job_id = $1', [job.id])).rows[0].n).toBe(0);
    } finally {
      vissza();
    }
  });
});

// =====================================================================
describe('Publikus visszatérés: az azonosíthatatlan kérés nem ír tartós sort', () => {
  it('szemét, idegen kulcs, ismeretlen TrID: 303 a hibaoldalra, NULLA új naplósor, a számláló nő', async () => {
    const elotte = await naploSorok();
    const szamlaloElotte = cf().szemetVisszateresek();
    const keresek = [
      '/payments/cib/vissza',
      `/payments/cib/vissza?PID=TST0001&CRYPTO=1&DATA=${'A'.repeat(3000)}`,
      '/payments/cib/vissza?nem=ertelmes',
      // Érvényes, a mi kulcsunkkal titkosított MSGT21 — de nem létező TrID-re.
      `/payments/cib/vissza?${bank.msgt21Query('9999888877776666')}`,
    ];
    for (const k of keresek) {
      const r = await request(app).get(k).redirects(0);
      expect(r.status, k).toBe(303);
      expect(r.headers.location).toMatch(/\/fizetes\/eredmeny\?hiba=azonositas$/);
    }
    expect(await naploSorok(), 'hitelesítés nélküli szemét-kérés tartós DB-sort írt').toBe(elotte);
    expect(cf().szemetVisszateresek() - szamlaloElotte).toBe(keresek.length);
  });

  it('a saját, érvényes visszatérés visszajátszása TrID-enként egy naplósort ír, a hozzáfűzött szemét nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    bank.dont(trid, 'fizet');
    const q = bank.msgt21Query(trid);
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).get(`/payments/cib/vissza?${q}&ZZ=${'x'.repeat(2000)}`).redirects(0);
      expect(r.status).toBe(303);
      expect(r.headers.location).toMatch(/\/fizetes\/eredmeny\?e=/);
    }
    await cf().varjHatterre();
    const { rows } = await db.query(
      "SELECT raw FROM cib_messages WHERE payment_id = $1 AND direction = 'bongeszo_be' AND msgt = 21", [trid],
    );
    expect(rows, 'minden visszajátszás új naplósort írt').toHaveLength(1);
    expect(rows[0].raw).not.toMatch(/ZZ=/);
    expect(rows[0].raw).toMatch(/^PID=[^&]+&CRYPTO=1&DATA=/);
  });
});

// =====================================================================
describe('Külön rate-limit vödrök a publikus CIB-végpontokon', () => {
  it('az eredményoldal 3 mp-es lekérdezése nem éhezteti ki a banki visszatérést és az átirányító linket', async () => {
    const { felado, job } = await elfogadottFuvar();
    const r = await fizet(felado, job);
    expect(r.status).toBe(200);
    for (let i = 0; i < 65; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).get('/payments/cib/eredmeny?e=nem-ervenyes');
    }
    const hop = await request(app).get(`/payments/cib/tovabb/${hopToken(r)}`).redirects(0);
    expect(hop.status, 'az átirányító link 429-et kapott az eredmény-lekérdezések miatt').toBe(302);
    bank.dont(r.body.trid, 'fizet');
    const v = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(r.body.trid)}`).redirects(0);
    expect(v.status, 'a bankból visszatérő vásárló 429-et kapott').toBe(303);
    expect(v.headers.location).toMatch(/\/fizetes\/eredmeny\?e=/);
    await cf().varjHatterre();
  });

  it('a /vissza saját korlátja felett sem nyers JSON: 303 a HTML hibaoldalra (a kör úgyis lezár)', async () => {
    let utolso;
    for (let i = 0; i < 125; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      utolso = await request(app).get('/payments/cib/vissza?szemet=1').redirects(0);
    }
    expect(utolso.status).toBe(303);
    expect(utolso.headers['content-type'] || '').not.toMatch(/json/);
    expect(utolso.headers.location).toMatch(/\/fizetes\/eredmeny\?hiba=azonositas$/);
  });

  it('a GLOBÁLIS (300/perc/IP) korlát felett sem nyers JSON a böngésző-navigációs végpontokon: 303 a hibaoldalra', async () => {
    // 2026-10-04 (javítókör): a végpontonkénti vödrök mellett a globális
    // limiter ELŐTTÜK fut — közös NAT mögött az eredményoldal 240/perces
    // kerete a globális keret nagy részét elviheti.
    const IP = '203.0.113.77';
    for (let i = 0; i < 300; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).get('/payments/cib/eredmeny?e=nem-ervenyes').set('X-Forwarded-For', IP);
    }
    const v = await request(app).get('/payments/cib/vissza?szemet=1').set('X-Forwarded-For', IP).redirects(0);
    expect(v.status, 'a bankból visszatérő vásárló nyers 429 JSON-t kapott').toBe(303);
    expect(v.headers['content-type'] || '').not.toMatch(/json/);
    expect(v.headers.location).toMatch(/\/fizetes\/eredmeny\?hiba=/);
    const t = await request(app).get(`/payments/cib/tovabb/${'a'.repeat(43)}`).set('X-Forwarded-For', IP).redirects(0);
    expect(t.status).toBe(303);
    expect(t.headers.location).toMatch(/\/fizetes\/eredmeny\?hiba=/);
    // Minden más végpont a megszokott 429 JSON-t kapja.
    const m = await request(app).get('/payments/cib/eredmeny?e=x').set('X-Forwarded-For', IP);
    expect(m.status).toBe(429);
  });
});

// =====================================================================
describe('Admin-szűrő: a felület szótára, és pontosan az, amit a pill mutat', () => {
  function webAllapotKulcsok() {
    const forras = fs.readFileSync(
      path.join(__dirname, '../../web/src/components/admin/CibFizetesekAdmin.tsx'), 'utf8',
    );
    const blokk = /const ALLAPOT_NEV[^=]*=\s*\{([\s\S]*?)\};/.exec(forras);
    expect(blokk, 'az ALLAPOT_NEV nem található a webes admin-komponensben').toBeTruthy();
    return [...blokk[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]);
  }

  it('a webes ALLAPOT_NEV minden kulcsa 200, és csak a megfelelő pillű tételeket adja', async () => {
    const admin = await createUser({ role: 'admin' });
    const kulcsok = webAllapotKulcsok();
    expect(kulcsok).toEqual(expect.arrayContaining(['feldolgozas', 'sikeres', 'sikertelen', 'nem_terhelt', 'mar_fizetve', 'ellenorzes']));
    const tetelek = {};
    const keszit = async (kulcs, allapotok) => {
      const { felado, job } = await elfogadottFuvar();
      tetelek[kulcs] = await cibSor(job, felado, allapotok);
    };
    await keszit('feldolgozas', { cibState: 'redirected' });
    await keszit('sikeres', { state: 'succeeded', cibState: 'closed_ok' });
    await keszit('sikertelen', { cibState: 'failed', eredmeny: { rc: '51' } });
    await keszit('nem_terhelt', { cibState: 'expired', eredmeny: { ok: 'bank_visszaforditotta' } });
    await keszit('mar_fizetve', { cibState: 'not_closed', eredmeny: { ok: 'mar_fizetve' } });
    await keszit('ellenorzes', { cibState: 'close_unknown' });
    for (const kulcs of kulcsok) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).get(`/payments/admin/cib?allapot=${kulcs}&limit=200`).set(...auth(admin));
      expect(r.status, `${kulcs}: ${JSON.stringify(r.body)}`).toBe(200);
      for (const t of r.body.items) expect(t.allapot, `${kulcs} szűrő más pillű tételt adott`).toBe(kulcs);
      if (tetelek[kulcs]) expect(r.body.items.map((t) => t.trid), kulcs).toContain(tetelek[kulcs]);
    }
    // A nyers (régi) szótár is él az API-hívóknak.
    expect((await request(app).get('/payments/admin/cib?allapot=needs_review').set(...auth(admin))).status).toBe(200);
    expect((await request(app).get('/payments/admin/cib?allapot=closed_ok').set(...auth(admin))).status).toBe(200);
    expect((await request(app).get('/payments/admin/cib?allapot=valami').set(...auth(admin))).status).toBe(400);
  });

  it('az SQL-leképezés minden állapot-kombinációra egyezik a JS lekepez-zel', async () => {
    const STATE = ['pending', 'succeeded', 'closed', 'needs_review'];
    const CIB = ['initializing', 'ready', 'redirected', 'authorized', 'closing', 'closed_ok', 'close_unknown',
      'failed', 'expired', 'not_closed', 'abandoned', 'init_failed'];
    const OK = [null, 'admin_visszaterites', 'admin_nem_lezarva', 'bank_visszaforditotta', 'zarasi_hatarido',
      'zaras_nem_kuldott', 'admin_lejaratas_jovahagyott', 'mar_fizetve', 'kupon', 'amo_elteres', 'valami'];
    const sorok = [];
    for (const state of STATE) for (const cib of CIB) for (const ok of OK) sorok.push({ state, cib_state: cib, ok });
    const ertekek = sorok.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`).join(', ');
    const parameterek = sorok.flatMap((s) => [s.state, s.cib_state, JSON.stringify(s.ok == null ? {} : { ok: s.ok })]);
    const { rows } = await db.query(
      `SELECT ${cf().lekepezSql('v')} AS a FROM (VALUES ${ertekek}) AS v(state, cib_state, cib_result)`,
      parameterek,
    );
    sorok.forEach((s, i) => {
      const js = cf().lekepez({ state: s.state, cib_state: s.cib_state, cib_result: s.ok == null ? {} : { ok: s.ok } });
      expect(rows[i].a, JSON.stringify(s)).toBe(js);
    });
  });
});

// =====================================================================
describe('JÁRAT-foglalás a kártyás (CIB) úton', () => {
  it('a /pay őszinte, nem „átmeneti" szöveget ad, saját kóddal, terhelés nélkül', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed' });
    const r = await request(app).post(`/route-bookings/${booking.id}/pay`).set(...auth(felado)).send({ consent: true });
    expect(r.body.code).toBe('BOOKING_CARD_NOT_AVAILABLE');
    expect(r.status).toBe(409);
    expect(r.body.error).not.toMatch(/átmenetileg|próbáld újra később/i);
    expect(r.body.error).toMatch(/nem történt terhelés/i);
  });

  it('a megerősítés nem szólít fel a (kártyával nem fizethető) díj megfizetésére — in-app és e-mail', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'pending' });
    const r = await request(app).post(`/route-bookings/${booking.id}/confirm`).set(...auth(szallito)).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await new Promise((res) => { setTimeout(res, 50); });
    const { rows } = await db.query(
      "SELECT body FROM notifications WHERE user_id = $1 AND type = 'booking_confirmed'", [felado.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].body).not.toMatch(/Fizesd meg/);
    expect(rows[0].body).toMatch(/kártyával/);
    const level = LEVELEK.find((l) => l.nev === 'sendBookingConfirmedEmail');
    expect(level, 'a megerősítő levél nem ment ki').toBeTruthy();
    expect(level.kartyasFizetesElerheto).toBe(false);
  });

  it('a megerősítő levél kártyával nem fizethető foglalásnál nem kínál „Fizetés most" gombot', async () => {
    const kuldott = [];
    const eredetiFetch = global.fetch;
    const vissza = beallitEnv({ RESEND_API_KEY: 're_teszt_kulcs' });
    global.fetch = async (_url, opciok) => {
      kuldott.push(JSON.parse(opciok.body));
      return new Response(JSON.stringify({ id: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await EREDETI_FOGLALAS_LEVEL({
        to: 'felado@example.com', shipperName: 'Teszt', routeTitle: 'Bp–Szeged', bookingId: 'b1',
        carrierName: 'Szállító', priceHuf: 12000, kartyasFizetesElerheto: false,
      });
      await EREDETI_FOGLALAS_LEVEL({
        to: 'felado@example.com', shipperName: 'Teszt', routeTitle: 'Bp–Szeged', bookingId: 'b1',
        carrierName: 'Szállító', priceHuf: 12000,
      });
    } finally {
      global.fetch = eredetiFetch;
      vissza();
    }
    expect(kuldott).toHaveLength(2);
    expect(kuldott[0].html).not.toMatch(/Fizetés most/);
    expect(kuldott[0].html).toMatch(/kártyával/);
    expect(kuldott[1].html).toMatch(/Fizetés most/);
  });

  it('boot: a bekapcsolt járat-ág + élő CIB hangos hibát ír (a foglalás díja kártyával nem fizethető)', () => {
    const { jaratKartyasEllenorzes } = require('../src/services/feePaymentSession');
    const naplo = [];
    const konzol = { error: (m) => naplo.push(m), warn: () => {}, log: () => {} };
    expect(jaratKartyasEllenorzes({ konzol })).toBe(true);
    expect(naplo.join('\n')).toMatch(/JARAT_ENABLED/);
    const vissza = beallitEnv({ JARAT_ENABLED: 'false' });
    try {
      expect(jaratKartyasEllenorzes({ konzol })).toBe(false);
    } finally {
      vissza();
    }
  });
});

// =====================================================================
describe('A fagyasztási 409 szerep- és állapotfüggő', () => {
  it('lezáruló kísérlet: a szállító és az admin nem „a te fizetésed"-et kapja', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    await cibSor(job, felado, { cibState: 'closing' });
    const lemond = await request(app).post(`/jobs/${job.id}/cancel`).set(...auth(szallito)).send({});
    expect(lemond.status).toBe(409);
    expect(lemond.body.code).toBe('CIB_PAYMENT_FINISHING');
    expect(lemond.body.error).not.toMatch(/fizetésed/);
    expect(lemond.body.error).toMatch(/feladó/);
    const admin = await createUser({ role: 'admin' });
    const a = await request(app).patch(`/admin/jobs/${job.id}`).set(...auth(admin)).send({ status: 'cancelled' });
    expect(a.status).toBe(409);
    expect(a.body.error).not.toMatch(/fizetésed/);
    const f = await request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({});
    expect(f.status).toBe(409);
    expect(f.body.error).toMatch(/fizetésed/);
  });

  it('kétes (close_unknown) kísérlet: CIB_PAYMENT_REVIEW, egyeztetés — nem „próbáld újra egy perc múlva"', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    await cibSor(job, felado, { cibState: 'close_unknown' });
    for (const [nev, keres] of [
      ['feladói lemondás', request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({})],
      ['szállítócsere', request(app).post(`/jobs/${job.id}/reopen`).set(...auth(felado)).send({})],
      ['szállítói lemondás', request(app).post(`/jobs/${job.id}/cancel`).set(...auth(szallito)).send({})],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await keres;
      expect(r.status, nev).toBe(409);
      expect(r.body.code, nev).toBe('CIB_PAYMENT_REVIEW');
      expect(r.body.error, nev).toMatch(/egyeztet/);
      expect(r.body.error, nev).not.toMatch(/egy perc/);
    }
  });
});

// =====================================================================
describe('Admin „Újraellenőrzés": megmondja, mi történik', () => {
  it('függő kísérlet: 200 + üzenet és a következő lépés ideje', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    const r = await request(app).post(`/payments/admin/cib/${trid}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
    expect(typeof r.body.uzenet).toBe('string');
    expect(r.body.uzenet.length).toBeGreaterThan(10);
    expect('kovetkezo_at' in r.body).toBe(true);
    await cf().varjHatterre();
  });

  it('felülvizsgálandó (needs_review) és végállapotú tétel: 409, nem hamis „ütemezve"', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const arva = await cibSor(job, felado, { state: 'needs_review', cibState: 'closed_ok' });
    const r1 = await request(app).post(`/payments/admin/cib/${arva}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('CIB_NO_AUTOMATIC_STEP');
    expect(r1.body.error).toMatch(/visszatérítés|kézi/i);
    const f2 = await elfogadottFuvar();
    const vege = await cibSor(f2.job, f2.felado, { state: 'closed', cibState: 'failed' });
    const r2 = await request(app).post(`/payments/admin/cib/${vege}/ujraellenorzes`).set(...auth(admin)).send({});
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('CIB_NO_AUTOMATIC_STEP');
  });
});

// =====================================================================
describe('A visszatérített könyvelési árva nem foglalja örökre a fuvar zárási helyét', () => {
  it('az admin „visszaterites" után ugyanarra a fuvarra új zárási sor kerülhet; két élő zárás továbbra sem', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const arva = await cibSor(job, felado, { state: 'needs_review', cibState: 'closed_ok', eredmeny: { rc: '00', anum: 'A1B2C3' } });
    const r = await request(app).post(`/payments/admin/cib/${arva}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'visszaterites', indoklas: 'A banknál visszatérítve, ügyszám a levelezésben.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await sor(arva))).toMatchObject({ state: 'closed', cib_state: 'closed_ok' });
    // Az új kísérlet zárási sora (a régi, visszatérített árva mellett).
    const uj = await cibSor(job, felado, { cibState: 'closing' });
    expect((await sor(uj)).cib_state).toBe('closing');
    // Két ÉLŐ zárási sor továbbra sem lehet (I4).
    let kod = null;
    try { await cibSor(job, felado, { cibState: 'closed_ok' }); } catch (err) { kod = err.code; }
    expect(kod).toBe('23505');
  });

  it('a visszatérített árva kimenete kifejezett: ok = admin_visszaterites (nem csupasz „nem terhelt"), és új fizetést nem blokkol', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const arva = await cibSor(job, felado, { state: 'needs_review', cibState: 'closed_ok', eredmeny: { rc: '00', anum: 'A1B2C3' } });
    expect((await request(app).post(`/payments/admin/cib/${arva}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'visszaterites', indoklas: 'A banknál visszatérítve, ügyszám a levelezésben.' })).status).toBe(200);
    const fp = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(fp.status, JSON.stringify(fp.body)).toBe(200);
    // A bank TERHELT, majd visszatérítettünk: a felület ezt csak a kifejezett
    // okból tudja megkülönböztetni a „nem terheltük" kimenettől.
    expect(fp.body.last_result).toMatchObject({ trid: arva, ok: 'admin_visszaterites', rc: '00' });
    expect(fp.body.pay_blocked_reason).toBeNull();
    expect(fp.body.can_pay).toBe(true);
  });
});

// =====================================================================
describe('A banki összeg-eltérés miatt le nem zárt kísérlet értesítése igaz', () => {
  it('nem „a fuvar közben megváltozott", hanem az összeg-eltérés; a fuvar változatlan', async () => {
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(
      `UPDATE payment_sessions SET cib_state = 'authorized', cib_next_action_at = NOW() - INTERVAL '1 second',
              cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"amo":"999","rc":"00"}'::jsonb
        WHERE payment_id = $1`, [trid],
    );
    await kor();
    await cf().varjHatterre();
    const s = await sor(trid);
    expect(s.cib_state).toBe('not_closed');
    const ertesites = INAPP.find((n) => n.user_id === felado.id);
    expect(ertesites, 'nem ment értesítés').toBeTruthy();
    expect(ertesites.body).not.toMatch(/megváltozott/);
    expect(ertesites.body).toMatch(/összeg/);
    const level = LEVELEK.find((l) => l.nev === 'sendFeePaymentFailedEmail');
    expect(level && level.tipus).toBe('osszeg_elteres');
  });
});

// =====================================================================
describe('Admin „lejáratás" egy jóváhagyott, le nem zárt kísérleten: a pill és a levél ugyanazt mondja', () => {
  it('az authorized → expired kísérlet „nem_terhelt" (nem „sikertelen"), a levél „nem_zart"', async () => {
    const admin = await createUser({ role: 'admin' });
    const { felado, job } = await elfogadottFuvar();
    const trid = await bankOldalon(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = 'authorized', created_at = NOW() - INTERVAL '20 minutes'
                     WHERE payment_id = $1`, [trid]);
    await db.query(`UPDATE cib_messages SET created_at = NOW() - INTERVAL '20 minutes'
                     WHERE payment_id = $1 AND direction = 'ki' AND msgt = 10`, [trid]);
    const r = await request(app).post(`/payments/admin/cib/${trid}/kezi-rendezes`).set(...auth(admin))
      .send({ muvelet: 'lejaratas', indoklas: 'A bank szerint a jóváhagyást nem zártuk le.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.allapot).toBe('nem_terhelt');
    const level = LEVELEK.find((l) => l.nev === 'sendFeePaymentFailedEmail');
    expect(level && level.tipus).toBe('nem_zart');
  });
});
