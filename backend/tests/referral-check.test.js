// =====================================================================
//  AJÁNLÓI KÓD ÉLŐ ELLENŐRZÉSE — GET /auth/referral-check (GF-014)
//
//  A Manus-találat: a regisztrációs űrlap BÁRMILYEN beírt kódra zöld
//  „Meghívóval regisztrálsz!" jelvényt mutatott, szerver-ellenőrzés nélkül
//  — az elgépelt kóddal regisztráló azt hitte, jár a jutalom, pedig az
//  attribúció némán elmaradt.
//
//  A végpont PUBLIKUS (a regisztráló még nincs belépve), ezért két dolgot
//  ez a fájl kényszerít ki:
//    1. helyes {valid} válasz (kis/nagybetű-érzéketlenül, mint a
//       regisztrációs feloldás);
//    2. SEMMI MÁS nem megy vissza — a kód birtoklása nem érhet adatot
//       (se név, se azonosító, se darabszám).
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');

async function kodotKap(userId) {
  const { getOrCreateReferralCode } = require('../src/services/referral');
  return getOrCreateReferralCode(userId);
}

describe('GET /auth/referral-check', () => {
  it('létező kódra {valid:true} — kis/nagybetű-érzéketlenül', async () => {
    const ajanlo = await createUser();
    const kod = await kodotKap(ajanlo.id);

    const res = await request(app).get('/auth/referral-check').query({ code: kod });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);

    const kicsivel = await request(app).get('/auth/referral-check').query({ code: kod.toLowerCase() });
    expect(
      kicsivel.body.valid,
      'A kisbetűs kódot a regisztráció elfogadja (UPPER-feloldás) — az élő '
      + 'ellenőrzésnek ugyanazt kell mondania, különben hamis pirosat mutat.',
    ).toBe(true);
  });

  it('ismeretlen kódra {valid:false}, hibás/hiányzó inputra sem 500', async () => {
    for (const q of [{ code: 'NEMLETEZO99' }, { code: '' }, {}, { code: 'x'.repeat(500) }]) {
      const res = await request(app).get('/auth/referral-check').query(q);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
    }
  });

  it('a válaszban a {valid}-on kívül SEMMI nincs (a kód birtoklása nem ér adatot)', async () => {
    const ajanlo = await createUser();
    const kod = await kodotKap(ajanlo.id);

    const res = await request(app).get('/auth/referral-check').query({ code: kod });
    expect(
      Object.keys(res.body).sort(),
      `A publikus kód-ellenőrzés többet ad vissza, mint {valid}: `
      + `${JSON.stringify(res.body)} — egy kód-enumeráló így adatot aratna.`,
    ).toEqual(['valid']);
    expect(JSON.stringify(res.body)).not.toContain(ajanlo.id);
  });
});
