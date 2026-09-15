import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, TINY_PNG } = require('./helpers');
const fs = require('fs');
const path = require('path');
const storage = require('../src/services/storage');
const gemini = require('../src/services/gemini');
const queue = require('../src/services/fileDeletionQueue');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fileExists = key => fs.existsSync(path.join(__dirname, '../uploads/private', path.basename(key)));
const upload = user => request(app).post('/auth/kyc-document').set(...auth(user))
  .field('doc_type', 'id_card').attach('file', TINY_PNG, { filename: 'id.png', contentType: 'image/png' });
const pendingAI = { pending: true, reason: 'Kézi ellenőrzés szükséges.', confidence: 0 };
afterEach(() => vi.restoreAllMocks());

it('tartós nyilvántartási hiba esetén a személyi-kép bájtjait sem írjuk ki', async () => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  vi.spyOn(queue, 'enqueueFileDeletions').mockRejectedValueOnce(new Error('A nyilvántartás átmenetileg nem elérhető'));
  const write = vi.spyOn(fs, 'writeFileSync');
  expect((await upload(user)).status).toBe(500);
  expect(write).not.toHaveBeenCalled();
});

it('váratlan AI-hiba után a már feltöltött fájl is eltűnik', async () => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  let key;
  vi.spyOn(gemini, 'verifyKycDocument').mockImplementation(async () => {
    key = (await db.query('SELECT file_key FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows[0].file_key;
    throw new Error('Megszakadt AI-kérés');
  });
  expect((await upload(user)).status).toBe(500);
  expect(fileExists(key)).toBe(false);
});

async function pausedUpload() {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  const started = gate(); const release = gate();
  vi.spyOn(gemini, 'verifyKycDocument').mockImplementation(async () => {
    started.resolve(); await release.promise; return pendingAI;
  });
  const response = upload(user).then(r => r);
  await started.promise;
  const tracked = await db.query('SELECT file_key FROM file_deletion_queue WHERE batch_id = $1', [user.id]);
  expect(tracked.rows).toHaveLength(1);
  const key = tracked.rows[0].file_key;
  expect(fileExists(key)).toBe(true);
  return { user, release, response, key };
}

it.each([false, true])('KYC közbeni fióktörlés: tárhelyhiba=%s mellett sem marad árva okmányfotó', async (storageFailure) => {
  const { user, release, response, key } = await pausedUpload();
  if (storageFailure) vi.spyOn(storage, 'deleteFile').mockResolvedValue(false);
  try {
    const deleted = await request(app).delete('/auth/me').set(...auth(user));
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  } finally { release.resolve(); }
  const result = await response;
  expect(result.status).toBe(404); expect(result.body.code).toBe('ACCOUNT_DELETED');
  expect((await db.query('SELECT 1 FROM kyc_documents WHERE user_id = $1', [user.id])).rows).toHaveLength(0);
  if (storageFailure) {
    expect(fileExists(key)).toBe(true);
    expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key = $1', [key])).rows).toHaveLength(1);
  } else {
    await vi.waitFor(() => expect(fileExists(key)).toBe(false));
  }
});

it('a lejárt, már eltakarított feltöltésből nem jöhet létre halott okmányhivatkozás', async () => {
  const { user, release, response, key } = await pausedUpload();
  try {
    await db.query('UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE batch_id = $1', [user.id]);
    await queue.processFileDeletionQueue({ batchId: user.id });
    expect(fileExists(key)).toBe(false);
  } finally { release.resolve(); }
  const result = await response;
  expect(result.status).toBe(409); expect(result.body.code).toBe('UPLOAD_EXPIRED');
  expect((await db.query('SELECT 1 FROM kyc_documents WHERE user_id = $1', [user.id])).rows).toHaveLength(0);
});

it('a takarítás a folyamatban lévő fájlírás feladatát lejáratkor sem fogyaszthatja el', async () => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  const started = gate(); const release = gate();
  const enqueue = queue.enqueueFileDeletions;
  const save = storage.savePrivateFile;
  vi.spyOn(queue, 'enqueueFileDeletions').mockImplementation(async (client, batchId, keys, options) => {
    await enqueue(client, batchId, keys, options);
    await client.query('UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE batch_id = $1', [batchId]);
  });
  vi.spyOn(storage, 'savePrivateFile').mockImplementation((buffer, name, type, options) =>
    save(buffer, name, type, { beforeSave: async key => {
      await options.beforeSave(key);
      started.resolve(); await release.promise;
    } }));
  vi.spyOn(gemini, 'verifyKycDocument').mockResolvedValue(pendingAI);
  const response = upload(user).then(r => r);
  await started.promise;
  let removed;
  try { removed = await queue.processFileDeletionQueue({ batchId: user.id }); }
  finally { release.resolve(); }
  const result = await response;
  expect(removed).toBe(0);
  expect(result.status).toBe(200);
  const key = (await db.query('SELECT file_url FROM kyc_documents WHERE user_id = $1', [user.id])).rows[0].file_url;
  expect(fileExists(key)).toBe(true);
});

it('a sikeresen mentett KYC-t a rendes fióktörlés a tárhelyről is eltávolítja', async () => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  vi.spyOn(gemini, 'verifyKycDocument').mockResolvedValue(pendingAI);
  expect((await upload(user)).status).toBe(200);
  const key = (await db.query('SELECT file_url FROM kyc_documents WHERE user_id = $1', [user.id])).rows[0].file_url;
  expect(fileExists(key)).toBe(true);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key = $1', [key])).rows).toHaveLength(0);
  expect((await request(app).delete('/auth/me').set(...auth(user))).status).toBe(200);
  expect(fileExists(key)).toBe(false);
});

it.each([false, true])('COMMIT hibája: a banki válaszhoz hasonlóan a DB tényleges döntése számít (commitolt=%s)', async (committed) => {
  const user = await createUser({ role: 'carrier', kyc: 'pending' });
  const realConnect = db.pool.connect.bind(db.pool);
  let uploadedKey;
  let armed = true;
  vi.spyOn(gemini, 'verifyKycDocument').mockImplementation(async () => {
    uploadedKey = (await db.query('SELECT file_key FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows[0].file_key;
    return pendingAI;
  });
  vi.spyOn(db.pool, 'connect').mockImplementation((...connectArgs) => {
    // pool.query a callbackes overloadot használja; azt nem helyettesítjük.
    if (connectArgs.length) return realConnect(...connectArgs);
    return (async () => {
    const client = await realConnect();
    const realQuery = client.query.bind(client);
    const realRelease = client.release.bind(client);
    let isKyc = false;
    client.query = async (sql, ...args) => {
      if (String(sql).includes('INSERT INTO kyc_documents')) isKyc = true;
      if (sql === 'COMMIT' && isKyc && armed) {
        armed = false;
        if (committed) await realQuery(sql, ...args);
        throw new Error('Szimulált COMMIT-válaszhiba');
      }
      return realQuery(sql, ...args);
    };
    client.release = (...args) => { client.query = realQuery; client.release = realRelease; return realRelease(...args); };
    return client;
    })();
  });
  const result = await upload(user);
  expect(result.status).toBe(500);
  expect((await db.query('SELECT 1 FROM kyc_documents WHERE user_id = $1', [user.id])).rows).toHaveLength(committed ? 1 : 0);
  await vi.waitFor(() => expect(fileExists(uploadedKey)).toBe(committed));
});
