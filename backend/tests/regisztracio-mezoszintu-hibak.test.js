// =====================================================================
//  REGISZTRÁCIÓ — A HIBA MEGNEVEZI A MEZŐT (UX-kör A10, 2026-10-08)
//
//  A regisztráció üres beküldésre eddig egyetlen „Hiányzó mezők" választ
//  adott, foglalt e-mail-címre pedig „Foglalt email"-t: a felhasználó nem
//  tudta, MELYIK mező a hibás és MIT tegyen. A web mostantól mezőszinten
//  jelez, és hibás űrlapot el sem küld — de a szerver válaszának önmagában
//  is érthetőnek kell lennie (más kliens, régi böngésző-fül, API-hívó).
//
//  Ez az őr a javítás NÉLKÜL piros: a régi válaszban nincs mezőnév, nincs
//  `code` és nincs `fields`.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, uniqueEmail } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => {
  __resetRateLimitsForTests();
});

describe('POST /auth/register — a hiányzó mezők megnevezve', () => {
  it('üres beküldésre mindhárom kötelező mezőt megnevezi', async () => {
    const res = await request(app).post('/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
    expect(res.body.fields).toEqual(['email', 'password', 'full_name']);
    expect(res.body.error, 'a felhasználónak olvasható üzenet a mezők nevével')
      .toBe('Hiányzó mezők: e-mail-cím, jelszó, teljes név.');
  });

  it('csak a ténylegesen hiányzót nevezi meg', async () => {
    const res = await request(app).post('/auth/register')
      .send({ email: uniqueEmail('hianyzo'), password: 'Jelszo123!' });
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual(['full_name']);
    expect(res.body.error).toBe('Hiányzó mezők: teljes név.');
  });
});

describe('POST /auth/register — foglalt e-mail-cím', () => {
  it('409 EMAIL_TAKEN, és megmondja, mit tegyen a felhasználó', async () => {
    const email = uniqueEmail('foglalt');
    const elso = await request(app).post('/auth/register')
      .send({ email, password: 'Jelszo123!', full_name: 'Első Elemér' });
    expect(elso.status).toBe(201);

    __resetRateLimitsForTests();
    const masodik = await request(app).post('/auth/register')
      .send({ email, password: 'Jelszo123!', full_name: 'Második Márta' });
    expect(masodik.status).toBe(409);
    expect(masodik.body.code).toBe('EMAIL_TAKEN');
    expect(masodik.body.error).toMatch(/foglalt/);
    expect(masodik.body.error).toMatch(/lépj be|új jelszó/);
  });
});
