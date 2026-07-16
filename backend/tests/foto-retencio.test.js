// Fuvar-fotó retenció (2026-07-16 user-döntés) — a szabály gépi őrzése:
//   - lezárt fuvar pickup/dropoff fotója 30 nap után törlődik
//   - vitás/zárolt fuvar fotója MARAD (5 évig; 5 év után az is törlődik)
//   - friss lezárás (<30 nap) fotója marad
//   - 'listing' fotót a purge nem érint
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db, createUser } = require('./helpers');
const { purgeOldDeliveryPhotos } = require('../src/services/photoRetention');

// data: URL — a deleteFile-nak nincs tároló-dolga vele, a sor-törlés a lényeg
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

async function insertJob({ shipperId, carrierId, status, ageDays, hold = false }) {
  const { rows } = await db.query(
    `INSERT INTO jobs (shipper_id, carrier_id, title, description,
        pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
        suggested_price_huf, status, photo_retention_hold,
        created_at, updated_at)
     VALUES ($1,$2,'retenció teszt','x','A',47.5,19.0,'B',46.2,20.1,
        10000,$3,$4, NOW() - ($5 || ' days')::interval, NOW() - ($5 || ' days')::interval)
     RETURNING id`,
    [shipperId, carrierId, status, hold, ageDays],
  );
  return rows[0].id;
}

async function insertPhoto(jobId, kind, uploaderId) {
  const { rows } = await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1,$2,$3,$4) RETURNING id`,
    [jobId, uploaderId, kind, DATA_URL],
  );
  return rows[0].id;
}

async function photoExists(id) {
  const { rows } = await db.query('SELECT 1 FROM photos WHERE id = $1', [id]);
  return rows.length > 0;
}

describe('Fuvar-fotó retenció (30 nap / zárolva 5 év)', () => {
  let shipper, carrier;
  beforeAll(async () => {
    shipper = await createUser();
    carrier = await createUser('carrier');
  });

  it('lezárt fuvar 31 napos pickup+dropoff fotója törlődik', async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 31 });
    const p1 = await insertPhoto(jobId, 'pickup', carrier.id);
    const p2 = await insertPhoto(jobId, 'dropoff', carrier.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p1)).toBe(false);
    expect(await photoExists(p2)).toBe(false);
  });

  it('friss (10 napos) lezárás fotója MARAD', async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 10 });
    const p = await insertPhoto(jobId, 'pickup', carrier.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p)).toBe(true);
  });

  it('zárolt (vitás) fuvar 31 napos fotója MARAD; 5 évnél idősebb zárolt viszont törlődik', async () => {
    const held = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'disputed', ageDays: 31, hold: true });
    const pHeld = await insertPhoto(held, 'dropoff', carrier.id);

    const ancient = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 5 * 365 + 10, hold: true });
    const pAncient = await insertPhoto(ancient, 'dropoff', carrier.id);

    await purgeOldDeliveryPhotos();
    expect(await photoExists(pHeld)).toBe(true);
    expect(await photoExists(pAncient)).toBe(false);
  });

  it("a 'listing' fotót a purge nem érinti (csak pickup/dropoff)", async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 60 });
    const p = await insertPhoto(jobId, 'listing', shipper.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p)).toBe(true);
  });

  it('a vita-nyitás automatikusan zárol (photo_retention_hold=TRUE)', async () => {
    const { app } = require('./helpers');
    const request = require('supertest');
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 1 });
    const res = await request(app)
      .post('/disputes')
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ job_id: jobId, description: 'retenció-teszt vita' });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [jobId]);
    expect(rows[0].photo_retention_hold).toBe(true);
  });
});
