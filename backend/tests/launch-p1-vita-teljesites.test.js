import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
afterEach(() => vi.restoreAllMocks());
const auth = (user) => ['Authorization', `Bearer ${user.token}`];
const upload = (job, carrier, kind) => request(app).post(`/jobs/${job.id}/photos`).set(...auth(carrier))
  .field('kind', kind).field('delivery_code', '111222').attach('file', TINY_PNG, { filename: 'proof.png', contentType: 'image/png' });
const open = (entity, user) => request(app).post('/disputes').set(...auth(user)).send({ ...entity, description: 'Az átadás részleteit egyeztetni kell.' });

describe('P1-03: vita és ügylet együtt változik', () => {
  it.each(['job', 'booking'])('%s: hibás második írás sem nyitáskor, sem lezáráskor nem hagy félkész vitát', async (type) => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const row = type === 'job'
      ? await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true })
      : (await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true })).booking;
    const table = type === 'job' ? 'jobs' : 'route_bookings';
    const field = type === 'job' ? 'job_id' : 'booking_id';
    const entity = { [field]: row.id };
    const fail = async () => {
      await db.query(`CREATE FUNCTION launch_dispute_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'dispute transition failure'; END $$`);
      await db.query(`CREATE TRIGGER launch_dispute_failure BEFORE UPDATE ON ${table}
        FOR EACH ROW WHEN (OLD.id = '${row.id}'::uuid) EXECUTE FUNCTION launch_dispute_failure()`);
    };
    await fail();
    try {
      expect((await open(entity, shipper)).status).toBe(500);
      expect((await db.query(`SELECT 1 FROM disputes WHERE ${field} = $1`, [row.id])).rows).toHaveLength(0);
      expect((await db.query(`SELECT photo_retention_hold FROM ${table} WHERE id = $1`, [row.id])).rows[0].photo_retention_hold).toBe(false);
    } finally { await db.query('DROP FUNCTION launch_dispute_failure() CASCADE'); }
    const dispute = await open(entity, shipper);
    expect(dispute.status).toBe(201);
    const resolve = () => request(app).patch(`/disputes/${dispute.body.id}`).set(...auth(admin))
      .send({ status: 'resolved_no_action', resolution_note: 'A felek megállapodtak.' });
    await fail();
    try {
      expect((await resolve()).status).toBe(500);
      expect((await db.query('SELECT status, resolved_at FROM disputes WHERE id = $1', [dispute.body.id])).rows[0])
        .toEqual({ status: 'open', resolved_at: null });
    } finally { await db.query('DROP FUNCTION launch_dispute_failure() CASCADE'); }
    expect((await resolve()).status).toBe(200);
    expect((await db.query(`SELECT status, photo_retention_hold FROM ${table} WHERE id = $1`, [row.id])).rows[0])
      .toEqual({ status: row.status, photo_retention_hold: true });
  });

  it('párhuzamos vita és pickup megőrzi a fizikai állapotot; lezárás és dropoff sem írja vissza', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    const [dispute, pickup] = await Promise.all([open({ job_id: job.id }, shipper), upload(job, carrier, 'pickup')]);
    expect(dispute.status).toBe(201); expect(pickup.status).toBe(201);
    expect((await db.query('SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id])).rows[0])
      .toEqual({ status: 'disputed', status_before_dispute: 'in_progress' });
    const [closed, dropoff] = await Promise.all([
      request(app).patch(`/disputes/${dispute.body.id}`).set(...auth(admin)).send({ status: 'resolved_no_action', resolution_note: 'Egyeztetve.' }),
      upload(job, carrier, 'dropoff'),
    ]);
    expect(closed.status).toBe(200); expect(dropoff.status).toBe(201);
    expect((await db.query('SELECT status, status_before_dispute, photo_retention_hold FROM jobs WHERE id = $1', [job.id])).rows[0])
      .toEqual({ status: 'delivered', status_before_dispute: null, photo_retention_hold: true });
  });
});

describe('P1-11: vita mellett is teljes a fizikai átadás', () => {
  it.each([false, true])('vita=%s: címzett-PIN, egyszeri jutalom és adóadat-bekérés', async (disputed) => {
    const shipper = await createUser();
    const referrer = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, carrier.id]);
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    await db.query("UPDATE jobs SET recipient_email = 'recipient@teszt.gofuvar.hu' WHERE id = $1", [job.id]);
    let dispute;
    if (disputed) { dispute = await open({ job_id: job.id }, shipper); expect(dispute.status).toBe(201); }
    const sms = vi.spyOn(require('../src/services/sms'), 'sendSms').mockResolvedValue({});
    const mail = vi.spyOn(require('../src/services/email'), 'sendRecipientPickupEmail').mockResolvedValue({});
    expect((await upload(job, carrier, 'pickup')).status).toBe(201);
    await vi.waitFor(() => {
      expect(sms).toHaveBeenCalledTimes(1);
      expect(mail).toHaveBeenCalledWith(expect.objectContaining({ deliveryCode: '111222', to: 'recipient@teszt.gofuvar.hu' }));
    });
    expect(sms.mock.calls[0][1]).toContain('111222');
    expect((await upload(job, carrier, 'dropoff')).status).toBe(201);
    await vi.waitFor(async () => {
      expect((await db.query("SELECT 1 FROM fee_vouchers WHERE user_id = $1 AND reason = 'referral'", [referrer.id])).rows).toHaveLength(1);
      expect((await db.query('SELECT tax_data_requested_at FROM users WHERE id = $1', [carrier.id])).rows[0].tax_data_requested_at).not.toBeNull();
    });
    expect((await upload(job, carrier, 'dropoff')).status).toBe(409);
    expect((await db.query("SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'tax_data_request'", [carrier.id])).rows).toHaveLength(1);
    if (disputed) {
      expect((await db.query('SELECT status FROM disputes WHERE id = $1', [dispute.body.id])).rows[0].status).toBe('open');
      expect((await db.query('SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id])).rows[0])
        .toEqual({ status: 'disputed', status_before_dispute: 'delivered' });
    }
  });
});
