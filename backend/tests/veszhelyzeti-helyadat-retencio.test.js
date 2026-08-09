// =====================================================================
//  VÉSZHELYZETI HELYADAT: SOS + mentés-kérés elévülése
//
//  Audit-találat (2026-08-09, 2. kör). A `sos_events` és a `tow_requests`
//  egyik retenciós körbe sem tartozott — pedig ez a rendszer LEGÉRZÉKENYEBB
//  helyadata: egy vészhelyzet pontos koordinátája és időpontja, szabad
//  szöveges leírással; a mentés-kérésnél a cím és a rendszám is. Eközben a
//  tájékoztató azt ígéri, hogy a nyers helyadatot 7 nap után töröljük, és a
//  `location_pings` / `users.last_known_*` már gépesítve is volt.
//
//  Két lépcső: 7 nap után a HELY és a szabad szöveg, 1 év után maga a sor.
//  A vészhelyzet TÉNYE addig megmarad (jogi igényérvényesítés), de hely nélkül.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';

const { db, createUser, createJob } = require('./helpers');
const {
  purgeEmergencyLocations, SOS_LOCATION_RETENTION_DAYS, SOS_EVENT_RETENTION_YEARS,
} = require('../src/services/retention');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

/** SOS-esemény adott korral. */
async function sosEsemeny({ napok = 0, evek = 0 } = {}) {
  const user = await createUser({ role: 'carrier' });
  const { rows } = await db.query(
    `INSERT INTO sos_events (user_id, lat, lng, message, created_at)
     VALUES ($1, 47.49791, 19.04023, 'Elakadtam az árokban', NOW() - ($2 || ' days')::interval - ($3 || ' years')::interval)
     RETURNING id`,
    [user.id, napok, evek],
  );
  return rows[0].id;
}

/** Mentés-kérés adott korral. */
async function mentesKeres({ napok = 0, evek = 0 } = {}) {
  const user = await createUser({ role: 'shipper' });
  const { rows } = await db.query(
    `INSERT INTO tow_requests (requester_id, lat, lng, address, issue_type,
                               issue_description, vehicle_type, vehicle_plate, created_at)
     VALUES ($1, 47.49791, 19.04023, 'Budapest, Váci út 1.', 'breakdown',
             'Nem indul a motor', 'car', 'ABC-123',
             NOW() - ($2 || ' days')::interval - ($3 || ' years')::interval)
     RETURNING id`,
    [user.id, napok, evek],
  );
  return rows[0].id;
}

const sos = async (id) => (await db.query('SELECT * FROM sos_events WHERE id = $1', [id])).rows[0];
const tow = async (id) => (await db.query('SELECT * FROM tow_requests WHERE id = $1', [id])).rows[0];

describe('SOS: a vészhelyzet pontos helye 7 nap után eltűnik', () => {
  it('a 7 napnál régebbi jelzésből törlődik a koordináta és az üzenet', async () => {
    const id = await sosEsemeny({ napok: SOS_LOCATION_RETENTION_DAYS + 1 });
    await purgeEmergencyLocations();

    const sor = await sos(id);
    expect(sor, 'a sor eltűnt — a vészhelyzet ténye 1 évig megmaradna').toBeTruthy();
    expect(sor.lat, 'a vészhelyzet pontos koordinátája megmaradt').toBeNull();
    expect(sor.lng).toBeNull();
    expect(sor.message, 'a szabad szöveges leírás megmaradt').toBeNull();
  });

  it('a FRISS jelzést nem bántja (az admin még dolgozik vele)', async () => {
    const id = await sosEsemeny({ napok: 1 });
    await purgeEmergencyLocations();

    const sor = await sos(id);
    expect(sor.lat, 'egy 1 napos vészjelzés helyét már törölte').not.toBeNull();
    expect(sor.message).toBeTruthy();
  });

  it('1 év után maga a sor is törlődik', async () => {
    const id = await sosEsemeny({ evek: SOS_EVENT_RETENTION_YEARS, napok: 30 });
    await purgeEmergencyLocations();
    expect(await sos(id), 'az 1 évnél régebbi vészjelzés sora megmaradt').toBeUndefined();
  });
});

describe('Mentés-kérés: a bajba jutott helye, címe és rendszáma elévül', () => {
  it('7 nap után a hely, a cím, a leírás és a rendszám eltűnik', async () => {
    const id = await mentesKeres({ napok: SOS_LOCATION_RETENTION_DAYS + 1 });
    await purgeEmergencyLocations();

    const sor = await tow(id);
    expect(sor).toBeTruthy();
    expect(sor.address, 'a pontos cím megmaradt').toBeNull();
    expect(sor.issue_description, 'a szabad szöveges leírás megmaradt').toBeNull();
    expect(sor.vehicle_plate, 'a rendszám (személyes adat) megmaradt').toBeNull();
    // A lat/lng NOT NULL a sémában, ezért nullázás helyett 0-ra állítjuk
    expect(Number(sor.lat)).toBe(0);
    expect(Number(sor.lng)).toBe(0);
    // A típus-mezők maradnak: ezekből statisztika készül, nem azonosítanak
    expect(sor.issue_type).toBe('breakdown');
    expect(sor.vehicle_type).toBe('car');
  });

  it('a friss kérést nem bántja (a mentős még úton van)', async () => {
    const id = await mentesKeres({ napok: 1 });
    await purgeEmergencyLocations();
    expect((await tow(id)).address).toBeTruthy();
  });

  it('1 év után a sor is törlődik', async () => {
    const id = await mentesKeres({ evek: SOS_EVENT_RETENTION_YEARS, napok: 30 });
    await purgeEmergencyLocations();
    expect(await tow(id)).toBeUndefined();
  });
});

describe('A kör a kikapcsolt funkció mellett is fut', () => {
  it('a takarítás akkor is dolgozik, ha a mentés-funkció ki van kapcsolva', async () => {
    // A TOWING_ENABLED csak a VÉGPONTOKAT zárja; a régi adatnak akkor is
    // el kell évülnie — különben a bekapcsolás pillanatában ott állna egy
    // évekkel korábbi, takarítatlan helyadat-halom.
    const eredeti = process.env.TOWING_ENABLED;
    process.env.TOWING_ENABLED = '';
    try {
      const id = await mentesKeres({ napok: SOS_LOCATION_RETENTION_DAYS + 1 });
      await purgeEmergencyLocations();
      expect((await tow(id)).address).toBeNull();
    } finally {
      process.env.TOWING_ENABLED = eredeti;
    }
  });
});
