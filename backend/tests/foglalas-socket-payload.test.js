// =====================================================================
//  A FOGLALÁS SOCKET-ESEMÉNYE IS A DÍJ-KAPU MÖGÖTT (2026-09-11)
//
//  Codex-audit P0-02: a `route-bookings:new` esemény a szállítónak a NYERS,
//  házszámos címet küldte a díj kifizetése előtt, miközben a REST-válasz
//  helyesen utca-szintre vágott (GF-008). A PII-őrök a socket-SZOBÁKBA
//  belépést mérték, a PAYLOAD-ot nem — ez a teszt a payloadot méri.
// =====================================================================
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const realtime = require('../src/realtime');

describe('route-bookings:new socket-payload', () => {
  it('fizetés előtt csak utca-szintű címet és semmilyen kódot/címzettet nem visz', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    const { rows: r } = await db.query(
      `INSERT INTO carrier_routes (carrier_id, title, departure_at, status)
       VALUES ($1, 'Teszt járat', NOW() + INTERVAL '1 day', 'open') RETURNING id`,
      [carrier.id],
    );
    await db.query(
      `INSERT INTO carrier_route_prices (route_id, size, price_huf) VALUES ($1, 'M', 12000)`,
      [r[0].id],
    );
    const kem = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});
    try {
      const res = await request(app)
        .post(`/carrier-routes/${r[0].id}/bookings`)
        .set('Authorization', `Bearer ${shipper.token}`)
        .send({
          length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
          pickup_address: 'Budapest, Váci út 12., 1134',
          pickup_lat: 47.5123456, pickup_lng: 19.0567891,
          dropoff_address: 'Szeged, Kárász utca 7., 6720',
          dropoff_lat: 46.2530123, dropoff_lng: 20.1414567,
          recipient_name: 'Címzett Címzett', recipient_phone: '+36301112233',
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const hivas = kem.mock.calls.find((c) => c[1] === 'route-bookings:new');
      expect(hivas, 'nem ment ki route-bookings:new esemény a szállítónak').toBeTruthy();
      expect(String(hivas[0])).toBe(String(carrier.id));
      const payload = hivas[2];
      expect(payload.pickup_address, 'HÁZSZÁM a socket-payloadban fizetés előtt').not.toMatch(/\b12\b/);
      expect(payload.dropoff_address, 'HÁZSZÁM a socket-payloadban fizetés előtt').not.toMatch(/\b7\b/);
      expect(payload.pickup_address).toMatch(/Váci út/);
      for (const tiltott of ['delivery_code', 'tracking_token', 'recipient_name', 'recipient_phone', 'recipient_email', 'notes']) {
        expect(payload, `${tiltott} a socket-payloadban`).not.toHaveProperty(tiltott);
      }
    } finally {
      kem.mockRestore();
    }
  });
});
