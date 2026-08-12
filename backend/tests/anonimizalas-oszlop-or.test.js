// =====================================================================
//  ANONIMIZÁLÁSI OSZLOP-ŐR (2026-08-11, 10. mérés F1)
//
//  ⚠️ A HIÁNYZÓ GRANULARITÁSI SZINT. A projektnek kilenc őre volt, és
//  mindegyik ENTITÁST kényszerített ki: minden TÁBLÁNAK legyen retenciós
//  szabálya, minden VÉGPONT legyen besorolva, minden STÁTUSZ essen valamelyik
//  ág alá, minden Sentry-HOOK kapjon szűrőt. Egy szinttel lejjebb — az
//  ATTRIBÚTUMNÁL — viszont nem volt semmi.
//
//  LEMÉRVE: a `retention.js`-ből kivéve a `declared_value_huf = NULL,`, a
//  `sender_delivery_code = NULL,` és a `dropoff_floor = 0,` sorokat, mind a
//  793 teszt ZÖLD MARADT. Vagyis a csomag deklarált értéke, a feladó
//  vészhelyzeti átvételi kódja és a címzett lakásának emelete határidő nélkül
//  megmaradt volna — a megmaradó `shipper_id` mellett, tehát személyhez köthetően.
//
//  Ez az őr TÉNYLEGESEN LEFUTTATJA az anonimizálást egy MINDEN oszlopában
//  kitöltött soron, és utána megnézi, mi maradt. Nem forrásszöveget illeszt:
//  egy komment vagy egy átnevezés nem elégíti ki.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db, createUser, createJob, createBooking } = require('./helpers');
const {
  anonymizeOldJobs, anonymizeOldCarrierRoutes, JOB_PII_RETENTION_YEARS,
} = require('../src/services/retention');
const { ANONIMIZALAS_MANIFEST } = require('./anonimizalasManifest');

/** „Üresnek" számít-e az érték az anonimizálás után? */
function ures(ertek) {
  return ertek === null || ertek === '' || ertek === 0 || ertek === false;
}

async function oszlopok(tabla) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tabla],
  );
  return rows.map((r) => r.column_name);
}

