import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const storage = require('../src/services/storage');
const queue = require('../src/services/fileDeletionQueue');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const files = [];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
  vi.spyOn(require('../src/services/pickupNotifications'), 'dispatchPickupNotifications').mockImplementation(() => {});
  const upload = () => request(app).post(`/jobs/${job.id}/photos`).set(...auth(carrier)).field('kind', 'pickup').attach('file', TINY_PNG, 'evidence.png');
  return { carrier, job, upload };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of files.splice(0)) if (fs.existsSync(f)) fs.unlinkSync(f);
});

it('nyilvántartási hiba esetén nem ír a tárhelyre és nem kerüli meg a hibát fallbackkel', async () => {
  const f = await fixture();
  vi.spyOn(queue, 'enqueueFileDeletions').mockRejectedValue(new Error('registration unavailable'));
  const write = vi.spyOn(fs, 'writeFileSync');
  expect((await f.upload()).status).toBe(500);
  expect(write).not.toHaveBeenCalled();
  expect((await db.query('SELECT 1 FROM photos WHERE job_id=$1', [f.job.id])).rowCount).toBe(0);
});

it.each([false, true])('más feltöltések törlési hátraléka nem kerül az aktuális válasz útjába; photo INSERT hiba=%s', async fail => {
  const f = await fixture(), query = Client.prototype.query;
  const oldKey = `/uploads/old-${f.carrier.id}.png`;
  await queue.enqueueFileDeletions(db, f.carrier.id, [oldKey]);
  if (fail) {
    vi.spyOn(Client.prototype, 'query').mockImplementation(function(sql, ...args) {
      if (String(sql).includes('INSERT INTO photos') && args[0]?.[0] === f.job.id) {
        return query.call(this, 'SELECT audit_nonexistent_column FROM photos');
      }
      return query.call(this, sql, ...args);
    });
  }
  const remove = vi.spyOn(storage, 'deleteFile');
  const result = await f.upload();
  expect(result.status).toBe(fail ? 500 : 201);
  expect(remove).not.toHaveBeenCalledWith(oldKey);
  expect((await db.query('SELECT attempts FROM file_deletion_queue WHERE file_key=$1', [oldKey])).rows[0].attempts).toBe(0);
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE batch_id=$1', [f.carrier.id])).rowCount).toBe(1);
  if (!fail) files.push(path.join(__dirname, '../uploads', path.basename(result.body.photo.url)));
});

it.each(['before', 'after'])('COMMIT %s hibája: a tényleges DB-döntés határozza meg a fájl sorsát', async when => {
  const f = await fixture(), query = Client.prototype.query;
  const saving = new WeakSet();
  let url;
  vi.spyOn(Client.prototype, 'query').mockImplementation(async function(sql, ...args) {
    if (String(sql).includes('INSERT INTO photos') && args[0]?.[0] === f.job.id) {
      saving.add(this); url = args[0][3]; files.push(path.join(__dirname, '../uploads', path.basename(url)));
    }
    const fail = sql === 'COMMIT' && saving.has(this);
    if (fail) saving.delete(this);
    if (fail && when === 'before') throw new Error('connection failed before commit');
    const result = await query.call(this, sql, ...args);
    if (fail) throw new Error('commit acknowledgement lost');
    return result;
  });
  expect((await f.upload()).status).toBe(500);
  const saved = when === 'after';
  expect(fs.existsSync(files.at(-1))).toBe(saved);
  expect((await db.query('SELECT 1 FROM photos WHERE job_id=$1', [f.job.id])).rowCount).toBe(saved ? 1 : 0);
  expect((await db.query('SELECT status FROM jobs WHERE id=$1', [f.job.id])).rows[0].status).toBe(saved ? 'in_progress' : 'accepted');
  expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [url])).rowCount).toBe(0);
});

