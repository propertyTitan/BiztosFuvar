// Jogosítvány-mentesség + szállítói KRESZ-nyilatkozat (2026-07-07):
// a jogosítvány többé nem kell; a személyi igazolvány (identity KYC) elég,
// és a szállítói tevékenységhez egy egyszeri nyilatkozat kell.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');

function bid(jobId, token, amount = 12000) {
  return request(app)
    .post(`/jobs/${jobId}/bids`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount_huf: amount, return_policy: 'included' });
}

describe('Szállítói nyilatkozat + jogosítvány-mentesség', () => {
  it('igazolt + nyilatkozatot elfogadott szállító licitálhat — JOGOSÍTVÁNY NÉLKÜL is', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' }); // identity verified + terms elfogadva (helper)
    // A jogosítvány szándékosan NEM verified — mégis mehet (nincs license-kapu)
    await db.query(`UPDATE users SET driver_kyc_status = 'pending' WHERE id = $1`, [carrier.id]);
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(201);
  });

  it('nyilatkozat nélkül a licitálás tiltott (DRIVER_TERMS_REQUIRED)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query(`UPDATE users SET driver_terms_accepted_at = NULL WHERE id = $1`, [carrier.id]);
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DRIVER_TERMS_REQUIRED');
  });

  it('a nyilatkozat elfogadása után a licitálás megy (idempotens endpoint)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query(`UPDATE users SET driver_terms_accepted_at = NULL WHERE id = $1`, [carrier.id]);

    const acc = await request(app).post('/auth/accept-driver-terms').set('Authorization', `Bearer ${carrier.token}`).send({});
    expect(acc.status).toBe(200);
    expect(acc.body.driver_terms_accepted_at).toBeTruthy();

    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(201);
  });

  it('igazolatlan személyazonosságnál továbbra is tiltott (IDENTITY_KYC_REQUIRED)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier', kyc: 'pending' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('IDENTITY_KYC_REQUIRED');
  });
});
