// =====================================================================
//  FOGLALÁS-FIZETÉS: az AKTÍV provider dönt, nem a Barion
//
//  Részletes átvizsgálás (2026-08-08) launch-kritikus találata. A foglalási
//  (Járat) ág a fuvar-ággal ellentétben KÖZVETLENÜL a barion-t hívta:
//    - a foglalás-díj a `barion.startFeePayment`-en ment,
//    - a confirm-payment guard `barion.isStub()`-ot nézett.
//
//  A launch QVIK-re vált (PAYMENT_PROVIDER=qvik, Barion elvetve). Ekkor
//  `barion.isStub()` TRUE (nincs Barion-kulcs), így a foglalás
//  confirm-payment guard KIKAPCSOLT volna: bárki fizetés nélkül fizetettnek
//  jelölhette volna a saját foglalását — a Járat-díj teljes megkerülése.
//
//  Javítás után a foglalási ág is a `paymentProvider` absztrakciót nézi,
//  ugyanúgy, mint a fuvar-ág. Ez a teszt a guardot őrzi: éles provider
//  mellett a kézi nyugtázás TILOS (a webhook a hiteles forrás).
// =====================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createBooking } = require('./helpers');
const paymentProvider = require('../src/services/paymentProvider');
const cib = require('../src/services/cib');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

/** Megerősített, fizetetlen foglalás, a beleegyezés már rögzítve. */
async function nyugtazhatoFoglalas() {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const { booking } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false,
  });
  await db.query('UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1', [booking.id]);
  return { felado, szallito, booking };
}

const confirm = (bookingId, token) => request(app)
  .post(`/route-bookings/${bookingId}/confirm-payment`)
  .set('Authorization', `Bearer ${token}`).send({});

describe('Foglalás confirm-payment: az aktív provider guardja', () => {
  it('ÉLES provider mellett a kézi nyugtázás TILOS (a webhook a hiteles forrás)', async () => {
    const { felado, booking } = await nyugtazhatoFoglalas();

    // „Éles" provider szimulálása az AKTÍV provider-modul (CIB) szintjén —
    // ez a valós konfigurációt utánozza (van kulcs → nem stub). Korábban itt
    // a `paymentProvider.isStub` volt mockolva; a guard azóta a
    // `manualConfirmAllowed()`-en megy, ami mindig az aktív providertől kérdez,
    // így a burkoló mockolása már nem érte volna el a valódi útvonalat.
    const eredeti = cib.isStub;
    cib.isStub = () => false;
    try {
      const res = await confirm(booking.id, felado.token);
      expect(
        res.status,
        'FIZETÉS-MEGKERÜLÉS: a foglalást kézzel fizetettnek lehetett jelölni éles provider mellett!',
      ).toBe(409);

      const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [booking.id]);
      expect(rows[0].paid_at, 'a foglalás fizetettnek jelölődött fizetés nélkül').toBeNull();
    } finally {
      cib.isStub = eredeti;
    }
  });

  it('STUB (teszt) módban a kézi nyugtázás működik — így tesztelhető a flow', async () => {
    const { felado, booking } = await nyugtazhatoFoglalas();
    // Alapból stub (nincs kulcs) → a nyugtázás lezárja a fizetést
    const res = await confirm(booking.id, felado.token);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);

    const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].paid_at, 'stub módban sem zárult le a fizetés').toBeTruthy();
  });

  it('idegen nem nyugtázhatja más foglalásának fizetését', async () => {
    const { booking } = await nyugtazhatoFoglalas();
    const idegen = await createUser({ role: 'shipper' });
    const res = await confirm(booking.id, idegen.token);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
