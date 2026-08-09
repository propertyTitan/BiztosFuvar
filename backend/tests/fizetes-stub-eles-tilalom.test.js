// =====================================================================
//  STUB FIZETÉS ÉLESBEN = TILTOTT ÁLLAPOT (2026-08-09, audit 3. kör)
//
//  A stub (kulcs nélküli) provider dev/teszt eszköz: nem szed pénzt, és
//  kinyitja a kézi fizetés-nyugtázást, hogy a tesztek végigmehessenek a
//  pénz-úton. ÉLESBEN ugyanez azt jelentené, hogy
//    - bárki fizetés nélkül „fizetettnek" jelöli a saját fuvarát/foglalását
//      (/confirm-payment), és
//    - a webhook a NYERS BODY-nak hinne (nincs mihez visszaolvasni),
//  vagyis a platform EGYETLEN bevétele (kapcsolatfelvételi díj) megkerülhető.
//
//  Eddig ezt csak egy boot-időben kiírt figyelmeztetés jelezte — egy
//  elfelejtett env-változó némán nyitva hagyta a kaput. A guard mostantól
//  futásidőben is zár. Ez a suite azt őrzi, hogy ne csússzon vissza.
//
//  ⚠️ A védelem FUTÁSIDEJŰ, nem boot-leállás (2026-08-09, éles tanulság): a
//  hard-fail kipróbálva — a Railway-en NODE_ENV=production, a CIB-kulcs pedig
//  a launchig nincs, így a boot-exit újraindítási ciklusba tette az éles
//  backendet (502-es API). A launch előtt a „prod + stub" a NORMÁL üzem; amit
//  védeni kell, az az, hogy közben senki ne juthasson fizetés nélkül
//  kontakthoz — ezt a lenti guardok adják.
// =====================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const paymentProvider = require('../src/services/paymentProvider');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_STUB_PAYMENTS = '';
});

/** Éles futás szimulálása (a provider marad stub — nincs kulcs). */
function elesFutas() {
  process.env.NODE_ENV = 'production';
}

async function nyugtazhatoFuvar() {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
  });
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  return { felado, job };
}

describe('paymentProvider: az éles+stub kombináció felismerése', () => {
  it('teszt-környezetben a stub HASZNÁLHATÓ (különben a suite sem tudna fizetni)', () => {
    expect(paymentProvider.isStub()).toBe(true);
    expect(paymentProvider.isUnsafeStub()).toBe(false);
    expect(paymentProvider.manualConfirmAllowed()).toBe(true);
  });

  it('éles futásban a stub TILTOTT állapot, a kézi nyugtázás zárva', () => {
    elesFutas();
    expect(paymentProvider.isUnsafeStub()).toBe(true);
    expect(paymentProvider.manualConfirmAllowed()).toBe(false);
  });

  it('a guardot SEMMILYEN env-kapcsoló nem oldja fel', () => {
    elesFutas();
    // Egy „vész-kapcsoló" elfelejtve maradna bekapcsolva pont a launchkor, és
    // épp azt a rést nyitná ki, ami ellen az egész véd. Ezért nincs ilyen.
    process.env.ALLOW_STUB_PAYMENTS = 'true';
    process.env.SKIP_PAYMENT_GUARD = 'true';
    expect(paymentProvider.isUnsafeStub()).toBe(true);
    expect(paymentProvider.manualConfirmAllowed()).toBe(false);
    delete process.env.SKIP_PAYMENT_GUARD;
  });
});

describe('Fuvar: kézi fizetés-nyugtázás éles futásban', () => {
  it('éles futás + kulcs nélküli provider → a fuvar NEM jelölhető fizetettnek', async () => {
    const { felado, job } = await nyugtazhatoFuvar();
    elesFutas();

    const res = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${felado.token}`).send({});

    expect(res.status, 'DÍJ-MEGKERÜLÉS: éles futásban kézzel fizetettnek lehetett jelölni!').toBe(409);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).toBeNull();
  });

  it('teszt-környezetben ugyanez a hívás átmegy (a flow tesztelhető marad)', async () => {
    const { felado, job } = await nyugtazhatoFuvar();
    const res = await request(app)
      .post(`/jobs/${job.id}/confirm-payment`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);
  });
});

describe('Foglalás: kézi fizetés-nyugtázás éles futásban', () => {
  it('éles futás + kulcs nélküli provider → a foglalás NEM jelölhető fizetettnek', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false,
    });
    await db.query('UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1', [booking.id]);
    elesFutas();

    const res = await request(app)
      .post(`/route-bookings/${booking.id}/confirm-payment`)
      .set('Authorization', `Bearer ${felado.token}`).send({});

    expect(res.status, 'DÍJ-MEGKERÜLÉS a foglalási ágon!').toBe(409);
    const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].paid_at).toBeNull();
  });
});

describe('Webhook: éles futásban a stub-callback nem dolgozható fel', () => {
  it('hamisított „Succeeded" POST éles+stub állapotban 503, nem fizetés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', $2, 0, 500)`,
      [job.id, `hamis-${job.id}`],
    );
    elesFutas();

    const res = await request(app)
      .post('/payments/cib/callback')
      .send({ PaymentId: `hamis-${job.id}`, Status: 'Succeeded' });

    expect(res.status).toBe(503);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a hamisított callback fizetettnek jelölte a fuvart!').toBeNull();
  });
});
