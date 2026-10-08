// =====================================================================
//  UX-ÁTVIZSGÁLÁS (2026-10-08) — a feladói út backend-őrei
//
//  Amit ez a fájl őriz (mindegyik a javítás nélkül piros):
//   1. (A1) Címzett NÉLKÜLI fuvar a feladó saját kódjával zárul → 'sender',
//      NEM 'sender_emergency'. Eddig minden ilyen sikeres kézbesítés
//      „vészhelyzeti kóddal zárult"-ként naplózódott, és a feladói oldal
//      hamis figyelmeztetést mutatott. Címzettel a vészhelyzeti jelölés marad.
//   2. (A13) A vita bizonyíték-hibaüzenete nem utasít lehetetlen lépésre
//      („tölts fel fotót" — a feladó nem tölthet fel bizonyíték-fotót).
//   3. (A12) Az Ajánlataim-lista a KIJELÖLT szállítónak megmondja, fizetve
//      van-e a díj (igaz/hamis, időbélyeg nélkül); a vesztes ajánlattevő ezt
//      sem kapja.
//   4. (A22) Az értesítés-szövegek: nincs „a(z)", magyar idézőjel, és a
//      rövidítés szóhatáron, „…"-tel történik.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, TINY_PNG,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const {
  nevelo, idezet, rovidit, fuvarRef, nagyKezdo,
} = require('../src/utils/ertesitesSzoveg');

beforeEach(() => { __resetRateLimitsForTests(); });

function dropoff({ jobId, token, deliveryCode }) {
  return request(app)
    .post(`/jobs/${jobId}/photos`)
    .set('Authorization', `Bearer ${token}`)
    .field('kind', 'dropoff')
    .field('delivery_code', deliveryCode)
    .attach('file', TINY_PNG, { filename: 'atadas.png', contentType: 'image/png' });
}

describe('A1 — a feladói kód csak címzettnél „vészhelyzeti"', () => {
  it('címzett nélkül a feladó saját kódjával zárt fuvar jelölése „sender"', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    // A feladó maga veszi át: nincs címzett (a helper alapból tölti).
    await db.query('UPDATE jobs SET recipient_name = NULL, recipient_phone = NULL WHERE id = $1', [job.id]);

    const res = await dropoff({ jobId: job.id, token: szallito.token, deliveryCode: '333444' });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT status, closed_by_code_type FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('delivered');
    expect(
      rows[0].closed_by_code_type,
      'címzett nélkül a feladó kódja AZ átvételi kód — a „vészhelyzeti" jelölés hamis vitajelet ad',
    ).toBe('sender');
  });

  it('külön címzettnél a feladói kód továbbra is vészhelyzeti', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await dropoff({ jobId: job.id, token: szallito.token, deliveryCode: '333444' });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT closed_by_code_type FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].closed_by_code_type).toBe('sender_emergency');
  });
});

