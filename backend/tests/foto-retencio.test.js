// Fuvar-fotó retenció (2026-07-16 user-döntés) — a szabály gépi őrzése:
//   - lezárt fuvar pickup/dropoff fotója 30 nap után törlődik
//   - vitás/zárolt fuvar fotója MARAD (5 évig; 5 év után az is törlődik)
//   - friss lezárás (<30 nap) fotója marad
//   - a 'listing' (hirdetési) fotó is elévül a lezárás után — 2026-08-09
//     óta; a FUTÓ hirdetés fotóját viszont nem bántja
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db, createUser, createJob } = require('./helpers');
const { purgeOldDeliveryPhotos, purgeOldChatMessages, purgeOldLocationPings, DEFAULT_RETENTION_DAYS } = require('../src/services/retention');

// data: URL — a deleteFile-nak nincs tároló-dolga vele, a sor-törlés a lényeg
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

async function insertJob({ shipperId, carrierId, status, ageDays, hold = false }) {
  const { rows } = await db.query(
    `INSERT INTO jobs (shipper_id, carrier_id, title, description,
        pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
        suggested_price_huf, status, photo_retention_hold,
        created_at, updated_at)
     VALUES ($1,$2,'retenció teszt','x','A',47.5,19.0,'B',46.2,20.1,
        10000,$3,$4, NOW() - ($5 || ' days')::interval, NOW() - ($5 || ' days')::interval)
     RETURNING id`,
    [shipperId, carrierId, status, hold, ageDays],
  );
  return rows[0].id;
}

