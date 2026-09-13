// =====================================================================
//  TELJES AUDIT — D3 csomag (2026-09-13): a web P1-ek backend-lába
//   - a kupon-ág (/pay, paid_via_voucher) `job:paid` socket-eseményt küld
//     mindkét félnek — eddig csak a webhook és a kézi nyugtázás küldött,
//     a felület F5-ig elavult maradt.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { grantVoucher } = require('../src/services/gamification');
const realtime = require('../src/realtime');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

afterEach(() => vi.restoreAllMocks());

describe('D3 — kuponos díjfizetés socket-eseménye', () => {
  it('paid_via_voucher → job:paid a feladónak ÉS a szállítónak', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: false });
    await grantVoucher(shipper.id, 'referral_reward', 30, null);
    const emit = vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {});

    const res = await request(app).post(`/jobs/${job.id}/pay`).set(auth(shipper.token)).send({ consent: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.paid_via_voucher).toBe(true);

    const paidEsemenyek = emit.mock.calls.filter((c) => c[1] === 'job:paid');
    const cimzettek = paidEsemenyek.map((c) => c[0]);
    expect(cimzettek, 'a kupon-ág nem küldött job:paid eseményt a feladónak').toContain(shipper.id);
    expect(cimzettek, 'a kupon-ág nem küldött job:paid eseményt a szállítónak').toContain(carrier.id);
    expect(paidEsemenyek.every((c) => c[2]?.job_id === job.id)).toBe(true);
  });
});
