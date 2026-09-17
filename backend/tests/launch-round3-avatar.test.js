import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, TINY_PNG } = require('./helpers');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const storage = require('../src/services/storage');
const queue = require('../src/services/fileDeletionQueue');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const upload = user => request(app).post('/auth/avatar').set(...auth(user)).attach('file', TINY_PNG, 'avatar.png');
const exists = url => fs.existsSync(path.join(__dirname, '../uploads', path.basename(url)));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('sikertelen DB-mentés nem hagy árvát; tárhelyhiba=%s', async storageFailure => {
  const user = await createUser();
  const query = Client.prototype.query;
  let key;
  vi.spyOn(Client.prototype, 'query').mockImplementation(function(sql, ...args) {
    if (String(sql).startsWith('UPDATE users SET avatar_url')) {
      key = args[0][0];
      return Promise.reject(new Error('injected avatar write failure'));
    }
    return query.call(this, sql, ...args);
  });
  const remove = storageFailure ? vi.spyOn(storage, 'deleteFile').mockResolvedValue(false) : null;
  expect((await upload(user)).status).toBe(500);
  expect(key).toBeTruthy(); expect(exists(key)).toBe(storageFailure);
  expect((await db.query('SELECT avatar_url FROM users WHERE id=$1', [user.id])).rows[0].avatar_url).toBeNull();
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [key])).rowCount).toBe(storageFailure ? 1 : 0);
  if (remove) {
    remove.mockRestore();
    await db.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE batch_id=$1', [user.id]);
    await queue.processFileDeletionQueue({ batchId: user.id });
    expect(exists(key)).toBe(false);
  }
});

it('tartós feladat nélkül nincs tárhelyírás', async () => {
  const user = await createUser();
  vi.spyOn(queue, 'enqueueFileDeletions').mockRejectedValue(new Error('database unavailable'));
  const write = vi.spyOn(fs, 'writeFileSync');
  expect((await upload(user)).status).toBe(500); expect(write).not.toHaveBeenCalled();
});

it('feltöltés közbeni fióktörlés után a profilkép sem marad meg', async () => {
  const user = await createUser(); const started = gate(), release = gate();
  const save = storage.saveFile;
  let key;
  vi.spyOn(storage, 'saveFile').mockImplementation(async (...args) => {
    key = await save(...args); started.resolve(); await release.promise; return key;
  });
  const response = upload(user).then(r => r); await started.promise;
  try { expect((await request(app).delete('/auth/me').set(...auth(user))).status).toBe(200); }
  finally { release.resolve(); }
  expect((await response).status).toBe(404); expect(exists(key)).toBe(false);
});

it('lejárt takarítás sem fogyaszthatja el a még íródó kép feladatát', async () => {
  const user = await createUser(); const started = gate(), release = gate();
  const save = storage.saveFile, enqueue = queue.enqueueFileDeletions;
  vi.spyOn(queue, 'enqueueFileDeletions').mockImplementation(async (client, batch, keys, options) => {
    await enqueue(client, batch, keys, options);
    await client.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE batch_id=$1', [batch]);
  });
  vi.spyOn(storage, 'saveFile').mockImplementation((buffer, name, mime, options) => save(buffer, name, mime, {
    beforeSave: async key => { await options.beforeSave(key); started.resolve(); await release.promise; },
  }));
  const response = upload(user).then(r => r); await started.promise;
  try { expect(await queue.processFileDeletionQueue({ batchId: user.id })).toBe(0); }
  finally { release.resolve(); }
  const result = await response;
  expect(result.status).toBe(200); expect(exists(result.body.url)).toBe(true);
  expect((await db.query('SELECT avatar_url FROM users WHERE id=$1', [user.id])).rows[0].avatar_url).toBe(result.body.url);
});

it('két párhuzamos feltöltés után csak az aktuális profilkép marad meg', async () => {
  const user = await createUser();
  const results = await Promise.all([upload(user), upload(user)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  const current = (await db.query('SELECT avatar_url FROM users WHERE id=$1', [user.id])).rows[0].avatar_url;
  for (const result of results) expect(exists(result.body.url)).toBe(result.body.url === current);
});

it('elveszett COMMIT-visszaigazolás nem törölheti az érvényes profilképet', async () => {
  const user = await createUser(); const query = Client.prototype.query;
  const changed = new WeakSet();
  vi.spyOn(Client.prototype, 'query').mockImplementation(async function(sql, ...args) {
    const result = await query.call(this, sql, ...args);
    if (String(sql).startsWith('UPDATE users SET avatar_url')) changed.add(this);
    if (String(sql) === 'COMMIT' && changed.has(this)) {
      changed.delete(this); throw new Error('commit acknowledgement lost');
    }
    return result;
  });
  expect((await upload(user)).status).toBe(500);
  const current = (await db.query('SELECT avatar_url FROM users WHERE id=$1', [user.id])).rows[0].avatar_url;
  expect(current).toBeTruthy(); expect(exists(current)).toBe(true);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [current])).rowCount).toBe(0);
});
