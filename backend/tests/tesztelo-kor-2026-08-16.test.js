// =====================================================================
//  TESZTELŐI KÖR — 2026-08-16 (a backend-oldali tételek őrei)
//
//  A tesztelő második nagy listájából a négy backend-javítás:
//   (1) felvételkor a FELADÓ is kap értesítést (eddig csak a címzett-SMS és
//       a socket ment — a zárva lévő böngészőhöz egyik sem ér el);
//   (2) a licit-szakaszban lemondott fuvar ajánlattevői értesülnek, és az
//       ajánlataik lezárulnak (eddig örökre „várakoztak");
//   (3) az elutasított ajánlat után a szállító ÚJRA tud ajánlatot tenni
//       (a UNIQUE-sor eddig örökre kizárta a fuvarból);
//   (4) a lemondott járat függő foglalásai lezárulnak + a feladó értesül;
//       fizetett aktív foglalással a járat nem mondható le.
//
//  Mindegyik VISSZAMÉRVE: a javítás visszavonásával piros.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob, createBooking, TINY_PNG,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

let felado; let szallito; let masikSzallito;

beforeAll(async () => {
  __resetRateLimitsForTests();
  felado = await createUser({ role: 'shipper' });
  szallito = await createUser({ role: 'carrier', kyc: 'verified' });
  masikSzallito = await createUser({ role: 'carrier', kyc: 'verified' });
});

async function ertesitesek(userId, tipus, { varakozasMs = 3000 } = {}) {
  const hatarido = Date.now() + varakozasMs;
  let rows = [];
  do {
    ({ rows } = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC',
      [userId, tipus],
    ));
    if (rows.length) return rows;
    await new Promise((r) => { setTimeout(r, 100); });
  } while (Date.now() < hatarido);
  return rows;
}

