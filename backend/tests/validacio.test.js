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
