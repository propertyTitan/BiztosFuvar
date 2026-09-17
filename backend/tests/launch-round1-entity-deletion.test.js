import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const storage = require('../src/services/storage');
const queue = require('../src/services/fileDeletionQueue');
const { Client } = require('pg');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => vi.restoreAllMocks());
beforeEach(() => require('../src/middleware/rateLimit').__resetRateLimitsForTests());

async function fixture(type = 'job') {
  const admin = await createUser({ role: 'admin' });
  const shipper = await createUser(); const carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true };
  const booking = type === 'job' ? null : await createBooking(opts);
  const entity = booking ? booking.booking : await createJob(opts);
  const field = type === 'job' ? 'job_id' : 'booking_id';
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const id = type === 'route' ? booking.routeId : entity.id;
  const path = `/admin/${{ job: 'jobs', booking: 'bookings', route: 'routes' }[type]}/${id}`;
  const key = `/uploads/delete-${entity.id}.png`;
  await db.query(`INSERT INTO photos(${field}, uploader_id, kind, url) VALUES($1,$2,'dropoff',$3)`, [entity.id, carrier.id, key]);
  return { admin, shipper, entity, id, field, table, path, key };
}

it.each(['job', 'booking', 'route'])('%s: a lezárt ügylet zárolt bizonyítékát admin sem törölheti', async type => {
  const f = await fixture(type);
  const remove = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
  expect((await request(app).patch('/admin/photo-hold').set(...auth(f.admin)).send({ [f.field]: f.entity.id, hold: true })).status).toBe(200);
  expect((await request(app).delete(f.path).set(...auth(f.admin))).status).toBe(409);
  expect((await db.query(`SELECT 1 FROM ${f.table} WHERE id=$1`, [f.entity.id])).rowCount).toBe(1);
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [f.key])).rowCount).toBe(1);
  expect(remove).not.toHaveBeenCalledWith(f.key);
});

it.each(['job', 'booking', 'route'])('%s: a függő banki munkamenet blokkolja az entitástörlést', async type => {
  const f = await fixture(type);
  await db.query(`INSERT INTO payment_sessions(payment_id,${f.field},shipper_id,amount_huf)
    VALUES($1,$2,$3,500)`, [`pending-${f.id}`, f.entity.id, f.shipper.id]);
  expect((await request(app).delete(f.path).set(...auth(f.admin))).status).toBe(409);
  expect((await db.query(`SELECT 1 FROM ${f.table} WHERE id=$1`, [f.entity.id])).rowCount).toBe(1);
});

it('kulcsgyűjtési hiba: az adat és a fájl is megmarad', async () => {
  const f = await fixture();
  const query = Client.prototype.query;
  const remove = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
  vi.spyOn(Client.prototype, 'query').mockImplementation(function (sql, ...args) {
    if (String(sql).includes('SELECT url FROM photos WHERE job_id')) return Promise.reject(new Error('teszt: kulcsgyűjtési hiba'));
    return query.call(this, sql, ...args);
  });
  expect((await request(app).delete(f.path).set(...auth(f.admin))).status).toBe(500);
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [f.key])).rowCount).toBe(1);
  expect(remove).not.toHaveBeenCalledWith(f.key);
});

it.each(['job', 'booking', 'route'])('%s: tárhelyhiba után tartós feladat és tényleges újrapróbálás', async type => {
  const f = await fixture(type);
  const remove = vi.spyOn(storage, 'deleteFile').mockResolvedValue(false);
  const response = await request(app).delete(f.path).set(...auth(f.admin));
  expect(response.status).toBe(200); expect(response.body.files_pending).toBe(true);
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [f.key])).rowCount).toBe(0);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [f.key])).rowCount).toBe(1);
  remove.mockResolvedValue(true);
  await db.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE batch_id=$1', [f.id]);
  await queue.processFileDeletionQueue({ batchId: f.id });
  expect(remove).toHaveBeenCalledWith(f.key);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [f.key])).rowCount).toBe(0);
});

it('DELETE-hiba visszagörgeti a fájltörlési feladatot is', async () => {
  const f = await fixture(); const query = Client.prototype.query;
  const remove = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
  vi.spyOn(Client.prototype, 'query').mockImplementation(function (sql, ...args) {
    if (String(sql).startsWith('DELETE FROM jobs WHERE id')) return Promise.reject(new Error('teszt: DELETE-hiba'));
    return query.call(this, sql, ...args);
  });
  expect((await request(app).delete(f.path).set(...auth(f.admin))).status).toBe(500);
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [f.key])).rowCount).toBe(1);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [f.key])).rowCount).toBe(0);
  expect(remove).not.toHaveBeenCalledWith(f.key);
});

it.each(['job', 'booking', 'route'])('%s: a közben commitolt hold megállítja a várakozó törlést', async type => {
  const f = await fixture(type); const locker = await db.pool.connect();
  await locker.query('BEGIN');
  await locker.query(`SELECT id FROM ${f.table} WHERE id=$1 FOR UPDATE`, [f.entity.id]);
  const deleting = request(app).delete(f.path).set(...auth(f.admin)).then(r => r);
  try {
    await vi.waitFor(async () => expect((await db.query(`SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type='Lock' AND (query LIKE '%FOR UPDATE%' OR query LIKE 'DELETE FROM%')`)).rowCount).toBeGreaterThan(0));
    await locker.query(`UPDATE ${f.table} SET photo_retention_hold=TRUE WHERE id=$1`, [f.entity.id]);
  } finally { await locker.query('COMMIT'); locker.release(); }
  expect((await deleting).status).toBe(409);
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [f.key])).rowCount).toBe(1);
});
