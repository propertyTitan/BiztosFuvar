// =====================================================================
//  SZIVÁRGÁS-CSOMAG (2026-08-10, adatáramlási + séma lencse)
//
//  1) PUBLIKUS KÖVETŐ-VÉGPONT — a díj-kapu csak az átvételi kódot és a
//     szállító telefonját védte. Kapu NÉLKÜL ment ki a felvételi cím, a
//     szállító TELJES NEVE és a GPS-pozíció, ráadásul LEJÁRAT NÉLKÜL: lezárt
//     fuvarra is, évekig. Aki valaha megkapta a linket (rossz számra ment
//     SMS, továbbküldött levél, böngésző-előzmény), az tartósan lekérdezte.
//  2) CHAT-ELŐZMÉNY — a `checkAccess` az AKTUÁLIS szállítót nézi, a
//     lekérdezés viszont a TELJES előzményt adta: szállító-csere után az ÚJ
//     szállító elolvasta a LEVÁLTOTT szállító és a feladó beszélgetését.
//  3) ÖTÖDIK ÁRVA-ÚT — a duplikátum-elutasításnál a már feltöltött
//     okmányfotó a bucketben maradt (a 409 DB-írás nélkül tér vissza).
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const storage = require('../src/services/storage');

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
afterEach(() => { vi.restoreAllMocks(); });

async function tokenesFuvar({ paid = true, status = 'in_progress' } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status, paid });
  const token = `trk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db.query(
    `UPDATE jobs SET tracking_token = $2, recipient_name = 'Kovács Anna' WHERE id = $1`,
    [job.id, token],
  );
  return { job, token, felado, szallito };
}

describe('Publikus követő-végpont', () => {
  it('a FELVÉTELI cím nem megy ki (a címzettre nem tartozik a feladó otthona)', async () => {
    const { token } = await tokenesFuvar();
    const res = await request(app).get(`/tracking/${token}`).expect(200);
    expect(
      res.body.pickup_address,
      'a feladó otthoni címe kiment egy bejelentkezés nélkül elérhető végponton',
    ).toBeUndefined();
    expect(res.body.dropoff_address, 'a kézbesítési cím viszont kell a címzettnek').toBeTruthy();
  });

  it('a LEZÁRT fuvar linkje két hét után lejár (410)', async () => {
    const { job, token } = await tokenesFuvar({ status: 'delivered' });
    await db.query(`UPDATE jobs SET delivered_at = NOW() - INTERVAL '30 days' WHERE id = $1`, [job.id]);
    const res = await request(app).get(`/tracking/${token}`);
    expect(
      res.status,
      'a követő-link a kézbesítés után ÉVEKIG kiadta a címeket és a neveket',
    ).toBe(410);
  });

  it('a friss kézbesítés linkje még él (a visszakeresés nem sérül)', async () => {
    const { job, token } = await tokenesFuvar({ status: 'delivered' });
    await db.query(`UPDATE jobs SET delivered_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [job.id]);
    await request(app).get(`/tracking/${token}`).expect(200);
  });
});

describe('Chat-előzmény szállító-csere után', () => {
  // ⚠️ A KÜLDÉS VALÓDI API-HÍVÁSSAL megy, nem nyers SQL-lel. Az első
  // javításnál a fixtúra kézzel írt sort szúrt be, és emiatt a teszt csak a
  // védelem FELÉT mérte: a leváltott szállító üzenetét vizsgálta, a feladóét
  // nem — pedig a feladó éppen a KORÁBBI szállítónak írta, hogy „a kapukód
  // 1234". A valódi úton haladva a fixtúra nem tud eltérni a valóságtól.
  async function beszelgetes() {
    const felado = await createUser({ role: 'shipper' });
    const regi = await createUser({ role: 'carrier' });
    const uj = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: regi.id, status: 'accepted', paid: true });

    await request(app).post('/messages').set(auth(regi.token))
      .send({ job_id: job.id, body: 'Itt a RÉGI szállító, mikor menjek?' }).expect(201);
    await request(app).post('/messages').set(auth(felado.token))
      .send({ job_id: job.id, body: 'A kapukód 1234, a nagymamám egyedül lesz otthon' }).expect(201);

    return { felado, regi, uj, job };
  }

  it('az ÚJ szállító a leváltott szállító üzeneteit NEM látja', async () => {
    const { uj, job } = await beszelgetes();
    await db.query('UPDATE jobs SET carrier_id = $2 WHERE id = $1', [job.id, uj.id]);

    const res = await request(app).get(`/messages?job_id=${job.id}`).set(auth(uj.token)).expect(200);

    expect(
      JSON.stringify(res.body),
      'az ÚJ szállító elolvasta a LEVÁLTOTT szállító üzenetét',
    ).not.toContain('RÉGI szállító');
  });

  it('az ÚJ szállító a FELADÓ korábbi üzeneteit sem látja', async () => {
    const { uj, job } = await beszelgetes();
    await db.query('UPDATE jobs SET carrier_id = $2 WHERE id = $1', [job.id, uj.id]);

    const res = await request(app).get(`/messages?job_id=${job.id}`).set(auth(uj.token)).expect(200);

    expect(
      JSON.stringify(res.body),
      'AZ ELSŐ JAVÍTÁS ITT BUKOTT EL: a feladó a KORÁBBI szállítónak írta a '
      + 'kapukódot, és az átment az újhoz — a szűrés csak a leváltott szállító '
      + 'üzeneteit rejtette el',
    ).not.toContain('kapukód 1234');
  });

  it('a saját beszélgetését mindkét fél változatlanul látja', async () => {
    const { felado, regi, job } = await beszelgetes();

    for (const [ki, token] of [['feladó', felado.token], ['szállító', regi.token]]) {
      const res = await request(app).get(`/messages?job_id=${job.id}`).set(auth(token)).expect(200);
      const szoveg = JSON.stringify(res.body);
      expect(szoveg, `a védelem túl széles: a ${ki} a saját szálát sem látja`).toContain('kapukód 1234');
      expect(szoveg, `a ${ki} nem látja a másik fél üzenetét a saját szálában`).toContain('RÉGI szállító');
    }
  });
});

describe('Ötödik árva-út: duplikátum-elutasítás', () => {
  it('a 409-nél a már feltöltött okmányfotó törlődik a tárolóból', async () => {
    const elso = await createUser({ role: 'carrier' });
    const masodik = await createUser({ role: 'carrier' });
    const okmanyszam = 'EF1122334';
    const hash = require('crypto')
      .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
      .update(okmanyszam).digest('hex');
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, doc_number_hash, hash_algo)
       VALUES ($1, 'id_card', 'private:kyc/elso.jpg', 'approved', $2, 'hmac-sha256')`,
      [elso.id, hash],
    );

    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/MASODIK-FELTOLTES.jpg');
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.95, documentNumber: okmanyszam,
      holder_name: null, likely_copy: false, birthDate: '1990-01-01',
    });

    const res = await request(app).post('/auth/kyc-document').set(auth(masodik.token))
      .field('doc_type', 'id_card').attach('file', JPEG, 'o.jpg');

    expect(res.status).toBe(409);
    expect(
      torles.mock.calls.flat(),
      'ÁRVA: a 409 DB-írás nélkül tér vissza, tehát a feltöltött SZEMÉLYI '
      + 'IGAZOLVÁNY fotóját semmilyen purge nem éri el többé',
    ).toContain('private:kyc/MASODIK-FELTOLTES.jpg');
  });
});
