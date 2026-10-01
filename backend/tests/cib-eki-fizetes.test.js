// =====================================================================
//  CIB EKI — A FIZETÉSI ÚT, HAMIS BANKKAL (2026-09-29, CIB PR-2/B)
//
//  A kártyás kapcsolatfelvételi díj teljes útja a feladó szemszögéből:
//  elfogadás → /pay (kétfázisú indítás) → egyszer használatos átirányító
//  link → a bank fizetőoldala → visszatérés az API-ra → MSGT33 → PONTOSAN
//  egy MSGT32 → könyvelés → értesítések a kötelező banki adatsorral.
//
//  Amit őriz (mindegyik egy konkrét, pénzbe kerülő hibamód ellen):
//   * az ELFOGADÁS nem indít banki kísérletet (MSGT10 nélkül, session és
//     díj-sor nélkül) — a szállító válaszában link sem lehet;
//   * a MSGT10 CSAK az előírt mezőkkel megy ki, zár NÉLKÜL (egy közben
//     érkező lemondás nem vár a bankra);
//   * az indítás minden hibaága banki szöveg nélküli, fix magyar választ ad;
//   * a hop-link egyszer használatos, soha nem 500;
//   * a visszatérés a NYERS query-ből fejt vissza, és hamis/idegen/ismeretlen
//     üzenetre semmit nem dolgoz fel;
//   * a publikus eredmény-oldal token-kapus, személyes adat nélkül;
//   * CIB-konfignál a régi callback 410, a stub teszt-üzem a listán kívüli
//     felhasználóknak bitre a régi.
//  A valódi bankot SEMMI nem hívja: minden banki üzenet a helyi hamis bankhoz
//  megy, futásidőben generált kulccsal.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── A levelező csatorna elfogása (a szerver betöltése ELŐTT — a route-ok
// egy része destrukturálva importál). Az eredeti függvények megmaradnak a
// levél-HTML méréséhez.
const LEVELEK = [];
const emailSzolg = require('../src/services/email');
const EREDETI_LEVEL = {};
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendFeePaymentFailedEmail',
  'sendPaymentDueEmail', 'sendCibRiasztasEmail']) {
  EREDETI_LEVEL[nev] = emailSzolg[nev];
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const {
  app, db, createUser, createJob, seenOffer,
} = require('./helpers');
const eki = require('../src/services/ekiCrypt');
const { inditHamisBank, beallitEnv, ujKulcs, bankTitkosit } = require('./cibHamisBank');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const { CIB_FELIRATOK } = require('../src/data/cibFeliratok');

// A még nem létező modulokat lustán töltjük: a piros-próbán a HTTP-szintű
// tesztek így a VISELKEDÉS hiányán buknak, nem egy import-hibán.
const cf = () => require('../src/services/cibFizetes');
const kor = () => require('../src/services/cibLekerdezo').runCibKor();
const auth = (u) => ['Authorization', `Bearer ${u.token}`];

let bank;
let visszaallit;

const ALAP_ENV = {
  CIB_BEVEZETES: '2026-01-01',
  CIB_HTTP_TIMEOUT_MS: '1500',
  CIB_ZARAS_TIMEOUT_MS: '1500',
  CIB_INDITAS_OSSZKERET_MS: '5000',
  CIB_LEKERDEZES_KOZ_MS: '5000',
};

beforeAll(async () => {
  bank = await inditHamisBank();
  visszaallit = beallitEnv(bank.env(ALAP_ENV));
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
  } catch { /* a piros-próbán a modul még nincs meg */ }
  // Tesztenkénti elszigetelés: a korábbi tesztek függő kísérletei parkolnak.
  await db.query(`UPDATE payment_sessions SET cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL
                   WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL`);
});

