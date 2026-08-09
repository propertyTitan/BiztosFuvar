// =====================================================================
//  Mentős-kapu (2026-08-09 biztonsági/adatvédelmi audit) — a segélyszolgálat
//  (towing) funkció végpont-biztonsága. A funkció a FELÜLETRŐL kikapcsolva,
//  de a végpontok élnek → launch előtt zárandó, mielőtt bekapcsolható.
//
//  Két rés zárva:
//   (1) mentőssé válni CSAK identity-KYC-vel lehet (nem egy kattintással)
//   (2) a bajba jutott TELJES telefonja + PONTOS GPS-e csak az ELVÁLLALÁS
//       után jár — a listában közelítő hely + probléma-típus + távolság
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

describe('Mentőssé válni csak azonosítottként (identity-KYC)', () => {
  it('KYC nélküli user NEM regisztrálhat mentősnek', async () => {
    const nincsKyc = await createUser({ role: 'carrier', kyc: 'pending' });
    const res = await request(app).post('/towing/register').set(auth(nincsKyc.token))
      .send({ tow_services: ['breakdown'], tow_vehicle_description: 'Ford' });
    expect(res.status).toBe(403);
  });

  it('KYC-verified user regisztrálhat', async () => {
    const kycOk = await createUser({ role: 'carrier', kyc: 'verified' });
    const res = await request(app).post('/towing/register').set(auth(kycOk.token))
      .send({ tow_services: ['breakdown'], tow_vehicle_description: 'Ford' });
    expect(res.status).toBe(200);
    expect(res.body.is_tow_driver).toBe(true);
  });
});

describe('A bajba jutott érzékeny adata csak az elvállalás UTÁN jár', () => {
  it('GET /towing/incoming — nincs teljes telefon és pontos GPS a listában', async () => {
    // Bajba jutott, valós GPS + telefon
    const bajban = await createUser({ role: 'shipper' }); // phone: +36201234567
    await request(app).post('/towing/request').set(auth(bajban.token)).send({
      lat: 47.4979, lng: 19.0402, issue_type: 'breakdown', vehicle_type: 'car',
      search_radius_km: 50,
    });

    // Egy azonosított mentős lekéri a közeli kéréseket
    const mentos = await createUser({ role: 'carrier', kyc: 'verified' });
    await request(app).post('/towing/register').set(auth(mentos.token))
      .send({ tow_services: ['breakdown'] });
    const res = await request(app).get('/towing/incoming?lat=47.50&lng=19.04').set(auth(mentos.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    for (const r of res.body) {
      // A koronaékszerek NEM járnak elvállalás előtt:
      expect(r.requester_phone, 'a bajba jutott TELJES telefonja zárt').toBeUndefined();
      expect(r.lat, 'a PONTOS GPS zárt').toBeUndefined();
      expect(r.lng).toBeUndefined();
      expect(r.requester_name, 'a teljes név zárt').toBeUndefined();
      // Ami jár (a döntéshez elég): közelítő hely + keresztnév + probléma + távolság
      expect(r).toHaveProperty('approx_lat');
      expect(r).toHaveProperty('issue_type');
      // A közelítő hely tényleg kerekített (~1 km), nem a pontos
      if (r.approx_lat != null) {
        expect(Number.isInteger(r.approx_lat * 100)).toBe(true);
      }
    }
  });
});
