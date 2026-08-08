// =====================================================================
//  ADMIN FELHASZNÁLÓ-TÖRLÉS VÉDELME — adatvesztés fizető ügyfélnél
//
//  Részletes átvizsgálás (2026-08-08). Az admin user-törlés csupasz
//  `DELETE FROM users` volt, guard nélkül. A kaszkádok miatt ez két gondot
//  okozhatott:
//    (1) az admin véletlenül törölhette SAJÁT MAGÁT (kizárja magát);
//    (2) egy szállító törlése a carrier_routes → route_bookings CASCADE-en át
//        MÁS feladók FIZETETT foglalásait is megsemmisítette volna — egy
//        folyamatban lévő, kifizetett ügylet adatvesztése.
//
//  (A fuvar-ág biztonságosabb: jobs.carrier_id ON DELETE SET NULL — a feladó
//  fuvarja megmarad. A foglalási ág viszont route_id CASCADE, ezért volt
//  fragilis.)
//
//  A guard: aktív + fizetett ügyletben lévő usert nem lehet törölni (előbb
//  le kell zárni). Terminál/fizetetlen ügyletnél a törlés szabad.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

const del = (id, token) => request(app).delete(`/admin/users/${id}`)
  .set('Authorization', `Bearer ${token}`);

async function admin() { return createUser({ role: 'admin' }); }

describe('Admin user-törlés: biztonsági guardok', () => {
  it('az admin NEM törölheti saját magát', async () => {
    const a = await admin();
    const res = await del(a.id, a.token);
    expect(res.status).toBe(400);
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [a.id]);
    expect(rows.length, 'az admin törölte magát').toBe(1);
  });

  it('nem törölhető a szállító, akinek MÁS feladó FIZETETT, aktív foglalása van', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // fizetett, folyamatban lévő foglalás a szállító járatán
    await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const res = await del(szallito.id, a.token);
    expect(res.status, 'a szállítót törölni lehetett aktív fizetett foglalással').toBe(409);
    expect(res.body.code).toBe('USER_HAS_ACTIVE_PAID');

    // A szállító ÉS a foglalás is megvan
    const { rows: u } = await db.query('SELECT 1 FROM users WHERE id = $1', [szallito.id]);
    expect(u.length).toBe(1);
  });

  it('nem törölhető a feladó, akinek FIZETETT, aktív fuvara van', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await del(felado.id, a.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USER_HAS_ACTIVE_PAID');
  });

  it('TÖRÖLHETŐ a user, akinek csak LEZÁRT vagy FIZETETLEN ügylete van', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // kézbesített (terminál) fizetett fuvar — ez már nem aktív
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    // + egy fizetetlen, aktív fuvar (fizetetlen → nem véd)
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    const res = await del(felado.id, a.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [felado.id]);
    expect(rows.length, 'a törlés nem hajtódott végre').toBe(0);
  });

  it('nem létező user törlése → 404, nem 200', async () => {
    const a = await admin();
    const res = await del('11111111-1111-1111-1111-111111111111', a.token);
    expect(res.status).toBe(404);
  });

  it('járat-törlés: nem törölhető, ha aktív FIZETETT foglalás van rajta', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking, routeId } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const blokk = await request(app).delete(`/admin/routes/${routeId}`).set('Authorization', `Bearer ${a.token}`);
    expect(blokk.status, 'a járatot törölni lehetett aktív fizetett foglalással (adatvesztés!)').toBe(409);
    expect(blokk.body.code).toBe('HAS_ACTIVE_PAID');

    // a foglalás megvan
    const { rows } = await db.query('SELECT 1 FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows.length).toBe(1);
  });

  it('fuvar-törlés: aktív fizetett fuvar nem, terminál fizetett igen', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const aktiv = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    const blokk = await request(app).delete(`/admin/jobs/${aktiv.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(blokk.status).toBe(409);

    const lezart = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    const ok = await request(app).delete(`/admin/jobs/${lezart.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('foglalás-törlés: aktív fizetett foglalás nem törölhető', async () => {
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await request(app).delete(`/admin/bookings/${booking.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('HAS_ACTIVE_PAID');
  });

  it('a fuvar-ág védett: szállító törlésekor a feladó fuvarja MEGMARAD (carrier_id NULL)', async () => {
    // Ez a SET NULL kaszkádot igazolja: egy LEZÁRT fuvarnál a szállító
    // törölhető, és a feladó fuvara nem tűnik el, csak elveszti a szállítót.
    const a = await admin();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const res = await del(szallito.id, a.token);
    expect(res.status).toBe(200);

    const { rows } = await db.query('SELECT carrier_id FROM jobs WHERE id = $1', [job.id]);
    expect(rows.length, 'a feladó fuvara eltűnt a szállító törlésekor').toBe(1);
    expect(rows[0].carrier_id, 'a carrier_id nem NULL-ódott').toBeNull();
  });
});
