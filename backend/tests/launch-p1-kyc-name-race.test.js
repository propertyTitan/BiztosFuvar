import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const fs = require('fs');
const path = require('path');
const { app, db, createUser, TINY_PNG } = require('./helpers');
const gemini = require('../src/services/gemini');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const upload = u => request(app).post('/auth/kyc-document').set(...auth(u))
  .field('doc_type', 'id_card').attach('file', TINY_PNG, { filename: 'id.png', contentType: 'image/png' });
afterEach(() => vi.restoreAllMocks());

async function applicant(company = false) {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  await db.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Kovács Béla', user.id]);
  if (company) await db.query("UPDATE users SET account_type = 'company' WHERE id = $1", [user.id]);
  vi.spyOn(gemini, 'verifyKycDocument').mockResolvedValue({
    valid: true, pending: false, confidence: 0.99, likelyCopy: false,
    holderName: 'Kovács Béla', documentNumber: `NAME${user.id.replace(/-/g, '').slice(0, 15)}`,
  });
  return user;
}

it.each([false, true])('névcsere a KYC-döntés után: nincs téves verified, a feltöltés újrapróbálható (cég=%s)', async (company) => {
  const user = await applicant(company);
  const selected = gate(); const release = gate();
  const query = db.query;
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, args) => {
    const result = await query(sql, args);
    if (!paused && String(sql).trim() === 'SELECT full_name FROM users WHERE id = $1' && args[0] === user.id) {
      paused = true; selected.resolve(); await release.promise;
    }
    return result;
  });
  const response = upload(user).then(r => r);
  await selected.promise;
  const tracked = (await query('SELECT file_key FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows[0];
  const file = path.join(__dirname, '../uploads/private', path.basename(tracked.file_key));
  expect(fs.existsSync(file)).toBe(true);
  try {
    const edited = await request(app).patch('/auth/me').set(...auth(user)).send({ full_name: 'Nagy István' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
  } finally { release.resolve(); }
  const result = await response;
  const current = (await query('SELECT full_name, identity_kyc_status FROM users WHERE id = $1', [user.id])).rows[0];
  expect(current).toEqual({ full_name: 'Nagy István', identity_kyc_status: 'pending' });
  expect(result.status).toBe(409); expect(result.body.code).toBe('KYC_PROFILE_CHANGED');
  expect((await query('SELECT 1 FROM kyc_documents WHERE user_id = $1', [user.id])).rows).toHaveLength(0);
  expect(fs.existsSync(file)).toBe(false);
  expect((await query('SELECT 1 FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows).toHaveLength(0);

  expect((await request(app).patch('/auth/me').set(...auth(user)).send({ full_name: 'Kovács Béla' })).status).toBe(200);
  const retried = await upload(user);
  expect(retried.status).toBe(200); expect(retried.body.status).toBe('verified');
});

it('ha a KYC véglegesítése szerez előbb zárat, a névcsere megvárja és 409-et kap', async () => {
  const user = await applicant();
  const locked = gate(); const release = gate();
  const connect = db.pool.connect.bind(db.pool);
  let paused = false;
  vi.spyOn(db.pool, 'connect').mockImplementation((...args) => {
    if (args.length) return connect(...args);
    return (async () => {
      const client = await connect();
      const query = client.query.bind(client); const originalRelease = client.release.bind(client);
      client.query = async (sql, ...params) => {
        const result = await query(sql, ...params);
        if (!paused && /SELECT .* FROM users WHERE id = \$1 FOR UPDATE/.test(String(sql)) && params[0]?.[0] === user.id) {
          paused = true; locked.resolve(); await release.promise;
        }
        return result;
      };
      client.release = (...releaseArgs) => { client.query = query; client.release = originalRelease; return originalRelease(...releaseArgs); };
      return client;
    })();
  });
  const response = upload(user).then(r => r);
  await locked.promise;
  const edited = request(app).patch('/auth/me').set(...auth(user)).send({ full_name: 'Nagy István' }).then(r => r);
  try {
    await vi.waitFor(async () => {
      const waiting = await db.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM users%'");
      expect(waiting.rows.length).toBeGreaterThan(0);
    });
  } finally { release.resolve(); }
  expect((await response).body.status).toBe('verified');
  const result = await edited;
  expect(result.status).toBe(409); expect(result.body.code).toBe('KYC_NAME_LOCKED');
  expect((await db.query('SELECT full_name FROM users WHERE id = $1', [user.id])).rows[0].full_name).toBe('Kovács Béla');
});

it('a meglévő névegyezési szabály és a kézi ellenőrzés változatlan', async () => {
  const matching = await applicant();
  await db.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Bela Kovacs', matching.id]);
  expect((await upload(matching)).body.status).toBe('verified');
  const mismatch = await applicant();
  await db.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Nagy István', mismatch.id]);
  const result = await upload(mismatch);
  expect(result.status).toBe(200); expect(result.body.status).toBe('pending');
  expect(result.body.ai_reason).toMatch(/név eltér/);
});
