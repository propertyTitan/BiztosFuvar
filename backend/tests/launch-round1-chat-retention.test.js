import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const retention = require('../src/services/retention');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());

async function fixture(type) {
  const shipper = await createUser(); const carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true };
  const entity = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const table = type === 'job' ? 'jobs' : 'route_bookings'; const field = type === 'job' ? 'job_id' : 'booking_id';
  await db.query(`UPDATE ${table} SET delivered_at=NOW()-INTERVAL '7 months'
    ${type === 'job' ? ",updated_at=NOW()-INTERVAL '7 months'" : ''} WHERE id=$1`, [entity.id]);
  const message = (await db.query(`INSERT INTO messages(${field},sender_id,recipient_id,body)
    VALUES($1,$2,$3,'Megőrzendő egyeztetés') RETURNING id`, [entity.id, shipper.id, carrier.id])).rows[0];
  return { shipper, entity, field, table, message };
}

it.each(['job', 'booking'])('%s: a jelöltlista után megnyitott vita megőrzi a chatet', async type => {
  const f = await fixture(type); const selected = gate(); const resume = gate(); const query = db.query;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (String(sql).includes(`SELECT e.id FROM ${f.table} e`) && result.rows.some(r => r.id === f.entity.id)) {
      selected.resolve(); await resume.promise;
    }
    return result;
  });
  const purge = retention.purgeOldChatMessages();
  try {
    await selected.promise;
    const response = await request(app).post('/disputes').set(...auth(f.shipper))
      .send({ [f.field]: f.entity.id, description: 'A chat az ügy bizonyítéka.' });
    expect(response.status).toBe(201);
  } finally { resume.resolve(); }
  await purge;
  expect((await db.query('SELECT 1 FROM messages WHERE id=$1', [f.message.id])).rowCount).toBe(1);
});

it.each(['job', 'booking'])('%s: a már törlő retenció végéig a vitanyitás vár', async type => {
  const f = await fixture(type); const locker = await db.pool.connect();
  await locker.query('BEGIN'); await locker.query('SELECT id FROM messages WHERE id=$1 FOR UPDATE', [f.message.id]);
  const purge = retention.purgeOldChatMessages();
  let dispute;
  try {
    await vi.waitFor(async () => expect((await db.query(`SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type='Lock' AND query LIKE 'DELETE FROM messages m%'`)).rowCount).toBeGreaterThan(0));
    let finished = false;
    dispute = request(app).post('/disputes').set(...auth(f.shipper))
      .send({ [f.field]: f.entity.id, description: 'Retenció közben indított ügy.' }).then(r => { finished = true; return r; });
    await vi.waitFor(async () => expect((await db.query(`SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type='Lock' AND query LIKE '%FOR UPDATE%' AND query NOT LIKE 'DELETE FROM messages m%'`)).rowCount).toBeGreaterThan(0));
    expect(finished).toBe(false);
  } finally { await locker.query('COMMIT'); locker.release(); await purge; if (dispute) await dispute; }
  expect((await dispute).status).toBe(201);
  expect((await db.query(`SELECT photo_retention_hold FROM ${f.table} WHERE id=$1`, [f.entity.id])).rows[0].photo_retention_hold).toBe(true);
});
