// Feladói KYC-mentesség (2026-07-19, user-döntés): a feladónak NEM kell
// személyi igazolvány — feladás és díj-fizetés okmány nélkül megy (a banki
// fizetés a de facto azonosítás). A SZÁLLÍTÓI kapu változatlan: ajánlatot
// tenni csak igazolt személyazonossággal lehet. Ez az aszimmetria az
// osztály-védelem lényege — ha bármelyik irányban elmozdul, itt hasal el.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { maybeGrantReferralReward } = require('../src/services/referral');

const JOB_BODY = {
  title: 'Teszt csomag KYC nélkül',
  pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};

describe('Feladó KYC nélkül', () => {
  it('nem-igazolt feladó IS feladhat fuvart (nincs KYC-kapu a feladáson)', async () => {
    const shipper = await createUser({ kyc: 'pending' });
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${shipper.token}`)
      .send(JOB_BODY);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it('nem-igazolt feladó a díj-fizetést is végigviheti (pay + confirm)', async () => {
    const shipper = await createUser({ kyc: 'pending' });
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: false });

    const start = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ consent: true });
    expect(start.status).toBe(200);

    const confirm = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(confirm.status).toBe(200);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).toBeTruthy();
  });

  it('a SZÁLLÍTÓI kapu változatlan: nem-igazolt szállító NEM tehet ajánlatot', async () => {
    const shipper = await createUser({ kyc: 'pending' });
    const carrier = await createUser({ role: 'carrier', kyc: 'pending' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    const res = await request(app)
      .post(`/jobs/${job.id}/bids`)
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('IDENTITY_KYC_REQUIRED');
  });

  it('ajánlói jutalom KYC nélküli feladó-teljesítésnél is jár (a fizetés a guard)', async () => {
    const referrer = await createUser();
    const invitee = await createUser({ kyc: 'pending' });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, invitee.id]);

    await maybeGrantReferralReward(invitee.id, { role: 'shipper', jobId: null });

    const { rows } = await db.query(
      'SELECT referral_reward_granted_at FROM users WHERE id = $1', [invitee.id],
    );
    expect(rows[0].referral_reward_granted_at).toBeTruthy();

    const { rows: vouchers } = await db.query(
      `SELECT COUNT(*)::int AS c FROM fee_vouchers WHERE user_id = $1 AND reason = 'referral'`,
      [referrer.id],
    );
    expect(vouchers[0].c).toBe(1);
  });

  it('szállítói úton a jutalomhoz továbbra is kell a KYC', async () => {
    const referrer = await createUser();
    const invitee = await createUser({ role: 'carrier', kyc: 'pending' });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, invitee.id]);

    await maybeGrantReferralReward(invitee.id, { role: 'carrier', jobId: null });

    const { rows } = await db.query(
      'SELECT referral_reward_granted_at FROM users WHERE id = $1', [invitee.id],
    );
    expect(rows[0].referral_reward_granted_at).toBeNull();
  });
});
