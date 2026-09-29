// =====================================================================
//  CIB PR-1 — a díjfizetés UTÁNI értesítések (2026-09-29)
//
//  A CIB-bekötés előtt a meglévő, közös értesítési út hibáit zárjuk. A stub
//  (teszt-üzem) és a jövőbeli banki út UGYANEZT a kódot használja, tehát ami
//  itt hibás, az élesben is hibás lenne.
//
//  Az öt igazolt hiba (payments.js confirmFeePayment, sikeres ág):
//    (a) a lekérdezés nem kérte le a j.accepted_price_huf-ot → a feladói
//        díj-visszaigazoló levélből hiányzott a fuvardíj emlékeztetője;
//    (b) a levél „Fizetés időpontja" a new Date() volt, nem a TÁROLT paid_at
//        (45/2014. 18. § — a tartós adathordozón a könyvelt időpont kell);
//    (c) a szállító a webhook-úton NEM kapott „Fizetés beérkezett" levelet
//        (a kézi úton igen — a két út szétcsúszott);
//    (d) ismételt könyvelésnél (alreadyBooked / átvett claim) minden levél,
//        in-app értesítés és socket-esemény ÚJRA kiment;
//    (e) Canceled/Expired jelzésre akkor is „Próbáld újra" ment, ha a fuvar
//        közben (másik kísérlettel) már kifizetett lett.
//  A kézi (teszt-üzemi) úton ugyanez: a párhuzamos nyugtázás vesztese is
//  értesített, és újranyitási verseny után a RÉGI szállító kapott „Indulhat a
//  fuvar!" üzenetet. Plusz: a /pay 502-es válasza a belső hibaszöveget adta ki.
//
//  Javítás: egy közös helper (services/feeNotifications.js), ami a
//  díjbizonylaton (fee_payment_receipts.notifications_sent_at) atomi claimmel
//  PONTOSAN EGYSZER értesít, és a claim pillanatában tárolt szállítónak ír.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import request from 'supertest';

const require = createRequire(import.meta.url);

// ── A levelező csatorna elfogása ─────────────────────────────────────
// ⚠️ A SORREND A LÉNYEG (lásd feketedoboz-ut.test.js): a route-ok egy része
// DESTRUKTURÁLVA importál (`const { sendJobPaidEmail } = require(...)`), tehát
// a levelező modult a szerver ELŐTT kell foltozni — különben a régi kód
// hívásai láthatatlanok maradnának, és a piros-próba nem mérne semmit.
const LEVELEK = [];
const emailSzolg = require('../src/services/email');
for (const nev of ['sendFeeConfirmationEmail', 'sendJobPaidEmail', 'sendBookingPaidEmail']) {
  emailSzolg[nev] = async (arg) => { LEVELEK.push({ nev, ...arg }); return { stub: true }; };
}

const {
  app, db, createUser, createJob, createBooking, seenOffer,
} = require('./helpers');
const dbModul = require('../src/db');
const realtime = require('../src/realtime');
const paymentProvider = require('../src/services/paymentProvider');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const { calculateConnectionFee } = require('../src/services/connectionFee');

const auth = (u) => ['Authorization', `Bearer ${u.token}`];
const webhook = (body) => request(app).post('/payments/cib/callback').send(body);
const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });

let SOCKET = [];
let eredetiEmit;
beforeEach(() => {
  __resetRateLimitsForTests();
  SOCKET = [];
  eredetiEmit = realtime.emitToUser;
  realtime.emitToUser = (userId, esemeny, payload) => {
    SOCKET.push({ userId, esemeny, payload });
    return eredetiEmit(userId, esemeny, payload);
  };
});
afterEach(() => {
  realtime.emitToUser = eredetiEmit;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const levelek = (nev, to) => LEVELEK.filter((l) => l.nev === nev && l.to === to);
const esemenyek = (userId, esemeny) => SOCKET.filter((s) => s.userId === userId && s.esemeny === esemeny);
async function ertesitesek(userId, type) {
  const { rows } = await db.query(
    'SELECT title, body, link FROM notifications WHERE user_id = $1 AND type = $2', [userId, type],
  );
  return rows;
}
async function tarolt(jobId) {
  const { rows } = await db.query(
    `SELECT j.paid_at, r.paid_at AS receipt_paid_at
       FROM jobs j LEFT JOIN fee_payment_receipts r ON r.job_id = j.id WHERE j.id = $1`, [jobId],
  );
  return rows[0];
}
/** Külön lekérdezés: a régi sémán (oszlop nélkül) csak ez az egy állítás bukjon. */
async function kikuldesNyugtazva(jobId) {
  const { rows } = await db.query(
    'SELECT notifications_sent_at FROM fee_payment_receipts WHERE job_id = $1', [jobId],
  );
  return rows[0]?.notifications_sent_at;
}

/** Fizetésre váró fuvar: elfogadott ajánlat, 'held' díj-sor, nyilatkozat megvan. */
async function fizetesreVaroFuvar({ priceHuf = 15000 } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false, priceHuf,
  });
  const paymentId = `pr1-${job.id}`;
  const dij = calculateConnectionFee(priceHuf);
  await db.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
     VALUES ($1, $2, 'held', $3, 0, $2)`,
    [job.id, dij, paymentId],
  );
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  return {
    felado, szallito, job, paymentId, dij, priceHuf,
  };
}

/** Fizetésre váró foglalás (a járat-ág párja). */
async function fizetesreVaroFoglalas({ priceHuf = 12000 } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const { booking } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false, priceHuf,
  });
  const paymentId = `pr1-b-${booking.id}`;
  await db.query(
    `UPDATE route_bookings SET connection_fee_huf = 500, fee_consent_at = NOW(), barion_payment_id = $2
      WHERE id = $1`,
    [booking.id, paymentId],
  );
  return {
    felado, szallito, booking, paymentId, priceHuf,
  };
}

/**
 * Egyszeri „elavult olvasás" a kérés ELSŐ ügylet-SELECT-jén: a valódi
 * lekérdezés lefut, a `kozben` a kettő közé ékelődő párhuzamos műveletet
 * modellezi, a hívó pedig a módosított (elavult) sort kapja. Így a verseny
 * determinisztikus — nem a szerencsén múlik, hogy a vesztes ág átjut-e.
 */
function elavultOlvasas({ tabla, id, atir = (s) => s, kozben = async () => {} }) {
  const eredeti = dbModul.query.bind(dbModul);
  const allapot = { talalat: 0 };
  vi.spyOn(dbModul, 'query').mockImplementation(async (sql, params) => {
    const res = await eredeti(sql, params);
    if (allapot.talalat === 0 && typeof sql === 'string' && /^\s*SELECT/i.test(sql)
        && new RegExp(`FROM ${tabla}\\b`).test(sql) && Array.isArray(params) && params[0] === id) {
      allapot.talalat += 1;
      await kozben(eredeti);
      return { ...res, rows: res.rows.map(atir) };
    }
    return res;
  });
  return allapot;
}

// =====================================================================
//  1) A WEBHOOK SIKERES ága: helyes tartalom, mindkét fél értesül
// =====================================================================
describe('Webhook Succeeded: a díj-visszaigazolás tartalma és címzettjei', () => {
  it('(a)+(b) a feladó levelében a fuvardíj és a TÁROLT fizetési időpont szerepel', async () => {
    const {
      felado, job, paymentId, dij, priceHuf,
    } = await fizetesreVaroFuvar();

    // A rendszeróra messze a DB-idő után jár: ha a levél a new Date()-ből
    // dolgozna, az időpont determinisztikusan eltérne a könyvelttől.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-06-15T10:00:00Z'));
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    // A levél setImmediate-ben megy: a hamis óra a kiküldés után áll vissza.
    await varj(120);
    vi.useRealTimers();
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const l = levelek('sendFeeConfirmationEmail', felado.email);
    expect(l, 'a feladó nem kapott (vagy többet kapott) díj-visszaigazolást').toHaveLength(1);
    expect(l[0].feeHuf).toBe(dij);
    expect(
      Number(l[0].cashHuf),
      '(a) a díj-visszaigazolásból hiányzik a fuvardíj — a webhook-lekérdezés nem kérte le az accepted_price_huf-ot',
    ).toBe(priceHuf);
    const t = await tarolt(job.id);
    expect(t.paid_at).toBeTruthy();
    expect(
      new Date(l[0].paidAtIso).getTime(),
      '(b) a levél fizetési időpontja nem a könyvelt paid_at, hanem a küldés pillanata',
    ).toBe(new Date(t.receipt_paid_at).getTime());
  });

  it('(c) a szállító a webhook-úton is megkapja a „Fizetés beérkezett" levelet, és mindkét fél socketet kap', async () => {
    const {
      felado, szallito, job, paymentId, priceHuf,
    } = await fizetesreVaroFuvar();
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBe(200);
    await varj(120);

    const l = levelek('sendJobPaidEmail', szallito.email);
    expect(l, '(c) a webhook-úton a szállító NEM kapott levelet (a kézi úton igen)').toHaveLength(1);
    expect(l[0].jobId).toBe(job.id);
    expect(Number(l[0].amountHuf)).toBe(priceHuf);
    expect(await ertesitesek(szallito.id, 'job_paid')).toHaveLength(1);
    expect(esemenyek(szallito.id, 'job:paid')).toHaveLength(1);
    expect(esemenyek(felado.id, 'job:paid')).toHaveLength(1);
    expect(await kikuldesNyugtazva(job.id), 'a kiküldés nincs nyugtázva a bizonylaton').toBeTruthy();
  });

  it('foglalásnál is: a feladó a fuvardíjjal, a szállító levélben értesül', async () => {
    const {
      felado, szallito, booking, paymentId, priceHuf,
    } = await fizetesreVaroFoglalas();
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBe(200);
    await varj(120);

    const f = levelek('sendFeeConfirmationEmail', felado.email);
    expect(f).toHaveLength(1);
    expect(Number(f[0].cashHuf)).toBe(priceHuf);
    const { rows } = await db.query('SELECT paid_at FROM fee_payment_receipts WHERE booking_id = $1', [booking.id]);
    expect(new Date(f[0].paidAtIso).getTime()).toBe(new Date(rows[0].paid_at).getTime());
    expect(levelek('sendBookingPaidEmail', szallito.email), 'a foglalás szállítója nem kapott levelet').toHaveLength(1);
    expect(await ertesitesek(szallito.id, 'booking_paid')).toHaveLength(1);
    expect(esemenyek(szallito.id, 'route-booking:paid')).toHaveLength(1);
    expect(esemenyek(felado.id, 'route-booking:paid')).toHaveLength(1);
  });
});

// =====================================================================
//  2) (d) Ismételt könyvelés: SEMMI nem megy ki újra
// =====================================================================
describe('(d) Ismételt könyvelés után nincs második értesítés', () => {
  const MODOK = {
    'átvett (elakadt) claim': (paymentId) => db.query(
      `UPDATE payment_events SET processed = false, created_at = NOW() - INTERVAL '5 minutes'
        WHERE payment_id = $1 AND status = 'Succeeded'`, [paymentId],
    ),
    'hiányzó naplósor (alreadyBooked)': (paymentId) => db.query(
      `DELETE FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded'`, [paymentId],
    ),
  };
  for (const [mod, elokeszit] of Object.entries(MODOK)) {
    it(`${mod}: a második feldolgozás nem küld levelet, in-app értesítést, socketet`, async () => {
      const {
        felado, szallito, job, paymentId,
      } = await fizetesreVaroFuvar();
      expect((await webhook({ PaymentId: paymentId, Status: 'Succeeded' })).status).toBe(200);
      await elokeszit(paymentId);
      const masodik = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
      expect(masodik.status).toBe(200);
      await varj(120);

      expect(levelek('sendFeeConfirmationEmail', felado.email), 'DUPLA díj-visszaigazoló levél').toHaveLength(1);
      expect(levelek('sendJobPaidEmail', szallito.email).length, 'DUPLA szállítói levél').toBeLessThanOrEqual(1);
      expect(await ertesitesek(szallito.id, 'job_paid'), 'DUPLA „Indulhat a fuvar!" értesítés').toHaveLength(1);
      expect(esemenyek(szallito.id, 'job:paid'), 'DUPLA job:paid a szállítónak').toHaveLength(1);
      expect(esemenyek(felado.id, 'job:paid'), 'DUPLA job:paid a feladónak').toHaveLength(1);
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM fee_payment_receipts WHERE job_id = $1', [job.id]);
      expect(rows[0].n).toBe(1);
    });
  }
});