// ── Segédek ──────────────────────────────────────────────────────────
async function elfogadottFuvar({ priceHuf = 15000 } = {}) {
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', priceHuf });
  return { felado, szallito, job };
}
const fizet = (f, job, body = { consent: true, cib_adatkezelesi_hozzajarulas: true }) => request(app).post(`/jobs/${job.id}/pay`).set(...auth(f)).send(body);
function hopToken(valasz) {
  const m = /\/payments\/cib\/tovabb\/([A-Za-z0-9_-]+)$/.exec(valasz.body.redirect_url || '');
  return m ? m[1] : null;
}
const atiranyit = (token) => request(app).get(`/payments/cib/tovabb/${token}`).redirects(0);
const bankUzenetek = (trid, msgt) => bank.uzenetek.filter((u) => u.trid === trid && u.msgt === msgt && u.csatorna === 'market');
async function visszater(trid, { dontes = 'fizet', nyersPlusz = true } = {}) {
  if (dontes) bank.dont(trid, dontes);
  const r = await request(app).get(`/payments/cib/vissza?${bank.msgt21Query(trid, { nyersPlusz })}`).redirects(0);
  await cf().varjHatterre();
  return r;
}
async function sor(trid) {
  return (await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid])).rows[0];
}
async function jobSor(id) {
  return (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
}
/** A teljes sikeres út: /pay → hop → a banki oldal → visszatérés. */
async function sikeresFizetes(felado, job) {
  const p = await fizet(felado, job);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const h = await atiranyit(hopToken(p));
  expect(h.status).toBe(302);
  const v = await visszater(p.body.trid);
  return { p, h, v, trid: p.body.trid };
}

// =====================================================================
describe('Elfogadás CIB-módban: nincs banki kísérlet, nincs link', () => {
  it('az ajánlat-elfogadás és az ellenajánlat-elfogadás 0 MSGT10-et küld, sessiont és díj-sort nem hoz létre', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const elotte = bank.uzenetek.length;
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(szallito))
      .send({ amount_huf: 20000, return_policy: 'included' });
    expect(bid.status).toBe(201);
    const acc = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(felado)).send(await seenOffer(bid.body.id));
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.barion).toEqual({ payment_id: null, gateway_url: null });
    expect(acc.body.connection_fee_huf).toBe(500);
    expect(bank.uzenetek.length, 'az elfogadás banki üzenetet küldött').toBe(elotte);
    expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM escrow_transactions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    expect((await jobSor(job.id)).connection_fee_huf).toBe(500);

    // Ellenajánlat-ág: a szállító fogadja el a feladó ellenajánlatát.
    const job2 = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid2 = await request(app).post(`/jobs/${job2.id}/bids`).set(...auth(szallito))
      .send({ amount_huf: 20000, return_policy: 'included' });
    const counter = await request(app).post(`/bids/${bid2.body.id}/counter`).set(...auth(felado)).send({ amount: 18000 });
    expect(counter.status).toBe(200);
    const acc2 = await request(app).post(`/bids/${bid2.body.id}/accept-counter`).set(...auth(szallito)).send(await seenOffer(bid2.body.id));
    expect(acc2.status, JSON.stringify(acc2.body)).toBe(200);
    expect(JSON.stringify(acc2.body)).not.toMatch(/gateway_url|redirect_url/);
    expect(bank.uzenetek.length).toBe(elotte);
    expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job2.id])).rowCount).toBe(0);
  });

  it('az azonnali fuvar elfogadása sem indít kísérletet, és a szállítói válaszban nincs fizetési link', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(`UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '1 hour',
                    suggested_price_huf = 25000 WHERE id = $1`, [job.id]);
    const elotte = bank.uzenetek.length;
    const r = await request(app).post(`/jobs/${job.id}/instant-accept`).set(...auth(szallito)).send({ expected_price_huf: 25000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/gateway_url|redirect_url|trid/);
    expect(bank.uzenetek.length).toBe(elotte);
    expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
    expect((await jobSor(job.id)).connection_fee_huf).toBe(500);
  });
});

