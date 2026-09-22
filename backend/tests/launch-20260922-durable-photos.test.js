import { afterEach, expect, it, vi } from 'vitest';
const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const request = require('supertest');
const fs = require('fs');
const { Client } = require('pg');
const storage = require('../src/services/storage');
afterEach(() => vi.restoreAllMocks());

it.each([
  ['job', false], ['booking', false], ['job', true], ['booking', true],
])('%s: éles R2-kiesésben a fotó bájtjai és az állapot együtt mentődnek; DB hiba=%s', async (type, dbFailure) => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const opts = { shipperId: shipper.id, carrierId: carrier.id, paid: true };
  const entity = type === 'job' ? await createJob(opts) : (await createBooking(opts)).booking;
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const field = type === 'job' ? 'job_id' : 'booking_id';
  const beforeStatus = (await db.query(`SELECT status FROM ${table} WHERE id=$1`, [entity.id])).rows[0].status;
  const storagePath = require.resolve('../src/services/storage'), sdkPath = require.resolve('@aws-sdk/client-s3');
  const oldStorage = require.cache[storagePath], oldSdk = require.cache[sdkPath];
  const keys = ['NODE_ENV', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'R2_PRIVATE_BUCKET_NAME'];
  const env = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  let puts = 0;
  try {
    Object.assign(process.env, { NODE_ENV: 'production', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET_NAME: 'test', R2_PUBLIC_URL: 'https://storage.invalid', R2_PRIVATE_BUCKET_NAME: 'test-private' });
    class PutObjectCommand { constructor(input) { this.input = input; } }
    class S3Client { async send() { puts++; throw new Error('Injected R2 outage; no network'); } }
    require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: { S3Client, PutObjectCommand } };
    delete require.cache[storagePath];
    vi.spyOn(storage, 'saveFile').mockImplementation(require('../src/services/storage').saveFile);
    vi.spyOn(require('@sentry/node'), 'captureMessage').mockImplementation(() => 'test');
    vi.spyOn(require('../src/services/pickupNotifications'), 'dispatchPickupNotifications').mockImplementation(() => {});
    const write = vi.spyOn(fs, 'writeFileSync');
    if (dbFailure) {
      const query = Client.prototype.query;
      vi.spyOn(Client.prototype, 'query').mockImplementation(function(sql, ...args) {
        if (String(sql).includes('INSERT INTO photos') && args[0]?.[0] === entity.id) {
          return query.call(this, 'SELECT nonexistent_durable_photo_column FROM photos');
        }
        return query.call(this, sql, ...args);
      });
    }
    const response = await request(app).post(`/${type === 'job' ? 'jobs' : 'route-bookings'}/${entity.id}/photos`)
      .set('Authorization', `Bearer ${carrier.token}`).field('kind', 'pickup').attach('file', TINY_PNG, 'proof.png');
    expect(puts).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(response.status, JSON.stringify(response.body)).toBe(dbFailure ? 500 : 201);
    const saved = await db.query(`SELECT url FROM photos WHERE ${field}=$1`, [entity.id]);
    expect(saved.rowCount).toBe(dbFailure ? 0 : 1);
    if (!dbFailure) {
      // Új lekérdezésből, kizárólag a DB-ből olvasható vissza a teljes kép.
      expect(saved.rows[0].url).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
      expect(Buffer.from(saved.rows[0].url.split(',')[1], 'base64')).toEqual(TINY_PNG);
    }
    expect((await db.query(`SELECT status FROM ${table} WHERE id=$1`, [entity.id])).rows[0].status)
      .toBe(dbFailure ? beforeStatus : 'in_progress');
  } finally {
    for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    if (oldStorage) require.cache[storagePath] = oldStorage; else delete require.cache[storagePath];
    if (oldSdk) require.cache[sdkPath] = oldSdk; else delete require.cache[sdkPath];
  }
});