async function insertPhoto(jobId, kind, uploaderId) {
  const { rows } = await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1,$2,$3,$4) RETURNING id`,
    [jobId, uploaderId, kind, DATA_URL],
  );
  return rows[0].id;
}

async function photoExists(id) {
  const { rows } = await db.query('SELECT 1 FROM photos WHERE id = $1', [id]);
  return rows.length > 0;
}

describe('Fuvar-fotó retenció (30 nap / zárolva 5 év)', () => {
  let shipper, carrier;
  beforeAll(async () => {
    shipper = await createUser();
    carrier = await createUser('carrier');
  });

  it('lezárt fuvar 31 napos pickup+dropoff fotója törlődik', async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 31 });
    const p1 = await insertPhoto(jobId, 'pickup', carrier.id);
    const p2 = await insertPhoto(jobId, 'dropoff', carrier.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p1)).toBe(false);
    expect(await photoExists(p2)).toBe(false);
  });

  it('friss (10 napos) lezárás fotója MARAD', async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 10 });
    const p = await insertPhoto(jobId, 'pickup', carrier.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p)).toBe(true);
  });

  it('zárolt (vitás) fuvar 31 napos fotója MARAD; 5 évnél idősebb zárolt viszont törlődik', async () => {
    const held = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'disputed', ageDays: 31, hold: true });
    const pHeld = await insertPhoto(held, 'dropoff', carrier.id);

    const ancient = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 5 * 365 + 10, hold: true });
    const pAncient = await insertPhoto(ancient, 'dropoff', carrier.id);

    await purgeOldDeliveryPhotos();
    expect(await photoExists(pHeld)).toBe(true);
    expect(await photoExists(pAncient)).toBe(false);
  });

  // ⚠️ EZ A TESZT KORÁBBAN A HIBÁT KODIFIKÁLTA (2026-08-09, séma-alapú audit).
  // Azt írta elő, hogy a purge NE érintse a 'listing' fotót — csakhogy ezt a
  // képet a FELADÓ tölti fel a saját lakásában (bútor, doboz, a szoba
  // belseje), a PUBLIKUS bucketbe, egyéves immutable cache-sel, és a
  // kívülállók is látják. Vagyis ez volt a rendszer leghosszabb ideig tartó,
  // legszélesebb körű expozíciója — miközben a tájékoztató 30 napot ígért a
  // fuvar-fotókra. A hirdetési fotó a fuvar LEZÁRÁSA után már semmit nem
  // szolgál, tehát ugyanaz a szabály vonatkozik rá, mint a többire.
  it("a LEZÁRT fuvar 'listing' fotója is elévül", async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 60 });
    const p = await insertPhoto(jobId, 'listing', shipper.id);
    await purgeOldDeliveryPhotos();
    expect(
      await photoExists(p),
      'a hirdetési fotó (a feladó lakásáról) örökre a publikus tárolóban maradt',
    ).toBe(false);
  });

  it("a FUTÓ fuvar 'listing' fotóját nem bántja (a hirdetés még él)", async () => {
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'bidding', ageDays: 60 });
    const p = await insertPhoto(jobId, 'listing', shipper.id);
    await purgeOldDeliveryPhotos();
    expect(await photoExists(p), 'egy FUTÓ hirdetés fotóját törölte').toBe(true);
  });

  it('a vita-nyitás automatikusan zárol (photo_retention_hold=TRUE)', async () => {
    const { app } = require('./helpers');
    const request = require('supertest');
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', ageDays: 1 });
    const res = await request(app)
      .post('/disputes')
      .set('Authorization', `Bearer ${shipper.token}`)
      .send({ job_id: jobId, description: 'retenció-teszt vita' });
    expect(res.status).toBe(201);
    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [jobId]);
    expect(rows[0].photo_retention_hold).toBe(true);
  });
});

describe('Chat-retenció (6 hónap / zárolva 5 év)', () => {
  let shipper, carrier;
  beforeAll(async () => {
    shipper = await createUser();
    carrier = await createUser('carrier');
  });

  async function insertMsg(jobId, senderId, ageDays = 0) {
    const { rows } = await db.query(
      `INSERT INTO messages (job_id, sender_id, body, created_at)
       VALUES ($1,$2,'retenció teszt üzenet', NOW() - ($3 || ' days')::interval) RETURNING id`,
      [jobId, senderId, ageDays],
    );
    return rows[0].id;
  }
  async function msgExists(id) {
    const { rows } = await db.query('SELECT 1 FROM messages WHERE id = $1', [id]);
    return rows.length > 0;
  }

  it('7 hónapja lezárt fuvar üzenete törlődik; 1 hónapos marad', async () => {
    const oldJob = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 215 });
    const freshJob = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 30 });
    const mOld = await insertMsg(oldJob, shipper.id, 215);
    const mFresh = await insertMsg(freshJob, carrier.id, 30);
    await purgeOldChatMessages();
    expect(await msgExists(mOld)).toBe(false);
    expect(await msgExists(mFresh)).toBe(true);
  });

  it('zárolt (vitás) ügylet üzenete 7 hónap után is MARAD; 5+ éves zárolté törlődik', async () => {
    const held = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'disputed', ageDays: 215, hold: true });
    const ancient = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'completed', ageDays: 5 * 365 + 10, hold: true });
    const mHeld = await insertMsg(held, shipper.id, 215);
    const mAncient = await insertMsg(ancient, shipper.id, 5 * 365 + 10);
    await purgeOldChatMessages();
    expect(await msgExists(mHeld)).toBe(true);
    expect(await msgExists(mAncient)).toBe(false);
  });
});

describe('GPS-ping retenció (7 nap)', () => {
  it('8 napos ping törlődik, 2 napos marad', async () => {
    const shipper = await createUser();
    const carrier = await createUser('carrier');
    const jobId = await insertJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', ageDays: 10 });
    const { rows: oldPing } = await db.query(
      `INSERT INTO location_pings (job_id, carrier_id, lat, lng, recorded_at)
       VALUES ($1,$2,47.5,19.0, NOW() - interval '8 days') RETURNING id`,
      [jobId, carrier.id],
    );
    const { rows: freshPing } = await db.query(
      `INSERT INTO location_pings (job_id, carrier_id, lat, lng, recorded_at)
       VALUES ($1,$2,47.6,19.1, NOW() - interval '2 days') RETURNING id`,
      [jobId, carrier.id],
    );
    await purgeOldLocationPings();
    const { rows: o } = await db.query('SELECT 1 FROM location_pings WHERE id=$1', [oldPing[0].id]);
    const { rows: f } = await db.query('SELECT 1 FROM location_pings WHERE id=$1', [freshPing[0].id]);
    expect(o.length).toBe(0);
    expect(f.length).toBe(1);
  });
});

// =====================================================================
//  A TÁROLÓ-TÖRLÉS KUDARCA (2026-08-11, séma-audit T2)
//
//  ⚠️ ELLENPÉLDA, AMI KORÁBBAN NEM BUKOTT: a `storage.deleteFile` R2-hibánál
//  CSENDBEN `false`-t ad. A purge mégis törölte a `photos` sort — az EGYETLEN
//  mutatót a fájlra —, tehát egy átmeneti R2-kiesés VÉGLEGESEN a publikus
//  bucketben hagyta az objektumot: se retry, se riasztás, se sepregető.
//  A régi tesztek ezt nem vehették észre: data:URL-t használtak fotó-URL-nek,
//  és kizárólag DB-sor létezését mérték — a tároló felé semmit.
// =====================================================================
describe('Tároló-hiba: a mutatót nem dobjuk el', () => {
  it('sikertelen fájl-törlésnél a photos sor MEGMARAD (holnap újrapróbáljuk)', async () => {
    const storage = require('../src/services/storage');
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    await db.query(
      `UPDATE jobs SET updated_at = NOW() - ($2 || ' days')::interval WHERE id = $1`,
      [job.id, DEFAULT_RETENTION_DAYS + 5],
    );
    const { rows: [foto] } = await db.query(
      `INSERT INTO photos (job_id, uploader_id, kind, url)
       VALUES ($1, $2, 'pickup', 'https://r2.example/teszt-foto.jpg') RETURNING id`,
      [job.id, szallito.id],
    );

    const eredeti = storage.deleteFile;
    storage.deleteFile = async () => false; // az R2 „elérhetetlen"
    try {
      await purgeOldDeliveryPhotos();
    } finally {
      storage.deleteFile = eredeti;
    }

    const { rows } = await db.query('SELECT id FROM photos WHERE id = $1', [foto.id]);
    expect(
      rows.length,
      'A tároló-törlés elbukott, de a DB-sort mégis töröltük.\n'
      + 'Ezzel az objektum VÉGLEGESEN árva marad a publikus bucketben:\n'
      + 'nincs mutató, nincs retry, nincs riasztás. A sort meg kell tartani,\n'
      + 'hogy a holnapi kör újrapróbálhassa (a KYC-ág már így csinálja).',
    ).toBe(1);

    // …és ha az R2 újra elérhető, a következő kör tényleg elviszi:
    storage.deleteFile = async () => true;
    try {
      await purgeOldDeliveryPhotos();
    } finally {
      storage.deleteFile = eredeti;
    }
    const { rows: utana } = await db.query('SELECT id FROM photos WHERE id = $1', [foto.id]);
    expect(utana.length, 'a helyreállás után sem törölt — beragadt volna').toBe(0);
  });
});

// =====================================================================
//  A „NEM ISMEREM FEL" ÁG (2026-08-12, 11. mérés A3)
//
//  ⚠️ A 8. körben lezárt árva-fájl osztálynak volt egy CSENDES, TÖMEGES
//  változata. A `deleteFile` korábban MINDEN fel nem ismert alakra `true`-t
//  adott. A `data:` URL-re ez helyes — egy `http(s)://` URL-re viszont
//  végzetes: ha az `R2_PUBLIC_URL` megváltozik (saját domainre váltás) vagy
//  egy deploynál eltér, a prefix-illesztés elhasal, a függvény „sikert"
//  jelent, és a napi kör TÖRLI AZ EGYETLEN MUTATÓT minden régi fotóról.
//
//  A meglévő tesztek ezt nem foghatták meg: MINDEN `deleteFile`-hívás
//  mockolt volt, és a fixtúrák `data:` URL-t használtak — az igazi függvény
//  sosem látott `https://…` címet.
// =====================================================================
describe('deleteFile: ismeretlen távoli URL fail-closed', () => {
  it('a fel nem ismert http(s) URL FALSE-t ad (nem hazudik sikert)', async () => {
    const storage = require('../src/services/storage');
    const eredmeny = await storage.deleteFile('https://idegen-domain.example/valami/kep.jpg');
    expect(
      eredmeny,
      'A deleteFile SIKERT jelentett egy olyan URL-re, amit nem tud kulcsra\n'
      + 'képezni. Ettől a retenciós kör törli a DB-sort — az egyetlen mutatót —,\n'
      + 'miközben az objektum a PUBLIKUS bucketben marad, örökre, riasztás nélkül.\n'
      + 'Ez pontosan akkor történik, ha az R2_PUBLIC_URL megváltozik.',
    ).toBe(false);
  });

  it('a data: URL és a relatív út viszont TRUE (nincs mit törölni)', async () => {
    const storage = require('../src/services/storage');
    expect(
      await storage.deleteFile('data:image/png;base64,iVBORw0KGgo='),
      'a data: URL-re false-t adtunk — ettől a sorok örökre beragadnának',
    ).toBe(true);
  });
});