// =====================================================================
describe('A boldog út: /pay → hop → bank → visszatérés → egy MSGT32 → könyvelés', () => {
  it('a /pay a szerződés szerinti választ adja, a MSGT10 csak az előírt mezőket viszi', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ provider: 'cib', fee_huf: 500, is_stub: false, reused: false });
    expect(p.body.trid).toMatch(/^[0-9]{16}$/);
    expect(p.body.redirect_url).toMatch(/^https:\/\/api\.gofuvar\.hu\/payments\/cib\/tovabb\/[A-Za-z0-9_-]{43}$/);
    expect(p.body.gateway_url).toBe(p.body.redirect_url);

    const [m10] = bankUzenetek(p.body.trid, 10);
    expect(Object.keys(m10.mezok).sort()).toEqual(['AMO', 'AUTH', 'CUR', 'LANG', 'MSGT', 'PID', 'TRID', 'TS', 'UID', 'URL'].sort());
    expect(m10.mezok.UID).toMatch(/^[A-Za-z0-9]{1,11}$/);
    expect(m10.mezok.UID).not.toContain(felado.id.slice(0, 8));
    expect(m10.mezok).toMatchObject({ AMO: '500', CUR: 'HUF', AUTH: '0', LANG: 'HU', URL: 'https://api.gofuvar.hu/payments/cib/vissza' });
    // A TS a DB órájából, Europe/Budapest szerint (a teszt UTC-ben is futhat).
    const bp = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date()).replace(/\D/g, '');
    expect(Math.abs(Number(m10.mezok.TS) - Number(bp))).toBeLessThan(120);

    const s = await sor(p.body.trid);
    expect(s).toMatchObject({ provider: 'cib', is_simulated: false, state: 'pending', cib_state: 'ready', amount_huf: 500 });
    const e = (await db.query('SELECT * FROM escrow_transactions WHERE job_id = $1', [job.id])).rows[0];
    expect(e).toMatchObject({ barion_payment_id: p.body.trid, barion_gateway_url: null, status: 'held' });
  });

  it('végigmegy: pontosan egy MSGT32, fizetett fuvar, nyugta, esemény, kontakt, levél a kötelező adatsorral', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    const { h, v, trid } = await sikeresFizetes(felado, job);

    // A hop a bank fizetőoldalára visz, ugyanazzal a TRID-del (MSGT20).
    expect(h.headers.location.startsWith(`${bank.customerUrl}?`)).toBe(true);
    expect(h.headers['cache-control']).toMatch(/no-store/);
    expect(h.headers['referrer-policy']).toBe('no-referrer');
    const m20 = eki.ekiDecrypt(h.headers.location.slice(h.headers.location.indexOf('?') + 1), bank.kulcs.kulcs);
    expect(m20).toMatchObject({ MSGT: '20', TRID: trid, PID: bank.pid });

    // A visszatérés 303-mal az aláírt eredmény-oldalra visz.
    expect(v.status).toBe(303);
    expect(v.headers.location).toMatch(/^https:\/\/www\.gofuvar\.hu\/fizetes\/eredmeny\?e=/);

    expect(bankUzenetek(trid, 33)).toHaveLength(1);
    expect(bankUzenetek(trid, 32), 'a MSGT32 nem pontosan egyszer ment ki').toHaveLength(1);

    const s = await sor(trid);
    expect(s).toMatchObject({ cib_state: 'closed_ok', state: 'succeeded' });
    expect(s.cib_result).toMatchObject({ rc: '00', forras: '32', amo: 500, cur: 'HUF' });
    expect(s.cib_result.anum).toMatch(/^[0-9]{6}$/);
    expect(s.cib_result.booked_at).toBeTruthy();
    expect(JSON.stringify(s.cib_result)).not.toMatch(/CNUM|\*\*\*/);

    const j = await jobSor(job.id);
    expect(j.paid_at).toBeTruthy();
    expect((await db.query('SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id])).rows[0].status).toBe('released');
    expect((await db.query('SELECT fee_huf FROM fee_payment_receipts WHERE payment_id = $1', [trid])).rows[0].fee_huf).toBe(500);
    expect((await db.query(`SELECT event_type, processed FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded'`, [trid])).rows[0])
      .toEqual({ event_type: 'webhook', processed: true });

    const reszlet = await request(app).get(`/jobs/${job.id}`).set(...auth(felado));
    expect(reszlet.body.contact, 'a kontakt a fizetés után sem jelent meg').toBeTruthy();

    const visszaig = LEVELEK.filter((l) => l.nev === 'sendFeeConfirmationEmail' && l.to === felado.email);
    expect(visszaig).toHaveLength(1);
    expect(visszaig[0].bankiAdatok).toMatchObject({ trid, rc: '00', amo: 500, cur: 'HUF' });
    expect(visszaig[0].bankiAdatok.anum).toBe(s.cib_result.anum);
    expect(visszaig[0].bankiAdatok.rt).toBeTruthy();
    expect(LEVELEK.filter((l) => l.nev === 'sendJobPaidEmail' && l.to === szallito.email)).toHaveLength(1);
  });

  it('a konzolra se a teljes TRID, se titkosított/nyílt banki üzenet, se a kulcs nem kerül; a Sentry-scrub a visszatérés query-jét eldobja', async () => {
    const naplo = [];
    const spyk = ['log', 'warn', 'error', 'info'].map((m) => vi.spyOn(console, m).mockImplementation((...a) => {
      naplo.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    }));
    let trid;
    try {
      const { felado, job } = await elfogadottFuvar();
      ({ trid } = await sikeresFizetes(felado, job));
      bank.forgatokonyv(10, [{ nyers: 'RC=S01', http: 200 }]);
      const b = await elfogadottFuvar();
      await fizet(b.felado, b.job);
    } finally {
      spyk.forEach((s) => s.mockRestore());
    }
    const osszes = naplo.join('\n');
    expect(osszes).not.toContain(trid);
    expect(osszes).not.toMatch(/DATA=|CRYPTO=1|MSGT=|RC=S01/);
    expect(osszes).not.toContain(bank.kulcs.b64);
    expect(osszes).not.toContain(bank.kulcs.b64.slice(0, 16));

    const { scrubSentryEvent } = require('../src/utils/sentryScrub');
    const q = bank.msgt21Query(trid);
    const esemeny = scrubSentryEvent({
      request: { url: `https://api.gofuvar.hu/payments/cib/vissza?${q}`, query_string: q },
    });
    const titkos = /DATA=([^&]+)/.exec(q)[1];
    expect(JSON.stringify(esemeny)).not.toContain(titkos.slice(0, 24));
    expect(esemeny.request.url).toContain('DATA=[SZURVE]');
  });

  it('a díj-visszaigazoló levél HTML-je mind az öt kötelező feliratot hordozza (a közös forrásból)', async () => {
    const elkapott = [];
    const eredetiKulcs = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_teszt_csak_fetch_stub';
    vi.stubGlobal('fetch', async (_url, opts) => {
      elkapott.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: 'teszt' }), text: async () => '' };
    });
    try {
      const bankiAdatok = {
        trid: '1234567890123456', rc: '00', rt: 'Sikeres tranzakció', amo: 500, cur: 'HUF', anum: '123456',
      };
      await EREDETI_LEVEL.sendFeeConfirmationEmail({
        to: 'a@teszt.gofuvar.hu', shipperName: 'Teszt', jobTitle: 'Fuvar', feeHuf: 500, cashHuf: 15000,
        paidAtIso: new Date().toISOString(), detailsPath: '/dashboard/fuvar/x', bankiAdatok,
      });
      await EREDETI_LEVEL.sendFeePaymentFailedEmail({
        to: 'a@teszt.gofuvar.hu', shipperName: 'Teszt', jobTitle: 'Fuvar', jobId: 'x',
        bankiAdatok: { ...bankiAdatok, rc: '51', rt: 'Elutasított tranzakció', anum: null }, rcCsoport: 'technikai', tipus: 'sikertelen',
      });
    } finally {
      vi.unstubAllGlobals();
      process.env.RESEND_API_KEY = eredetiKulcs;
    }
    expect(elkapott).toHaveLength(2);
    for (const level of elkapott) {
      for (const felirat of [CIB_FELIRATOK.trid, CIB_FELIRATOK.rc, CIB_FELIRATOK.rt, CIB_FELIRATOK.amo, CIB_FELIRATOK.anum]) {
        expect(level.html, `hiányzó felirat: ${felirat}`).toContain(felirat);
      }
      expect(level.html).toContain('1234567890123456');
      expect(level.html).not.toMatch(/\*\*\*\*/); // kártyaszám soha
    }
    expect(elkapott[1].html).toContain('fizetes=ujra');
  });

  it('az eredmény-oldal token-kapus: helyes tokenre az öt mező, név és cím nélkül; rossz tokenre 404', async () => {
    const { felado, job } = await elfogadottFuvar();
    const { v, trid } = await sikeresFizetes(felado, job);
    const token = new URL(v.headers.location).searchParams.get('e');
    const r = await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(token)}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      allapot: 'sikeres', trid, rc: '00', amo: 500, cur: 'HUF', job_id: job.id, rc_csoport: null, ujra_fizetheto: false,
    });
    expect(r.body.anum).toMatch(/^[0-9]{6}$/);
    expect(r.body.rt).toBeTruthy();
    const szoveg = JSON.stringify(r.body);
    expect(szoveg).not.toContain('Teszt fuvar');
    expect(szoveg).not.toContain('Budapest');
    expect(szoveg).not.toContain(felado.email);

    for (const rossz of ['', 'x', `${token}x`, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), `${trid}.1.aaaa`]) {
      const rr = await request(app).get(`/payments/cib/eredmeny?e=${encodeURIComponent(rossz)}`);
      expect(rr.status, `rossz token elfogadva: ${rossz}`).toBe(404);
    }
  });

  it('a GET /jobs/:id/fee-payment csak a feladónak (és adminnak) jár', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    const elotte = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(elotte.status).toBe(200);
    expect(elotte.body).toMatchObject({ provider_kind: 'cib', can_pay: true, open_attempt: null, last_result: null });

    const { trid } = await sikeresFizetes(felado, job);
    const utana = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(felado));
    expect(utana.body.can_pay).toBe(false);
    expect(utana.body.last_result).toMatchObject({ trid, rc: '00', allapot: 'sikeres', amo: 500, cur: 'HUF' });

    const idegen = await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(szallito));
    expect(idegen.status).toBe(403);
    expect(JSON.stringify(idegen.body)).not.toContain(trid);
    const admin = await createUser({ role: 'admin' });
    expect((await request(app).get(`/jobs/${job.id}/fee-payment`).set(...auth(admin))).status).toBe(200);
  });
});

