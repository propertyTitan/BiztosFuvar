// =====================================================================
//  UX A03 (2026-10-08): a Trust Score BELSŐ pontszám.
//
//  Az adatkezelési tájékoztató (2026-10-08) azt mondja: belső, tájékoztató
//  pontszám, a felületen csak az adminisztrátor látja. A felület tényleg nem
//  mutatta — az API viszont MÁS felhasználónak is kiadta (a feladónak az
//  ajánlattevő szállítóét, a publikus profilon bárkinek). Ez az őr azt
//  tartja, hogy a szöveg a kódra is igaz legyen: más ember pontszáma
//  egyik nem-admin végponton sem jár.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const request = require('supertest');
const { db, app, createUser, createJob } = require('./helpers');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Trust Score — más felhasználónak nem jár', () => {
  it('a feladó az ajánlatok listáján nem kapja meg a szállító pontszámát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET trust_score = 73 WHERE id = $1', [szallito.id]);
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      'INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 15000)',
      [job.id, szallito.id],
    );
    const res = await request(app).get(`/jobs/${job.id}/bids`).set(auth(felado.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0], 'a szállító belső pontszáma kiment a feladónak').not.toHaveProperty('trust_score');
  });

  it('a publikus profil nem adja ki a pontszámot', async () => {
    const nezo = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET trust_score = 73 WHERE id = $1', [szallito.id]);
    const res = await request(app).get(`/auth/users/${szallito.id}/profile`).set(auth(nezo.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body), 'a publikus profil kiadja a belső pontszámot').not.toMatch(/trust_?score/i);
  });
});
