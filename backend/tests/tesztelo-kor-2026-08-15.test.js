// =====================================================================
//  TESZTELŐI KÖR — 2026-08-15
//
//  A tesztelő tizenkét észrevételéből az itt mérhető (backend-oldali)
//  tételek őrei. Mindegyik VISSZAMÉRVE: a javítás nélkül piros.
//
//  ⚠️ A KÖR LEGFONTOSABB TANULSÁGA — ISMÉT UGYANAZ A MINTÁZAT:
//  a „fizetési visszahozó háló" (2026-08-09) a megegyezés utáni értesítést
//  csak arra az ágra építette meg, ahol felfedezték — amikor a SZÁLLÍTÓ
//  fogadja el a feladó ellenajánlatát. A GYAKORI eset a fordítottja (a feladó
//  fogadja el a szállító ajánlatát), és azon az ágon a feladó SEMMIT nem
//  kapott: se in-app értesítést, se e-mailt. Csak egy pár másodperces toastot.
//  „A védelem azon az úton épül meg, ahol felfedezték."
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');

/** Ajánlat felvétele közvetlenül (a helpers nem exportál ilyet). */
async function ajanlat(jobId, carrierId, amountHuf) {
  const { rows } = await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
     VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [jobId, carrierId, amountHuf],
  );
  return rows[0];
}
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

let felado; let szallito;

beforeAll(async () => {
  __resetRateLimitsForTests();
  felado = await createUser({ role: 'shipper' });
  szallito = await createUser({ role: 'carrier', kyc: 'verified' });
});

/**
 * Az adott user értesítései típus szerint — MEGVÁRVA, hogy megérkezzenek.
 *
 * ⚠️ A `notifyDealClosed` fire-and-forget hívás (nincs `await` a kezelőben):
 * a HTTP-válasz hamarabb megjön, mint ahogy az értesítés a DB-be kerül. Fix
 * `sleep` helyett rövid POLLING: gyors gépen azonnal visszatér, lassún pedig
 * nem lesz flaky. (Ha a hiányt mérjük, a teljes türelmi időt kivárja — ez az
 * ára annak, hogy a bukás megbízható legyen.)
 */
async function ertesitesek(userId, tipus, { varakozasMs = 3000 } = {}) {
  const hatarido = Date.now() + varakozasMs;
  let rows = [];
  do {
    ({ rows } = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC',
      [userId, tipus],
    ));
    if (rows.length) return rows;
    await new Promise((r) => { setTimeout(r, 100); });
  } while (Date.now() < hatarido);
  return rows;
}