// =====================================================================
describe('Indítás: kétfázisú, hibaágai banki szöveg nélkül', () => {
  it('RC=02 kétszer, majd 00: új TRID-ekkel három sor, az utolsó „ready"', async () => {
    const { felado, job } = await elfogadottFuvar();
    bank.forgatokonyv(10, [{ rc: '02' }, { rc: '02' }, { rc: '00' }]);
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const sorok = (await db.query('SELECT payment_id, cib_state, state, cib_result FROM payment_sessions WHERE job_id = $1 ORDER BY created_at', [job.id])).rows;
    expect(sorok).toHaveLength(3);
    expect(new Set(sorok.map((s) => s.payment_id)).size).toBe(3);
    expect(sorok.filter((s) => s.cib_state === 'init_failed' && s.state === 'closed' && s.cib_result.ok === 'trid_foglalt')).toHaveLength(2);
    expect(sorok.find((s) => s.payment_id === p.body.trid).cib_state).toBe('ready');
  });

  it('RC=02 háromszor → 502 CIB_INIT_FAILED, minden kísérlet lezárva', async () => {
    const { felado, job } = await elfogadottFuvar();
    bank.forgatokonyv(10, [{ rc: '02' }, { rc: '02' }, { rc: '02' }]);
    const p = await fizet(felado, job);
    expect(p.status).toBe(502);
    expect(p.body.code).toBe('CIB_INIT_FAILED');
    const sorok = (await db.query('SELECT cib_state, state FROM payment_sessions WHERE job_id = $1', [job.id])).rows;
    expect(sorok).toHaveLength(3);
    expect(sorok.every((s) => s.cib_state === 'init_failed' && s.state === 'closed')).toBe(true);
  });

  it.each([
    ['RC=01', { rc: '01' }, 502, 'CIB_INIT_FAILED'],
    ['titkosítatlan S01 HTTP 200-zal', { nyers: 'RC=S01', http: 200 }, 502, 'CIB_INIT_FAILED'],
    ['D04 (rátakorlát)', { nyers: 'RC=D04', http: 500 }, 503, 'CIB_BUSY'],
    ['időtúllépés', { lefagy: true }, 502, 'CIB_INIT_FAILED'],
    ['értelmetlen törzs', { szemet: 'valami' }, 502, 'CIB_INIT_FAILED'],
  ])('%s (%j) → %i %s, init_failed + Expired, banki szöveg a válaszban nincs', async (_n, lepes, http, kod) => {
    const { felado, job } = await elfogadottFuvar();
    bank.forgatokonyv(10, [lepes]);
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(http);
    expect(p.body.code).toBe(kod);
    expect(typeof p.body.error).toBe('string');
    expect(JSON.stringify(p.body)).not.toMatch(/RC=|S01|D04|detail|ECONN|timeout/i);
    const s = (await db.query('SELECT payment_id, cib_state, state FROM payment_sessions WHERE job_id = $1', [job.id])).rows;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cib_state: 'init_failed', state: 'closed' });
    expect((await db.query(`SELECT 1 FROM payment_events WHERE payment_id = $1 AND status = 'Expired' AND processed`, [s[0].payment_id])).rowCount).toBe(1);
  });

  it('régi szívverés (a lekérdező kör nem fut) → 503, MSGT10 nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    cf().__resetCibAllapotForTests(); // a szívverés 0
    const elotte = bank.uzenetek.length;
    const p = await fizet(felado, job);
    expect(p.status).toBe(503);
    expect(p.body.code).toBe('PAYMENT_TEMPORARILY_UNAVAILABLE');
    expect(bank.uzenetek.length).toBe(elotte);
    expect((await db.query('SELECT 1 FROM payment_sessions WHERE job_id = $1', [job.id])).rowCount).toBe(0);
  });

  it('megszakító: 5 egymás utáni S-hiba után a /pay banki hívás nélkül 503', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { felado, job } = await elfogadottFuvar();
      bank.forgatokonyv(10, [{ nyers: 'RC=S01', http: 403 }]);
      expect((await fizet(felado, job)).status).toBe(502);
    }
    const { felado, job } = await elfogadottFuvar();
    const elotte = bank.uzenetek.length;
    const p = await fizet(felado, job);
    expect(p.status).toBe(503);
    expect(p.body.code).toBe('PAYMENT_TEMPORARILY_UNAVAILABLE');
    expect(bank.uzenetek.length).toBe(elotte);
  });

  it('a MSGT10 alatt a fuvarsor NINCS zárolva: egy párhuzamos lemondás nem vár a bankra', async () => {
    const { felado, job } = await elfogadottFuvar();
    let lemondas = null;
    bank.horog(async (u) => {
      if (u.msgt !== 10) return;
      bank.horog(null);
      lemondas = await Promise.race([
        request(app).post(`/jobs/${job.id}/cancel`).set(...auth(felado)).send({}),
        new Promise((r) => { setTimeout(() => r('ZAROLVA'), 1200); }),
      ]);
    });
    const p = await fizet(felado, job);
    expect(lemondas, 'a lemondás a banki hívás alatt a fuvarsorra várt').not.toBe('ZAROLVA');
    expect(lemondas.status).toBe(200);
    // A lemondott fuvarra nem adunk ki fizetési linket.
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('STATE_CHANGED');
    const s = (await db.query('SELECT cib_state, state FROM payment_sessions WHERE job_id = $1', [job.id])).rows[0];
    expect(s).toMatchObject({ cib_state: 'abandoned', state: 'closed' });
  });
});

