// Adatvédelem és jogosultság: ki mit láthat egy fuvarból, licitekből,
// és nem lehet-e admin-jogot szerezni regisztrációval.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, uniqueEmail } = require('./helpers');

function getJob(jobId, token) {
  return request(app).get(`/jobs/${jobId}`).set('Authorization', `Bearer ${token}`);
}

describe('Fuvar-adatok láthatósága (scrub)', () => {
  it('a sofőr NEM látja a kódokat és a tracking tokent, a címzettet igen', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await getJob(job.id, carrier.token);

    expect(res.status).toBe(200);
    expect(res.body.delivery_code).toBeUndefined();
    expect(res.body.sender_delivery_code).toBeUndefined();
    expect(res.body.tracking_token).toBeUndefined();
    // kézbesítéskor hívnia kell tudni a címzettet
    expect(res.body.recipient_phone).toBe('+36301112233');
  });

  it('kívülálló user nem lát címzett-PII-t, kódot, tokent, Barion-azonosítót', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const outsider = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await getJob(job.id, outsider.token);

    expect(res.status).toBe(200);
    expect(res.body.delivery_code).toBeUndefined();
    expect(res.body.tracking_token).toBeUndefined();
    expect(res.body.recipient_name).toBeUndefined();
    expect(res.body.recipient_phone).toBeUndefined();
    expect(res.body.barion_payment_id).toBeUndefined();
    // BUG-038: a fizetési státusz és a díj sem jár kívülállónak — a vesztes
    // licitálók élőben látták a nyertes "Fizetésre vár → FIZETVE" állapotát
    expect(res.body.paid_at).toBeUndefined();
    expect(res.body.fee_consent_at).toBeUndefined();
    expect(res.body.connection_fee_huf).toBeUndefined();
  });

  it('a feladó látja a saját vész-kódját és a tokent, a címzett kódját NEM', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id });

    const res = await getJob(job.id, shipper.token);

    expect(res.status).toBe(200);
    expect(res.body.delivery_code).toBeUndefined();
    expect(res.body.sender_delivery_code).toBe('333444');
    expect(res.body.tracking_token).toBeTruthy();
  });

  it('a publikus követőoldal él, de a válaszban nincs tracking_token vagy Barion-adat', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id });

    const res = await request(app).get(`/tracking/${job.tracking_token}`);

    expect(res.status).toBe(200);
    expect(res.body.tracking_token).toBeUndefined();
    expect(res.body.barion_payment_id).toBeUndefined();
  });
});

describe('Licitek láthatósága', () => {
  it('egy sofőr csak a SAJÁT licitjét látja, a konkurensét nem', async () => {
    const shipper = await createUser();
    const carrierA = await createUser({ role: 'carrier' });
    const carrierB = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 9000), ($1, $3, 8000)`,
      [job.id, carrierA.id, carrierB.id],
    );

    const res = await request(app)
      .get(`/jobs/${job.id}/bids`)
      .set('Authorization', `Bearer ${carrierA.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].carrier_id).toBe(carrierA.id);
  });

  it('a feladó minden licitet lát', async () => {
    const shipper = await createUser();
    const carrierA = await createUser({ role: 'carrier' });
    const carrierB = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 9000), ($1, $3, 8000)`,
      [job.id, carrierA.id, carrierB.id],
    );

    const res = await request(app)
      .get(`/jobs/${job.id}/bids`)
      .set('Authorization', `Bearer ${shipper.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('Regisztráció — jogosultság-eszkaláció tiltás', () => {
  it('role=admin regisztráció NEM ad admin fiókot', async () => {
    const res = await request(app).post('/auth/register').send({
      email: uniqueEmail('tamado'),
      password: 'Jelszo123!',
      full_name: 'Támadó Tóni',
      role: 'admin',
    });

    expect(res.status).toBeLessThan(300);
    const { rows } = await db.query('SELECT role FROM users WHERE email = $1', [
      res.body.user?.email || res.body.email,
    ]);
    expect(rows[0].role).not.toBe('admin');
  });
});
