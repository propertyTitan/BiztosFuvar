// BUG-011 regressziós tesztek: mező-validációk a regisztrációnál és a
// profil-szerkesztésnél. A "8 szóköz mint jelszó" és a csupa-szóköz név
// korábban átment; a telefonszám/rendszám bármit elfogadott.
//
// FIGYELEM: a /auth/register rate-limitje IP-nként korlátos — ez a fájl
// szándékosan kevés (és többnyire sikertelen) register-hívást tesz.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, uniqueEmail } = require('./helpers');

function register(body) {
  return request(app).post('/auth/register').send(body);
}

describe('Regisztráció mező-validációk (BUG-011)', () => {
  it('csupa szóköz jelszó (8 szóköz) → 400', async () => {
    const res = await register({
      email: uniqueEmail('val'), password: '        ', full_name: 'Teszt Elek',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/szóköz/i);
  });

  it('csupa szóköz név → 400', async () => {
    const res = await register({
      email: uniqueEmail('val'), password: 'Jelszo123!', full_name: '    ',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/név/i);
  });

  it('szemét telefonszám és irreális hosszú név → 400', async () => {
    const badPhone = await register({
      email: uniqueEmail('val'), password: 'Jelszo123!', full_name: 'Teszt Elek',
      phone: 'nem-telefonszam!!!',
    });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toMatch(/telefonszám/i);

    const longName = await register({
      email: uniqueEmail('val'), password: 'Jelszo123!', full_name: 'x'.repeat(101),
    });
    expect(longName.status).toBe(400);
  });
});

describe('Cím-validációk (TC-013/TC-107)', () => {
  it('csupa-szóköz és túl hosszú fuvar-cím → 400', async () => {
    const user = await createUser();
    const base = {
      pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
      dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
      weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
    };
    const spaces = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ ...base, title: '    ' });
    expect(spaces.status).toBe(400);

    const tooLong = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ ...base, title: 'x'.repeat(500) });
    expect(tooLong.status).toBe(400);
  });

  it('csupa-szóköz útvonalnév → 400', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({
        title: '   ',
        departure_at: new Date(Date.now() + 86400000).toISOString(),
        waypoints: [
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
          { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
        ],
        prices: [{ size: 'M', price_huf: 10000 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/útvonal neve/i);
  });
});

describe('Profil-szerkesztés mező-validációk (BUG-011)', () => {
  it('csupa szóköz név és szemét rendszám → 400; érvényes értékek trimmelve mentődnek', async () => {
    const user = await createUser();

    const badName = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ full_name: '   ' });
    expect(badName.status).toBe(400);

    const badPlate = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ vehicle_plate: '<script>alert(1)</script>' });
    expect(badPlate.status).toBe(400);

    const ok = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ full_name: '  Rendes Név  ', phone: '+36 20 123 4567', vehicle_plate: 'abc-123' });
    expect(ok.status).toBe(200);
    expect(ok.body.full_name).toBe('Rendes Név');
    expect(ok.body.vehicle_plate).toBe('ABC-123');
  });
});
