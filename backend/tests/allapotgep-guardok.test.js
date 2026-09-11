// =====================================================================
//  ÁLLAPOTGÉP-GUARDOK: „utolsó író nyer" helyett pontosan egy eredmény
//  (2026-09-11, Codex-audit P0-04)
//
//  Több ág előbb SELECT-elte az állapotot, majd feltétel nélküli UPDATE-et
//  futtatott. Két párhuzamos kérés között (dupla kattintás, két fül, a másik
//  fél egyidejű lépése) az utolsó író nyert: egy KIFIZETETT foglalás
//  'rejected'-be, egy felvett (in_progress) fuvar 'cancelled'-be, egy
//  lemondott fuvar 'in_progress'-be íródhatott. A versenyt determinisztikusan
//  szimuláljuk: a handler első SELECT-je UTÁN, az UPDATE ELŐTT átírjuk az
//  állapotot — pontosan az az ablak, amiben élesben a másik kérés jár.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** A handler első, mintára illő SELECT-je után lefuttatja az átíró SQL-t. */
async function kozbenAtir({ minta, atiroSql, params, fut }) {
  const eredeti = db.query;
  let megtortent = false;
  db.query = async (text, p) => {
    const r = await eredeti(text, p);
    if (!megtortent && minta.test(String(text))) {
      megtortent = true;
      await eredeti(atiroSql, params);
    }
    return r;
  };
  try {
    const res = await fut();
    expect(megtortent, 'a szimulált verseny nem futott le — a minta nem illett a handler SELECT-jére').toBe(true);
    return res;
  } finally {
    db.query = eredeti;
  }
}

describe('Foglalás: elutasítás vs. megerősítés versenye', () => {
  it('a közben megerősített (kifizetett) foglalást az elutasítás NEM írja felül', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' });

    const res = await kozbenAtir({
      minta: /SELECT b\.\*, r\.carrier_id, r\.title AS route_title/,
      atiroSql: `UPDATE route_bookings SET status = 'confirmed', paid_at = NOW() WHERE id = $1`,
      params: [booking.id],
      fut: () => request(app).post(`/route-bookings/${booking.id}/reject`).set(auth(carrier.token)),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('STATE_CHANGED');
    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status, 'a kifizetett foglalás elutasítottá vált').toBe('confirmed');
  });

  it('vitatott foglalás NEM mondható le (a fuvar-ág 2026-08-07-es szabálya)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'disputed', paid: true });
    const res = await request(app).post(`/route-bookings/${booking.id}/cancel`).set(auth(shipper.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toMatch(/vita/);
    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('disputed');
  });
});

describe('Fuvar: lemondás vs. felvétel versenye', () => {
  it('a közben felvett (in_progress) fuvart a feladó lemondása NEM írja felül', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });

    const res = await kozbenAtir({
      minta: /FROM jobs/,
      atiroSql: `UPDATE jobs SET status = 'in_progress' WHERE id = $1`,
      params: [job.id],
      fut: () => request(app).post(`/jobs/${job.id}/cancel`).set(auth(shipper.token)).send({ reason: 'meggondoltam' }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('STATE_CHANGED');
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'a felvett fuvar lemondottá vált').toBe('in_progress');
  });

  it('a közben lemondott fuvart a felvételi fotó NEM lépteti in_progress-be', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });

    const res = await kozbenAtir({
      minta: /SELECT \* FROM jobs WHERE id = \$1/,
      atiroSql: `UPDATE jobs SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
      params: [job.id],
      fut: () => request(app).post(`/jobs/${job.id}/photos`).set(auth(carrier.token))
        .field('kind', 'pickup').attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('STATE_CHANGED');
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'a lemondott fuvar in_progress lett').toBe('cancelled');
  });
});

describe('Fuvar: újranyitás egy tranzakcióban', () => {
  it('ha a fuvar közben nem accepted, az ajánlatok sem állnak át (nincs fél-siker)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const masik = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });
    const { rows: bid } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy)
       VALUES ($1, $2, 12000, 'rejected', 'included') RETURNING id`,
      [job.id, masik.id],
    );

    const res = await kozbenAtir({
      minta: /FROM jobs/,
      atiroSql: `UPDATE jobs SET status = 'in_progress' WHERE id = $1`,
      params: [job.id],
      fut: () => request(app).post(`/jobs/${job.id}/reopen`).set(auth(shipper.token)).send({ reason: 'nem jött' }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const { rows } = await db.query('SELECT status FROM bids WHERE id = $1', [bid[0].id]);
    expect(rows[0].status, 'fél-siker: a fuvar nem nyílt újra, az ajánlat mégis pending lett').toBe('rejected');
  });
});
