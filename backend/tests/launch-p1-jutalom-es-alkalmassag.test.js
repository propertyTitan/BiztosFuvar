import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { maybeGrantReferralReward } = require('../src/services/referral');
afterEach(() => vi.restoreAllMocks());
const count = async (id) => Number((await db.query("SELECT COUNT(*) FROM fee_vouchers WHERE user_id = $1 AND reason = 'referral'", [id])).rows[0].count);

describe('P1-02: az ajánlói jutalom közös tranzakciója', () => {
  it('INSERT-hiba után nincs elhasznált jutalom, az újrapróbálás kiadja', async () => {
    const referrer = await createUser();
    const invitee = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, invitee.id]);
    await db.query(`CREATE FUNCTION launch_referral_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'referral insert failure'; END $$`);
    await db.query(`CREATE TRIGGER launch_referral_failure BEFORE INSERT ON fee_vouchers
      FOR EACH ROW EXECUTE FUNCTION launch_referral_failure()`);
    try {
      await maybeGrantReferralReward(invitee.id, { role: 'carrier' });
      expect(await count(referrer.id)).toBe(0);
      expect((await db.query('SELECT referral_reward_granted_at FROM users WHERE id = $1', [invitee.id])).rows[0].referral_reward_granted_at).toBeNull();
    } finally { await db.query('DROP FUNCTION launch_referral_failure() CASCADE'); }
    await maybeGrantReferralReward(invitee.id, { role: 'carrier' });
    expect(await count(referrer.id)).toBe(1);
  });

  it('külön meghívottak párhuzamos teljesítése sem lépi túl az ötös havi plafont', async () => {
    const referrer = await createUser();
    await db.query("INSERT INTO fee_vouchers(user_id, reason, valid_until) SELECT $1, 'referral', CURRENT_DATE + 60 FROM generate_series(1,4)", [referrer.id]);
    const invitees = await Promise.all(Array.from({ length: 8 }, () => createUser({ role: 'carrier' })));
    await db.query('UPDATE users SET referred_by = $1 WHERE id = ANY($2::uuid[])', [referrer.id, invitees.map((u) => u.id)]);
    await Promise.all(invitees.map((u) => maybeGrantReferralReward(u.id, { role: 'carrier' })));
    expect(await count(referrer.id)).toBe(5);
    const granted = await db.query('SELECT id FROM users WHERE referred_by = $1 AND referral_reward_granted_at IS NOT NULL', [referrer.id]);
    expect(granted.rows).toHaveLength(1);
  });
});

describe('P1-04: megállapodás alatti elérhetőség', () => {
  it.each(['accepted', 'in_progress', 'disputed'])('%s fuvar mellett az üres szám tiltott, az érvényes csere megengedett', async (status) => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true, status });
    const denied = await request(app).patch('/auth/me').set('Authorization', `Bearer ${carrier.token}`).send({ phone: '' });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('PHONE_REQUIRED_FOR_ACTIVE_DEAL');
    const replaced = await request(app).patch('/auth/me').set('Authorization', `Bearer ${carrier.token}`).send({ phone: '+36309998877' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.phone).toBe('+36309998877');
  });

  it('foglalás is védi a telefont, lezárás után az ürítés szabad', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id });
    const clear = () => request(app).patch('/auth/me').set('Authorization', `Bearer ${carrier.token}`).send({ phone: null });
    expect((await clear()).status).toBe(409);
    await db.query("UPDATE route_bookings SET status = 'delivered' WHERE id = $1", [booking.id]);
    expect((await clear()).status).toBe(200);
  });
});

describe('P1-12: foglaláskor friss szállítói alkalmasság', () => {
  it.each([
    ["can_bid = FALSE", 'CARRIER_SUSPENDED'],
    ["identity_kyc_status = 'pending'", 'IDENTITY_KYC_REQUIRED'],
    ['driver_terms_accepted_at = NULL', 'DRIVER_TERMS_REQUIRED'],
    ['phone = NULL', 'PHONE_REQUIRED'],
  ])('%s megerősítés előtt: nincs megállapodás vagy fizetési session', async (change, code) => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' });
    await db.query(`UPDATE users SET ${change} WHERE id = $1`, [carrier.id]);
    const provider = vi.spyOn(require('../src/services/paymentProvider'), 'startFeePayment');
    const res = await request(app).post(`/route-bookings/${booking.id}/confirm`).set('Authorization', `Bearer ${carrier.token}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(code);
    expect(provider).not.toHaveBeenCalled();
    expect((await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id])).rows[0].status).toBe('pending');
  });
});
