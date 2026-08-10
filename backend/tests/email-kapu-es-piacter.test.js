// =====================================================================
//  SZERVER-OLDALI E-MAIL-KAPU + A PIACTÉR ADATKÖRE (2026-08-10)
//
//  Az adatáramlási lencse a rendszer legnagyobb megmaradt PII-felületét
//  írta le, és a lépéssor ma működött:
//
//   1. POST /auth/register — AZONNAL érvényes JWT-t ad. Az `authRequired`
//      nem nézte az `email_verified`-et: az e-mail-kapu KIZÁRÓLAG
//      frontend-oldali overlay volt. Egy eldobható, NEM LÉTEZŐ címmel
//      készült fiók tokenje ugyanúgy működött.
//   2. GET /jobs?status=bidding — 200 sor/kérés, város- és ársávszűrőkkel.
//   3. A shipper_id-ből a publikus profil → TELJES NÉV.
//
//  Egy böngésző-overlay nem hozzáférés-vezérlés.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser, createJob, db } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Az e-mail-kapu a szerveren is érvényes', () => {
  it('meg NEM erősített fiók nem böngészheti a piacteret', async () => {
    const user = await createUser({ role: 'carrier', emailVerified: false });

    const res = await request(app).get('/jobs?status=bidding').set(auth(user.token));

    expect(
      res.status,
      'egy eldobható, NEM LÉTEZŐ e-mail-címmel készült fiók tokenjével a teljes '
      + 'piactér lapozható volt — pontos címekkel',
    ).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('meg NEM erősített fiók nem kérheti le mások publikus profilját', async () => {
    const user = await createUser({ role: 'carrier', emailVerified: false });
    const masik = await createUser({ role: 'shipper' });

    const res = await request(app).get(`/auth/users/${masik.id}/profile`).set(auth(user.token));

    expect(res.status, 'a shipper_id-ből teljes név volt kinyerhető').toBe(403);
  });

  it('a saját profilját viszont eléri (különben nem tudná feloldani a helyzetét)', async () => {
    const user = await createUser({ role: 'shipper', emailVerified: false });
    await request(app).get('/auth/me').set(auth(user.token)).expect(200);
  });

  it('megerősített fiók változatlanul böngészhet', async () => {
    const user = await createUser({ role: 'carrier' });
    await request(app).get('/jobs?status=bidding').set(auth(user.token)).expect(200);
  });
});

describe('A piactér adatköre', () => {
  it('a csomag DEKLARÁLT ÉRTÉKE nem megy ki a kívülállónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query('UPDATE jobs SET declared_value_huf = 450000 WHERE id = $1', [job.id]);

    const res = await request(app).get('/jobs?status=bidding').set(auth(bongeszo.token)).expect(200);
    const sor = res.body.find((j) => j.id === job.id);

    expect(sor, 'a fuvar nem jelent meg a listán — a teszt vak').toBeTruthy();
    expect(
      sor.declared_value_huf,
      'a pontos címhez társítva a „mennyit ér a csomag" célpont-válogatásra '
      + 'alkalmas, a szállítás munkáját viszont nem befolyásolja',
    ).toBeUndefined();
  });

  it('az ÁRAZÁSHOZ szükséges mezők viszont MEGMARADNAK', async () => {
    // Szándékos ellen-teszt: az audit ezeket is javasolta kivenni, de a
    // harmadik emelet lift nélkül MÁS munka. Elvéve a szállító vakon
    // licitálna, és abból vita lesz.
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `UPDATE jobs SET pickup_floor = 3, pickup_has_elevator = FALSE,
              pickup_needs_carrying = TRUE WHERE id = $1`,
      [job.id],
    );

    const res = await request(app).get('/jobs?status=bidding').set(auth(bongeszo.token)).expect(200);
    const sor = res.body.find((j) => j.id === job.id);

    expect(sor.pickup_floor, 'a szállító nem tudja beárazni a cipelést').toBe(3);
    expect(sor.pickup_has_elevator).toBe(false);
    expect(sor.pickup_needs_carrying).toBe(true);
  });
});
