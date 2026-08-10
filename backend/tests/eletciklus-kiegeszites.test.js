// =====================================================================
//  A RETENCIÓS ŐR ÁLTAL FELTÁRT HIÁNYOK (2026-08-10)
//
//  Ezeket nem kézi átolvasás találta, hanem az új őr (retencios-or.test.js):
//  a séma minden tábláját a manifesthez méri, és megnevezte, mi maradt ki.
//
//   1) BERAGADT FUVAR — az `accepted`/`in_progress` állapotban megrekedt
//      fuvar (a leggyakoribb VALÓS kudarc-mód: elkelt, kifizették, aztán a
//      szállító eltűnt) EGYETLEN retenciós kört sem ért el. Örökre őrizte a
//      pontos címeket, a címzett elérhetőségét, az átvételi kódot és az élő
//      követő-tokent.
//   2) BERAGADT FOGLALÁS — a foglalási ágon egyáltalán nem volt lezáró.
//   3) DAC7-ADAT — a tájékoztató 5 évet ígért, végrehajtó kód nélkül.
//   4) FIZETÉSI NAPLÓ — nem volt megőrzési ideje, és a fuvar CÍMÉT tárolta.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db, createUser, createJob, createBooking } = require('./helpers');
const {
  expireAbandonedJobs, expireAbandonedBookings, purgeOldPaymentEvents, purgeOldTaxData,
  ABANDONED_JOB_YEARS, TAX_DATA_RETENTION_YEARS, INVOICE_RETENTION_YEARS,
} = require('../src/services/retention');

const statusza = async (id) => (await db.query('SELECT status FROM jobs WHERE id = $1', [id])).rows[0].status;

describe('Beragadt fuvarok (a leggyakoribb valós kudarc-mód)', () => {
  for (const allapot of ['accepted', 'in_progress']) {
    it(`a ${allapot} állapotban egy éve nem mozdult fuvar lezárul`, async () => {
      const felado = await createUser({ role: 'shipper' });
      const szallito = await createUser({ role: 'carrier' });
      const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: allapot, paid: true });
      await db.query(
        `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
        [job.id, ABANDONED_JOB_YEARS + 1],
      );

      await expireAbandonedJobs();

      expect(
        await statusza(job.id),
        `a ${allapot} fuvar örökre őrizte a pontos címet, a címzett telefonját és az élő követő-tokent`,
      ).toBe('cancelled');
    });
  }

  it('a VITÁS fuvart soha nem zárja le automatikusan', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'disputed', paid: true });
    await db.query(
      `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
      [job.id, ABANDONED_JOB_YEARS + 5],
    );

    await expireAbandonedJobs();

    expect(await statusza(job.id), 'egy NYITOTT VITÁT zárt le egy időzítő!').toBe('disputed');
  });

  it('a friss, futó fuvart nem bántja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    await expireAbandonedJobs();

    expect(await statusza(job.id), 'egy FUTÓ fuvart zárt le!').toBe('in_progress');
  });
});

describe('Beragadt foglalások (a hiányzó szimmetria)', () => {
  it('az egy éve nem mozdult foglalás lezárul', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    await db.query(
      `UPDATE route_bookings SET created_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
      [booking.id, ABANDONED_JOB_YEARS + 1],
    );

    await expireAbandonedBookings();

    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status, 'a foglalási ágon egyáltalán nem volt lezáró').toBe('cancelled');
  });

  it('a friss foglalást nem bántja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    await expireAbandonedBookings();

    const { rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('confirmed');
  });
});

describe('DAC7-adat: 5 év — amit a tájékoztató ígér', () => {
  it('az 5 évnél régebbi adóazonosító jel és születési dátum törlődik', async () => {
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET personal_tax_id = '8123456789', birth_date = '1985-03-12',
              tax_data_provided_at = NOW() - ($2 || ' years')::interval - INTERVAL '1 day'
        WHERE id = $1`,
      [szallito.id, TAX_DATA_RETENTION_YEARS],
    );

    await purgeOldTaxData();

    const { rows } = await db.query('SELECT personal_tax_id, birth_date FROM users WHERE id = $1', [szallito.id]);
    expect(
      rows[0].personal_tax_id,
      'egy kormányzati személyazonosító szám maradt a fiók élettartamáig, '
      + 'miközben a tájékoztató 5 évet ígér',
    ).toBeNull();
    expect(rows[0].birth_date).toBeNull();
  });

  it('a friss adatot nem bántja (a jelentési kötelezettség él)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET personal_tax_id = '8123456789', tax_data_provided_at = NOW() WHERE id = $1`,
      [szallito.id],
    );

    await purgeOldTaxData();

    const { rows } = await db.query('SELECT personal_tax_id FROM users WHERE id = $1', [szallito.id]);
    expect(rows[0].personal_tax_id, 'a DAC7-jelentéshez szükséges adatot idő előtt törölte').toBe('8123456789');
  });

  it('a friss TELJESÍTETT fuvar újraindítja az órát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET personal_tax_id = '8123456789',
              tax_data_provided_at = NOW() - ($2 || ' years')::interval - INTERVAL '1 day'
        WHERE id = $1`,
      [szallito.id, TAX_DATA_RETENTION_YEARS],
    );
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    await db.query('UPDATE jobs SET delivered_at = NOW() WHERE id = $1', [job.id]);

    await purgeOldTaxData();

    const { rows } = await db.query('SELECT personal_tax_id FROM users WHERE id = $1', [szallito.id]);
    expect(
      rows[0].personal_tax_id,
      'a tavaly teljesített fuvar után is törölte az adatot — a jelentési '
      + 'kötelezettség az UTOLSÓ jelentési évhez kötődik',
    ).toBe('8123456789');
  });
});

describe('Fizetési napló', () => {
  it('a 8 évnél régebbi naplósor elévül', async () => {
    const { rows: uj } = await db.query(
      `INSERT INTO payment_events (payment_id, status, event_type, summary, created_at)
       VALUES ($1, 'Succeeded', 'webhook', 'teszt', NOW() - ($2 || ' years')::interval - INTERVAL '1 day')
       RETURNING id`,
      [`retencio-teszt-${Date.now()}`, INVOICE_RETENTION_YEARS],
    );

    await purgeOldPaymentEvents();

    const { rowCount } = await db.query('SELECT 1 FROM payment_events WHERE id = $1', [uj[0].id]);
    expect(rowCount, 'a fizetési naplónak nem volt megőrzési ideje').toBe(0);
  });

  it('a summary NEM tartalmazza a fuvar felhasználó által írt címét', async () => {
    const forras = require('fs').readFileSync(`${__dirname}/../src/routes/payments.js`, 'utf8');
    const summaryk = [...forras.matchAll(/summary: `[^`]*`/g)].map((m) => m[0]);
    expect(summaryk.length, 'nem találtam summary-összeállítást — a teszt vak').toBeGreaterThan(1);
    for (const s of summaryk) {
      expect(
        s,
        'a fuvar CÍME (felhasználó által írt szabad szöveg) bekerül a fizetési naplóba — '
        + 'a fuvar csupaszításakor épp ezért ürítjük ki, itt viszont tovább élne: ' + s,
      ).not.toContain('${title}');
    }
  });
});