describe('Anonimizálási oszlop-őr', () => {
  it('MINDEN oszlop be van sorolva (új oszlop = tudatos döntés)', async () => {
    const gondok = [];
    for (const tabla of Object.keys(ANONIMIZALAS_MANIFEST)) {
      const valos = await oszlopok(tabla);
      expect(valos.length, `nem sikerült kiolvasni a(z) ${tabla} oszlopait`).toBeGreaterThan(10);

      for (const o of valos) {
        if (!ANONIMIZALAS_MANIFEST[tabla][o]) gondok.push(`${tabla}.${o}`);
      }
      // …és fordítva: a manifest ne hivatkozzon nem létező oszlopra
      for (const o of Object.keys(ANONIMIZALAS_MANIFEST[tabla])) {
        if (!valos.includes(o)) gondok.push(`${tabla}.${o} (a manifestben van, a sémában NINCS)`);
      }
    }
    expect(
      gondok,
      `Ezek az oszlopok nincsenek elszámolva az anonimizálásnál:\n  ${gondok.join('\n  ')}\n\n`
      + 'Döntsd el mindegyikről:\n'
      + "  'urul'  — az anonimizálás után nem tartalmazhat adatot\n"
      + "  { marad: '…' } — indokoltan megmarad, ÍRÁSOS indoklással\n\n"
      + 'Enélkül egy új PII-oszlop átmenne mindhárom sémából olvasó őrön\n'
      + '(retenciós, halott-oszlop, állapot-mátrix), mert azok tábla- és\n'
      + 'státusz-szinten mérnek, nem oszlop-szinten.',
    ).toEqual([]);
  });

  it('a fuvar MINDEN „urul" oszlopa tényleg kiürül (futtatva)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    // MINDEN „urul" oszlopot feltöltünk — így nem tudunk véletlenül azért
    // zöldet kapni, mert a fixture eleve üresen hagyta a mezőt.
    await db.query(
      `UPDATE jobs SET
         description = 'Anyukám bútorai, csöngess a Kovács névre',
         cancel_reason = 'A címzett nem volt otthon a Fő utca 12-ben',
         ai_description_notes = 'A leírás említi a 3. emeletet',
         source_store = 'IKEA Örs vezér tere',
         source_image_url = 'https://example.com/termek.jpg',
         declared_value_huf = 250000,
         sender_delivery_code = '999888',
         title = 'Kovács Jánosné bútorai',
         pickup_floor = 3, dropoff_floor = 2,
         pickup_has_elevator = TRUE, dropoff_has_elevator = TRUE,
         pickup_needs_carrying = TRUE, dropoff_needs_carrying = TRUE,
         updated_at = NOW() - ($2 || ' years')::interval
       WHERE id = $1`,
      [job.id, JOB_PII_RETENTION_YEARS + 1],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [job.id]);
    const sor = rows[0];
    const bentmaradt = Object.entries(ANONIMIZALAS_MANIFEST.jobs)
      .filter(([, v]) => v === 'urul')
      .filter(([o]) => !ures(sor[o]))
      .map(([o]) => `${o} = ${JSON.stringify(sor[o])}`);

    expect(
      bentmaradt,
      `Ezek az oszlopok az anonimizálás UTÁN is tartalmaznak adatot:\n  ${bentmaradt.join('\n  ')}\n\n`
      + 'A fuvar sora megmarad (a shipper_id-vel együtt), tehát ami itt bent\n'
      + 'ragad, az SZEMÉLYHEZ KÖTHETŐEN marad meg — határidő nélkül.\n'
      + 'A tájékoztató 3 évet ígér a fuvar személyes adataira.',
    ).toEqual([]);

    // A „marad" oldalt is mérjük: a védelem NE legyen túl széles.
    expect(sor.shipper_id, 'a feladó azonosítója is eltűnt — a fuvar TÉNYE elveszett').toBeTruthy();
    expect(sor.status, 'a státusz eltűnt').toBeTruthy();
    expect(sor.anonymized_at, 'nincs nyoma, hogy az anonimizálás megtörtént').toBeTruthy();
  });

  it('a foglalás MINDEN „urul" oszlopa tényleg kiürül (futtatva)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    await db.query(
      `UPDATE route_bookings SET
         notes = 'A szomszéd néni veszi át, Kovácsné',
         cancel_reason = 'Nem volt otthon senki',
         created_at = NOW() - ($2 || ' years')::interval,
         delivered_at = NOW() - ($2 || ' years')::interval
       WHERE id = $1`,
      [booking.id, JOB_PII_RETENTION_YEARS + 1],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT * FROM route_bookings WHERE id = $1', [booking.id]);
    const sor = rows[0];
    const bentmaradt = Object.entries(ANONIMIZALAS_MANIFEST.route_bookings)
      .filter(([, v]) => v === 'urul')
      .filter(([o]) => !ures(sor[o]))
      .map(([o]) => `${o} = ${JSON.stringify(sor[o])}`);

    expect(
      bentmaradt,
      `Ezek a foglalás-oszlopok az anonimizálás UTÁN is tartalmaznak adatot:\n  ${bentmaradt.join('\n  ')}`,
    ).toEqual([]);
  });

  it('a JÁRAT MINDEN „urul" oszlopa tényleg kiürül (futtatva)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const { rows: jarat } = await db.query(
      `INSERT INTO carrier_routes
         (carrier_id, title, description, vehicle_description, waypoints,
          departure_at, status, created_at)
       VALUES ($1, 'Kovács János rendszeres járata',
               'Minden kedden megyek, hívj a 06 30 111 2222-n',
               'Fehér Ford Transit, KOV-123',
               '[{"name":"Budapest, Váci út 12.","lat":47.49,"lng":19.04}]'::jsonb,
               NOW() - INTERVAL '5 years', 'completed', NOW() - INTERVAL '5 years')
       RETURNING id`,
      [szallito.id],
    );

    await anonymizeOldCarrierRoutes();

    const { rows } = await db.query('SELECT * FROM carrier_routes WHERE id = $1', [jarat[0].id]);
    const sor = rows[0];
    const bentmaradt = Object.entries(ANONIMIZALAS_MANIFEST.carrier_routes)
      .filter(([, v]) => v === 'urul')
      .filter(([o]) => {
        const e = sor[o];
        if (e === null || e === '' || e === 0 || e === false) return false;
        // a waypoints üres tömbje is „ürült"
        if (Array.isArray(e) && e.length === 0) return false;
        return true;
      })
      .map(([o]) => `${o} = ${JSON.stringify(sor[o])}`);

    expect(
      bentmaradt,
      `Ezek a JÁRAT-oszlopok az anonimizálás UTÁN is tartalmaznak adatot:\n  ${bentmaradt.join('\n  ')}\n\n`
      + 'A `waypoints` az, amit a retention.js saját indoklása MOZGÁSPROFILNAK\n'
      + 'nevez: „hogy egy magánszemély jellemzően mikor merre jár". A megmaradó\n'
      + 'carrier_id mellett ez személyhez köthetően maradna, határidő nélkül.',
    ).toEqual([]);
  });

  it('a „marad" bejegyzések indoklása érdemi', () => {
    for (const [tabla, oszlopok2] of Object.entries(ANONIMIZALAS_MANIFEST)) {
      for (const [o, v] of Object.entries(oszlopok2)) {
        if (v === 'urul' || v === 'rovidul') continue;
        expect(
          typeof v.marad === 'string' && v.marad.length > 30,
          `A(z) ${tabla}.${o} indoklása túl rövid. Írd le, MIÉRT maradhat meg `
          + 'egy 3+ éves, anonimizált fuvaron.',
        ).toBe(true);
      }
    }
  });
});
