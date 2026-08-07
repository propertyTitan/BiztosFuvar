// =====================================================================
//  FIZETÉSI WEBHOOK — a pénz-út legkritikusabb pontja
//
//  Miért ez volt a legkomolyabb rés: a kapcsolatfelvételi díj a platform
//  EGYETLEN bevétele, és azt nem a felhasználó kattintása erősíti meg,
//  hanem a fizetésszolgáltató szerver-szerver hívása. Ha ez a végpont rosszul
//  viselkedik, az vagy PÉNZT VESZTÜNK (a fizetés nem rögzül), vagy a
//  felhasználót károsítjuk (kétszer könyveljük), vagy INGYEN ADJUK a
//  szolgáltatást (hamisított „Succeeded" POST).
//
//  A `szerep-lefedettseg` suite kivételként jelölte, mert „a QVIK még stub".
//  Ez viszont csak a QVIK-VÁZRA igaz: a Barion-callback tartalmazza a
//  TÉNYLEGES fizetés-megerősítő logikát (paid_at, escrow-felszabadítás,
//  számla, idempotencia) — és a QVIK élesítésekor épp ezt fogja örökölni
//  (a kód kommentje is közös helperbe szervezést ír elő). Vagyis ezek a
//  tesztek a MOSTANI logikát őrzik, és készen állnak az átállásra.
//
//  ⚠️ Teszt-környezetben a Barion STUB módban van (nincs POS-kulcs), ezért a
//  státusz a body-ból jön. Ez SZÁNDÉKOS: így a pénz-logika tesztelhető külső
//  szolgáltató nélkül. Az éles út (a státusz visszaolvasása a PSP-től) külön
//  tesztet kap lentebb, mockolt providerrel.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

