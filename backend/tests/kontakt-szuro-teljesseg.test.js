// =====================================================================
//  A kontakt-szűrő TELJESSÉGE — a 2. audit-kör (2026-08-09) találatai.
//
//  Az első kör (#120) bevezette a firstContactLeak-et, de HÁROM, a másik
//  félhez fizetés előtt eljutó felület kimaradt belőle:
//    F1: users.full_name  — a LEGLÁTHATÓBB mező (ajánlat, kérdés, profil)
//    F5: pickup/dropoff_address — a böngésző szállító látja a GET /jobs-on
//    F2: a vita-leírás (fizetés előtt) · F7: a nyilvános értékelés-komment
//
//  Ez a suite azt őrzi, hogy a szűrő MINDEN ilyen felületen fut — ne
//  lehessen egyetlen kimaradt mezővel megkerülni a platform egyetlen
//  bevételét (kapcsolatfelvételi díj).
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, uniqueEmail } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

const TELEFON = 'Hívj: 06301234567';

describe('F1 — a NÉV is átmegy a kontakt-szűrőn', () => {
  it('regisztrációnál a telefonszámos név elutasítva', async () => {
    const res = await request(app).post('/auth/register').send({
      email: uniqueEmail('nev'), password: 'Jelszo123!',
      full_name: TELEFON, phone: '+36201112233',
    });
    expect(res.status).toBe(400);
    // 2026-08-30 (REG-P1-NEW-01): a számjegyes nevet már a név-szabály fogja
    // meg (előbb fut, erősebb) — a lényeg változatlan: a szám nem megy át.
    expect(res.body.code).toBe('NAME_HAS_DIGITS');
  });

  it('PATCH /auth/me — a névbe utólag sem írható elérhetőség', async () => {
    const u = await createUser({ role: 'carrier' });
    const res = await request(app).patch('/auth/me').set(auth(u.token))
      .send({ full_name: 'Kovacs Bela 0630 123 4567' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NAME_HAS_DIGITS');

    // Kontroll: a normál név továbbra is megy
    __resetRateLimitsForTests();
    const ok = await request(app).patch('/auth/me').set(auth(u.token))
      .send({ full_name: 'Kovács Béla' });
    expect(ok.status).toBeLessThan(400);
  });
});

describe('F5 — a CÍM-mezők is átmennek a szűrőn', () => {
  const VALID_JOB = {
    title: 'Cím-szűrés teszt',
    pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
    weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
  };

  it('a felvételi és a lerakodási címbe sem írható telefonszám', async () => {
    const felado = await createUser({ role: 'shipper' });
    for (const mezo of ['pickup_address', 'dropoff_address']) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send({ ...VALID_JOB, [mezo]: `Budapest, Váci út 1. — ${TELEFON}` });
      expect(res.status, mezo).toBe(400);
      expect(res.body.code).toBe('CONTACT_LEAK');
    }
    // Kontroll: a valódi cím átmegy
    __resetRateLimitsForTests();
    const ok = await request(app).post('/jobs').set(auth(felado.token)).send(VALID_JOB);
    expect(ok.status).toBe(201);
  });
});

describe('F2 — a vita-leírás fizetés ELŐTT szűrt, utána nem', () => {
  it('fizetetlen fuvaron a telefonszámos vita-leírás elutasítva', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    const res = await request(app).post('/disputes').set(auth(felado.token))
      .send({ job_id: job.id, description: `Nem jött el. ${TELEFON}` });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('FIZETETT fuvaron a telefonszám legitim bizonyíték lehet — átmegy', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await request(app).post('/disputes').set(auth(felado.token))
      .send({ job_id: job.id, description: `Hívtam a ${TELEFON} számon, nem vette fel.` });
    expect(res.status).toBe(201);
  });
});

describe('F7 — a nyilvános értékelés-komment mindig szűrt', () => {
  it('a kommentbe nem írható elérhetőség (tartós hirdetőfelület lenne)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const res = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: `Szuper volt! Legközelebb ${TELEFON}` });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });
});

describe('Mentős-lista: a PONTOS cím sem szivároghat (a 2. kör regresszió-találata)', () => {
  it('az address / rendszám / leírás / requester_id nincs a listában', async () => {
    const bajban = await createUser({ role: 'shipper' });
    await request(app).post('/towing/request').set(auth(bajban.token)).send({
      lat: 47.4979, lng: 19.0402, address: 'Budapest, Váci út 178. 3. emelet',
      issue_type: 'breakdown', vehicle_type: 'car', vehicle_plate: 'ABC-123',
      issue_description: 'Egyedül vagyok éjjel', search_radius_km: 50,
    });

    const mentos = await createUser({ role: 'carrier', kyc: 'verified' });
    await request(app).post('/towing/register').set(auth(mentos.token))
      .send({ tow_services: ['breakdown'] });
    const res = await request(app).get('/towing/incoming?lat=47.50&lng=19.04').set(auth(mentos.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    for (const r of res.body) {
      expect(r.address, 'a PONTOS cím kiütné a ~1km-es kerekítést').toBeUndefined();
      expect(r.vehicle_plate).toBeUndefined();
      expect(r.issue_description).toBeUndefined();
      expect(r.requester_id, 'ezzel a teljes név lekérhető lenne a profilról').toBeUndefined();
      // Ami jár: közelítő hely + probléma-típus
      expect(r).toHaveProperty('approx_lat');
      expect(r).toHaveProperty('issue_type');
    }
  });
});
