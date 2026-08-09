// =====================================================================
//  A Barion-callback inert, ha nem barion az AKTÍV fizetési provider.
//
//  A 2026-08-09-i biztonsági audit (pénz + authz ügynök, keresztvalidálva):
//  a launch CIB-re vált (PAYMENT_PROVIDER=cib, barion kulcs NÉLKÜL →
//  barion.isStub() örökre true). Enélkül a barion-callback a body-nak hisz,
//  és egy hamisított {"Status":"Succeeded"} POST fizetés nélkül beállítaná a
//  paid_at-ot + felfedné a kontaktot. A guard ezt zárja.
//
//  ⚠️ A meglévő fizetes-webhook.test.js "hamis zöld" volt erre: KÉZZEL
//  barion.isStub=false-ra állít, azaz csak a "barion az élő provider" esetet
//  fedte — a launch-konfigot (cib élő + barion stubbolt) SOHA.
// =====================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');

describe('Barion-callback: inert, ha nem barion az aktív provider (CIB-launch konfig)', () => {
  const eredeti = process.env.PAYMENT_PROVIDER;
  beforeEach(() => { process.env.PAYMENT_PROVIDER = 'cib'; });
  afterEach(() => {
    if (eredeti === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = eredeti;
  });

  it('hamisított Succeeded POST → 410, és a paid_at NEM áll be (fuvar-ág)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', 'FAKE-PAY-CIB-1', 0, 500)`,
      [job.id],
    );

    const res = await request(app).post('/payments/barion/callback')
      .send({ PaymentId: 'FAKE-PAY-CIB-1', Status: 'Succeeded' });
    expect(res.status).toBe(410);
    expect(res.body.ignored).toBe(true);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a hamisított callback NEM fizethetett').toBeNull();
  });

  it('a foglalási ág is védett (a paid_at ott sem áll be)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // Minimál route + booking, held escrow-sorral egy ismert payment-id-re
    const { rows: r } = await db.query(
      `INSERT INTO carrier_routes (carrier_id, title, departure_at, status)
       VALUES ($1, 'Teszt', NOW() + INTERVAL '1 day', 'open') RETURNING id`,
      [szallito.id],
    );
    const { rows: b } = await db.query(
      `INSERT INTO route_bookings (route_id, shipper_id, package_size, length_cm, width_cm, height_cm,
         weight_kg, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
         price_huf, delivery_code, status, tracking_token, barion_payment_id)
       VALUES ($1, $2, 'M', 40,30,20, 5, 'BP', 47.5,19.0, 'Szeged', 46.2,20.1, 500, '111222', 'confirmed', 'tok2', 'FAKE-PAY-CIB-2')
       RETURNING id`,
      [r[0].id, felado.id],
    );
    const res = await request(app).post('/payments/barion/callback')
      .send({ PaymentId: 'FAKE-PAY-CIB-2', Status: 'Succeeded' });
    expect(res.status).toBe(410);
    const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [b[0].id]);
    expect(rows[0].paid_at).toBeNull();
  });
});
