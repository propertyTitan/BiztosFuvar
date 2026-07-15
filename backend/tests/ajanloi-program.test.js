// Ajánlói program (referral): attribúció regisztrációkor, a jutalom-trigger
// őrei (egyszer, KYC-feltétel, havi plafon), és az "ingyen feladás" kupon
// beváltása a /pay-en (a díj-plafonnal együtt).
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, uniqueEmail } = require('./helpers');
const {
  maybeGrantReferralReward,
  resolveReferrerId,
  REFERRAL_MONTHLY_CAP,
  REFERRAL_VOUCHER_MAX_FEE_HUF,
} = require('../src/services/referral');
const { grantVoucher } = require('../src/services/gamification');

function countVouchers(userId, reason = 'referral') {
  return db
    .query('SELECT COUNT(*)::int AS c FROM fee_vouchers WHERE user_id = $1 AND reason = $2', [userId, reason])
    .then((r) => r.rows[0].c);
}

describe('Ajánlói attribúció (regisztráció)', () => {
  it('a ?ref kóddal regisztráló usernél beáll a referred_by, és saját kódot kap', async () => {
    const aEmail = uniqueEmail('ref-a');
    const regA = await request(app).post('/auth/register').send({
      email: aEmail, password: 'JelszoTeszt123', full_name: 'Ajánló Anna',
    });
    expect(regA.status).toBe(201);

    // A saját ajánlói kódja
    const info = await request(app).get('/auth/referral').set('Authorization', `Bearer ${regA.body.token}`);
    expect(info.status).toBe(200);
    expect(info.body.code).toBeTruthy();
    expect(info.body.link).toContain(`ref=${info.body.code}`);

    const regB = await request(app).post('/auth/register').send({
      email: uniqueEmail('ref-b'), password: 'JelszoTeszt123', full_name: 'Meghívott Béla', ref: info.body.code,
    });
    expect(regB.status).toBe(201);

    const { rows } = await db.query('SELECT referred_by, referral_code FROM users WHERE id = $1', [regB.body.user.id]);
    expect(rows[0].referred_by).toBe(regA.body.user.id);
    expect(rows[0].referral_code).toBeTruthy();
    expect(rows[0].referral_code).not.toBe(info.body.code); // saját, egyedi kód
  });

  it('ismeretlen ref kóddal is sikeres a regisztráció, csak nincs ajánló', async () => {
    const reg = await request(app).post('/auth/register').send({
      email: uniqueEmail('ref-x'), password: 'JelszoTeszt123', full_name: 'Nincs Ajánló', ref: 'NEMLETEZO',
    });
    expect(reg.status).toBe(201);
    const { rows } = await db.query('SELECT referred_by FROM users WHERE id = $1', [reg.body.user.id]);
    expect(rows[0].referred_by).toBeNull();
    expect(await resolveReferrerId('NEMLETEZO')).toBeNull();
  });
});

describe('Ajánlói jutalom-trigger', () => {
  async function pair({ inviteeKyc = 'verified' } = {}) {
    const referrer = await createUser();
    const invitee = await createUser({ role: 'carrier', kyc: inviteeKyc });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, invitee.id]);
    return { referrer, invitee };
  }

  it('a meghívott teljesítésekor az ajánló pontosan EGY kupont kap (idempotens)', async () => {
    const { referrer, invitee } = await pair();
    await maybeGrantReferralReward(invitee.id, { role: 'carrier' });
    await maybeGrantReferralReward(invitee.id, { role: 'carrier' }); // másodszor már ne
    expect(await countVouchers(referrer.id)).toBe(1);
    const { rows } = await db.query('SELECT referral_reward_granted_at FROM users WHERE id = $1', [invitee.id]);
    expect(rows[0].referral_reward_granted_at).not.toBeNull();
  });

  it('KYC nélküli meghívott NEM vált ki jutalmat', async () => {
    const { referrer, invitee } = await pair({ inviteeKyc: 'pending' });
    await maybeGrantReferralReward(invitee.id, { role: 'carrier' });
    expect(await countVouchers(referrer.id)).toBe(0);
  });

  it('az ajánló havi plafonja fölött már nem jár kupon', async () => {
    const referrer = await createUser();
    // Feltöltjük a referrert a plafonig ebben a hónapban.
    for (let i = 0; i < REFERRAL_MONTHLY_CAP; i++) {
      await grantVoucher(referrer.id, 'referral', 60, REFERRAL_VOUCHER_MAX_FEE_HUF);
    }
    const invitee = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, invitee.id]);
    await maybeGrantReferralReward(invitee.id, { role: 'carrier' });
    expect(await countVouchers(referrer.id)).toBe(REFERRAL_MONTHLY_CAP); // nem nőtt
  });
});

describe('Ingyen feladás a /pay-en (kupon-beváltás)', () => {
  it('kuponnal a díj alatti feladás Barion nélkül lezárul (paid_via_voucher)', async () => {
    const shipper = await createUser();
    await grantVoucher(shipper.id, 'referral', 60, REFERRAL_VOUCHER_MAX_FEE_HUF);
    const job = await createJob({ shipperId: shipper.id, priceHuf: 15000 }); // díj: 500 Ft ≤ plafon

    const res = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ consent: true });

    expect(res.status).toBe(200);
    expect(res.body.paid_via_voucher).toBe(true);
    expect(res.body.fee_huf).toBe(0);

    const { rows } = await db.query('SELECT paid_at, connection_fee_huf FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
    expect(rows[0].connection_fee_huf).toBe(0);
    // a kupon elhasználódott
    const used = await db.query(
      `SELECT COUNT(*)::int AS c FROM fee_vouchers WHERE user_id = $1 AND used_at IS NOT NULL`,
      [shipper.id],
    );
    expect(used.rows[0].c).toBe(1);
  });

  it('a plafon FÖLÖTTI díjra a kupon nem alkalmazható — marad a rendes fizetés', async () => {
    const shipper = await createUser();
    // Az új árazásban (500/1000) a referral-plafon (1000) minden díjat fedne —
    // a plafon-GUARD logikát ezért egy kisebb, 500 Ft-os plafonú kuponnal
    // és felső sávos (1000 Ft díjú) fuvarral tartjuk tesztelve.
    await grantVoucher(shipper.id, 'referral', 60, 500);
    const job = await createJob({ shipperId: shipper.id, priceHuf: 150000 }); // díj: 1000 Ft > 500 plafon

    const res = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ consent: true });

    expect(res.status).toBe(200);
    expect(res.body.paid_via_voucher).toBeUndefined();
    expect(res.body.gateway_url).toBeTruthy(); // Barion (stub) út

    // a kupon érintetlen
    const unused = await db.query(
      `SELECT COUNT(*)::int AS c FROM fee_vouchers WHERE user_id = $1 AND used_at IS NULL`,
      [shipper.id],
    );
    expect(unused.rows[0].c).toBe(1);
  });
});
