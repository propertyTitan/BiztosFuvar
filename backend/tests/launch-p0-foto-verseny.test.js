import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// A route betöltése ELŐTT fogjuk meg a tárolót; minden SQL valódi Postgresen fut.
const storage = require('../src/services/storage');
const realSave = storage.saveFile;
const save = vi.spyOn(storage, 'saveFile');
const { app, db, createUser, createJob, createBooking, TINY_PNG, seenOffer } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
beforeEach(() => { save.mockImplementation(realSave); __resetRateLimitsForTests(); });
afterAll(() => vi.restoreAllMocks());

function upload(path, token, kind, code = '111222') {
  return request(app).post(path).set('Authorization', `Bearer ${token}`)
    .field('kind', kind).field('delivery_code', code)
    .attach('file', TINY_PNG, { filename: 'proof.png', contentType: 'image/png' });
}

async function duringUpload(start, change) {
  let proceed;
  let reached;
  const waiting = new Promise((resolve) => { reached = resolve; });
  const released = new Promise((resolve) => { proceed = resolve; });
  let storedUrl;
  save.mockImplementationOnce(async (...args) => {
    storedUrl = await realSave(...args);
    reached();
    await released;
    return storedUrl;
  });
  const pending = start().then((res) => res);
  try {
    await waiting;
    await change();
  } finally { proceed(); }
  return { response: await pending, storedUrl };
}

describe('P0-01: a fotó mentésének pillanatában érvényes jogosultság és állapot', () => {
  it('valódi újranyitás és új ajánlat elfogadása közben sem indul el más szállító fuvarja', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const replacement = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    const { response } = await duringUpload(
      () => upload(`/jobs/${job.id}/photos`, carrier.token, 'pickup'),
      async () => {
        const reopened = await request(app).post(`/jobs/${job.id}/reopen`)
          .set('Authorization', `Bearer ${shipper.token}`).send({});
        expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
        const bid = await request(app).post(`/jobs/${job.id}/bids`)
          .set('Authorization', `Bearer ${replacement.token}`).send({ amount_huf: 15000, return_policy: 'included' });
        expect(bid.status, JSON.stringify(bid.body)).toBe(201);
        const accepted = await request(app).post(`/bids/${bid.body.id}/accept`).send(await seenOffer(bid.body.id))
          .set('Authorization', `Bearer ${shipper.token}`);
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      },
    );
    expect(response.status).toBe(403);
    expect((await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id])).rows[0])
      .toEqual({ status: 'accepted', carrier_id: replacement.id });
    expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
  });

  it.each(['pickup', 'dropoff', 'damage', 'document'])('szállítócsere a %s feltöltése alatt: nincs idegen fotó vagy állapotváltás', async (kind) => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const replacement = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true,
      status: kind === 'dropoff' ? 'in_progress' : 'accepted' });
    const cleanup = vi.spyOn(storage, 'deleteFile');
    try {
      const { response, storedUrl } = await duringUpload(
        () => upload(`/jobs/${job.id}/photos`, carrier.token, kind),
        () => db.query("UPDATE jobs SET carrier_id = $2, status = 'accepted' WHERE id = $1", [job.id, replacement.id]),
      );
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      const current = (await db.query('SELECT carrier_id, status FROM jobs WHERE id = $1', [job.id])).rows[0];
      expect(current).toEqual({ carrier_id: replacement.id, status: 'accepted' });
      expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
      expect(cleanup).toHaveBeenCalledWith(storedUrl);
    } finally { cleanup.mockRestore(); }
  });

  it('közben lemondott foglalásnál sem marad bizonyítékfotó', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    const { response } = await duringUpload(
      () => upload(`/route-bookings/${booking.id}/photos`, carrier.token, 'pickup'),
      () => db.query("UPDATE route_bookings SET status = 'cancelled' WHERE id = $1", [booking.id]),
    );
    expect(response.status).toBe(409);
    expect((await db.query('SELECT * FROM photos WHERE booking_id = $1', [booking.id])).rows).toHaveLength(0);
    expect((await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id])).rows[0].status).toBe('cancelled');
  });

  it('két párhuzamos vitás kézbesítésből csak egy menthet fotót és léptethet', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true, status: 'disputed' });
    await db.query("UPDATE jobs SET status_before_dispute = 'in_progress' WHERE id = $1", [job.id]);
    let winner;
    const { response } = await duringUpload(
      () => upload(`/jobs/${job.id}/photos`, carrier.token, 'dropoff'),
      async () => { winner = await upload(`/jobs/${job.id}/photos`, carrier.token, 'dropoff'); },
    );
    expect(winner.status).toBe(201);
    expect(response.status).toBe(409);
    const current = (await db.query('SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id])).rows[0];
    expect(current).toEqual({ status: 'disputed', status_before_dispute: 'delivered' });
    expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(1);
  });

  it('az időközben lezárt kódkapu nem kerülhető meg egy korábban indított helyes kéréssel', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true, status: 'in_progress' });
    const { response } = await duringUpload(
      () => upload(`/jobs/${job.id}/photos`, carrier.token, 'dropoff'),
      () => db.query("UPDATE jobs SET delivery_code_locked_until = NOW() + INTERVAL '1 hour' WHERE id = $1", [job.id]),
    );
    expect(response.status).toBe(429);
    expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
  });

  it('az állapot UPDATE hibája a fotó INSERT-et is visszagörgeti', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    await db.query(`CREATE FUNCTION launch_p0_photo_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'photo transition failure probe'; END $$`);
    await db.query(`CREATE TRIGGER launch_p0_photo_fail BEFORE UPDATE ON jobs
      FOR EACH ROW WHEN (OLD.id = '${job.id}'::uuid) EXECUTE FUNCTION launch_p0_photo_fail()`);
    const cleanup = vi.spyOn(storage, 'deleteFile');
    try {
      const response = await upload(`/jobs/${job.id}/photos`, carrier.token, 'pickup');
      expect(response.status).toBe(500);
      expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(0);
      expect((await db.query('SELECT status FROM jobs WHERE id = $1', [job.id])).rows[0].status).toBe('accepted');
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      cleanup.mockRestore();
      await db.query('DROP TRIGGER launch_p0_photo_fail ON jobs');
      await db.query('DROP FUNCTION launch_p0_photo_fail()');
    }
  });

  it('a párhuzamos hirdetésfotó sem lépheti túl a darabkorlátot', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    await db.query(`INSERT INTO photos (job_id, uploader_id, kind, url)
      SELECT $1, $2, 'listing', 'data:image/png;base64,test' FROM generate_series(1, 9)`, [job.id, shipper.id]);
    let winner;
    const { response } = await duringUpload(
      () => upload(`/jobs/${job.id}/photos`, shipper.token, 'listing'),
      async () => { winner = await upload(`/jobs/${job.id}/photos`, shipper.token, 'listing'); },
    );
    expect(winner.status).toBe(201);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PHOTO_LIMIT');
    expect((await db.query('SELECT * FROM photos WHERE job_id = $1', [job.id])).rows).toHaveLength(10);
  });

  it('a foglalási útvonal tulajdonosát is újraellenőrzi', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const replacement = await createUser({ role: 'carrier' });
    const { booking, routeId } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
    const { response } = await duringUpload(
      () => upload(`/route-bookings/${booking.id}/photos`, carrier.token, 'document'),
      () => db.query('UPDATE carrier_routes SET carrier_id = $2 WHERE id = $1', [routeId, replacement.id]),
    );
    expect(response.status).toBe(403);
    expect((await db.query('SELECT * FROM photos WHERE booking_id = $1', [booking.id])).rows).toHaveLength(0);
  });
});
