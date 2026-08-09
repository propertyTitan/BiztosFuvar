// =====================================================================
//  A 2026-08-09-i biztonsági (PII) audit három KRITIKUS szivárgásának
//  regressziós tesztje. Mindhárom a "koronaékszereket" (átvételi kód +
//  címzett-telefon + tracking token) adta ki fizetés nélkül.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

describe('Publikus tracking: a szállító telefonja + a kód csak fizetés után', () => {
  it('paid_at ELŐTT a /tracking/:token NEM adja a carrier.phone-t és a delivery_code-ot', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    // A tracking token publikus (auth nélkül hívható)
    const res = await request(app).get(`/tracking/${job.tracking_token}`);
    expect(res.status).toBe(200);
    expect(res.body.carrier).toBeTruthy();
    expect(res.body.carrier.name, 'a szállító neve mehet').toBeTruthy();
    expect(res.body.carrier.phone, 'fizetés előtt a szállító TELEFONJA zárt').toBeNull();
    expect(res.body.delivery_code, 'fizetés előtt az átvételi kód zárt').toBeNull();
  });

  it('paid_at UTÁN a telefon és a kód jár (a legitim címzett post-pay kapja a linket)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await request(app).get(`/tracking/${job.tracking_token}`);
    expect(res.body.carrier.phone).toBe('+36201234567');
    expect(res.body.delivery_code).toBe('111222');
  });
});

describe('along-jobs + backhaul: a nyers fuvarsor SCRUBBOLVA jut a szállítóhoz', () => {
  // Egy szállító böngészi az útba eső / visszafuvar jelölteket — ezek IDEGEN
  // fuvarok, tehát a scrub kívülálló-ága kell fusson (nincs kód/PII/token).
  async function passzoloFuvar(feladoId) {
    // BP → Szeged, bidding — a geo-matching befogadja a BP-Szeged járatot
    return createJob({
      shipperId: feladoId, status: 'bidding',
      pickupAddress: 'Budapest', dropoffAddress: 'Szeged',
    });
  }

  it('GET /carrier-routes/:id/along-jobs — nincs delivery_code / recipient_phone / tracking_token', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await passzoloFuvar(felado.id);

    // A szállító létrehoz egy BP→Szeged járatot
    const routeRes = await request(app).post('/carrier-routes').set(auth(szallito.token)).send({
      title: 'BP-Szeged járat',
      departure_at: new Date(Date.now() + 86400000).toISOString(),
      waypoints: [{ lat: 47.4979, lng: 19.0402 }, { lat: 46.2530, lng: 20.1414 }],
      prices: [{ size: 'M', price_huf: 5000 }],
    });
    expect(routeRes.status).toBe(201);

    const res = await request(app).get(`/carrier-routes/${routeRes.body.id}/along-jobs`).set(auth(szallito.token));
    expect(res.status).toBe(200);
    // A találatok (ha vannak) SOHA nem tartalmazhatnak érzékeny mezőt
    for (const j of res.body.jobs || []) {
      expect(j).not.toHaveProperty('delivery_code');
      expect(j).not.toHaveProperty('sender_delivery_code');
      expect(j).not.toHaveProperty('tracking_token');
      expect(j).not.toHaveProperty('recipient_phone');
      expect(j).not.toHaveProperty('recipient_email');
    }
  });

  it('GET /backhaul/for-trip/:jobId — nincs érzékeny mező a jelöltekben', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await passzoloFuvar(felado.id);
    // A szállítónak kell egy aktív (accepted) A→B fuvara
    const trip = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
      pickupAddress: 'Budapest', dropoffAddress: 'Szeged',
    });
    const res = await request(app).get(`/backhaul/for-trip/${trip.id}`).set(auth(szallito.token));
    expect(res.status).toBe(200);
    for (const c of res.body.candidates || []) {
      expect(c).not.toHaveProperty('delivery_code');
      expect(c).not.toHaveProperty('tracking_token');
      expect(c).not.toHaveProperty('recipient_phone');
    }
  });
});
