import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer, TINY_PNG } = require('./helpers');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());

async function accept(job, carrier, shipper, amount) {
  const offer = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({ amount_huf: amount, return_policy: 'included' });
  expect(offer.status, JSON.stringify(offer.body)).toBe(201);
  const accepted = await request(app).post(`/bids/${offer.body.id}/accept`).set(...auth(shipper)).send(await seenOffer(offer.body.id));
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
}

it.each(['gps-read', 'photos-read', 'gps-write'])('carrier replacement: an in-flight %s cannot reach the new agreement', async kind => {
  const shipper = await createUser(), oldCarrier = await createUser({ role: 'carrier' }), nextCarrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', paid: true });
  await accept(job, oldCarrier, shipper, 15000);
  const query = db.query, captured = gate(), resume = gate();
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    const accessQuery = kind === 'gps-write'
      ? String(sql).includes('SELECT j.carrier_id, j.shipper_id, j.status, j.dropoff_lat')
      : (String(sql) === 'SELECT shipper_id, carrier_id FROM jobs WHERE id = $1' || String(sql).includes('SELECT j.id, (j.shipper_id = $2'));
    if (!paused && accessQuery && args[0]?.[0] === job.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  // Az olvasásnál a jogosultságot tartalmazó DB-eredmény után várunk.
  // Az új írás már zárol: ennél az első (felhasználó-) zár megszerzése ELŐTT
  // késleltetjük a kérést. A régi, zár nélküli út fenti kapuja a hiba
  // eredeti reprodukciója; az új út a visszavonást követő írást ellenőrzi.
  const clientQuery = require('pg').Client.prototype.query;
  vi.spyOn(require('pg').Client.prototype, 'query').mockImplementation(function (sql, ...args) {
    if (kind === 'gps-write' && !paused && String(sql) === 'SELECT id FROM users WHERE id = $1 FOR UPDATE' && args[0]?.[0] === oldCarrier.id) {
      paused = true; captured.resolve();
      return resume.promise.then(() => clientQuery.call(this, sql, ...args));
    }
    return clientQuery.call(this, sql, ...args);
  });
  const oldRequest = kind === 'gps-write'
    ? request(app).post(`/jobs/${job.id}/location`).set(...auth(oldCarrier)).send({ lat: 48.123456, lng: 20.654321 }).then(r => r)
    : request(app).get(`/jobs/${job.id}/${kind === 'gps-read' ? 'location/last' : 'photos'}`).set(...auth(oldCarrier)).then(r => r);
  await captured.promise;
  let newPhoto;
  try {
    expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
    await accept(job, nextCarrier, shipper, 17000);
    expect((await request(app).post(`/jobs/${job.id}/location`).set(...auth(nextCarrier)).send({ lat: 47.481234, lng: 19.051234 })).status).toBe(200);
    vi.spyOn(require('../src/services/pickupNotifications'), 'dispatchPickupNotifications').mockImplementation(() => {});
    const photo = await request(app).post(`/jobs/${job.id}/photos`).set(...auth(nextCarrier))
      .field('kind', 'pickup').field('gps_lat', '47.481234').field('gps_lng', '19.051234').attach('file', TINY_PNG, 'private-proof.png');
    expect(photo.status, JSON.stringify(photo.body)).toBe(201); newPhoto = photo.body.photo;
  } finally { resume.resolve(); }
  const response = await oldRequest;
  const freshGps = await request(app).get(`/jobs/${job.id}/location/last`).set(...auth(oldCarrier));
  expect(freshGps.status).toBe(403);
  const freshPhotos = await request(app).get(`/jobs/${job.id}/photos`).set(...auth(oldCarrier));
  expect(freshPhotos.body.some(p => p.id === newPhoto.id)).toBe(false);
  if (kind === 'gps-read') expect(response.body?.lat, 'The replaced carrier received the new carrier GPS.').not.toBe(47.481234);
  if (kind === 'photos-read') expect(response.body.some(p => p.id === newPhoto.id), 'The replaced carrier received a proof photo created after revocation.').toBe(false);
  if (kind === 'gps-write') {
    expect((await db.query('SELECT 1 FROM location_pings WHERE job_id=$1 AND carrier_id=$2', [job.id, oldCarrier.id])).rowCount,
      'The replaced carrier inserted a position into the new agreement.').toBe(0);
  }
});

it.each(['delivered', 'cancelled'])('a physically %s job under dispute rejects further GPS writes', async physicalStatus => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'disputed', paid: true });
  await db.query('UPDATE jobs SET status_before_dispute=$2 WHERE id=$1', [job.id, physicalStatus]);
  const response = await request(app).post(`/jobs/${job.id}/location`).set(...auth(carrier)).send({ lat: 47.48, lng: 19.05 });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('JOB_CLOSED');
  expect((await db.query('SELECT 1 FROM location_pings WHERE job_id=$1', [job.id])).rowCount).toBe(0);
});

it('the new carrier does not receive the previous carrier position before sending a first ping', async () => {
  const shipper = await createUser(), oldCarrier = await createUser({ role: 'carrier' }), nextCarrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', paid: true });
  await accept(job, oldCarrier, shipper, 15000);
  expect((await request(app).post(`/jobs/${job.id}/location`).set(...auth(oldCarrier)).send({ lat: 47.48, lng: 19.05 })).status).toBe(200);
  expect((await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({})).status).toBe(200);
  await accept(job, nextCarrier, shipper, 17000);
  const response = await request(app).get(`/jobs/${job.id}/location/last`).set(...auth(nextCarrier));
  expect(response.status).toBe(200);
  expect(response.body).toBeNull();
});
