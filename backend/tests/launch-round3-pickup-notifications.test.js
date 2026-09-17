import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const { Client } = require('pg');
const service = require('../src/services/pickupNotifications');
const sms = require('../src/services/sms');
const email = require('../src/services/email');
afterEach(() => vi.restoreAllMocks());
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(type) {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, paid: true };
  const entity = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const field = type === 'job' ? 'job_id' : 'booking_id';
  await db.query(`UPDATE ${table} SET recipient_email='recipient@example.test' WHERE id=$1`, [entity.id]);
  const sentSms = vi.spyOn(sms, 'sendSms').mockResolvedValue({ ok: true });
  const sentEmail = vi.spyOn(email, 'sendRecipientPickupEmail').mockResolvedValue({ id: 'sent' });
  const upload = () => request(app).post(`/${type === 'job' ? 'jobs' : 'route-bookings'}/${entity.id}/photos`)
    .set('Authorization', `Bearer ${carrier.token}`).field('kind', 'pickup').attach('file', TINY_PNG, 'pickup.png');
  const tasks = () => db.query(`SELECT * FROM pickup_notification_queue WHERE ${field}=$1`, [entity.id]);
  const due = () => db.query(`UPDATE pickup_notification_queue SET next_attempt_at=NOW() WHERE ${field}=$1`, [entity.id]);
  const run = () => service.runPickupNotifications({ [type === 'job' ? 'jobId' : 'bookingId']: entity.id });
  return { entity, table, field, sentSms, sentEmail, upload, tasks, due, run };
}

it.each(['job', 'booking'])('%s: COMMIT utáni SQL-hiba túlélhető, második fotó nem dupláz', async type => {
  const f = await fixture(type);
  const query = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function(sql, ...args) {
    if (String(sql).includes('AS carrier_name, c.phone AS carrier_phone') && args[0]?.[0] === f.entity.id) {
      return query.call(this, 'SELECT missing_pickup_column FROM users');
    }
    return query.call(this, sql, ...args);
  });
  expect((await f.upload()).status).toBe(201);
  await vi.waitFor(async () => expect((await f.tasks()).rows.filter(r => r.attempts === 1)).toHaveLength(2));
  expect(f.sentSms).not.toHaveBeenCalled(); expect(f.sentEmail).not.toHaveBeenCalled();
  expect((await db.query(`SELECT status FROM ${f.table} WHERE id=$1`, [f.entity.id])).rows[0].status).toBe('in_progress');
  spy.mockRestore();
  await f.due(); await f.run();
  expect(f.sentSms).toHaveBeenCalledTimes(1); expect(f.sentEmail).toHaveBeenCalledTimes(1);
  expect((await f.tasks()).rows).toHaveLength(0);
  expect((await f.upload()).status).toBe(201); await f.run();
  expect(f.sentSms).toHaveBeenCalledTimes(1);
  expect(f.sentSms.mock.calls[0][1]).toContain(f.entity.delivery_code);
  expect(f.sentSms.mock.calls[0][2]).toEqual({ queueOnFailure: false });
});

it.each(['sms', 'email'])('%s hiba csak a sikertelen csatornát próbálja újra', async channel => {
  const f = await fixture('job');
  // A közös teszt-DB-ben más tesztek SMS-feladatai is lehetnek. A saját
  // küldésünk nem adhat új feladatot ehhez a másik retry-sorhoz.
  const legacySeed = (await db.query(`INSERT INTO sms_retry_queue(phone, message)
    VALUES('+36309999999', 'Másik értesítés függő feladata') RETURNING id`)).rows[0];
  const legacyBefore = (await db.query('SELECT id FROM sms_retry_queue ORDER BY id')).rows;
  const failed = channel === 'sms' ? f.sentSms : f.sentEmail;
  failed.mockResolvedValue(channel === 'sms' ? { ok: false } : null);
  expect((await f.upload()).status).toBe(201);
  await vi.waitFor(async () => {
    const rows = (await f.tasks()).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ channel, attempts: 1 });
  });
  failed.mockResolvedValue(channel === 'sms' ? { ok: true } : { id: 'sent' });
  await f.due(); await f.run();
  expect(failed).toHaveBeenCalledTimes(2);
  expect(channel === 'sms' ? f.sentEmail : f.sentSms).toHaveBeenCalledTimes(1);
  expect(f.sentSms).toHaveBeenCalledWith(f.entity.recipient_phone, expect.any(String), { queueOnFailure: false });
  expect((await db.query('SELECT id FROM sms_retry_queue ORDER BY id')).rows).toEqual(legacyBefore);
  await db.query('DELETE FROM sms_retry_queue WHERE id=$1', [legacySeed.id]);
});

it('feladatmentési hiba visszagörgeti a felvételt és a fotót', async () => {
  const f = await fixture('job');
  vi.spyOn(service, 'enqueuePickupNotifications').mockRejectedValue(new Error('DB unavailable'));
  expect((await f.upload()).status).toBe(500);
  expect((await db.query('SELECT status FROM jobs WHERE id=$1', [f.entity.id])).rows[0].status).toBe('accepted');
  expect((await db.query('SELECT 1 FROM photos WHERE job_id=$1', [f.entity.id])).rowCount).toBe(0);
  expect(f.sentSms).not.toHaveBeenCalled();
});

it('újraindítás utáni két feldolgozó nem küldi egyszerre ugyanazt az SMS-t', async () => {
  const f = await fixture('job');
  vi.spyOn(service, 'dispatchPickupNotifications').mockImplementation(() => {});
  expect((await f.upload()).status).toBe(201);
  const started = gate(), release = gate();
  f.sentSms.mockImplementation(async () => { started.resolve(); await release.promise; return { ok: true }; });
  const first = f.run(); await started.promise;
  try { await f.run(); } finally { release.resolve(); }
  await first;
  expect(f.sentSms).toHaveBeenCalledTimes(1); expect(f.sentEmail).toHaveBeenCalledTimes(1);
  expect((await f.tasks()).rows).toHaveLength(0);
});

it.each(['delivered', 'expired'])('%s: elavult felvételi üzenet nem megy ki', async reason => {
  const f = await fixture('job');
  vi.spyOn(service, 'dispatchPickupNotifications').mockImplementation(() => {});
  expect((await f.upload()).status).toBe(201);
  if (reason === 'delivered') await db.query("UPDATE jobs SET status='delivered' WHERE id=$1", [f.entity.id]);
  else await db.query("UPDATE pickup_notification_queue SET created_at=NOW()-INTERVAL '49 hours' WHERE job_id=$1", [f.entity.id]);
  await f.run();
  expect((await f.tasks()).rows).toHaveLength(0); expect(f.sentSms).not.toHaveBeenCalled();
});
