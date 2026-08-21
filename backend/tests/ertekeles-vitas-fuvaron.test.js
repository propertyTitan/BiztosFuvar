// =====================================================================
//  ÉRTÉKELÉS VITATOTT FUVARON — a kézbesítés a választóvonal (2026-08-21)
//
//  Manus-teszt találata: a kézbesített fuvarra nyitott vita 'disputed'-be
//  tette a státuszt, és ezzel az értékelés MINDKÉT oldalon végleg eltűnt —
//  a backend 409-cel is dobta volna. Pedig a vita és az értékelés két külön
//  csatorna: az élmény pont a vitás ügyletnél a legfontosabb visszajelzés.
//
//  Az új szabály: értékelni a KÉZBESÍTÉS UTÁN lehet — vitatott fuvaron is,
//  ha a csomag már kézbesült (delivered_at). A kézbesítés ELŐTTI vitában
//  továbbra sem: ott a szolgáltatás még meg sem történt.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

let felado; let szallito;

beforeAll(async () => {
  __resetRateLimitsForTests();
  felado = await createUser({ role: 'shipper' });
  szallito = await createUser({ role: 'carrier', kyc: 'verified' });
});

async function vitasFuvar({ kezbesitve }) {
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'disputed', paid: true,
  });
  await db.query(
    `UPDATE jobs SET delivered_at = $1, status_before_dispute = $2 WHERE id = $3`,
    [kezbesitve ? new Date() : null, kezbesitve ? 'delivered' : 'in_progress', job.id],
  );
  return job;
}

describe('Értékelés vitatott fuvaron', () => {
  it('KÉZBESÍTÉS UTÁNI vitában az értékelés MEGY (mindkét fél)', async () => {
    const job = await vitasFuvar({ kezbesitve: true });

    __resetRateLimitsForTests();
    const feladoe = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 4, comment: 'A csomag kézbesült, de vita lett belőle.' });
    expect(
      feladoe.status,
      '⚠️ A kézbesítés utáni vita elvette az értékelést a feladótól.\n\n'
      + 'A fuvar kézbesült (delivered_at áll), a vita utólag nyílt — az\n'
      + 'élményről szóló visszajelzés pont ilyenkor a legértékesebb, és a\n'
      + 'vita nem némíthatja el. (Manus-teszt, 2026-08-21: a vitatott fuvaron\n'
      + 'az értékelő doboz el is tűnt a felületről.)',
    ).toBe(201);

    const szallitoe = await request(app).post('/reviews').set(auth(szallito.token))
      .send({ job_id: job.id, stars: 3, comment: 'Nehéz eset volt.' });
    expect(szallitoe.status, 'a szállító oldala is értékelhet').toBe(201);
  });

  it('KÉZBESÍTÉS ELŐTTI vitában viszont NEM (a szolgáltatás még nem történt meg)', async () => {
    const job = await vitasFuvar({ kezbesitve: false });

    __resetRateLimitsForTests();
    const res = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 1, comment: 'Még út közben elakadt.' });
    expect(
      res.status,
      'Kézbesítés ELŐTTI vitában is átment az értékelés — így egy még le sem\n'
      + 'zárult szállítás kapna végleges csillagot, ami a vita kimenetelét is\n'
      + 'előre bélyegezné.',
    ).toBe(409);
  });

  it('a sima kézbesített fuvar értékelése változatlanul megy (nem romlott el)', async () => {
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    await db.query('UPDATE jobs SET delivered_at = NOW() WHERE id = $1', [job.id]);

    __resetRateLimitsForTests();
    const res = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Minden rendben volt, köszönöm.' });
    expect(res.status).toBe(201);
  });
});
