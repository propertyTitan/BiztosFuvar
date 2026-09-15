import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { db, createUser } = require('./helpers');
const email = require('../src/services/email');
const { purgeDormantAccounts } = require('../src/services/retention');

async function dormant(warned = false) {
  const user = await createUser();
  await db.query(`UPDATE users SET last_login_at = NOW() - INTERVAL '4 years',
    dormant_warned_at = CASE WHEN $2 THEN NOW() - INTERVAL '31 days' ELSE NULL END WHERE id = $1`, [user.id, warned]);
  return user;
}
const current = async (id) => (await db.query('SELECT dormant_warned_at FROM users WHERE id = $1', [id])).rows[0];
beforeEach(() => {
  vi.spyOn(email, 'sendDormantAccountWarningEmail').mockResolvedValue({ id: 'accepted-by-provider', stub: false });
});
afterEach(() => vi.restoreAllMocks());

describe('P0-02: törlési határidő csak visszaigazolt figyelmeztetés után', () => {
  it.each([null, undefined, { id: null, stub: false }, { id: 'stub-123', stub: true }])('nem igazolt küldés (%j) után nem indul el az óra; később újrapróbálható', async (result) => {
    const user = await dormant();
    email.sendDormantAccountWarningEmail.mockResolvedValue(result);
    await purgeDormantAccounts();
    expect((await current(user.id)).dormant_warned_at).toBeNull();
    email.sendDormantAccountWarningEmail.mockResolvedValue({ id: 'accepted-by-provider', stub: false });
    await purgeDormantAccounts();
    expect((await current(user.id)).dormant_warned_at).not.toBeNull();
  });

  it('küldés közbeni bejelentkezés után nem jelöli újra inaktívnak a fiókot', async () => {
    const user = await dormant();
    email.sendDormantAccountWarningEmail.mockImplementation(async ({ to }) => {
      if (to === user.email) await db.query('UPDATE users SET last_login_at = NOW(), dormant_warned_at = NULL WHERE id = $1', [user.id]);
      return { id: 'accepted-by-provider', stub: false };
    });
    await purgeDormantAccounts();
    expect((await current(user.id)).dormant_warned_at).toBeNull();
  });

  it('a törlési lista lekérése után aktivizálódó fiók megmarad', async () => {
    const user = await dormant(true);
    const query = db.query;
    let changed = false;
    vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
      const result = await query(sql, params);
      if (!changed && /SELECT id FROM users/.test(sql) && /dormant_warned_at IS NOT NULL/.test(sql)) {
        changed = true;
        await query('UPDATE users SET last_login_at = NOW(), dormant_warned_at = NULL WHERE id = $1', [user.id]);
      }
      return result;
    });
    await purgeDormantAccounts();
    expect(changed).toBe(true);
    expect(await current(user.id)).toEqual({ dormant_warned_at: null });
  });
});
