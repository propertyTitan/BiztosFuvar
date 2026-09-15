import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const storage = require('../src/services/storage');
const retention = require('../src/services/retention');
const auth = (u) => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());

async function evidence(type) {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true };
  const row = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const field = type === 'job' ? 'job_id' : 'booking_id';
  await db.query(`UPDATE ${table} SET delivered_at = NOW() - INTERVAL '31 days'
    ${type === 'job' ? ", updated_at = NOW() - INTERVAL '31 days'" : ''} WHERE id = $1`, [row.id]);
  const key = `private:retention-proof-${row.id}`;
  const photo = (await db.query(`INSERT INTO photos(${field}, uploader_id, kind, url)
    VALUES($1,$2,'dropoff',$3) RETURNING id`, [row.id, carrier.id, key])).rows[0];
  return { shipper, key, photo, table, entity: { [field]: row.id } };
}

it.each(['job', 'booking'])('%s: az előválogatás után megnyitott vita és admin-hold is megőrzi a fotót', async (type) => {
  for (const method of ['dispute', 'admin']) {
    const { shipper, key, photo, entity } = await evidence(type);
    const admin = await createUser({ role: 'admin' });
    const selected = gate(); const release = gate();
    const realQuery = db.query;
    const spy = vi.spyOn(db, 'query').mockImplementation(async (sql, args) => {
      const result = await realQuery(sql, args);
      if (String(sql).includes('SELECT p.id, p.url') && String(sql).includes('JOIN route_bookings')) {
        selected.resolve(); await release.promise;
      }
      return result;
    });
    const objects = new Set([key]);
    const remove = vi.spyOn(storage, 'deleteFile').mockImplementation(async k => { objects.delete(k); return true; });
    const purge = retention.purgeOldDeliveryPhotos();
    try {
      await selected.promise;
      const response = method === 'dispute'
        ? await request(app).post('/disputes').set(...auth(shipper)).send({ ...entity, evidence_url: key, description: 'A sérülés bizonyítékát meg kell őrizni.' })
        : await request(app).patch('/admin/photo-hold').set(...auth(admin)).send({ ...entity, hold: true });
      expect(response.status, JSON.stringify(response.body)).toBe(method === 'dispute' ? 201 : 200);
      expect(remove).not.toHaveBeenCalledWith(key);
    } finally { release.resolve(); }
    await purge;
    expect(objects.has(key)).toBe(true);
    expect((await db.query('SELECT 1 FROM photos WHERE id = $1', [photo.id])).rows).toHaveLength(1);
    spy.mockRestore(); remove.mockRestore();
  }
});

it.each(['job', 'booking'])('%s: a már futó tárhelytörlés végéig az admin-hold vár a sorzárra', async (type) => {
  const { key, entity } = await evidence(type);
  const admin = await createUser({ role: 'admin' });
  const started = gate(); const release = gate();
  vi.spyOn(storage, 'deleteFile').mockImplementation(async k => {
    if (k === key) { started.resolve(); await release.promise; }
    return true;
  });
  const purge = retention.purgeOldDeliveryPhotos();
  await started.promise;
  let completed = false;
  const hold = request(app).patch('/admin/photo-hold').set(...auth(admin)).send({ ...entity, hold: true })
    .then(r => { completed = true; return r; });
  try {
    await vi.waitFor(async () => {
      const waiting = await db.query(`SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%SET photo_retention_hold = $1%'`);
      expect(waiting.rows.length).toBeGreaterThan(0);
    });
    expect(completed).toBe(false);
  } finally { release.resolve(); await purge; await hold; }
  expect((await hold).status).toBe(200);
});

it('tárolóhiba esetén megmarad a mutató és a következő kör ténylegesen újrapróbálja', async () => {
  const { key, photo } = await evidence('job');
  const remove = vi.spyOn(storage, 'deleteFile').mockImplementation(async k => k !== key);
  await retention.purgeOldDeliveryPhotos();
  expect((await db.query('SELECT 1 FROM photos WHERE id = $1', [photo.id])).rows).toHaveLength(1);
  remove.mockResolvedValue(true);
  await retention.purgeOldDeliveryPhotos();
  expect(remove.mock.calls.filter(([k]) => k === key)).toHaveLength(2);
  expect((await db.query('SELECT 1 FROM photos WHERE id = $1', [photo.id])).rows).toHaveLength(0);
});
