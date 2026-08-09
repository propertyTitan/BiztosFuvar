// =====================================================================
//  A SEGÉLYSZOLGÁLAT (towing) ALAPBÓL KI VAN KAPCSOLVA
//
//  Audit-találat (2026-08-09, 2. kör, KRITIKUS — pénz-integritás). A flow a
//  felületről dormant volt, a VÉGPONTOK viszont élesen be voltak kötve, és
//  ez a legnagyobb bevétel-kockázat a rendszerben:
//
//    a towing-ág SEHOL nem szed kapcsolatfelvételi díjat, elvállaláskor
//    viszont a bajba jutott azonnal megkapja a mentős TELJES NEVÉT és
//    TELEFONSZÁMÁT.
//
//  Vagyis egy KYC-s szállító egyszer regisztrál mentősként, és onnantól
//  minden fuvarát ezen a csatornán intézheti — a platform egyetlen bevétele
//  (500/1.000 Ft × minden fuvar) korlátlanul megkerülhető.
//
//  A kapcsoló (`TOWING_ENABLED`) élesben nincs beállítva → 503. Teszt alatt
//  BE van kapcsolva (env-setup.js), hogy a funkció biztonsági tesztjei
//  (KYC-kapu, lista-scrub, közelítő hely) továbbra is fussanak — a védelem
//  így nem rohad el holt kódként, amíg a funkció alszik.
// =====================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { app, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { process.env.TOWING_ENABLED = 'true'; });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Towing: a kapcsoló nélkül minden végpont zárva', () => {
  it('a kikapcsolt funkció egyetlen végpontja sem szolgál ki', async () => {
    process.env.TOWING_ENABLED = '';
    const user = await createUser({ role: 'carrier' });

    const hivasok = [
      request(app).post('/towing/request').set(auth(user.token))
        .send({ lat: 47.5, lng: 19.05, issue_type: 'breakdown' }),
      request(app).get('/towing/my-requests').set(auth(user.token)),
      request(app).post('/towing/register').set(auth(user.token)).send({ tow_services: ['breakdown'] }),
      request(app).get('/towing/incoming').set(auth(user.token)),
      request(app).post('/towing/toggle-available').set(auth(user.token)).send({ available: true }),
    ];

    for (const hivas of hivasok) {
      const res = await hivas;
      expect(res.status, `A KIKAPCSOLT funkció kiszolgált egy kérést! (${res.status})`).toBe(503);
      expect(res.body.code).toBe('TOWING_DISABLED');
    }
  });

  it('a kikapcsolás nem érinti a többi végpontot', async () => {
    process.env.TOWING_ENABLED = '';
    const user = await createUser({ role: 'shipper' });

    // A towing-router a gyökérre van mountolva — a guardnak CSAK a /towing/*
    // utakra szabad hatnia, különben az egész API-t lekapcsolná.
    const me = await request(app).get('/auth/me').set(auth(user.token));
    expect(me.status, 'a towing-guard más végpontot is blokkolt!').toBe(200);

    const jobs = await request(app).get('/jobs?status=bidding').set(auth(user.token));
    expect(jobs.status).toBe(200);
  });

  it('bekapcsolva viszont működik (a biztonsági tesztek futhatnak)', async () => {
    process.env.TOWING_ENABLED = 'true';
    const user = await createUser({ role: 'shipper' });

    const res = await request(app).get('/towing/my-requests').set(auth(user.token));
    expect(res.status).toBe(200);
  });
});
