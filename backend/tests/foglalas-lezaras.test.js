// BUG-041 regressziós tesztek: a fix áras foglalás lezárási útja.
// A licites fuvarok pénz-út szabályainak tükre a foglalási ágon:
// díj-fizetés nélkül nem indul munka, a kód nem brute-force-olható,
// a helyes kóddal a foglalás delivered lesz.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createBooking, TINY_PNG } = require('./helpers');

function uploadPhoto({ bookingId, token, kind, deliveryCode }) {
  const req = request(app)
    .post(`/route-bookings/${bookingId}/photos`)
    .set('Authorization', `Bearer ${token}`)
    .field('kind', kind);
  if (deliveryCode) req.field('delivery_code', deliveryCode);
  return req.attach('file', TINY_PNG, { filename: 'teszt.png', contentType: 'image/png' });
}

describe('Foglalás-lezárás (BUG-041) — fizetési guard', () => {
  it('fizetetlen foglaláson a pickup 409, a státusz marad confirmed', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: false });

    const res = await uploadPhoto({ bookingId: booking.id, token: carrier.token, kind: 'pickup' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/kapcsolatfelvételi díjat/);
    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('confirmed');
  });

  it('fizetett foglaláson a pickup átmegy és in_progress-re vált', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await uploadPhoto({ bookingId: booking.id, token: carrier.token, kind: 'pickup' });

    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('idegen (nem az útvonal sofőrje) fotót sem tölthet fel — 403', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const intruder = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await uploadPhoto({ bookingId: booking.id, token: intruder.token, kind: 'pickup' });
    expect(res.status).toBe(403);
  });
});

describe('Foglalás-lezárás (BUG-041) — kézbesítési kód', () => {
  it('helyes kóddal a foglalás delivered lesz, delivered_at kitöltve', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const res = await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });

    expect(res.status).toBe(201);
    const { rows } = await db.query(
      'SELECT status, delivered_at FROM route_bookings WHERE id = $1', [booking.id],
    );
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].delivered_at).toBeTruthy();
  });

  it('rossz kód 403, az 5. hibás próba után jó kóddal is zárolva (429)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    for (let i = 0; i < 5; i += 1) {
      const res = await uploadPhoto({
        bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '000000',
      });
      expect(res.status).toBe(403);
    }

    const locked = await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(locked.status).toBe(429);

    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('második (ismételt) kézbesítés 409 — a lezárt foglalás nem nyitható újra fotóval', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });

    const first = await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(first.status).toBe(201);

    const second = await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(second.status).toBe(409);
  });

  it('a kézbesítés csak in_progress állapotból megy — confirmed-ből 409', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed', paid: true,
    });

    const res = await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(res.status).toBe(409);
  });

  it('a foglalás felei látják a fotókat, idegen nem', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const stranger = await createUser();
    const { booking } = await createBooking({
      shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true,
    });
    await uploadPhoto({
      bookingId: booking.id, token: carrier.token, kind: 'dropoff', deliveryCode: '111222',
    });

    const asShipper = await request(app)
      .get(`/route-bookings/${booking.id}/photos`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(asShipper.status).toBe(200);
    expect(asShipper.body.length).toBe(1);

    const asStranger = await request(app)
      .get(`/route-bookings/${booking.id}/photos`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(asStranger.status).toBe(403);
  });
});
