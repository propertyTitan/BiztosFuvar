// =====================================================================
//  Fiók-törlés → a TÁROLÓ (R2) is takarít (GDPR 17. cikk, 2026-08-09 audit).
//
//  A fiók-törlés eddig csak a DB-sorokat vitte (CASCADE); az R2-objektumok
//  (köztük a személyi igazolvány fotója) bennragadtak. Ez a teszt igazolja,
//  hogy a self-delete ÉS az admin-törlés a DB-CASCADE ELŐTT meghívja a
//  deleteFile-t a user MINDEN fájljára (KYC + avatar + fuvar-fotó).
// =====================================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const storage = require('../src/services/storage');
const { purgeUserFiles } = require('../src/utils/userFiles');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// Egy usernek KYC-okmány + avatar + fuvar-fotó URL-t adunk (a fájlok
// fizikailag nem kellenek — a deleteFile-t spy-oljuk).
async function userWithFiles(role = 'shipper') {
  const u = await createUser({ role });
  await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [u.id, 'https://cdn.example/avatar-' + u.id + '.jpg']);
  await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
     VALUES ($1, 'id_card', $2, 'approved')`,
    [u.id, 'private:kyc/' + u.id + '.jpg'],
  );
  const job = await createJob({ shipperId: u.id, status: 'bidding' });
  await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1, $2, 'pickup', $3)`,
    [job.id, u.id, 'https://cdn.example/photo-' + u.id + '.jpg'],
  );
  return u;
}

let spy;
beforeEach(() => { spy = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true); });
afterEach(() => { spy.mockRestore(); });

describe('purgeUserFiles: minden tárolt user-fájlt töröl', () => {
  it('a KYC-okmány, az avatar ÉS a fuvar-fotó is deleteFile-t kap', async () => {
    const u = await userWithFiles();
    const n = await purgeUserFiles(u.id);
    expect(n).toBe(3);
    const torolt = spy.mock.calls.map((c) => c[0]);
    expect(torolt).toContain('private:kyc/' + u.id + '.jpg');       // KYC-okmány (privát bucket)
    expect(torolt.some((x) => x.includes('avatar'))).toBe(true);
    expect(torolt.some((x) => x.includes('photo'))).toBe(true);
  });
});

describe('A fiók-törlés (self + admin) a DB-CASCADE ELŐTT takarít', () => {
  it('DELETE /auth/me → a KYC-okmány fotója törlődik a tárolóból', async () => {
    const u = await userWithFiles();
    const res = await request(app).delete('/auth/me').set(auth(u.token));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    const torolt = spy.mock.calls.map((c) => c[0]);
    expect(torolt, 'a személyi igazolvány fotója nem maradhat árván').toContain('private:kyc/' + u.id + '.jpg');
  });

  it('admin user-törlés → ugyanúgy takarít a tárolóból', async () => {
    const admin = await createUser({ role: 'admin' });
    const u = await userWithFiles('carrier');
    const res = await request(app).delete(`/admin/users/${u.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    const torolt = spy.mock.calls.map((c) => c[0]);
    expect(torolt).toContain('private:kyc/' + u.id + '.jpg');
  });
});
