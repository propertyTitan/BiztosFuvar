// =====================================================================
//  A LEZÁRT FUVAROK SZEMÉLYES ADATAI ELÉVÜLNEK
//
//  Audit-találat (2026-08-09, 2. kör). A `jobs` és a `route_bookings`
//  táblának SEMMILYEN megőrzési ideje nem volt: a köré épült adatokat
//  gépiesen töröltük (fotó 30 nap, chat 6 hónap, GPS 7 nap), de maga a
//  fuvar-sor — a PONTOS két címmel, a koordinátákkal, a címzett teljes
//  elérhetőségével és a csomag deklarált értékével — örökre megmaradt.
//
//  Törlés helyett ANONIMIZÁLÁS: a fuvar ténye üzletileg kell (statisztika,
//  értékelés-előzmény, elszámolás), a személyes adat nem. A sor megmarad, a
//  PII ürül, a cím településre rövidül.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';

const { db, createUser, createJob, createBooking } = require('./helpers');
const { anonymizeOldJobs, JOB_PII_RETENTION_YEARS } = require('../src/services/retention');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

const jobSor = async (id) => (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];

/** Lezárt fuvar, adott korral. */
async function regiFuvar({ evek, hold = false }) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
  });
  await db.query(
    `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval,
                     photo_retention_hold = $3
      WHERE id = $1`,
    [job.id, evek, hold],
  );
  return job;
}

describe('Fuvar-anonimizálás: a személyes adat elévül, a fuvar ténye marad', () => {
  it('3 évnél régebbi lezárt fuvarnál a címzett-adatok törlődnek', async () => {
    const job = await regiFuvar({ evek: JOB_PII_RETENTION_YEARS + 1 });
    // Kiinduló állapot: a fixture valódi címzett-adatokkal dolgozik
    const elotte = await jobSor(job.id);
    expect(elotte.recipient_phone).toBeTruthy();

    await anonymizeOldJobs();

    const utana = await jobSor(job.id);
    expect(utana.recipient_name, 'a címzett neve megmaradt').toBeNull();
    expect(utana.recipient_phone, 'a címzett telefonszáma megmaradt').toBeNull();
    expect(utana.recipient_email).toBeNull();
    expect(utana.delivery_code, 'az átvételi kód megmaradt').toBeNull();
    expect(utana.tracking_token, 'a követő-token megmaradt — vele a régi link is élne').toBeNull();
    expect(utana.anonymized_at).not.toBeNull();
  });

  it('a pontos cím településre rövidül, a koordináta ~1 km-re kerekedik', async () => {
    const job = await regiFuvar({ evek: JOB_PII_RETENTION_YEARS + 1 });
    await anonymizeOldJobs();

    const utana = await jobSor(job.id);
    expect(utana.pickup_address, 'a pontos utca+házszám megmaradt').toBe('Budapest');
    expect(utana.dropoff_address).toBe('Szeged');
    expect(Number(utana.pickup_lat)).toBe(47.5);
    expect(Number(utana.dropoff_lng)).toBe(20.14);
  });

  it('a fuvar TÉNYE megmarad (statisztika, elszámolás)', async () => {
    const job = await regiFuvar({ evek: JOB_PII_RETENTION_YEARS + 1 });
    await anonymizeOldJobs();

    const utana = await jobSor(job.id);
    expect(utana, 'a sor eltűnt — a statisztika és az elszámolás elveszne').toBeTruthy();
    expect(utana.status).toBe('delivered');
    expect(utana.accepted_price_huf).toBeTruthy();
    expect(utana.shipper_id).toBeTruthy();
    expect(utana.carrier_id).toBeTruthy();
  });

  it('a FRISS lezárt fuvart nem bántja', async () => {
    const job = await regiFuvar({ evek: 1 });
    await anonymizeOldJobs();

    const utana = await jobSor(job.id);
    expect(utana.recipient_phone, 'egy 1 éves fuvar adatait már törölte').toBeTruthy();
    expect(utana.anonymized_at).toBeNull();
  });

  it('a ZÁROLT (vitás) ügyletet 5 évig őrzi — a bizonyíték nem tűnhet el', async () => {
    const job = await regiFuvar({ evek: 4, hold: true });
    await anonymizeOldJobs();

    const utana = await jobSor(job.id);
    expect(
      utana.recipient_phone,
      'a zárolt (vitás) ügylet bizonyítéka 5 év előtt eltűnt',
    ).toBeTruthy();
  });

  it('a zárolt ügylet is elévül 5 év után', async () => {
    const job = await regiFuvar({ evek: 6, hold: true });
    await anonymizeOldJobs();
    expect((await jobSor(job.id)).recipient_phone).toBeNull();
  });

  it('a NEM lezárt (folyamatban lévő) fuvart soha nem érinti', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    await db.query(
      `UPDATE jobs SET updated_at = NOW() - INTERVAL '10 years' WHERE id = $1`, [job.id],
    );
    await anonymizeOldJobs();
    expect((await jobSor(job.id)).recipient_phone, 'egy FOLYAMATBAN lévő fuvar adatai törlődtek!').toBeTruthy();
  });

  it('kétszer futtatva nem dolgozik újra (anonymized_at guard)', async () => {
    await regiFuvar({ evek: JOB_PII_RETENTION_YEARS + 1 });
    const elso = await anonymizeOldJobs();
    const masodik = await anonymizeOldJobs();
    expect(elso).toBeGreaterThan(0);
    expect(masodik, 'a napi kör minden nap újra végigfutna a régi sorokon').toBe(0);
  });

  it('a foglalási (Járat) ág is anonimizálódik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    await db.query(
      `UPDATE route_bookings SET delivered_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
      [booking.id, JOB_PII_RETENTION_YEARS + 1],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT * FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].recipient_phone).toBeNull();
    expect(rows[0].delivery_code).toBeNull();
    expect(rows[0].pickup_address).toBe('Budapest');
    expect(rows[0].status, 'a foglalás ténye eltűnt').toBe('delivered');
  });
});