// =====================================================================
describe('Hop-link: egyszer használatos, soha nem 500', () => {
  it('a második használat nem ad MSGT20-at, hanem a fuvaroldalra visz; ismeretlen és szemét token → hibaoldal', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    const token = hopToken(p);
    expect((await atiranyit(token)).status).toBe(302);
    const masodik = await atiranyit(token);
    expect(masodik.status).toBe(303);
    expect(masodik.headers.location).toBe(`https://www.gofuvar.hu/dashboard/fuvar/${job.id}?fizetes=link-lejart`);
    for (const t of ['A'.repeat(43), 'rovid', '%00', 'x'.repeat(500), "'; DROP TABLE jobs;--"]) {
      const r = await atiranyit(encodeURIComponent(t));
      expect(r.status, `token: ${t}`).toBe(303);
      expect(r.headers.location).toBe('https://www.gofuvar.hu/fizetes/eredmeny?hiba=link');
    }
    expect(bank.uzenetek.filter((u) => u.csatorna === 'customer' && u.trid === p.body.trid)).toHaveLength(0);
  });

  it('a fel nem használt, lejárt hop-ot a kör banki hívás nélkül „abandoned"-ra teszi', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_hop_expires_at = NOW() - INTERVAL '1 minute',
                    cib_next_action_at = NOW() - INTERVAL '1 second' WHERE payment_id = $1`, [p.body.trid]);
    const elotte = bank.uzenetek.length;
    await kor();
    expect(bank.uzenetek.length).toBe(elotte);
    expect(await sor(p.body.trid)).toMatchObject({ cib_state: 'abandoned', state: 'closed' });
    expect((await sor(p.body.trid)).cib_result.ok).toBe('hop_lejart');
    const lejart = await atiranyit(hopToken(p));
    expect(lejart.status).toBe(303);
    expect(lejart.headers.location).toContain(`/dashboard/fuvar/${job.id}?fizetes=link-lejart`);
  });
});

// =====================================================================
describe('Újrapróba: új TRID, a függő kísérletek szabályai', () => {
  it('a bankhoz átirányított (redirected) kísérlet mellett új TRID indulhat; a „ready" felülíródik', async () => {
    const { felado, job } = await elfogadottFuvar();
    const elso = await fizet(felado, job);
    const masodik = await fizet(felado, job);
    expect(masodik.status).toBe(200);
    expect(masodik.body.trid).not.toBe(elso.body.trid);
    expect(masodik.body.reused).toBe(false);
    const regi = await sor(elso.body.trid);
    expect(regi).toMatchObject({ cib_state: 'abandoned', state: 'closed' });
    expect(regi.cib_result.ok).toBe('felulirva');

    expect((await atiranyit(hopToken(masodik))).status).toBe(302);
    const harmadik = await fizet(felado, job);
    expect(harmadik.status).toBe(200);
    expect((await sor(masodik.body.trid)).cib_state).toBe('redirected');
  });

  it.each([
    ['authorized', 409, 'CIB_PAYMENT_FINISHING'],
    ['closing', 409, 'CIB_PAYMENT_FINISHING'],
    ['close_unknown', 409, 'CIB_PAYMENT_REVIEW'],
  ])('függő %s kísérlet mellett a /pay %i %s', async (allapot, http, kod) => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    await db.query(`UPDATE payment_sessions SET cib_state = $2, cib_next_action_at = NOW() + INTERVAL '1 hour',
                    cib_close_attempts = CASE WHEN $2 = 'authorized' THEN 0 ELSE 1 END WHERE payment_id = $1`, [p.body.trid, allapot]);
    const r = await fizet(felado, job);
    expect(r.status).toBe(http);
    expect(r.body.code).toBe(kod);
    await cf().varjHatterre();
  });

  it('60 másodpercnél fiatalabb „initializing" mellett 409 PAYMENT_STARTING; a korlát fölött 429', async () => {
    const { felado, job } = await elfogadottFuvar();
    await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state, cib_next_action_at)
                    VALUES ($1, $2, $3, 500, 'cib', 'pending', 'initializing', NOW() + INTERVAL '2 minutes')`,
    ['1111000011110001', job.id, felado.id]);
    const r = await fizet(felado, job);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PAYMENT_STARTING');

    const { felado: f2, job: j2 } = await elfogadottFuvar();
    for (let i = 0; i < 6; i += 1) {
      await db.query(`INSERT INTO payment_sessions (payment_id, job_id, shipper_id, amount_huf, provider, state, cib_state)
                      VALUES ($1, $2, $3, 500, 'cib', 'closed', 'failed')`, [`22220000222200${String(i).padStart(2, '0')}`, j2.id, f2.id]);
    }
    const t = await fizet(f2, j2);
    expect(t.status).toBe(429);
    expect(t.body.code).toBe('PAYMENT_RETRY_LIMIT');
  });

  it('a függő szimulált stub-session az első CIB-/pay-en provider_switch-csel zárul', async () => {
    const { felado, job } = await elfogadottFuvar();
    await db.query(`INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, barion_gateway_url, carrier_share_huf, platform_share_huf)
                    VALUES ($1, 500, 'held', $2, $3, 0, 500)`, [job.id, `cib-stub-${job.id}`, `stub:cib/${job.id}`]);
    const stub = await sor(`cib-stub-${job.id}`);
    expect(stub).toMatchObject({ is_simulated: true, state: 'pending' });
    const p = await fizet(felado, job);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(await sor(`cib-stub-${job.id}`)).toMatchObject({ state: 'closed', closed_reason: 'provider_switch' });
  });
});

