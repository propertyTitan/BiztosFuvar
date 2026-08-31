// =====================================================================
//  BIZTONSÁGI FEJLÉCEK + KOORDINÁTA-KAPU (Manus biztonsági audit, 2026-08-31)
//
//  SEC-002: az API `X-Powered-By: Express`-t hirdetett (fingerprint), és
//  nem küldött nosniff/frame/referrer fejlécet.
//  SEC-010: az érzékeny (bearer-védett) válaszok cache-elhetők voltak —
//  egy közbenső proxy vagy a böngésző eltárolhatta a profil/KYC-adatot.
//  SEC-009: az árbecslő lat=91 / lng=999 koordinátára is 200-at adott.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser } = require('./helpers');

describe('SEC-002/010 — fejlécek minden API-válaszon', () => {
  it('nincs X-Powered-By, van nosniff + frame-deny + no-store', async () => {
    const user = await createUser();
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by'], 'az Express-fingerprint visszajött').toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(
      res.headers['cache-control'],
      'az érzékeny (bearer-védett) válasz cache-elhető — profil/KYC-adat ragadhat közbenső cache-ben',
    ).toBe('private, no-store, max-age=0');
  });

  it('a publikus végpont is no-store (dinamikus JSON, nincs mit cache-elni)', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
  });

  it('a /uploads statikus út KIVÉTEL — ott nem erőltetünk no-store-t', async () => {
    const res = await request(app).get('/uploads/nem-letezo.jpg');
    // 404 is jó — a lényeg, hogy a no-store fejléc NEM erre az útra van kényszerítve
    expect(res.headers['cache-control'] || '').not.toBe('private, no-store, max-age=0');
  });
});

describe('SEC-009 — az árbecslő koordináta-tartománya', () => {
  const alap = {
    pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_lat: 46.253, dropoff_lng: 20.1414, weight_kg: 5,
  };

  it('tartományon kívüli koordináta → 400, nem hamis becslés', async () => {
    for (const rossz of [
      { pickup_lat: 91 }, { pickup_lat: -91 }, { pickup_lng: 999 },
      { dropoff_lat: 91 }, { dropoff_lng: -181 },
    ]) {
      const res = await request(app).get('/calculator/estimate').query({ ...alap, ...rossz });
      expect(
        res.status,
        `lat/lng tartományon kívül (${JSON.stringify(rossz)}) mégis ${res.status} jött — `
        + 'a hamis „becslés" a konverziós felületen bizalmat rombol',
      ).toBe(400);
    }
  });

  it('érvényes koordinátákra változatlanul megy a becslés', async () => {
    const res = await request(app).get('/calculator/estimate').query(alap);
    expect(res.status).toBe(200);
    expect(res.body.estimate_huf ?? res.body.estimate ?? res.body.min_huf).toBeDefined();
  });
});