// =====================================================================
//  3) (e) Megszakadt/lejárt jelzés egy MÁR kifizetett ügyletre
// =====================================================================
describe('(e) Canceled/Expired kifizetett ügyletre: nincs „Próbáld újra"', () => {
  for (const statusz of ['Canceled', 'Expired']) {
    it(`fuvar: „${statusz}" a sikeres fizetés után nem hívja újrafizetésre a feladót`, async () => {
      const { felado, job, paymentId } = await fizetesreVaroFuvar();
      expect((await webhook({ PaymentId: paymentId, Status: 'Succeeded' })).status).toBe(200);
      const res = await webhook({ PaymentId: paymentId, Status: statusz });
      expect(res.status).toBe(200);
      const hamis = (await ertesitesek(felado.id, 'payment_failed')).filter((n) => n.link.includes(job.id));
      expect(hamis, 'a KIFIZETETT fuvar feladója „Fizetés megszakadt — próbáld újra" üzenetet kapott').toHaveLength(0);
    });

    it(`foglalás: „${statusz}" a sikeres fizetés után sem`, async () => {
      const { felado, paymentId } = await fizetesreVaroFoglalas();
      expect((await webhook({ PaymentId: paymentId, Status: 'Succeeded' })).status).toBe(200);
      expect((await webhook({ PaymentId: paymentId, Status: statusz })).status).toBe(200);
      expect(await ertesitesek(felado.id, 'payment_failed')).toHaveLength(0);
    });
  }

  it('ellenpróba: FIZETETLEN fuvarnál a „Próbáld újra" továbbra is kimegy', async () => {
    const { felado, job, paymentId } = await fizetesreVaroFuvar();
    expect((await webhook({ PaymentId: paymentId, Status: 'Canceled' })).status).toBe(200);
    const ert = (await ertesitesek(felado.id, 'payment_failed')).filter((n) => n.link.includes(job.id));
    expect(ert, 'a túl széles szűrés a valódi megszakadást is elnémította').toHaveLength(1);
  });
});