/** Fizetésre váró fuvar: elfogadott ajánlat, díj-sor 'held' állapotban. */
async function fizetesreVaroFuvar({ priceHuf = 15000 } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false, priceHuf,
  });

  const paymentId = `teszt-pay-${job.id}`;
  const { calculateConnectionFee } = require('../src/services/connectionFee');
  const dij = calculateConnectionFee(priceHuf);
  await db.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
     VALUES ($1, $2, 'held', $3, 0, $2)`,
    [job.id, dij, paymentId],
  );
  // A díj-fizetéshez a nyilatkozat is kell (45/2014. 29.§)
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);

  return { felado, szallito, job, paymentId, dij };
}

const webhook = (body) => request(app).post('/payments/barion/callback').send(body);

/** Hány díj-sor van, és milyen állapotban.
 *  (Az `escrow_transactions.job_id` UNIQUE — a dupla terhelés ellen tehát
 *  DB-szintű védelem is van. Ezek a tesztek azt őrzik, hogy az alkalmazás-
 *  logika se próbálkozzon vele, és hogy a constraint hibája ne csapódjon
 *  ki 500-ként a PSP felé.) */
async function dijSorok(jobId) {
  const { rows } = await db.query(
    'SELECT status, amount_huf FROM escrow_transactions WHERE job_id = $1 ORDER BY held_at',
    [jobId],
  );
  return rows;
}

describe('Fizetési webhook: a sikeres fizetés rögzül', () => {
  it('„Succeeded" webhookra a fuvar fizetetté válik és a díj-sor felszabadul', async () => {
    const { job, paymentId, dij } = await fizetesreVaroFuvar();

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'A webhook után a fuvar NEM lett fizetett!').toBeTruthy();

    const sorok = await dijSorok(job.id);
    expect(sorok).toHaveLength(1);
    expect(sorok[0].status, 'A díj-sor nem szabadult fel').toBe('released');
    expect(Number(sorok[0].amount_huf), 'Nem a sávos díj könyvelődött').toBe(dij);
  });

  it('a felek a fizetés után látják egymás elérhetőségét — ezt veszi meg a díj', async () => {
    const { felado, szallito, job, paymentId } = await fizetesreVaroFuvar();

    // Előtte NEM
    const elotte = await request(app).get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(elotte.body.contact, 'KONTAKT-SZIVÁRGÁS fizetés előtt').toBeUndefined();

    await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    for (const [nev, tok] of [['feladó', felado.token], ['szállító', szallito.token]]) {
      const utana = await request(app).get(`/jobs/${job.id}`)
        .set('Authorization', `Bearer ${tok}`);
      expect(
        utana.body.contact,
        `A díj kifizetése után a ${nev} NEM kapta meg a másik elérhetőségét`,
      ).toBeTruthy();
    }
  });
});

describe('Fizetési webhook: idempotencia — a PSP ismételhet', () => {
  it('UGYANAZ a webhook kétszer nem könyvel kétszer', async () => {
    const { job, paymentId } = await fizetesreVaroFuvar();

    const elso = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    const masodik = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    expect(elso.status).toBeLessThan(400);
    // A második is nyugtázva legyen (különben a PSP a végtelenségig ismétel)
    expect(masodik.status, 'A megismételt webhookot elutasítottuk — a PSP újra fogja próbálni').toBeLessThan(400);

    const sorok = await dijSorok(job.id);
    expect(
      sorok.filter((s) => s.status === 'released'),
      `${sorok.length} díj-sor keletkezett — DUPLA KÖNYVELÉS!`,
    ).toHaveLength(1);
  });

  it('tíz párhuzamos webhook is csak EGY terhelést eredményez', async () => {
    const { job, paymentId } = await fizetesreVaroFuvar();

    // A PSP hálózati hiba után rázúdíthat többet egyszerre
    await Promise.all(
      Array.from({ length: 10 }, () => webhook({ PaymentId: paymentId, Status: 'Succeeded' })),
    );

    const sorok = await dijSorok(job.id);
    expect(
      sorok.filter((s) => s.status === 'released').length,
      'Párhuzamos webhookokból többszörös könyvelés lett!',
    ).toBeLessThanOrEqual(1);
  });
});

describe('Fizetési webhook: amit el KELL utasítania', () => {
  it('azonosító nélküli hívás → 400, semmi nem történik', async () => {
    const res = await webhook({ Status: 'Succeeded' });
    expect(res.status).toBe(400);
  });

  it('ismeretlen fizetés-azonosító nem érint egyetlen fuvart sem', async () => {
    const { job } = await fizetesreVaroFuvar();

    const res = await webhook({ PaymentId: 'sosem-letezett-azonosito', Status: 'Succeeded' });
    expect(res.status, 'Ismeretlen azonosítóra 500-at adott').toBeLessThan(500);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'Egy IDEGEN azonosító kifizette ezt a fuvart!').toBeNull();
  });

  it('a MÁSIK fuvar azonosítója nem fizeti ki ezt a fuvart', async () => {
    const a = await fizetesreVaroFuvar();
    const b = await fizetesreVaroFuvar();

    await webhook({ PaymentId: a.paymentId, Status: 'Succeeded' });

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [b.job.id]);
    expect(rows[0].paid_at, 'Az „A" fuvar fizetése kifizette a „B" fuvart is!').toBeNull();
  });

  it('sikertelen/megszakított fizetés NEM teszi fizetetté a fuvart', async () => {
    for (const statusz of ['Canceled', 'Expired', 'Failed', 'Prepared', 'Unknown']) {
      const { job, paymentId } = await fizetesreVaroFuvar();

      const res = await webhook({ PaymentId: paymentId, Status: statusz });
      expect(res.status, `${statusz}: 500-at adott`).toBeLessThan(500);

      const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
      expect(
        rows[0].paid_at,
        `A(z) „${statusz}" státuszú fizetés FIZETETTÉ tette a fuvart!`,
      ).toBeNull();

      const sorok = await dijSorok(job.id);
      expect(
        sorok.every((s) => s.status !== 'released'),
        `A(z) „${statusz}" státusznál felszabadult a díj-sor!`,
      ).toBe(true);
    }
  });

  it('szemét body-ra sem omlik össze (a PSP is küldhet váratlant)', async () => {
    const szemet = [
      {},
      { PaymentId: null },
      { PaymentId: 12345, Status: 'Succeeded' },
      { PaymentId: { $ne: null }, Status: 'Succeeded' },
      { PaymentId: 'x'.repeat(5000), Status: 'Succeeded' },
      { PaymentId: "' OR '1'='1", Status: 'Succeeded' },
    ];
    for (const body of szemet) {
      const res = await webhook(body);
      expect(
        res.status,
        `Szemét webhook 500-at okozott: ${JSON.stringify(body).slice(0, 80)}`,
      ).toBeLessThan(500);
    }
  });
});

