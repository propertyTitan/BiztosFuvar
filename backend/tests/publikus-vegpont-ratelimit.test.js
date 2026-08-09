// =====================================================================
//  A publikus végpontok a rate limiter MÖGÖTT vannak — regressziós őr.
//
//  Miért kellett (2026-08-09, a k6 load-teszt találata): a /coverage/zones
//  és az /uploads static a globalRateLimit ELÉ csúszott az index.js-ben
//  (a /health mellé), ezért korlátlanul, IP-limit nélkül lehetett hívni.
//  A /health-nek ott a helye (monitoring), de a többi publikus végpontnak
//  a limiter mögött KELL lennie.
//
//  Az őr determinisztikus jele: a limiter MINDEN lefutásakor beállítja az
//  `X-RateLimit-Limit` fejlécet. Ha egy végpont válaszában OTT a fejléc, a
//  limiter lefutott rá (mögötte van); ha NINCS, a végpont a limiter előtt
//  ül. Egyetlen kérésből eldönthető — nem kell 300-at kilőni.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob } = require('./helpers');

describe('Publikus végpontok a rate limiter mögött', () => {
  it('a /coverage/zones a limiter MÖGÖTT van (van X-RateLimit fejléc)', async () => {
    const res = await request(app).get('/coverage/zones');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('a /calculator/estimate a limiter mögött van (kontroll — mindig is ott volt)', async () => {
    const res = await request(app).get(
      '/calculator/estimate?pickup_lat=47.5&pickup_lng=19.0&dropoff_lat=46.2&dropoff_lng=20.1&weight_kg=10',
    );
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('a nyilvános követés (/tracking/:token) a limiter mögött van', async () => {
    const shipper = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await request(app).get(`/tracking/${job.tracking_token}`);
    // A státusz lehet 200 vagy 404 (a token-feloldástól függ) — a lényeg,
    // hogy a limiter lefutott rá.
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('a /health SZÁNDÉKOSAN a limiter ELŐTT van (nincs X-RateLimit fejléc)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    // Ha egyszer ide is kerül fejléc, az azt jelenti, hogy a health a
    // limiter mögé került — az a monitoringot fojtaná, tehát HIBA lenne.
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