// =====================================================================
//  4) A KÉZI (teszt-üzemi) nyugtázás versenyei
// =====================================================================
describe('Kézi nyugtázás: a vesztes ág és az elavult szállító', () => {
  const nyugtaz = (job, felado) => request(app).post(`/jobs/${job.id}/confirm-payment`).set(...auth(felado)).send({});

  it('a párhuzamos nyugtázás VESZTESE nem küld második levelet/értesítést', async () => {
    const { felado, szallito, job } = await fizetesreVaroFuvar();
    expect((await nyugtaz(job, felado)).status).toBe(200);
    // A vesztes még a győztes COMMIT-ja előtt olvasott: nála a paid_at üres.
    const injekcio = elavultOlvasas({ tabla: 'jobs', id: job.id, atir: (s) => ({ ...s, paid_at: null }) });
    const masodik = await nyugtaz(job, felado);
    expect(injekcio.talalat, 'az elavult olvasás nem történt meg — a teszt nem mér semmit').toBe(1);
    expect(masodik.status).toBe(200);
    await varj(120);

    expect(levelek('sendFeeConfirmationEmail', felado.email), 'a vesztes ág is díj-visszaigazolást küldött').toHaveLength(1);
    expect(levelek('sendJobPaidEmail', szallito.email), 'a vesztes ág is szállítói levelet küldött').toHaveLength(1);
    expect(await ertesitesek(szallito.id, 'job_paid'), 'a vesztes ág is „Indulhat a fuvar!"-t küldött').toHaveLength(1);
    expect(esemenyek(szallito.id, 'job:paid')).toHaveLength(1);
  });

  it('újranyitási verseny után a RÉGI szállító nem kap „Indulhat a fuvar!" üzenetet', async () => {
    const { felado, szallito, job } = await fizetesreVaroFuvar();
    // A nyugtázás első olvasása után a szállító visszalép (díjmentes újranyitás).
    const injekcio = elavultOlvasas({
      tabla: 'jobs',
      id: job.id,
      kozben: (q) => q(
        `UPDATE jobs SET status = 'bidding', carrier_id = NULL,
                reopened_count = COALESCE(reopened_count, 0) + 1 WHERE id = $1`, [job.id],
      ),
    });
    const res = await nyugtaz(job, felado);
    expect(injekcio.talalat).toBe(1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await varj(120);

    const t = await tarolt(job.id);
    expect(t.paid_at, 'a díj a fuvarra szól — az újranyitott fuvarra is könyvelendő').toBeTruthy();
    expect(await ertesitesek(szallito.id, 'job_paid'), 'a VISSZALÉPETT szállító „Indulhat a fuvar!" értesítést kapott').toHaveLength(0);
    expect(levelek('sendJobPaidEmail', szallito.email), 'a VISSZALÉPETT szállító levelet kapott').toHaveLength(0);
    expect(esemenyek(szallito.id, 'job:paid')).toHaveLength(0);
    expect(levelek('sendFeeConfirmationEmail', felado.email), 'a feladó díj-visszaigazolása viszont jár').toHaveLength(1);
  });

  it('foglalás: a vesztes nyugtázás sem küld második levelet', async () => {
    const { felado, szallito, booking } = await fizetesreVaroFoglalas();
    const nyugtazB = () => request(app).post(`/route-bookings/${booking.id}/confirm-payment`).set(...auth(felado)).send({});
    expect((await nyugtazB()).status).toBe(200);
    const injekcio = elavultOlvasas({ tabla: 'route_bookings', id: booking.id, atir: (s) => ({ ...s, paid_at: null }) });
    expect((await nyugtazB()).status).toBe(200);
    expect(injekcio.talalat).toBe(1);
    await varj(120);

    expect(levelek('sendFeeConfirmationEmail', felado.email)).toHaveLength(1);
    expect(levelek('sendBookingPaidEmail', szallito.email)).toHaveLength(1);
    expect(await ertesitesek(szallito.id, 'booking_paid')).toHaveLength(1);
  });
});

// =====================================================================
//  5) A fizetésindítás hibája nem adja ki a belső hibaszöveget
// =====================================================================
describe('A 502-es válasz nem tartalmaz belső részletet', () => {
  const TITOK = 'ECONNREFUSED 10.1.2.3:443 belso-titok@gofuvar.hu';

  it('POST /jobs/:id/pay', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });
    vi.spyOn(paymentProvider, 'startFeePayment').mockRejectedValue(new Error(TITOK));
    const res = await request(app).post(`/jobs/${job.id}/pay`).set(...auth(felado)).send({ consent: true });
    expect(res.status).toBe(502);
    expect(res.body.detail, 'a 502 a nyers belső hibaszöveget adta ki').toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('10.1.2.3');
    expect(res.body.code).toBe('PAYMENT_START_FAILED');
    expect(res.body.error).toMatch(/díjfizetés/i);
  });

  it('POST /bids/:id/accept (a megállapodás indítja a fizetést)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(szallito))
      .send({ amount_huf: 15000, return_policy: 'included' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    vi.spyOn(paymentProvider, 'startFeePayment').mockRejectedValue(new Error(TITOK));
    const res = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(felado)).send(await seenOffer(bid.body.id));
    expect(res.status).toBe(502);
    expect(res.body.detail).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('10.1.2.3');
    expect(res.body.code).toBe('PAYMENT_START_FAILED');
  });
});

