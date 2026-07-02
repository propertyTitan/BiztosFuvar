// A pénz-út üzleti szabályai: fizetés nélkül nem indul munka, a kézbesítési
// kód nem brute-force-olható, a letét pontosan egyszer szabadul fel.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, TINY_PNG } = require('./helpers');

function uploadPhoto({ jobId, token, kind, deliveryCode }) {
  const req = request(app)
    .post(`/jobs/${jobId}/photos`)
    .set('Authorization', `Bearer ${token}`)
    .field('kind', kind);
  if (deliveryCode) req.field('delivery_code', deliveryCode);
  return req.attach('file', TINY_PNG, { filename: 'teszt.png', contentType: 'image/png' });
}

describe('Fizetési guard — fizetetlen fuvaron nem indul munka', () => {
  it('fizetetlen fuvarra a pickup fotó 409-et kap, a státusz marad accepted', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: false });

    const res = await uploadPhoto({ jobId: job.id, token: carrier.token, kind: 'pickup' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nincs kifizetve/);
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('accepted');
  });

  it('fizetetlen fuvaron a dropoff (lezárás) sem megy, jó kóddal sem', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: false,
    });

    const res = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nincs kifizetve/);
  });

  it('kifizetett fuvaron a pickup átmegy és in_progress-re vált', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await uploadPhoto({ jobId: job.id, token: carrier.token, kind: 'pickup' });

    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('a feladó confirm-payment hívása után a korábban tiltott pickup már átmegy', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: false });

    const blocked = await uploadPhoto({ jobId: job.id, token: carrier.token, kind: 'pickup' });
    expect(blocked.status).toBe(409);

    const pay = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(pay.status).toBe(200);

    const allowed = await uploadPhoto({ jobId: job.id, token: carrier.token, kind: 'pickup' });
    expect(allowed.status).toBe(201);
  });
});

describe('Kézbesítési kód — brute force védelem', () => {
  it('rossz kód 403, az 5. hibás próba után jó kóddal is zárolva (429)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    for (let i = 0; i < 5; i += 1) {
      const res = await uploadPhoto({
        jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '000000',
      });
      expect(res.status).toBe(403);
    }

    // A zárolás után a HELYES kód sem megy át
    const locked = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(locked.status).toBe(429);

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('helyes kóddal a fuvar delivered lesz és a letét felszabadul', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const res = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });

    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('delivered');
    const { rows: esc } = await db.query(
      'SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(esc[0].status).toBe('released');
  });

  it('második (ismételt) kézbesítés 409 — a letét nem szabadulhat fel kétszer', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const first = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(first.status).toBe(201);

    const second = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(second.status).toBe(409);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS released FROM escrow_transactions
        WHERE job_id = $1 AND status = 'released'`, [job.id],
    );
    expect(rows[0].released).toBe(1);
  });

  it('a feladó vész-kódja (sender_delivery_code) is lezárja a fuvart', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const res = await uploadPhoto({
      jobId: job.id, token: carrier.token, kind: 'dropoff', deliveryCode: '333444',
    });

    expect(res.status).toBe(201);
    const { rows } = await db.query(
      'SELECT status, closed_by_code_type FROM jobs WHERE id = $1', [job.id],
    );
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].closed_by_code_type).toBe('sender_emergency');
  });

  it('idegen (nem kijelölt) sofőr fotót sem tölthet fel — 403', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const intruder = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const res = await uploadPhoto({
      jobId: job.id, token: intruder.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(res.status).toBe(403);
  });
});
