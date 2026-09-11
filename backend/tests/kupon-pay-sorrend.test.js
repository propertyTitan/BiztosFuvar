// =====================================================================
//  A KUPON A GATEWAY-ÚJRAHASZNÁLAT ELŐTT (2026-09-11, Codex-audit P1-01, D2)
//
//  A licit-elfogadás MINDIG létrehoz egy fizetési munkamenetet, és a /pay a
//  meglévő gateway-URL-t feltétel nélkül visszaadta — a kupon-ág a valódi
//  folyamaton holt kód volt. A régi tesztek gateway nélküli fixture-ön
//  futottak, ezért zöldek voltak. Ez a teszt a valódi állapotot méri.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { grantVoucher } = require('../src/services/gamification');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('POST /jobs/:id/pay meglévő gateway-URL mellett', () => {
  it('a kupon beváltódik, a fuvar fizetett lesz (nem a régi URL jön vissza)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: false });
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, barion_gateway_url, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', 'teszt-pid', 'stub:cib/teszt', 0, 500)`,
      [job.id],
    );
    await grantVoucher(shipper.id, 'referral_reward', 30, null);

    const res = await request(app).post(`/jobs/${job.id}/pay`).set(auth(shipper.token)).send({ consent: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.paid_via_voucher, 'a meglévő gateway-URL megelőzte a kupont — az ajánlói jutalom nem váltódik be').toBe(true);
    const { rows } = await db.query('SELECT paid_at, connection_fee_huf FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
    expect(Number(rows[0].connection_fee_huf)).toBe(0);
    const { rows: v } = await db.query('SELECT used_at FROM fee_vouchers WHERE user_id = $1', [shipper.id]);
    expect(v[0].used_at).not.toBeNull();
  });

  it('kupon nélkül a meglévő URL-t adja vissza (reused) — a régi viselkedés megmarad', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: false });
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, barion_gateway_url, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', 'teszt-pid2', 'stub:cib/teszt2', 0, 500)`,
      [job.id],
    );
    const res = await request(app).post(`/jobs/${job.id}/pay`).set(auth(shipper.token)).send({ consent: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reused).toBe(true);
    expect(res.body.gateway_url).toBe('stub:cib/teszt2');
  });
});