describe('A13 — a vita bizonyíték-hibája nem küld zsákutcába', () => {
  it('a feladó idegen bizonyíték-URL-jére a hiba nem kér fotó-feltöltést', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const res = await request(app)
      .post('/disputes')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({
        job_id: job.id,
        description: 'A csomag sérülten érkezett meg, a doboz sarka behorpadt.',
        evidence_url: 'https://pub-teszt.r2.dev/nem-ehhez-a-fuvarhoz.jpg',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EVIDENCE_URL');
    expect(
      res.body.error,
      'a feladó nem tölthet fel bizonyíték-fotót — a hiba nem utasíthat erre',
    ).not.toMatch(/tölts fel/i);
    expect(res.body.error).toMatch(/írd le/i);
  });
});

describe('A12 — Ajánlataim: a kijelölt szállító látja a díj állapotát', () => {
  async function ajanlattal({ paid }) {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const vesztes = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy)
       VALUES ($1, $2, 15000, 'accepted', 'included'), ($1, $3, 16000, 'rejected', 'included')`,
      [job.id, szallito.id, vesztes.id],
    );
    return { job, szallito, vesztes };
  }
  async function sorom(user, jobId) {
    const res = await request(app).get('/bids/mine').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    return res.body.find((r) => r.job_id === jobId);
  }

  it('fizetetlen fuvar: job_fee_paid=false, fizetett: true; időbélyeg egyik esetben sem', async () => {
    const fizetetlen = await ajanlattal({ paid: false });
    const a = await sorom(fizetetlen.szallito, fizetetlen.job.id);
    expect(a.job_fee_paid, 'a nyertes nem tudja meg, hogy a díjra vár').toBe(false);
    expect(a.job_paid_at).toBeUndefined();

    const fizetett = await ajanlattal({ paid: true });
    const b = await sorom(fizetett.szallito, fizetett.job.id);
    expect(b.job_fee_paid).toBe(true);
    expect(b.job_paid_at).toBeUndefined();
  });

  it('a vesztes ajánlattevő a másik ügylet díj-állapotát nem kapja meg', async () => {
    const { job, vesztes } = await ajanlattal({ paid: true });
    const sor = await sorom(vesztes, job.id);
    expect(sor).toBeTruthy();
    expect(sor.job_fee_paid, 'a vesztes ajánlattevőre nem tartozik a díj állapota').toBeUndefined();
  });
});

describe('A22 — értesítés-szövegek', () => {
  it('a segédek: névelő, magyar idézőjel, szóhatáros rövidítés', () => {
    expect(nevelo('Íróasztal')).toBe('az');
    expect(nevelo('Kanapé')).toBe('a');
    expect(nevelo('5 doboz')).toBe('az');
    expect(nevelo('2 doboz')).toBe('a');
    // A számot kiolvasva döntünk (fix1-review): egy, ezer, egymillió → „az”;
    // tíz, tizenöt, száz, tízezer → „a”; öt… mindig „az”.
    expect(nevelo('1 db szék')).toBe('az');
    expect(nevelo('10 doboz')).toBe('a');
    expect(nevelo('15 db szék')).toBe('a');
    expect(nevelo('100 kg tégla')).toBe('a');
    expect(nevelo('1000 tégla')).toBe('az');
    expect(nevelo('1 000 tégla')).toBe('az');
    expect(nevelo('12000 tégla')).toBe('a');
    expect(nevelo('1500 kg')).toBe('az');
    expect(nevelo('50 szék')).toBe('az');
    expect(nevelo('500 tégla')).toBe('az');
    expect(nevelo('„10 doboz”')).toBe('a');
    expect(idezet('Kanapé')).toBe('„Kanapé”');
    expect(fuvarRef('Íróasztal')).toBe('az „Íróasztal”');
    expect(fuvarRef('')).toBe('a');
    expect(nagyKezdo(fuvarRef('Kanapé'))).toBe('A „Kanapé”');
    const hosszu = 'Szia! Holnap reggel nyolc és kilenc között tudok jelentkezni a csomagért, ha neked is megfelel';
    const r = rovidit(hosszu, 60);
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.endsWith('…')).toBe(true);
    // Szóhatáron vág: az utolsó szó a forrásban is egész szó.
    const szavak = hosszu.split(' ');
    expect(szavak).toContain(r.slice(0, -1).split(' ').at(-1));
    expect(rovidit('rövid', 60)).toBe('rövid');
  });

  it('az ellenajánlat-értesítés névelővel és magyar idézőjellel szól', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: null, status: 'bidding' });
    await db.query("UPDATE jobs SET title = 'Íróasztal Pécsre' WHERE id = $1", [job.id]);
    const { rows: bid } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, return_policy, job_terms_revision)
       VALUES ($1, $2, 20000, 'included', (SELECT terms_revision FROM jobs WHERE id = $1)) RETURNING id`,
      [job.id, szallito.id],
    );
    const res = await request(app)
      .post(`/bids/${bid[0].id}/counter`)
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ amount: 18000 });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      "SELECT body FROM notifications WHERE user_id = $1 AND type = 'counter_offer' ORDER BY created_at DESC LIMIT 1",
      [szallito.id],
    );
    expect(rows[0].body).not.toMatch(/a\(z\)/i);
    expect(rows[0].body).toContain('az „Íróasztal Pécsre”');
  });

  it('a chat-értesítés előnézete szóhatáron, „…"-tel rövidül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    const szoveg = 'Szia! Holnap reggel nyolc és kilenc között tudok jelentkezni a csomagért a megadott címen, '
      + 'ha neked is megfelel, kérlek jelezz vissza.';
    const res = await request(app)
      .post('/messages')
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ job_id: job.id, body: szoveg });
    expect(res.status).toBe(201);
    const { rows } = await db.query(
      "SELECT body FROM notifications WHERE user_id = $1 AND type = 'chat_message' ORDER BY created_at DESC LIMIT 1",
      [felado.id],
    );
    const elonezet = rows[0].body;
    expect(elonezet.length).toBeLessThanOrEqual(100);
    expect(elonezet.endsWith('…'), `a levágás jelöletlen: „${elonezet}"`).toBe(true);
    expect(szoveg.split(' '), 'szó közepén szakadt meg').toContain(elonezet.slice(0, -1).split(' ').at(-1));
  });
});
