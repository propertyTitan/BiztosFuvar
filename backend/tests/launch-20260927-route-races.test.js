import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const auth = u => ['Authorization', `Bearer ${u.token}`];
beforeEach(() => __resetRateLimitsForTests());
async function setup() {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const { booking, routeId } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' });
  await db.query("INSERT INTO carrier_route_prices(route_id,size,price_huf) VALUES($1,'M',10000)", [routeId]);
  const cancel = () => request(app).patch(`/carrier-routes/${routeId}/status`).set(...auth(carrier)).send({ status: 'cancelled' }).then(r => r);
  const confirm = () => request(app).post(`/route-bookings/${booking.id}/confirm`).set(...auth(carrier)).send({}).then(r => r);
  const book = () => request(app).post(`/carrier-routes/${routeId}/bookings`).set(...auth(shipper)).send({
    length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
    pickup_address: 'Budapest, Teszt utca 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
  }).then(r => r);
  return { shipper, carrier, booking, routeId, cancel, confirm, book };
}
async function waitForBlocked(fragment, count = 1) {
  for (let i = 0; i < 200; i++) {
    const r = await db.query("SELECT query FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE $1", [`%${fragment}%`]);
    if (r.rowCount >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`A párhuzamos kérés nem jutott el a várt DB-zárig: ${fragment}`);
}

it.each(['book', 'confirm'])('a lemondás mögött várakozó %s nem hagyhat aktív foglalást a lemondott járaton', async action => {
  const p = await setup(); const blocker = await db.pool.connect();
  let cancelled, pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM carrier_routes WHERE id=$1 FOR UPDATE', [p.routeId]);
    cancelled = p.cancel();
    await waitForBlocked('carrier_routes');
    pending = p[action]();
    await waitForBlocked('carrier_routes', 2);
  } finally { await blocker.query('COMMIT'); blocker.release(); }
  expect((await cancelled).status).toBe(200);
  const result = await pending; expect(result.status, JSON.stringify(result.body)).toBe(409);
  expect((await db.query("SELECT 1 FROM route_bookings WHERE route_id=$1 AND status IN ('pending','confirmed')", [p.routeId])).rowCount).toBe(0);
});

it('ha a foglalás létrehozása nyeri a zárat, a következő lemondás azt is lezárja', async () => {
  const p = await setup(); const blocker = await db.pool.connect();
  let booked, cancelled;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM carrier_routes WHERE id=$1 FOR UPDATE', [p.routeId]);
    booked = p.book(); await waitForBlocked('carrier_routes');
    cancelled = p.cancel(); await waitForBlocked('carrier_routes', 2);
  } finally { await blocker.query('COMMIT'); blocker.release(); }
  expect((await booked).status).toBe(201); expect((await cancelled).status).toBe(200);
  expect((await db.query("SELECT status FROM route_bookings WHERE route_id=$1", [p.routeId])).rows)
    .toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
});

it('a közben fizetetté váló foglalás megakadályozza a járat lemondását', async () => {
  const p = await setup(); const blocker = await db.pool.connect();
  let cancelled;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE route_bookings SET status='confirmed',paid_at=NOW() WHERE id=$1", [p.booking.id]);
    cancelled = p.cancel();
    await waitForBlocked('route_bookings');
  } finally { await blocker.query('COMMIT'); blocker.release(); }
  const result = await cancelled;
  expect(result.status).toBe(409); expect(result.body.code).toBe('HAS_ACTIVE_PAID');
  expect((await db.query('SELECT status FROM carrier_routes WHERE id=$1', [p.routeId])).rows[0].status).toBe('open');
});

it.each(['cancelled', 'draft'])('régi pending foglalás sem erősíthető meg %s járaton', async status => {
  const p = await setup();
  await db.query('UPDATE carrier_routes SET status=$1 WHERE id=$2', [status, p.routeId]);
  const result = await p.confirm();
  expect(result.status).toBe(409); expect(result.body.code).toBe('ROUTE_NOT_OPEN');
  expect((await db.query('SELECT 1 FROM payment_sessions WHERE booking_id=$1', [p.booking.id])).rowCount).toBe(0);
});

it('a full járatra korábban beérkezett foglalás továbbra is elfogadható', async () => {
  const p = await setup();
  await db.query("UPDATE carrier_routes SET status='full' WHERE id=$1", [p.routeId]);
  expect((await p.confirm()).status).toBe(200);
});