it('a takarító nem fogyaszthatja el az éppen íródó fotó feladatát', async () => {
  const f = await fixture(), started = gate(), resume = gate();
  const save = storage.saveFile, enqueue = queue.enqueueFileDeletions;
  vi.spyOn(queue, 'enqueueFileDeletions').mockImplementation(async (client, batch, keys, options) => {
    await enqueue(client, batch, keys, options);
    await client.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE batch_id=$1', [batch]);
  });
  vi.spyOn(storage, 'saveFile').mockImplementation((buffer, name, mime, options) => save(buffer, name, mime, {
    beforeSave: async key => { await options.beforeSave(key); started.resolve(); await resume.promise; },
  }));
  const response = f.upload().then(r => r);
  await started.promise;
  try { expect(await queue.processFileDeletionQueue({ batchId: f.carrier.id })).toBe(0); }
  finally { resume.resolve(); }
  const result = await response;
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const file = path.join(__dirname, '../uploads', path.basename(result.body.photo.url)); files.push(file);
  expect(fs.existsSync(file)).toBe(true);
});

it('lejárt feltöltéshez nem kerülhet a DB-be már eltakarított bizonyíték', async () => {
  const f = await fixture();
  const { withPhotoUpload } = require('../src/services/photoUpload');
  const { commitPhoto } = require('../src/services/photoEvidence');
  await expect(withPhotoUpload(f.carrier.id, { buffer: TINY_PNG, originalname: 'evidence.png', mimetype: 'image/png' }, async url => {
    await db.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE file_key=$1', [url]);
    await queue.processFileDeletionQueue({ batchId: f.carrier.id });
    return commitPhoto({ jobId: f.job.id, uploaderId: f.carrier.id, kind: 'pickup', url, gps: [null,null,null], maxPhotos: 10 });
  })).rejects.toMatchObject({ photoStatus: 409, photoBody: { code: 'UPLOAD_EXPIRED' } });
  expect((await db.query('SELECT 1 FROM photos WHERE job_id=$1', [f.job.id])).rowCount).toBe(0);
});

it.each([['job', false], ['job', true], ['booking', false], ['booking', true]])('%s: failed photo INSERT remains recoverable, storage deletion failure=%s', async (type, deletionFailure) => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, paid: true };
  const entity = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const field = type === 'job' ? 'job_id' : 'booking_id';
  const query = Client.prototype.query;
  let url;
  vi.spyOn(Client.prototype, 'query').mockImplementation(function(sql, ...args) {
    if (String(sql).includes('INSERT INTO photos') && args[0]?.[0] === entity.id) {
      url = args[0][3]; files.push(path.join(__dirname, '../uploads', path.basename(url)));
      return query.call(this, 'SELECT audit_nonexistent_column FROM photos');
    }
    return query.call(this, sql, ...args);
  });
  const remove = deletionFailure ? vi.spyOn(storage, 'deleteFile').mockResolvedValue(false) : null;
  const response = await request(app).post(`/${type === 'job' ? 'jobs' : 'route-bookings'}/${entity.id}/photos`)
    .set(...auth(carrier)).field('kind', 'pickup').attach('file', TINY_PNG, 'evidence.png');
  expect(response.status).toBe(500);
  expect(url).toBeTruthy();
  expect(fs.existsSync(files.at(-1))).toBe(deletionFailure);
  expect((await db.query(`SELECT 1 FROM photos WHERE ${field}=$1`, [entity.id])).rowCount).toBe(0);
  const taskCount = (await db.query('SELECT 1 FROM file_deletion_queue WHERE file_key=$1', [url])).rowCount;
  expect(taskCount).toBe(deletionFailure ? 1 : 0);
  remove?.mockRestore();
  await db.query('UPDATE file_deletion_queue SET next_attempt_at=NOW() WHERE file_key=$1', [url]);
  await queue.processFileDeletionQueue({ batchId: carrier.id });
  expect(fs.existsSync(files.at(-1)), 'A tárhely helyreállt, de a fájlhoz nincs tartós feladat, ezért a takarító sem találja.').toBe(false);
});