async function ajanlat(jobId, carrierId, amountHuf, status = 'pending') {
  const { rows } = await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [jobId, carrierId, amountHuf, status],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
//  (1) FELVÉTEL → A FELADÓ ÉRTESÜL
// ---------------------------------------------------------------------
describe('Felvétel: a feladó maradandó értesítést kap', () => {
  it('a pickup-fotó után a feladónál megjelenik a „felvették a csomagod"', async () => {
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/jobs/${job.id}/photos`)
      .set(auth(szallito.token))
      .field('kind', 'pickup')
      .attach('file', TINY_PNG, 'pickup.png');
    expect(res.status).toBeLessThan(400);

    const sorok = await ertesitesek(felado.id, 'job_picked_up');
    expect(
      sorok.length,
      '⚠️ A feladó nem tudja meg, hogy a csomagja elindult.\n\n'
      + 'A felvételről eddig CSAK a címzett kapott SMS-t és a fuvar-szoba egy\n'
      + 'socket-eseményt — a zárva lévő böngészőhöz egyik sem ér el. A feladó,\n'
      + 'akinek a csomagjáról szó van, semmilyen maradandó értesítést nem kapott.',
    ).toBeGreaterThan(0);
    expect(sorok[0].link).toContain(job.id);
  });
});

// ---------------------------------------------------------------------
//  (2) LEMONDÁS A LICIT-SZAKASZBAN → AZ AJÁNLATTEVŐK ÉRTESÜLNEK
// ---------------------------------------------------------------------
describe('Hirdetés-visszavonás: az ajánlattevők értesülnek', () => {
  it('a függő ajánlatot adó szállítók értesítést kapnak, az ajánlatok lezárulnak', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await ajanlat(job.id, szallito.id, 20000);
    await ajanlat(job.id, masikSzallito.id, 22000);

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/jobs/${job.id}/cancel`)
      .set(auth(felado.token))
      .send({ reason: 'Okafogyott' });
    expect(res.status).toBeLessThan(400);

    for (const sz of [szallito, masikSzallito]) {
      const sorok = await ertesitesek(sz.id, 'job_cancelled');
      const enyem = sorok.filter((s) => (s.body || '').length > 0);
      expect(
        enyem.length,
        '⚠️ Az ajánlattevő szállító nem tudja meg, hogy a hirdetést visszavonták.\n\n'
        + 'A lemondás „másik fél" értesítése a carrier_id-re megy — a licit-\n'
        + 'szakaszban az még NULL, tehát a címzett nélkül maradt. A szállító\n'
        + 'szemében az ajánlata örökre „elfogadásra várakozik". (Elfogadásról\n'
        + 'ment értesítés — lemondásról nem: megint csak az egyik ág épült meg.)',
      ).toBeGreaterThan(0);
    }

    const { rows: maradek } = await db.query(
      `SELECT COUNT(*)::int AS db FROM bids WHERE job_id = $1 AND status = 'pending'`,
      [job.id],
    );
    expect(
      maradek[0].db,
      'A lemondott fuvar ajánlatai „pending" maradtak — a listákban tovább várakoznának.',
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------
//  (3) ELUTASÍTOTT AJÁNLAT UTÁN ÚJRA LEHET PRÓBÁLKOZNI
// ---------------------------------------------------------------------
describe('Újra-ajánlat: az elutasított szállító visszatérhet', () => {
  it('rejected ajánlat után az új ajánlat ÁTMEGY, és pending lesz az új összeggel', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await ajanlat(job.id, szallito.id, 30000, 'rejected');

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/jobs/${job.id}/bids`)
      .set(auth(szallito.token))
      .send({ amount_huf: 26000, return_policy: 'included' });

    expect(
      res.status,
      `⚠️ Az elutasított szállító nem tud újra ajánlatot tenni (${res.status}).\n\n`
      + 'A bids-en UNIQUE (job_id, carrier_id) él, és az elutasított sor\n'
      + 'megmarad — a korábbi kód a 23505-re csak annyit mondott: „már tettél\n'
      + 'ajánlatot". A szállító így SOHA TÖBBÉ nem versenyezhetett azon a\n'
      + 'fuvaron, hiába nyitott a licit. Jobb árral visszatérni legitim —\n'
      + 'pont ettől verseny a verseny.',
    ).toBe(201);

    const { rows } = await db.query(
      'SELECT status, amount_huf FROM bids WHERE job_id = $1 AND carrier_id = $2',
      [job.id, szallito.id],
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].amount_huf).toBe(26000);
  });

  it('FÜGGŐ (pending) ajánlat mellett viszont marad a 409 (nem duplázható)', async () => {
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await ajanlat(job.id, szallito.id, 30000, 'pending');

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/jobs/${job.id}/bids`)
      .set(auth(szallito.token))
      .send({ amount_huf: 26000, return_policy: 'included' });
    expect(res.status).toBe(409);
  });

  it('ELFOGADOTT ajánlatot az újra-ajánlat nem írhat felül', async () => {
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await ajanlat(job.id, szallito.id, 30000, 'accepted');

    __resetRateLimitsForTests();
    const res = await request(app)
      .post(`/jobs/${job.id}/bids`)
      .set(auth(szallito.token))
      .send({ amount_huf: 1000, return_policy: 'included' });

    expect(
      res.status,
      'Az elfogadott ajánlat felülírható volt egy új ajánlattal — a\n'
      + 'megállapodott ár utólag átírható lenne, a fuvar pénzügyi magja sérül.',
    ).toBeGreaterThanOrEqual(400);

    const { rows } = await db.query(
      'SELECT status, amount_huf FROM bids WHERE job_id = $1 AND carrier_id = $2',
      [job.id, szallito.id],
    );
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].amount_huf).toBe(30000);
  });
});

// ---------------------------------------------------------------------
//  (4) JÁRAT-LEMONDÁS → A FOGLALÁSOK RENDEZŐDNEK
// ---------------------------------------------------------------------
describe('Járat-lemondás: a függő foglalások lezárulnak', () => {
  // ⚠️ A createBooking MAGA gyárt járatot (carrierId-t vár, nem routeId-t),
  // és { booking, routeId }-t ad vissza — az első változatom itt is TIPPELTE
  // a szerződést olvasás helyett, és a saját külön járatára tett foglalás
  // helyett a helperé jött létre. Ugyanaz a visszatérő hibám.
  it('a függő (nem fizetett) foglalás lezárul, a feladó értesül', async () => {
    const { booking, routeId } = await createBooking({
      carrierId: szallito.id, shipperId: felado.id, status: 'pending',
    });
    const r = { id: routeId };

    __resetRateLimitsForTests();
    const res = await request(app)
      .patch(`/carrier-routes/${r.id}/status`)
      .set(auth(szallito.token))
      .send({ status: 'cancelled' });
    expect(res.status).toBeLessThan(400);

    const { rows } = await db.query(
      'SELECT status FROM route_bookings WHERE id = $1', [booking.id],
    );
    expect(
      rows[0].status,
      '⚠️ A lemondott járat foglalása „pending" maradt — a feladó örökre egy\n'
      + 'olyan járatra várna, ami már nem létezik, és erről senki nem szól neki.',
    ).toBe('cancelled');

    const sorok = await ertesitesek(felado.id, 'booking_cancelled');
    expect(sorok.length, 'a feladó nem értesült a járat lemondásáról').toBeGreaterThan(0);
  });

  it('FIZETETT aktív foglalással a járat NEM mondható le (409)', async () => {
    const { booking, routeId } = await createBooking({
      carrierId: szallito.id, shipperId: felado.id, status: 'confirmed', paid: true,
    });
    const r = { id: routeId };

    __resetRateLimitsForTests();
    const res = await request(app)
      .patch(`/carrier-routes/${r.id}/status`)
      .set(auth(szallito.token))
      .send({ status: 'cancelled' });

    expect(
      res.status,
      'A fizetett, aktív foglalású járat kézen-közön lemondható volt — a\n'
      + 'feladó pénzt adott ezért az útért, a foglalás rendezése nélkül a\n'
      + 'járat nem tűnhet el alóla.',
    ).toBe(409);
    expect(res.body.code).toBe('HAS_ACTIVE_PAID');

    const { rows } = await db.query(
      'SELECT status FROM route_bookings WHERE id = $1', [booking.id],
    );
    expect(rows[0].status).toBe('confirmed');
  });

  it('a teljes szerkesztő PATCH-en a lemondás NEM megy (csak a /status útján)', async () => {
    // A védelem ne csak az egyik úton éljen: a teljes PATCH is tud státuszt
    // állítani — ott a cancelled tiltott, mert a foglalás-rendezés a /status
    // végponton él.
    const { routeId } = await createBooking({
      carrierId: szallito.id, shipperId: felado.id, status: 'pending',
    });
    __resetRateLimitsForTests();
    const res = await request(app)
      .patch(`/carrier-routes/${routeId}`)
      .set(auth(szallito.token))
      .send({ status: 'cancelled' });
    expect(res.status).toBe(400);
  });
});
