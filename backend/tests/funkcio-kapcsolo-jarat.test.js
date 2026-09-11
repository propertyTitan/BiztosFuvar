// =====================================================================
//  JÁRAT-ÁG KAPCSOLÓ (2026-09-11, Codex-audit / user-döntés D1)
//
//  A launchra a járat-ág rejtett. A backend író végpontjai JARAT_ENABLED
//  nélkül 503 JARAT_DISABLED-et adnak; az olvasók élnek; és — a SOS-kapcsoló
//  tanulsága — MÁS routerek végpontjai érintetlenek maradnak.
// =====================================================================
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

afterEach(() => { process.env.JARAT_ENABLED = 'true'; });

describe('JARAT_ENABLED nélkül', () => {
  it('a járat-hirdetés és a foglalás írása 503 JARAT_DISABLED', async () => {
    process.env.JARAT_ENABLED = 'false';
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send({ title: 'Teszt', departure_at: new Date(Date.now() + 86400000).toISOString(), waypoints: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body.code).toBe('JARAT_DISABLED');
    const cancel = await request(app).post('/route-bookings/00000000-0000-0000-0000-000000000000/cancel')
      .set(auth(carrier.token)).send({});
    expect(cancel.status).toBe(503);
  });

  it('az olvasó végpontok és a többi router érintetlen', async () => {
    process.env.JARAT_ENABLED = 'false';
    const shipper = await createUser();
    const lista = await request(app).get('/carrier-routes').set(auth(shipper.token));
    expect(lista.status, 'a járat-lista OLVASÁSA is 503 lett').not.toBe(503);
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const masik = await request(app).get(`/jobs/${job.id}`).set(auth(shipper.token));
    expect(masik.status, 'a kapcsoló átszivárgott a fuvar-routerre').toBe(200);
  });

  it('bekapcsolva (teszt-alapértelmezés) a járat-hirdetés nem 503', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app).post('/carrier-routes').set(auth(carrier.token))
      .send({ title: 'Teszt', departure_at: new Date(Date.now() + 86400000).toISOString(), waypoints: [] });
    expect(res.status).not.toBe(503);
  });
});