// =====================================================================
describe('Visszatérés: a nyers query a döntő; hamis üzenetre nincs feldolgozás', () => {
  it('a nyers „+" és a kódolt DATA is visszafejthető; az első MSGT33 azonnal megy', async () => {
    for (const nyersPlusz of [true, false]) {
      const { felado, job } = await elfogadottFuvar();
      const p = await fizet(felado, job);
      await atiranyit(hopToken(p));
      bank.tridre(p.body.trid, 33, [{ rc: 'PR' }]);
      const v = await visszater(p.body.trid, { dontes: null, nyersPlusz });
      expect(v.status).toBe(303);
      expect(v.headers.location).toMatch(/\/fizetes\/eredmeny\?e=/);
      expect(bankUzenetek(p.body.trid, 33), 'a visszatérés után nem ment azonnal MSGT33').toHaveLength(1);
      expect((await sor(p.body.trid)).cib_returned_at).toBeTruthy();
      // Visszajátszás a közön belül: nincs második MSGT33.
      await visszater(p.body.trid, { dontes: null, nyersPlusz });
      expect(bankUzenetek(p.body.trid, 33)).toHaveLength(1);
    }
  });

  it('hamisított, idegen kulcsú, ismeretlen TRID-es vagy szemét visszatérés → 303 hibaoldal, feldolgozás nélkül', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    await atiranyit(hopToken(p));
    const idegen = ujKulcs('TST0001');
    const esetek = [
      bankTitkosit([['MSGT', '21'], ['PID', 'TST0001'], ['TRID', p.body.trid]], idegen),
      bank.msgt21Query('9999888877776666'),
      bank.msgt21Query(p.body.trid).replace(/DATA=.{6}/, 'DATA=AAAAAA'),
      'szemet=1',
      '',
      `PID=TST0001&CRYPTO=1&DATA=${'A'.repeat(5000)}`,
    ];
    for (const q of esetek) {
      const r = await request(app).get(`/payments/cib/vissza?${q}`).redirects(0);
      expect(r.status, `eset: ${q.slice(0, 40)}`).toBe(303);
      expect(r.headers.location).toBe('https://www.gofuvar.hu/fizetes/eredmeny?hiba=azonositas');
    }
    await cf().varjHatterre();
    expect(bankUzenetek(p.body.trid, 33)).toHaveLength(0);
    expect((await sor(p.body.trid)).cib_returned_at).toBeNull();
  });
});

