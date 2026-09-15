import { describe, it, expect } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob } = require('./helpers');
const { grantVoucher, redeemJobVoucher } = require('../src/services/gamification');

async function fixture() {
  const shipper = await createUser();
  const job = await createJob({ shipperId: shipper.id });
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  await grantVoucher(shipper.id, 'referral_reward', 30, 500);
  await grantVoucher(shipper.id, 'referral_reward', 30, 500);
  return { shipper, job };
}
const used = async id => (await db.query('SELECT * FROM fee_vouchers WHERE user_id = $1 AND used_at IS NOT NULL', [id])).rowCount;

describe('Audit 3 — a kupon és a fuvar egy tranzakció', () => {
  it('két egyidejű fizetésindítás ugyanarra a fuvarra csak egy kupont fogyaszt', async () => {
    const { shipper, job } = await fixture();
    const replies = await Promise.all([1, 2].map(() => request(app).post(`/jobs/${job.id}/pay`)
      .set({ Authorization: `Bearer ${shipper.token}` }).send({ consent: true })));
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await used(shipper.id)).toBe(1);
    expect((await db.query('SELECT paid_at, connection_fee_huf FROM jobs WHERE id = $1', [job.id])).rows[0])
      .toMatchObject({ paid_at: expect.any(Date), connection_fee_huf: 0 });
  });

  it('a fuvar írásának hibája a kupon felhasználását is visszavonja', async () => {
    const { shipper, job } = await fixture();
    await db.query(`CREATE FUNCTION audit_kupon_hiba() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit kupon hiba'; END $$;
      CREATE TRIGGER audit_kupon_hiba BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION audit_kupon_hiba()`);
    try {
      await expect(redeemJobVoucher(shipper.id, job.id)).rejects.toThrow('audit kupon hiba');
      expect(await used(shipper.id)).toBe(0);
    } finally {
      await db.query('DROP TRIGGER audit_kupon_hiba ON jobs; DROP FUNCTION audit_kupon_hiba()');
    }
    expect((await redeemJobVoucher(shipper.id, job.id)).used).toBe(true);
    expect(await used(shipper.id)).toBe(1);
  });

  it('időközben lemondott fuvarhoz nem vált be kupont', async () => {
    const { shipper, job } = await fixture();
    await db.query("UPDATE jobs SET status = 'cancelled' WHERE id = $1", [job.id]);
    expect((await redeemJobVoucher(shipper.id, job.id)).changed).toBe(true);
    expect(await used(shipper.id)).toBe(0);
  });
});