// =====================================================================
//  6) Migráció: a meglévő bizonylatok értesítése nyugtázottnak számít
// =====================================================================
describe('094/095 migráció', () => {
  it('a notifications_sent_at oszlop létezik, és a backfill a paid_at-ra állítja a régi sorokat', async () => {
    const { rows: oszlop } = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'fee_payment_receipts' AND column_name = 'notifications_sent_at'`,
    );
    expect(oszlop[0]?.data_type).toBe('timestamp with time zone');

    const paymentId = `pr1-regi-${Date.now()}`;
    await db.query(
      `INSERT INTO fee_payment_receipts (payment_id, fee_huf, paid_at, invoice_pending)
       VALUES ($1, 500, NOW() - INTERVAL '3 days', FALSE)`, [paymentId],
    );
    const sql = readFileSync(`${__dirname}/../db/migrations/095_fee_receipt_notifications_backfill.sql`, 'utf8');
    await db.query(sql);
    const { rows } = await db.query(
      'SELECT paid_at, notifications_sent_at FROM fee_payment_receipts WHERE payment_id = $1', [paymentId],
    );
    expect(new Date(rows[0].notifications_sent_at).getTime()).toBe(new Date(rows[0].paid_at).getTime());
    await db.query('DELETE FROM fee_payment_receipts WHERE payment_id = $1', [paymentId]);
  });
});
