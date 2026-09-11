// =====================================================================
//  SZÁLLÍTÓI FELFÜGGESZTÉS — a can_bid valódi kapu (2026-09-11, D4)
//
//  Codex-audit P1-03: a can_bid az adminon írható volt, de egyetlen
//  jogosultsági kapu sem olvasta — az admin azt hitte, letiltotta a
//  szállítót, az tovább licitált. Ez a moderáció minimuma a launchra.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('can_bid = false', () => {
  it('ajánlattétel, járat-hirdetés és azonnali elfogadás egyaránt 403 CARRIER_SUSPENDED', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET can_bid = FALSE WHERE id = $1', [carrier.id]);
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(bid.status, JSON.stringify(bid.body)).toBe(403);
    expect(bid.body.code).toBe('CARRIER_SUSPENDED');

    const route = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send({ title: 'Teszt járat', departure_at: new Date(Date.now() + 86400000).toISOString(), waypoints: [] });
    expect(route.status, JSON.stringify(route.body)).toBe(403);
    expect(route.body.code).toBe('CARRIER_SUSPENDED');

    const instant = await request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(carrier.token)).send({});
    expect(instant.status, JSON.stringify(instant.body)).toBe(403);
    expect(instant.body.code).toBe('CARRIER_SUSPENDED');
  });

  it('az admin a PATCH-csel felfüggeszt és felold; a lista mutatja a can_bid-et', async () => {
    const admin = await createUser({ role: 'admin' });
    const carrier = await createUser({ role: 'carrier' });
    const off = await request(app).patch(`/admin/users/${carrier.id}`).set(auth(admin.token)).send({ can_bid: false });
    expect(off.status).toBe(200);
    const lista = await request(app).get(`/admin/users?search=${encodeURIComponent(carrier.email)}`).set(auth(admin.token));
    expect(lista.status).toBe(200);
    const sor = lista.body.find((u) => u.id === carrier.id);
    expect(sor, 'a szállító nincs a listában').toBeTruthy();
    expect(sor.can_bid, 'az admin-lista nem mutatja a felfüggesztést').toBe(false);
    const on = await request(app).patch(`/admin/users/${carrier.id}`).set(auth(admin.token)).send({ can_bid: true });
    expect(on.status).toBe(200);
    const { rows } = await db.query('SELECT can_bid FROM users WHERE id = $1', [carrier.id]);
    expect(rows[0].can_bid).toBe(true);
  });

  it('kontroll: nem felfüggesztett szállító ajánlata nem 403', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const bid = await request(app).post(`/jobs/${job.id}/bids`).set(auth(carrier.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(bid.status, JSON.stringify(bid.body)).not.toBe(403);
  });
});