// =====================================================================
describe('Üzemmódok: callback, teszt-allowlist, hibás konfig', () => {
  it('teljes CIB-konfignál a régi callback 410 CIB_NO_CALLBACK, és semmit nem könyvel', async () => {
    const { felado, job } = await elfogadottFuvar();
    const p = await fizet(felado, job);
    const r = await request(app).post('/payments/cib/callback').send({ PaymentId: p.body.trid, Status: 'Succeeded' });
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('CIB_NO_CALLBACK');
    expect((await jobSor(job.id)).paid_at).toBeNull();
    expect(bankUzenetek(p.body.trid, 33)).toHaveLength(0);
  });

  it('hibás konfignál: /pay 503 CIB_UNAVAILABLE, a callback 410, a kézi nyugtázás zárva', async () => {
    const vissza = beallitEnv({ CIB_KORNYEZET: 'rossz' });
    try {
      const { felado, job } = await elfogadottFuvar();
      const p = await fizet(felado, job);
      expect(p.status).toBe(503);
      expect(p.body.code).toBe('CIB_UNAVAILABLE');
      expect((await request(app).post('/payments/cib/callback').send({ PaymentId: 'x', Status: 'Succeeded' })).status).toBe(410);
      const k = await request(app).post(`/jobs/${job.id}/confirm-payment`).set(...auth(felado)).send({});
      expect(k.status).toBe(409);
      expect((await jobSor(job.id)).paid_at).toBeNull();
    } finally {
      vissza();
    }
  });

  it('teszt-allowlist: a listás felhasználó CIB-et kap (kézi nyugtázás 409), a többi a régi stubot (cib-stub-<id>)', async () => {
    const listas = await createUser();
    const vissza = beallitEnv({ CIB_TESZT_FELHASZNALOK: listas.id, ALLOW_STUB_PAYMENTS: 'true' });
    try {
      const szallito = await createUser({ role: 'carrier' });
      const j1 = await createJob({ shipperId: listas.id, carrierId: szallito.id, status: 'accepted' });
      const p1 = await fizet(listas, j1);
      expect(p1.status).toBe(200);
      expect(p1.body.provider).toBe('cib');
      expect((await request(app).post(`/jobs/${j1.id}/confirm-payment`).set(...auth(listas)).send({})).status).toBe(409);
      const me1 = await request(app).get('/auth/me').set(...auth(listas));
      expect(me1.body).toMatchObject({ payment_test_mode: true, payment_test_kind: 'cib_teszt' });

      const masik = await createUser();
      const j2 = await createJob({ shipperId: masik.id, carrierId: szallito.id, status: 'accepted' });
      const p2 = await fizet(masik, j2);
      expect(p2.status, JSON.stringify(p2.body)).toBe(200);
      expect(p2.body).toMatchObject({ payment_id: `cib-stub-${j2.id}`, gateway_url: `stub:cib/${j2.id}`, is_stub: true });
      const k2 = await request(app).post(`/jobs/${j2.id}/confirm-payment`).set(...auth(masik)).send({});
      expect(k2.status).toBe(200);
      const me2 = await request(app).get('/auth/me').set(...auth(masik));
      expect(me2.body).toMatchObject({ payment_test_mode: true, payment_test_kind: 'stub' });
    } finally {
      vissza();
    }
  });
});
