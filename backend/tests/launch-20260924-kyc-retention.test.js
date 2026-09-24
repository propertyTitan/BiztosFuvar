import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, seenKycDocument, TINY_PNG } = require('./helpers');
const storage = require('../src/services/storage');
const { purgeOldKycFiles } = require('../src/services/kyc');
const fs = require('fs'); const path = require('path');
const auth = user => ['Authorization', `Bearer ${user.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const exists = key => fs.existsSync(path.join(__dirname, '../uploads/private', path.basename(key)));
afterEach(() => vi.restoreAllMocks());

it('a jelöltlista után jóváhagyott KYC új 30 napja megőrzi a fotót', async () => {
  const admin = await createUser({ role: 'admin' }), user = await createUser({ role: 'carrier', kyc: 'pending' });
  const key = await storage.savePrivateFile(TINY_PNG, 'id.png', 'image/png');
  const doc = (await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, uploaded_at, created_at)
    VALUES($1, 'id_card', $2, 'pending', NOW()-INTERVAL '61 days', NOW()-INTERVAL '61 days') RETURNING id`, [user.id, key])).rows[0];
  const snapshot = await seenKycDocument(admin, doc.id);
  const selected = gate(), resume = gate(); const query = db.query; let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, args) => {
    const result = await query(sql, args);
    if (!paused && String(sql).includes('SELECT id, file_url, uploaded_at') && String(sql).includes('FROM kyc_documents')) {
      paused = true; selected.resolve(); await resume.promise;
    }
    return result;
  });
  const purge = purgeOldKycFiles(); await selected.promise;
  try {
    const review = await request(app).patch(`/admin/kyc-documents/${doc.id}`).set(...auth(admin)).send({ action: 'approve', ...snapshot });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
  } finally { resume.resolve(); }
  await purge;
  const row = (await query('SELECT file_url, status FROM kyc_documents WHERE id=$1', [doc.id])).rows[0];
  expect(row.status).toBe('approved'); expect(row.file_url).toBe(key); expect(exists(key)).toBe(true);
});

it('a mikrosecond-pontosságú lejárt feltöltés mutatója is kiürül', async () => {
  const user = await createUser();
  const key = await storage.savePrivateFile(TINY_PNG, 'id.png', 'image/png');
  const { rows } = await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, uploaded_at, created_at, reviewed_at)
    VALUES($1, 'id_card', $2, 'approved', '2020-01-01T00:00:00.123456Z', '2020-01-01', '2020-01-02') RETURNING id`, [user.id, key]);
  expect(await purgeOldKycFiles()).toBeGreaterThan(0);
  expect(exists(key)).toBe(false);
  expect((await db.query('SELECT file_url FROM kyc_documents WHERE id=$1', [rows[0].id])).rows[0].file_url).toBeNull();
});

it('a már zárolt törlés után az admin régi review-tokenje nem fogadható el', async () => {
  const admin = await createUser({ role: 'admin' }), user = await createUser();
  const key = await storage.savePrivateFile(TINY_PNG, 'id.png', 'image/png');
  const { rows } = await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, uploaded_at, created_at)
    VALUES($1, 'id_card', $2, 'pending', NOW()-INTERVAL '61 days', NOW()-INTERVAL '61 days') RETURNING id`, [user.id, key]);
  const snapshot = await seenKycDocument(admin, rows[0].id);
  const removing = gate(), release = gate(); const remove = storage.deleteFile;
  vi.spyOn(storage, 'deleteFile').mockImplementation(async url => {
    if (url === key) { removing.resolve(); await release.promise; }
    return remove(url);
  });
  const purge = purgeOldKycFiles(); await removing.promise;
  let finished = false;
  const review = request(app).patch(`/admin/kyc-documents/${rows[0].id}`).set(...auth(admin))
    .send({ action: 'approve', ...snapshot }).then(response => { finished = true; return response; });
  try {
    await new Promise(resolve => setTimeout(resolve, 50)); expect(finished).toBe(false);
  } finally { release.resolve(); }
  await purge;
  const response = await review;
  expect(response.status).toBe(409); expect(response.body.code).toBe('KYC_REVIEW_CHANGED');
});

it('tárhelyhibánál a sor és a fotó megmarad, majd az újrapróbálás sikerül', async () => {
  const user = await createUser();
  const key = await storage.savePrivateFile(TINY_PNG, 'id.png', 'image/png');
  const { rows } = await db.query(`INSERT INTO kyc_documents(user_id, doc_type, file_url, status, uploaded_at, created_at)
    VALUES($1, 'id_card', $2, 'pending', NOW()-INTERVAL '61 days', NOW()-INTERVAL '61 days') RETURNING id`, [user.id, key]);
  const remove = vi.spyOn(storage, 'deleteFile').mockResolvedValue(false);
  await purgeOldKycFiles();
  expect(exists(key)).toBe(true);
  expect((await db.query('SELECT file_url FROM kyc_documents WHERE id=$1', [rows[0].id])).rows[0].file_url).toBe(key);
  remove.mockRestore(); await purgeOldKycFiles();
  expect(exists(key)).toBe(false);
  expect((await db.query('SELECT file_url FROM kyc_documents WHERE id=$1', [rows[0].id])).rows[0].file_url).toBeNull();
});
