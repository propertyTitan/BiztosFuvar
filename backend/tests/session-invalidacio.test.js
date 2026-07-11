// Session-invalidáció (token_version) — a 2026-07-11-i audit H1 tétele.
// A JWT stateless volt: a jelszó-reset NEM vonta vissza a korábbi tokeneket,
// azok a 7 napos lejáratig éltek (lopott token → 7 nap kitettség). A `tv`
// (token_version) claim + a DB-egyezés ellenőrzése ezt zárja le.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { app, db, createUser } = require('./helpers');

function tokenFor(user, tv) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, tv },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

const me = (token) =>
  request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

describe('Session-invalidáció (token_version)', () => {
  it('token_version léptetése után a korábbi token 401 (SESSION_INVALIDATED)', async () => {
    const user = await createUser(); // DB token_version=0; a helper tokenje tv nélkül → 0-ként kezelt
    expect((await me(user.token)).status).toBe(200);

    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);

    const stale = await me(user.token);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe('SESSION_INVALIDATED');
  });

  it('a friss (helyes tv-jű) token a léptetés után is működik', async () => {
    const user = await createUser();
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);

    const res = await me(tokenFor(user, 1));
    expect(res.status).toBe(200);
  });

  it('POST /auth/reset-password lépteti a token_version-t → a reset ELŐTTI token érvénytelen', async () => {
    const user = await createUser();
    const resetToken = crypto.randomBytes(16).toString('hex');
    await db.query(
      `UPDATE users
          SET password_reset_token_hash = $1,
              password_reset_expires_at = NOW() + INTERVAL '30 minutes'
        WHERE id = $2`,
      [crypto.createHash('sha256').update(resetToken).digest('hex'), user.id],
    );

    expect((await me(user.token)).status).toBe(200); // reset előtt még jó

    const reset = await request(app)
      .post('/auth/reset-password')
      .send({ token: resetToken, password: 'ujBiztonsagos9' });
    expect(reset.status).toBe(200);

    const after = await me(user.token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('SESSION_INVALIDATED');

    const { rows } = await db.query('SELECT token_version FROM users WHERE id = $1', [user.id]);
    expect(rows[0].token_version).toBe(1);
  });

  it('nem létező user tokenje 401 (a régi stateless verify átengedte volna)', async () => {
    const ghost = tokenFor(
      { id: '00000000-0000-0000-0000-000000000000', role: 'shipper', email: 'ghost@x' },
      0,
    );
    expect((await me(ghost)).status).toBe(401);
  });
});
