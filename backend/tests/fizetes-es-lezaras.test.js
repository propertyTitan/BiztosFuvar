// A pénz-út üzleti szabályai (készpénzes modell): a kapcsolatfelvételi díj
// megfizetése nélkül nem indul munka, a kézbesítési kód nem brute-force-olható,
// lemondáskor nincs pénzmozgás, szállító-lemondásnál a fuvar díjmentesen újranyílik.
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
    expect(res.body.error).toMatch(/kapcsolatfelvételi díjat/);
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
    expect(res.body.error).toMatch(/kapcsolatfelvételi díjat/);
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

    // Consent nélkül a fizetés el sem indítható (elállási jog tudomásulvétele
    // a Barion-redirect ELŐTT kötelező) és nyugtázni sem lehet
    const noConsentPay = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({});
    expect(noConsentPay.status).toBe(400);
    expect(noConsentPay.body.code).toBe('CONSENT_REQUIRED');

    const noConsentConfirm = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(noConsentConfirm.status).toBe(400);
    expect(noConsentConfirm.body.code).toBe('CONSENT_REQUIRED');

    // Consent-tel az indítás rögzíti a nyilatkozatot, a nyugtázás átmegy
    const start = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ consent: true });
    expect(start.status).toBe(200);

    const pay = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(pay.status).toBe(200);

    // A nyilatkozat időbélyege (jogi bizonyíték) mentve
    const { rows: consentRows } = await db.query(
      'SELECT fee_consent_at FROM jobs WHERE id = $1', [job.id],
    );
    expect(consentRows[0].fee_consent_at).toBeTruthy();

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

  it('helyes kóddal a fuvar delivered lesz (a díj-sor released marad, pénzmozgás nincs)', async () => {
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

  it('második (ismételt) kézbesítés 409 — a státusz-átmenet egyszeri', async () => {
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

  it('feladói lemondás: nincs lemondási díj, nincs refund, a befizetett díj-sor released marad', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true, priceHuf: 20000,
    });

    const res = await request(app)
      .post(`/jobs/${job.id}/cancel`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ reason: 'teszt lemondás' });

    expect(res.status).toBe(200);
    expect(res.body.cancellation_fee_huf).toBe(0);
    expect(res.body.refund_huf).toBe(0);
    expect(res.body.fee_kept).toBe(true); // a díj nem jár vissza — őszinte visszajelzés

    const { rows } = await db.query(
      'SELECT status FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(rows[0].status).toBe('released'); // a befizetett díj végleges

    const { rows: jrows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(jrows[0].status).toBe('cancelled');
  });

  it('szállítói lemondás elfogadott fuvaron: díjmentes újranyitás, a díj megmarad a fuvaron', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true, priceHuf: 20000,
    });

    const res = await request(app)
      .post(`/jobs/${job.id}/cancel`)
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({ reason: 'defekt' });

    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
    expect(res.body.status).toBe('bidding');

    const { rows } = await db.query(
      'SELECT status, carrier_id, paid_at, connection_fee_huf, reopened_count FROM jobs WHERE id = $1',
      [job.id],
    );
    expect(rows[0].status).toBe('bidding');
    expect(rows[0].carrier_id).toBeNull();
    expect(rows[0].paid_at).toBeTruthy(); // a díj a fuvaron marad
    expect(Number(rows[0].connection_fee_huf)).toBe(500); // 20 000 Ft még az 500 Ft-os sáv
    expect(rows[0].reopened_count).toBe(1);
  });

  it('a feladó szállítót cserélhet (reopen): a korábbi elutasított licitek visszaállnak pending-re', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const otherCarrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true, priceHuf: 20000,
    });
    // A nyertes + egy elfogadáskor elutasított licit
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy)
       VALUES ($1, $2, 20000, 'accepted', 'included'), ($1, $3, 22000, 'rejected', 'included')`,
      [job.id, carrier.id, otherCarrier.id],
    );

    const res = await request(app)
      .post(`/jobs/${job.id}/reopen`)
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ reason: 'nem veszi fel a telefont' });

    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);

    const { rows: bids } = await db.query(
      'SELECT carrier_id, status FROM bids WHERE job_id = $1 ORDER BY amount_huf', [job.id],
    );
    const byCarrier = Object.fromEntries(bids.map((b) => [b.carrier_id, b.status]));
    expect(byCarrier[carrier.id]).toBe('rejected'); // a leváltott szállító licitje lezárva
    expect(byCarrier[otherCarrier.id]).toBe('pending'); // a többi újra választható
  });

  it('idegen (nem kijelölt) szállító fotót sem tölthet fel — 403', async () => {
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