// ---------------------------------------------------------------------
//  1) MEGEGYEZÉS UTÁN A FELADÓ IS KAP ÉRTESÍTÉST
// ---------------------------------------------------------------------
describe('Megegyezés: a FELADÓ is kap fizetési felszólítást', () => {
  it('a feladó ajánlat-elfogadása után értesítést kap a díjról', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await ajanlat(job.id, szallito.id, 25000);

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/bids/${bid.id}/accept`)
      .set(auth(felado.token));
    expect(res.status).toBeLessThan(400);

    const sorok = await ertesitesek(felado.id, 'payment_due');
    expect(
      sorok.length,
      '⚠️ A FELADÓ SEMMILYEN MARADANDÓ ÉRTESÍTÉST NEM KAPOTT az elfogadás után.\n\n'
      + 'Ez a GYAKORI eset: a feladó elfogadja a szállító ajánlatát. Eddig csak\n'
      + 'egy pár másodpercre felvillanó toast volt — aki elnavigált vagy\n'
      + 'frissített, annak semmi nem maradt a kezében arról, hogy MOST fizetnie\n'
      + 'kell. A harangban sem volt sor, a postaládájában sem levél. A fizetési\n'
      + 'emlékeztető-kör csak 24 óra múlva szólal meg.\n\n'
      + 'A platform EGYETLEN bevétele múlik ezen a lépcsőn.\n\n'
      + '⚠️ A másik ágon (amikor a SZÁLLÍTÓ fogad el ellenajánlatot) ez a\n'
      + 'védelem 2026-08-09 óta megvolt — csak ezen az úton nem.',
    ).toBeGreaterThan(0);

    const sor = sorok[0];
    expect(sor.link, 'az értesítés nem a fuvar oldalára visz').toContain(job.id);
    expect(
      /kapcsolatfelvételi díj/i.test(sor.body),
      'az értesítés nem mondja meg, MIT kell tennie',
    ).toBe(true);
  });

  it('a SZÁLLÍTÓ értesítése változatlanul megy (nem rontottuk el)', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await ajanlat(job.id, szallito.id, 31000);
    __resetRateLimitsForTests();
    await request(app).post(`/bids/${bid.id}/accept`).set(auth(felado.token));

    const sorok = await ertesitesek(szallito.id, 'bid_accepted');
    expect(sorok.length, 'a szállító elvesztette az értesítését').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------
//  2) KÉRDÉS / VÁLASZ ÉRTESÍTÉSEK
// ---------------------------------------------------------------------
describe('Kérdés–válasz: mindkét fél értesül', () => {
  it('kérdésnél a FELADÓ kap értesítést', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    __resetRateLimitsForTests();

    const res = await request(app)
      .post(`/jobs/${job.id}/questions`)
      .set(auth(szallito.token))
      .send({ question: 'Van lift a felvételi címen?' });
    expect(res.status).toBe(201);

    const sorok = await ertesitesek(felado.id, 'job_question');
    expect(
      sorok.length,
      '⚠️ A feladó nem tudja meg, hogy kérdés érkezett a fuvarára.\n\n'
      + 'A kérdés-válasz modul EDDIG NULLA értesítést küldött. Egy\n'
      + 'megválaszolatlan kérdés elviszi a szállítót a fuvartól — közvetlen\n'
      + 'konverzió-veszteség.',
    ).toBeGreaterThan(0);

    expect(
      sorok[0].body.includes('lift'),
      '⚠️ A KÉRDÉS SZÖVEGE bekerült az értesítésbe. Ez szándékosan NEM így\n'
      + 'működik: a notifications sorai hosszan megmaradnak, és a szabad\n'
      + 'szövegben elérhetőség is lehet — a kontakt-szűrő a kérdésre fut, az\n'
      + 'értesítésre nem. A felhasználó egy kattintással elolvassa.',
    ).toBe(false);
  });

  it('válasznál a KÉRDEZŐ kap értesítést', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    __resetRateLimitsForTests();
    const q = await request(app)
      .post(`/jobs/${job.id}/questions`)
      .set(auth(szallito.token))
      .send({ question: 'Mikor lehet felvenni?' });
    expect(q.status).toBe(201);

    __resetRateLimitsForTests();
    const a = await request(app)
      .post(`/questions/${q.body.id}/answer`)
      .set(auth(felado.token))
      .send({ answer: 'Hétköznap délután bármikor.' });
    expect(a.status).toBe(200);

    const sorok = await ertesitesek(szallito.id, 'job_question_answered');
    expect(
      sorok.length,
      '⚠️ A kérdező nem tudja meg, hogy válaszoltak neki. Feltette a kérdést, '
      + 'majd továbblépett — és sosem derül ki számára, hogy megjött a válasz, '
      + 'amire az ajánlattétele épült volna.',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------
//  3) A SZÁMLA-IGÉNY ELJUT A SZÁLLÍTÓHOZ
// ---------------------------------------------------------------------
describe('Számla-igény: a szállító látja ajánlattétel előtt', () => {
  it('az invoice_requested megjelenik a fuvar adatai közt a szállítónak', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query('UPDATE jobs SET invoice_requested = TRUE WHERE id = $1', [job.id]);

    __resetRateLimitsForTests();
    const res = await request(app).get(`/jobs/${job.id}`).set(auth(szallito.token));

    expect(res.status).toBe(200);
    expect(
      res.body.invoice_requested,
      '⚠️ A számla-igény nem jut el a szállítóhoz.\n\n'
      + 'A kápés modellben a fuvardíjról a SZÁLLÍTÓ állít ki számlát (a platform\n'
      + 'csak a kapcsolatfelvételi díjról). Egy magánszemély szállító NEM TUD\n'
      + 'számlát adni — ha ez nem látszik ajánlattétel ELŐTT, a hiány az\n'
      + 'átadásnál derül ki, amikor a csomag már ott van.',
    ).toBe(true);
  });
});
