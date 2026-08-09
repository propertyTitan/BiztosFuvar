// =====================================================================
//  A JÁRAT-FOGLALÁS SZÁMLÁJA A DÍJRÓL SZÓL, NEM A FUVARDÍJRÓL
//
//  Audit-találat (2026-08-09, KRITIKUS). A fizetési webhook a foglalási
//  ágon a `route_bookings.price_huf`-ot vette „platform-díjnak" — az viszont
//  a KÉSZPÉNZES FUVARDÍJ (pl. 12.000 Ft), nem a kapcsolatfelvételi díj
//  (500/1.000 Ft). Minden éles járat-fizetésnél ez következett volna be:
//    - a bank 500 Ft-ot terhel,
//    - a Számlázz.hu 12.000 Ft-ról állít ki ADÓÜGYI SZÁMLÁT (NAV-adat-
//      szolgáltatással) → csak sztornóval javítható,
//    - a 45/2014. 18. § szerinti visszaigazoló e-mail hamis összeget ír,
//    - a bevételi napló (payment_events.platform_fee) is torzul.
//
//  Azért nem bukott ki korábban, mert a webhook-tesztek között EGYETLEN
//  foglalási eset sem volt. Ez a fájl pótolja.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

const webhook = (body) => request(app).post('/payments/cib/callback').send(body);

/** Megerősített, fizetésre váró foglalás — a díj a fuvardíjtól ELTÉRŐ összeg. */
async function fizetesreVaroFoglalas({ priceHuf = 12000, feeHuf = 500 } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const { booking } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false, priceHuf,
  });
  const paymentId = `cib-teszt-${booking.id}`;
  await db.query(
    `UPDATE route_bookings
        SET connection_fee_huf = $2, fee_consent_at = NOW(), barion_payment_id = $3
      WHERE id = $1`,
    [booking.id, feeHuf, paymentId],
  );
  return { felado, szallito, booking, paymentId, priceHuf, feeHuf };
}

const szamla = async (bookingId) => (await db.query(
  'SELECT * FROM invoices WHERE booking_id = $1', [bookingId],
)).rows[0];

const dijEsemeny = async (paymentId) => (await db.query(
  `SELECT * FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded'`, [paymentId],
)).rows[0];

describe('Foglalás-fizetés: a számla a KAPCSOLATFELVÉTELI DÍJRÓL szól', () => {
  it('500 Ft-os díj → 500 Ft-os számla (nem a 12.000 Ft-os fuvardíjról)', async () => {
    const { booking, paymentId } = await fizetesreVaroFoglalas({ priceHuf: 12000, feeHuf: 500 });

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBe(200);

    const inv = await szamla(booking.id);
    expect(inv, 'nem készült számla a foglalásról').toBeTruthy();
    expect(
      inv.gross_amount,
      'HIBÁS ADÓÜGYI BIZONYLAT: a számla a fuvardíjról szól, nem a beszedett díjról!',
    ).toBe(500);
    // A bruttóból visszafelé számolt nettó+ÁFA pontosan kiadja a terhelt összeget
    expect(inv.net_amount + inv.vat_amount).toBe(500);
  });

  it('felső sávos díj (1.000 Ft) is pontosan annyi', async () => {
    const { booking, paymentId } = await fizetesreVaroFoglalas({ priceHuf: 150000, feeHuf: 1000 });
    await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    const inv = await szamla(booking.id);
    expect(inv.gross_amount).toBe(1000);
  });

  it('a bevételi napló (payment_events) is a díjat könyveli', async () => {
    const { paymentId } = await fizetesreVaroFoglalas({ priceHuf: 12000, feeHuf: 500 });
    await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    const esemeny = await dijEsemeny(paymentId);
    expect(esemeny.platform_fee).toBe(500);
    expect(esemeny.total_amount).toBe(500);
  });

  it('a foglalás fizetettre vált, és a fuvardíj érintetlen marad', async () => {
    const { booking, paymentId, priceHuf } = await fizetesreVaroFoglalas();
    await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    const { rows } = await db.query(
      'SELECT paid_at, price_huf, connection_fee_huf FROM route_bookings WHERE id = $1',
      [booking.id],
    );
    expect(rows[0].paid_at).not.toBeNull();
    expect(rows[0].price_huf, 'a készpénzes fuvardíj nem változhat').toBe(priceHuf);
    expect(rows[0].connection_fee_huf).toBe(500);
  });
});
