// =====================================================================
//  ADATVÉDELMI KÖR 3 — a SÉMA-ALAPÚ audit találatai
//
//  A harmadik kör nem a kódot járta végig, hanem az ADATOT: tábláról
//  táblára, oszloponként. Ezért találta meg azt, amit két kód-alapú kör nem:
//
//   1) a HIRDETÉSI („listing") fotó örökre megmaradt a PUBLIKUS tárolóban —
//      a retenció csak a pickup/dropoff képekre futott. Ezt a FELADÓ tölti
//      fel a saját lakásában, és a kívülállók is látják;
//   2) az admin fuvar-/járat-/foglalás-törlése R2-árvákat hagyott (a
//      fiók-törlésnél ezt már javítottuk — ez a három ág kimaradt);
//   3) a `payment_events.summary` a feladó TELJES NEVÉT tárolta szövegben,
//      miközben az azonosító mezők törléskor NULL-ra állnak;
//   4) a `deleted_accounts` sózatlan, visszafejthető e-mail-lenyomatot
//      őrzött ÖRÖKRE — épp attól, aki a törlési jogát gyakorolta —, és a
//      teljes kódbázisban egyetlen hivatkozás volt rá: maga az INSERT.
// =====================================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const storage = require('../src/services/storage');
const {
  purgeOldDeliveryPhotos, purgeOldDeletedAccounts, DELETED_ACCOUNT_RETENTION_YEARS,
} = require('../src/services/retention');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** Fotó-sor egy fuvarhoz, adott típussal és korral. */
async function fotot({ jobId, kind, evek = 0, napok = 0 }) {
  const { rows } = await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url)
     SELECT $1, shipper_id, $2, $3 FROM jobs WHERE id = $1 RETURNING id`,
    [jobId, kind, `https://r2.pelda.hu/${kind}-${Date.now()}-${Math.random()}.jpg`],
  );
  await db.query(
    `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval - ($3 || ' days')::interval
      WHERE id = $1`,
    [jobId, evek, napok],
  );
  return rows[0].id;
}

const fotoLetezik = async (id) => (await db.query('SELECT 1 FROM photos WHERE id = $1', [id])).rowCount > 0;

describe('Hirdetési fotó: a retenció rá is vonatkozik', () => {
  it('a lezárt fuvar HIRDETÉSI fotója is törlődik 30 nap után', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered', paid: true });
    const listing = await fotot({ jobId: job.id, kind: 'listing', napok: 40 });
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDeliveryPhotos();

    expect(
      await fotoLetezik(listing),
      'a HIRDETÉSI fotó (a feladó lakásáról) örökre a publikus tárolóban maradt',
    ).toBe(false);
  });

  it('a damage/document fotó is elévül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'completed', paid: true });
    const damage = await fotot({ jobId: job.id, kind: 'damage', napok: 40 });
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDeliveryPhotos();
    expect(await fotoLetezik(damage)).toBe(false);
  });

  it('a FRISS hirdetési fotót nem bántja (a fuvar még fut)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const listing = await fotot({ jobId: job.id, kind: 'listing', napok: 2 });
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDeliveryPhotos();
    expect(await fotoLetezik(listing), 'egy FUTÓ fuvar hirdetési fotóját törölte!').toBe(true);
  });

  it('vitás (zárolt) ügyletnél a hirdetési fotó is 5 évig marad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered', paid: true });
    const listing = await fotot({ jobId: job.id, kind: 'listing', evek: 2 });
    await db.query('UPDATE jobs SET photo_retention_hold = TRUE WHERE id = $1', [job.id]);
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDeliveryPhotos();
    expect(await fotoLetezik(listing), 'a zárolt bizonyíték 5 év előtt eltűnt').toBe(true);
  });
});

describe('Admin-törlés: nem marad árva fájl a tárolóban', () => {
  it('fuvar törlésekor a fotók a tárolóból is elmennek', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'cancelled' });
    await fotot({ jobId: job.id, kind: 'listing' });
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    const res = await request(app).delete(`/admin/jobs/${job.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(
      torles,
      'ÁRVA FÁJL: a DB-sor CASCADE-del eltűnt, a tárolt fotó viszont örökre ottmaradt',
    ).toHaveBeenCalled();
  });

  it('foglalás törlésekor is', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'cancelled', paid: false,
    });
    await db.query(
      `INSERT INTO photos (booking_id, uploader_id, kind, url)
       VALUES ($1, $2, 'pickup', 'https://r2.pelda.hu/b.jpg')`,
      [booking.id, szallito.id],
    );
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    const res = await request(app).delete(`/admin/bookings/${booking.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(torles).toHaveBeenCalledWith('https://r2.pelda.hu/b.jpg');
  });
});

describe('Fizetési napló: nincs benne név', () => {
  it('a summary a feladó azonosítóját tárolja, nem a nevét', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET full_name = $2 WHERE id = $1', [felado.id, 'Egyedi Névteszt Elek']);
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    const paymentId = `nev-teszt-${job.id}`;
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', $2, 0, 500)`,
      [job.id, paymentId],
    );

    await request(app).post('/payments/cib/callback').send({ PaymentId: paymentId, Status: 'Succeeded' });

    const { rows } = await db.query(
      `SELECT summary FROM payment_events WHERE payment_id = $1 AND status = 'Succeeded'`, [paymentId],
    );
    expect(rows[0], 'nem keletkezett naplósor').toBeTruthy();
    expect(
      rows[0].summary,
      'a TELJES NÉV bekerült a naplóba — a fiók törlése után is ottmaradna',
    ).not.toContain('Egyedi Névteszt Elek');
    expect(rows[0].summary).toContain(felado.id);
  });
});

describe('Törölt fiók audit-nyoma', () => {
  it('a lenyomat HMAC-elt (nem a nyers e-mail SHA-256-ja)', async () => {
    const user = await createUser({ role: 'shipper' });
    const email = (await db.query('SELECT email FROM users WHERE id = $1', [user.id])).rows[0].email;

    await request(app).delete('/auth/me').set(auth(user.token));

    const { rows } = await db.query(
      'SELECT email_hash, hash_algo FROM deleted_accounts WHERE original_user_id = $1', [user.id],
    );
    expect(rows[0], 'nem keletkezett audit-nyom').toBeTruthy();
    expect(rows[0].hash_algo).toBe('hmac-sha256');

    // A sózatlan SHA-256 visszafejthető lenne egy e-mail-jelöltlistával —
    // ezért ellenőrizzük, hogy NEM az szerepel a táblában.
    const sozatlan = require('crypto').createHash('sha256').update(email).digest('hex');
    expect(
      rows[0].email_hash,
      'a lenyomat a nyers e-mail SHA-256-ja — jelöltlistával visszafejthető',
    ).not.toBe(sozatlan);
  });

  it('az 5 évnél régebbi audit-nyom elévül', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query(
      `INSERT INTO deleted_accounts (original_user_id, email_hash, reason, deleted_at)
       VALUES ($1, 'regi', 'teszt', NOW() - ($2 || ' years')::interval - INTERVAL '1 day')`,
      [user.id, DELETED_ACCOUNT_RETENTION_YEARS],
    );
    await purgeOldDeletedAccounts();

    const { rows } = await db.query(
      `SELECT 1 FROM deleted_accounts WHERE original_user_id = $1 AND reason = 'teszt'`, [user.id],
    );
    expect(rows.length, 'a törölt fiók lenyomata 5 év után is megmaradt').toBe(0);
  });
});
