// =====================================================================
//  A LEFEDETTSÉGI KÖR HÁROM TERMÉKKÓD-HIBÁJA (2026-08-12)
//
//  ⚠️ MIND A HÁRMAT AZ ELÁGAZÁS-LEFEDETTSÉG HAJSZOLÁSA HOZTA ELŐ. Ez a
//  legjobb érv amellett, hogy a tesztelő kérése (80% fölé) nem szám-fetisizmus:
//  a fedetlen elágazások TÖBBSÉGE hibaág, és pont ott laknak a néma hibák.
//
//  BUG-1 (MAGAS) — PÁRHUZAMOS AJÁNLAT-ELFOGADÁS → POSTGRES DEADLOCK → 500
//    A tranzakció az AJÁNLAT sorával kezdett, majd a tömeges elutasításnál
//    zárolta a TÖBBIT. Két egyidejű elfogadásnál (dupla kattintás, két fül)
//    körkörös várakozás lett belőle. MÉRVE: a javítás nélkül 3/3 futásban
//    500 jött a szánt 409 helyett — a feladó „Szerverhibát" látott a
//    PÉNZ-ÚTON, és fölösleges Sentry-riasztás ment. A `jobClaim.rowCount === 0`
//    guard emiatt gyakorlatilag HOLT KÓD volt: a deadlock előbb ütött.
//    Javítás: egységes zárolási sorrend — előbb MINDIG a fuvar sora.
//
//  BUG-2 (KÖZEPES) — `pickup_window_start/_end` validálatlanul ment a
//    timestamptz oszlopba: `'nem-datum'` és `99999999999999` egyaránt 500-at
//    adott. Ez sérti a projekt SZ1 szabályát („egyetlen írási végpont sem
//    adhat 500-at rossz inputra").
//    ⚠️ MIÉRT NEM FOGTA MEG A HÜLYEBIZTOS-MÁTRIX: az a saját body-SABLONJÁBAN
//    szereplő mezőket mutálja, és ez a kettő nem volt benne. A mátrix-módszer
//    vakfoltja: a HIÁNYZÓ mezőt nem lehet mutálni.
//
//  BUG-3 (ALACSONY) — a `currency` nyitott értékkészlet volt: a
//    `'HUFHUFHUF…'` és a `12345` is 201-et kapott és eltárolódott. A szemét
//    valuta elindítja az árfolyam-befagyasztást (külső ECB-hívás).
//    A `return_policy` már helyesen zárt volt — a valuta kimaradt mellőle.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
const require = createRequire(import.meta.url);
const { app, db, createUser, createJob } = require('./helpers');
const alap = {
  title: 'Teszt', pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.49, pickup_lng: 19.04,
  dropoff_address: 'Szeged, Fő tér 1.', dropoff_lat: 46.25, dropoff_lng: 20.14,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};
describe('Lefedettségi kör: a három termékkód-hiba', () => {
  it('BUG-2: szemét dátum → 400, nem 500', async () => {
    const u = await createUser({ role: 'shipper' });
    for (const rossz of ['nem-datum', 99999999999999, '0000-00-00', {}]) {
      const res = await request(app).post('/jobs').set('Authorization', `Bearer ${u.token}`)
        .send({ ...alap, pickup_window_start: rossz });
      expect(res.status, `${JSON.stringify(rossz)} → ${res.status}`).toBe(400);
    }
  });
  it('BUG-2 kontroll: ÉRVÉNYES időablak átmegy', async () => {
    const u = await createUser({ role: 'shipper' });
    const holnap = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app).post('/jobs').set('Authorization', `Bearer ${u.token}`)
      .send({ ...alap, pickup_window_start: holnap });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
  it('BUG-3: szemét valuta → 400', async () => {
    const f = await createUser({ role: 'shipper' });
    const sz = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: f.id, status: 'bidding' });
    const res = await request(app).post(`/jobs/${job.id}/bids`).set('Authorization', `Bearer ${sz.token}`)
      .send({ amount_huf: 12000, return_policy: 'included', currency: 'HUFHUFHUF' });
    expect(res.status).toBe(400);
  });
  it('BUG-1: párhuzamos elfogadás → 1 nyertes, NINCS 500', async () => {
    const f = await createUser({ role: 'shipper' });
    const a = await createUser({ role: 'carrier' });
    const b = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: f.id, status: 'bidding' });
    const mk = async (u, ar) => (await request(app).post(`/jobs/${job.id}/bids`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ amount_huf: ar, return_policy: 'included' })).body.id;
    const b1 = await mk(a, 20000); const b2 = await mk(b, 21000);
    const [r1, r2] = await Promise.all([
      request(app).post(`/bids/${b1}/accept`).set('Authorization', `Bearer ${f.token}`).send({}),
      request(app).post(`/bids/${b2}/accept`).set('Authorization', `Bearer ${f.token}`).send({}),
    ]);
    const statuszok = [r1.status, r2.status].sort();
    expect(statuszok.filter(s => s >= 500), `500-at kaptunk: ${statuszok}`).toEqual([]);
    expect(statuszok.filter(s => s === 200).length, `pontosan egy nyertes kell: ${statuszok}`).toBe(1);
  });
});
