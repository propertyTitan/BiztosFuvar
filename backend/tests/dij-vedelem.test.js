// =====================================================================
//  Díj-védelem — a platform EGYETLEN bevételét (kapcsolatfelvételi díj) és
//  az adatintegritást védő guardok (2026-08-09, több-ügynökös átvizsgálás).
//
//  Négy tétel:
//   #1 kontakt-szivárgás szűrés MINDEN fizetés-előtti szabad-szövegen
//   #3 a címzett-mezők (recipient_*) csak a díjfizetés UTÁN a szállítónak
//   #2 a self-delete nem semmisíthet meg fizetett/vitás ügyletet
//   #4 reopen-plafon a kontakt-aratás ellen
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, uniqueEmail } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

const VALID_JOB = {
  title: 'Díj-védelem teszt fuvar',
  pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};

// Reprezentatív kontakt-szivárgások (telefonszám többféle formában + email)
const LEAKS = ['Hívj: 06301234567', '+36 30 123 4567', 'email: valaki@gmail.com', 'elerheto 0036201112233'];

describe('#1 Kontakt-szivárgás szűrés a fizetés-előtti mezőkön', () => {
  it('POST /jobs — a cím és a leírás nem tartalmazhat elérhetőséget', async () => {
    const felado = await createUser({ role: 'shipper' });
    for (const leak of LEAKS) {
      __resetRateLimitsForTests();
      const descRes = await request(app).post('/jobs').set(auth(felado.token))
        .send({ ...VALID_JOB, description: leak });
      expect(descRes.status, `description "${leak}"`).toBe(400);
      expect(descRes.body.code).toBe('CONTACT_LEAK');
    }
    // A cím-mezőben is
    const titleRes = await request(app).post('/jobs').set(auth(felado.token))
      .send({ ...VALID_JOB, title: 'Fuvar 06301234567' });
    expect(titleRes.status).toBe(400);
    // Kontroll: tiszta feladás átmegy
    const ok = await request(app).post('/jobs').set(auth(felado.token))
      .send({ ...VALID_JOB, description: 'Törékeny, kérlek óvatosan.' });
    expect(ok.status).toBe(201);
  });

  it('POST /bids — az ajánlat-üzenet nem tartalmazhat elérhetőséget', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included', message: 'Hívj: 0630 123 4567' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
    // Kontroll: tiszta üzenettel megy
    __resetRateLimitsForTests();
    const ok = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included', message: 'Délután érek oda.' });
    expect(ok.status).toBe(201);
  });

  it('POST /carrier-routes — a járat leírása és jármű-leírása szűrt', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const base = {
      title: 'BP-Szeged járat', departure_at: new Date(Date.now() + 86400000).toISOString(),
      waypoints: [{ lat: 47.5, lng: 19.0 }, { lat: 46.2, lng: 20.1 }],
      prices: [{ size: 'M', price_huf: 5000 }],
    };
    const descRes = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send({ ...base, description: 'Írj: sofor@gmail.com' });
    expect(descRes.status).toBe(400);
    __resetRateLimitsForTests();
    const vehRes = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send({ ...base, vehicle_description: 'Transit, hívj 06201234567' });
    expect(vehRes.status).toBe(400);
  });

  it('POST /carrier-routes/:id/bookings — a foglalás jegyzete szűrt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { routeId } = await createBooking({ shipperId: felado.id, carrierId: szallito.id });
    const res = await request(app).post(`/carrier-routes/${routeId}/bookings`).set(auth(felado.token))
      .send({
        length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
        pickup_address: 'Budapest', pickup_lat: 47.5, pickup_lng: 19.0,
        dropoff_address: 'Szeged', dropoff_lat: 46.2, dropoff_lng: 20.1,
        notes: 'Hívj a szám: 06301234567',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('PATCH /auth/me — bio / jármű / cégnév szűrt (a telefon-mező NEM)', async () => {
    const user = await createUser({ role: 'carrier' });
    for (const field of ['bio', 'vehicle_type', 'company_name']) {
      __resetRateLimitsForTests();
      const res = await request(app).patch('/auth/me').set(auth(user.token))
        .send({ [field]: 'elerhetoseg 06301234567' });
      expect(res.status, `${field}`).toBe(400);
      expect(res.body.code).toBe('CONTACT_LEAK');
    }
    // A legitim telefon-mező viszont továbbra is megy
    const okPhone = await request(app).patch('/auth/me').set(auth(user.token))
      .send({ phone: '+36 30 123 4567' });
    expect(okPhone.status).toBeLessThan(400);
  });

  it('POST /auth/register — a cégnév/jármű a regisztrációnál is szűrt (a PATCH-kapu ne legyen megkerülhető)', async () => {
    const res = await request(app).post('/auth/register').send({
      email: uniqueEmail('leak'), password: 'Jelszo123!', full_name: 'Teszt Elek',
      phone: '+36201112233', vehicle_type: 'Transit — hívj 06301234567',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });
});

describe('#3 A címzett-mezők csak a díjfizetés UTÁN jutnak a szállítóhoz', () => {
  it('fuvar: a kijelölt szállító paid_at ELŐTT nem látja a recipient-et, UTÁN igen', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    // Elfogadva, de MÉG NEM fizetve (carrier_id beáll, paid_at NULL)
    const unpaid = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    const elotte = await request(app).get(`/jobs/${unpaid.id}`).set(auth(szallito.token));
    expect(elotte.status).toBe(200);
    expect(elotte.body.recipient_phone, 'fizetés előtt NEM járhat a címzett száma').toBeUndefined();
    expect(elotte.body.recipient_name).toBeUndefined();

    // Fizetve
    const paid = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const utana = await request(app).get(`/jobs/${paid.id}`).set(auth(szallito.token));
    expect(utana.body.recipient_phone, 'fizetés után a szállító hívhatja a címzettet').toBe('+36301112233');
  });

  it('foglalás: ugyanez a kapu a route_bookings scrubjában', async () => {
    const { scrubBookingForUser } = require('../src/routes/carrierRoutes');
    expect(typeof scrubBookingForUser, 'a scrub exportálva kell legyen').toBe('function');
    const szallitoId = 'c0000000-0000-0000-0000-000000000001';
    const booking = {
      shipper_id: 's0000000-0000-0000-0000-000000000002',
      recipient_name: 'Teszt Címzett', recipient_phone: '+36301112233',
      delivery_code: '111222', tracking_token: 'tok', paid_at: null,
    };
    // Fizetés előtt a szállító NEM látja a címzett elérhetőségét
    const preFee = scrubBookingForUser(booking, { sub: szallitoId });
    expect(preFee.recipient_phone).toBeUndefined();
    expect(preFee.recipient_name).toBeUndefined();
    // Fizetés után igen (a kézbesítéshez)
    const postFee = scrubBookingForUser({ ...booking, paid_at: new Date() }, { sub: szallitoId });
    expect(postFee.recipient_phone).toBe('+36301112233');
    // A feladó (saját foglalása) mindig látja
    const owner = scrubBookingForUser(booking, { sub: booking.shipper_id });
    expect(owner.recipient_phone).toBe('+36301112233');
  });
});

describe('#2 Self-delete adatvesztés-guard', () => {
  it('aktív + fizetett fuvarban lévő user NEM törölheti magát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    for (const u of [felado, szallito]) {
      const res = await request(app).delete('/auth/me').set(auth(u.token));
      expect(res.status, 'aktív fizetett ügyletben tiltott').toBe(409);
      expect(res.body.code).toBe('USER_HAS_ACTIVE_PAID');
    }
  });

  it('a szállító, akinek a JÁRATÁN fizetett foglalás van, nem törölheti magát (más feladó adata)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true });
    const res = await request(app).delete('/auth/me').set(auth(szallito.token));
    expect(res.status).toBe(409);
  });

  it('vitatott (disputed) fuvar résztvevője nem törölheti magát (bizonyíték-zárolás)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'disputed', paid: true });
    const res = await request(app).delete('/auth/me').set(auth(felado.token));
    expect(res.status).toBe(409);
  });

  it('terminál / ügylet nélküli user viszont törölheti magát', async () => {
    const tiszta = await createUser({ role: 'shipper' });
    const okRes = await request(app).delete('/auth/me').set(auth(tiszta.token));
    expect(okRes.status).toBe(200);

    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    const lezart = await request(app).delete('/auth/me').set(auth(szallito.token));
    expect(lezart.status, 'lezárt ügylet után a törlés szabad').toBe(200);
  });
});

describe('#4 Reopen-plafon a kontakt-aratás ellen', () => {
  it('5 újranyitás után a 6. tiltott (REOPEN_LIMIT_REACHED)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // A fuvar már a plafonon: reopened_count = 5, accepted + fizetett
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await db.query('UPDATE jobs SET reopened_count = 5 WHERE id = $1', [job.id]);

    const res = await request(app).post(`/jobs/${job.id}/reopen`).set(auth(felado.token)).send({ reason: 'nem elérhető' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REOPEN_LIMIT_REACHED');
  });

  it('a plafon alatt a reopen működik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await db.query('UPDATE jobs SET reopened_count = 1 WHERE id = $1', [job.id]);
    const res = await request(app).post(`/jobs/${job.id}/reopen`).set(auth(felado.token)).send({ reason: 'csere' });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(true);
  });
});
