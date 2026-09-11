// =====================================================================
//  KYC-NÉV ZÁR (2026-09-11, Codex-audit P1-03): az „Azonosított szállító"
//  jelvény az okmányon szereplő névhez tartozik — igazolás után a név csak
//  ügyfélszolgálaton át változhat.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('PATCH /auth/me full_name', () => {
  it('igazolt (verified) fióknál a név módosítása 409 KYC_NAME_LOCKED', async () => {
    const u = await createUser({ kyc: 'verified' });
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({ full_name: 'Teljesen Másvalaki' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('KYC_NAME_LOCKED');
    const { rows } = await db.query('SELECT full_name FROM users WHERE id = $1', [u.id]);
    expect(rows[0].full_name).not.toBe('Teljesen Másvalaki');
  });

  it('igazolt fióknál a VÁLTOZATLAN név (más mezővel együtt) átmegy', async () => {
    const u = await createUser({ kyc: 'verified' });
    const { rows } = await db.query('SELECT full_name FROM users WHERE id = $1', [u.id]);
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({ full_name: rows[0].full_name, bio: 'Megbízható vagyok.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('nem igazolt fiók szabadon átírhatja a nevét', async () => {
    const u = await createUser({ kyc: 'none' });
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({ full_name: 'Új Név' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.full_name).toBe('Új Név');
  });
});
