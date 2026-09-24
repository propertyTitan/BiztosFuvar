import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const storage = require('../src/services/storage');
const { app, db, createUser, TINY_PNG } = require('./helpers');
const { purgeOldKycFiles } = require('../src/services/kyc');
afterEach(() => { vi.restoreAllMocks(); });

it('P1-05: 61 napos rekord mai pending újrafeltöltése túléli a retenciót', async () => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, created_at)
    VALUES($1, 'id_card', 'data:image/png;base64,b2xk', 'pending', NOW() - INTERVAL '61 days')`, [user.id]);
  const response = await request(app).post('/auth/kyc-document').set('Authorization', `Bearer ${user.token}`)
    .field('doc_type', 'id_card').attach('file', TINY_PNG, { filename: 'id.png', contentType: 'image/png' });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const before = (await db.query('SELECT * FROM kyc_documents WHERE user_id = $1', [user.id])).rows[0];
  expect(before.status).toBe('pending');
  await purgeOldKycFiles();
  const after = (await db.query('SELECT * FROM kyc_documents WHERE user_id = $1', [user.id])).rows[0];
  expect(after.file_url).toBe(before.file_url);
  expect(after.created_at).toEqual(before.created_at);
});

it('P1-05: purge közben lecserélt kép mutatója megmarad', async () => {
  const user = await createUser();
  const { rows } = await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, created_at)
    VALUES($1, 'id_card', 'data:image/png;base64,cHVyZ2U=', 'pending', NOW() - INTERVAL '61 days') RETURNING id`, [user.id]);
  // A csere az előválogatás UTÁN, a friss sorzár ELŐTT commitol. A tároló-
  // törlésen belüli UPDATE már helyesen blokkolna a purge sorzárán.
  const query = db.query; let replaced = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, args) => {
    const result = await query(sql, args);
    if (!replaced && String(sql).includes('SELECT id, file_url, uploaded_at')) {
      replaced = true;
      await query("UPDATE kyc_documents SET file_url = 'data:image/png;base64,bmV3', uploaded_at = NOW() WHERE id = $1", [rows[0].id]);
    }
    return result;
  });
  await purgeOldKycFiles();
  expect((await db.query('SELECT file_url FROM kyc_documents WHERE id = $1', [rows[0].id])).rows[0].file_url).toBe('data:image/png;base64,bmV3');
});
