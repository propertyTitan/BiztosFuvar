import { describe, it, expect } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob } = require('./helpers');
const { findBackhaulCandidates } = require('../src/services/backhaul');
const auth = u => ({ Authorization: `Bearer ${u.token}` });

async function fixture() {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const trip = await createJob({ shipperId: shipper.id, carrierId: carrier.id });
  await db.query('UPDATE jobs SET pickup_lat = 46, pickup_lng = 20, dropoff_lat = 47.5, dropoff_lng = 19.04 WHERE id = $1', [trip.id]);
  const candidate = await createJob({ shipperId: shipper.id, status: 'bidding' });
  await db.query('UPDATE jobs SET pickup_lat = 47.5004, pickup_lng = 19.0404, dropoff_lat = 46.0004, dropoff_lng = 20.0004 WHERE id = $1', [candidate.id]);
  return { carrier, trip, candidate };
}
const metrics = c => ({ pickup: c.backhaul_pickup_from_dest_km, dropoff: c.backhaul_drop_from_origin_km, score: c.backhaul_score });

describe('Audit 6 — visszafuvar helyadatvédelme', () => {
  it.each(['for-trip', 'suggestions'])('%s: a koordináta mögötti finomabb pontosság nem jut ki távolságként vagy pontszámként', async endpoint => {
    const { carrier, trip, candidate } = await fixture();
    const load = async () => {
      const r = await request(app).get(endpoint === 'for-trip' ? `/backhaul/for-trip/${trip.id}` : '/backhaul/suggestions').set(auth(carrier));
      expect(r.status).toBe(200);
      const candidates = endpoint === 'for-trip' ? r.body.candidates : r.body.groups.find(g => g.trip_id === trip.id).candidates;
      return candidates.find(c => c.id === candidate.id);
    };
    const first = await load();
    expect(first).toBeTruthy();
    expect(metrics(first)).toEqual({ pickup: 0, dropoff: 0, score: 100 });
    expect(first).not.toHaveProperty('delivery_code');
    await db.query('UPDATE jobs SET pickup_lat = 47.4996, pickup_lng = 19.0396, dropoff_lat = 45.9996, dropoff_lng = 19.9996 WHERE id = $1', [candidate.id]);
    expect(metrics(await load())).toEqual(metrics(first));
  });

  it('20 méteres sugárnál a SQL-előszűrés is a kerekített pontot használja', async () => {
    const { carrier, candidate } = await fixture();
    const params = { originLat: 46, originLng: 20, destLat: 47.5, destLng: 19.04, carrierId: carrier.id, radiusKm: 0.02 };
    expect((await findBackhaulCandidates(params)).map(c => c.id)).toContain(candidate.id);
    await db.query('UPDATE jobs SET pickup_lat = 47.5006 WHERE id = $1', [candidate.id]);
    expect((await findBackhaulCandidates(params)).map(c => c.id)).not.toContain(candidate.id);
  });

  it('a fizetetlen kiinduló fuvar rejtett koordinátája és házszáma sem kerül ki', async () => {
    const { carrier, trip, candidate } = await fixture();
    await db.query('UPDATE jobs SET pickup_lat = 46.0004, pickup_lng = 20.0004, dropoff_lat = 47.5004, dropoff_lng = 19.0404 WHERE id = $1', [trip.id]);
    const r = await request(app).get('/backhaul/suggestions').set(auth(carrier));
    const group = r.body.groups.find(g => g.trip_id === trip.id);
    expect(metrics(group.candidates.find(c => c.id === candidate.id))).toEqual({ pickup: 0, dropoff: 0, score: 100 });
    expect(group.trip_pickup_address).not.toContain('1.');
    expect(group.trip_dropoff_address).not.toContain('2.');
    await db.query('UPDATE jobs SET paid_at = NOW() WHERE id = $1', [trip.id]);
    const paid = await request(app).get('/backhaul/suggestions').set(auth(carrier));
    expect(paid.body.groups.find(g => g.trip_id === trip.id).trip_pickup_address).toBe(trip.pickup_address);
  });
});
