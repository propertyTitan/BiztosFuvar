import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, seenKycDocument, TINY_PNG } = require('./helpers');
const { Client } = require('pg');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());
beforeEach(() => require('../src/middleware/rateLimit').__resetRateLimitsForTests());
async function fixture() {
  const admin = await createUser({ role: 'admin' }); const user = await createUser({ role: 'carrier', kyc: 'pending' });
  const doc = (await db.query(`INSERT INTO kyc_documents(user_id,doc_type,file_url,status)
    VALUES($1,'id_card','private:reviewed-old-document','pending') RETURNING id`, [user.id])).rows[0];
  const snapshot = await seenKycDocument(admin, doc.id);
  return { admin, user, doc, snapshot };
}
const review = (f, body) => request(app).patch(`/admin/kyc-documents/${f.doc.id}`).set(...auth(f.admin)).send(body);
function upload(user) {
  vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({ pending: true, confidence: 0, reason: 'Kézi ellenőrzés szükséges.' });
  return request(app).post('/auth/kyc-document').set(...auth(user)).field('doc_type', 'id_card')
    .attach('file', TINY_PNG, { filename: 'new-id.png', contentType: 'image/png' });
}

it('megtekintett dokumentum nélkül nincs kézi döntés', async () => {
  const f = await fixture();
  const response = await review(f, { action: 'approve' });
  expect(response.status).toBe(409); expect(response.body.code).toBe('KYC_REVIEW_CHANGED');
  expect((await db.query('SELECT identity_kyc_status FROM users WHERE id=$1', [f.user.id])).rows[0].identity_kyc_status).toBe('pending');
});

it.each(['upload', 'name', 'decision'])('%s után a korábbi okmány-pillanatkép nem használható', async change => {
  const f = await fixture();
  if (change === 'upload') expect((await upload(f.user)).status).toBe(200);
  if (change === 'name') expect((await request(app).patch('/auth/me').set(...auth(f.user)).send({ full_name: 'Új Teszt Név' })).status).toBe(200);
  if (change === 'decision') expect((await review(f, { action: 'reject', reason: 'Új ellenőrzés kell.', ...f.snapshot })).status).toBe(200);
  const response = await review(f, { action: 'approve', ...f.snapshot });
  expect(response.status).toBe(409); expect(response.body.code).toBe('KYC_REVIEW_CHANGED');
  expect((await db.query('SELECT identity_kyc_status FROM users WHERE id=$1', [f.user.id])).rows[0].identity_kyc_status)
    .toBe(change === 'decision' ? 'rejected' : 'pending');
});

it('a második adatbázisírás hibája a dokumentumdöntést is visszagörgeti', async () => {
  const f = await fixture(); const query = Client.prototype.query;
  vi.spyOn(Client.prototype, 'query').mockImplementation(function (sql, ...args) {
    if (String(sql) === 'UPDATE users SET identity_kyc_status = $1 WHERE id = $2' && args[0]?.[1] === f.user.id)
      return Promise.reject(new Error('teszt: második KYC-írás hibája'));
    return query.call(this, sql, ...args);
  });
  expect((await review(f, { action: 'reject', reason: 'Nem megfelelő.', ...f.snapshot })).status).toBe(500);
  expect((await db.query('SELECT status, reviewed_by FROM kyc_documents WHERE id=$1', [f.doc.id])).rows[0])
    .toMatchObject({ status: 'pending', reviewed_by: null });
  expect((await db.query('SELECT identity_kyc_status FROM users WHERE id=$1', [f.user.id])).rows[0].identity_kyc_status).toBe('pending');
  expect((await db.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='kyc_rejected'", [f.user.id])).rowCount).toBe(0);
});

it('a folyamatban lévő admin-döntés és az új feltöltés sorosan, egyező státusszal végződik', async () => {
  const f = await fixture(); const query = Client.prototype.query; const paused = gate(); const resume = gate();
  let once = false;
  vi.spyOn(Client.prototype, 'query').mockImplementation(async function (sql, ...args) {
    if (!once && String(sql) === 'UPDATE users SET identity_kyc_status = $1 WHERE id = $2' && args[0]?.[1] === f.user.id) {
      once = true; paused.resolve(); await resume.promise;
    }
    return query.call(this, sql, ...args);
  });
  const approving = review(f, { action: 'approve', ...f.snapshot }).then(r => r);
  let uploading;
  try {
    await paused.promise;
    uploading = upload(f.user).then(r => r);
    await vi.waitFor(async () => expect((await db.query(`SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type='Lock' AND query LIKE 'SELECT id, full_name FROM users%FOR UPDATE'`)).rowCount).toBeGreaterThan(0));
  } finally { resume.resolve(); await approving; if (uploading) await uploading; }
  expect((await approving).status).toBe(200); expect((await uploading).status).toBe(200);
  expect((await db.query('SELECT status FROM kyc_documents WHERE id=$1', [f.doc.id])).rows[0].status).toBe('pending');
  expect((await db.query('SELECT identity_kyc_status FROM users WHERE id=$1', [f.user.id])).rows[0].identity_kyc_status).toBe('pending');
});