describe('Fizetési webhook: a hamisítás elleni védelem', () => {
  it('éles módban a státuszt a PSP-től olvassa vissza, nem a body-ból hiszi', async () => {
    // A támadó „Succeeded"-et POST-ol, de a PSP szerint a fizetés MEGSZAKADT.
    // A kódnak a PSP-t kell hinnie, különben ingyen adnánk a szolgáltatást.
    const barion = require('../src/services/barion');
    const eredetiIsStub = barion.isStub;
    const eredetiGetState = barion.getPaymentState;

    const { job, paymentId } = await fizetesreVaroFuvar();
    barion.isStub = () => false;                       // „éles" mód
    barion.getPaymentState = async () => ({ Status: 'Canceled' });  // a PSP igazsága

    try {
      const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
      expect(res.status).toBeLessThan(500);

      const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
      expect(
        rows[0].paid_at,
        'HAMISÍTOTT „Succeeded" POST kifizette a fuvart — a kód a body-nak hitt, nem a PSP-nek!',
      ).toBeNull();
    } finally {
      barion.isStub = eredetiIsStub;
      barion.getPaymentState = eredetiGetState;
    }
  });

  it('ha a PSP nem elérhető, NEM könyvelünk — inkább újrapróbálást kérünk', async () => {
    const barion = require('../src/services/barion');
    const eredetiIsStub = barion.isStub;
    const eredetiGetState = barion.getPaymentState;

    const { job, paymentId } = await fizetesreVaroFuvar();
    barion.isStub = () => false;
    barion.getPaymentState = async () => { throw new Error('hálózati hiba'); };

    try {
      const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
      // 5xx itt HELYES: a PSP így tudja, hogy ismételnie kell
      expect(res.status, 'A PSP-hiba után nem kértünk újrapróbálást').toBeGreaterThanOrEqual(500);

      const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
      expect(rows[0].paid_at, 'Ellenőrizetlen állapottal könyveltünk!').toBeNull();
    } finally {
      barion.isStub = eredetiIsStub;
      barion.getPaymentState = eredetiGetState;
    }
  });
});

describe('QVIK callback (még váz)', () => {
  it('nyugtázza a hívást, hogy a PSP ne ismételgesse', async () => {
    const res = await request(app).post('/payments/qvik/callback')
      .send({ paymentId: 'teszt', status: 'SUCCESS' });
    expect(res.status).toBeLessThan(400);
  });

  it('szemét bodyra sem omlik össze', async () => {
    for (const body of [{}, { paymentId: null }, { a: 'x'.repeat(3000) }]) {
      const res = await request(app).post('/payments/qvik/callback').send(body);
      expect(res.status).toBeLessThan(500);
    }
  });

  // ⚠️ ÉLESÍTÉSKOR: amikor a qvik.js feldolgozása bekerül, az itteni
  // Barion-tesztek mintájára KELL rá írni a teljes kört (sikeres fizetés,
  // idempotencia, hamisítás-védelem, ismeretlen azonosító). A
  // szerep-lefedettseg KIVETELEK listájáról ekkor törlendő a bejegyzés.
});
