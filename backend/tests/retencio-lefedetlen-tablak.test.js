// =====================================================================
//  A RETENCIÓBÓL KIMARADT TÁBLÁK (2026-08-09, adatvédelmi audit 3. kör)
//
//  A 060-as kör a fuvar-SORT anonimizálja 3 év után, de a fuvar KÖRÉ épült
//  szabad szöveg másik táblában él — és ott érintetlen maradt. Öt tábla nem
//  tartozott egyetlen retenciós körbe sem:
//
//    bids.message / job_questions  — a fuvarról szóló beszélgetés
//    carrier_routes               — járat- és jármű-leírás + útvonal-előzmény
//    disputes                     — a legterheltebb szöveg az egész rendszerben
//    invoices                     — vevő neve, adószáma, címe
//
//  Ez a suite azt őrzi, hogy egyik se csússzon vissza a határidő nélküli
//  megőrzésbe — és azt is, hogy a körök NE vigyék el, amit nem szabad
//  (nyitott vita, élő járat-sablon, futó fuvar).
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';

const { db, createUser, createJob } = require('./helpers');
const storage = require('../src/services/storage');
const {
  anonymizeOldJobs, anonymizeOldCarrierRoutes, purgeOldDisputes, purgeOldInvoices,
  JOB_PII_RETENTION_YEARS, HOLD_RETENTION_YEARS, INVOICE_RETENTION_YEARS,
} = require('../src/services/retention');

afterEach(() => { vi.restoreAllMocks(); });

/** Lezárt fuvar, amit az anonimizáló kör már elér (a kortól függően). */
async function regiLezartFuvar(shipperId, carrierId, evek) {
  const job = await createJob({ shipperId, carrierId, status: 'completed', paid: true });
  await db.query(
    `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
    [job.id, evek],
  );
  return job;
}

describe('A fuvar körüli szabad szöveg is elévül', () => {
  it('az anonimizált fuvar AJÁNLAT-ÜZENETE kiürül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await regiLezartFuvar(felado.id, szallito.id, JOB_PII_RETENTION_YEARS + 1);
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, message, status)
       VALUES ($1, $2, 25000, 'A nagymamám a 3. emeleten lakik, nincs lift', 'pending')`,
      [job.id, szallito.id],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT message FROM bids WHERE job_id = $1', [job.id]);
    expect(
      rows[0].message,
      'a fuvar leírását kiürítettük, de az ajánlat-üzenet szövege örökre megmaradt',
    ).toBeNull();
  });

  it('az anonimizált fuvar KÉRDÉS-VÁLASZ szála kiürül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await regiLezartFuvar(felado.id, szallito.id, JOB_PII_RETENTION_YEARS + 1);
    await db.query(
      `INSERT INTO job_questions (job_id, asker_id, question, answer, answered_by)
       VALUES ($1, $2, 'Otthon lesz valaki délután a Fő utca 12-ben?', 'Igen, anyukám', $3)`,
      [job.id, szallito.id, felado.id],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT question, answer FROM job_questions WHERE job_id = $1', [job.id]);
    expect(rows[0].question, 'a nyilvános kérdés szövege megmaradt').toBe('');
    expect(rows[0].answer, 'a válasz szövege megmaradt').toBeNull();
  });

  it('a FUTÓ fuvar ajánlat-üzenetét és kérdéseit nem bántja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, message, status)
       VALUES ($1, $2, 25000, 'Holnap tudom vinni', 'pending')`,
      [job.id, szallito.id],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query('SELECT message FROM bids WHERE job_id = $1', [job.id]);
    expect(rows[0].message, 'egy FUTÓ fuvar ajánlat-üzenetét törölte!').toBe('Holnap tudom vinni');
  });
});

describe('Járat-anonimizálás', () => {
  async function jarat({ carrierId, evek, template = false, status = 'completed' }) {
    const { rows } = await db.query(
      `INSERT INTO carrier_routes
         (carrier_id, title, description, vehicle_description, departure_at, waypoints, status, is_template)
       VALUES ($1, 'Szeged → Budapest', 'Hétfőnként megyek a gyerekért, hívj a 06...',
               'Fehér Transporter', NOW() - ($2 || ' years')::interval,
               '[{"lat":46.25,"lng":20.14,"name":"Szeged"},{"lat":47.49,"lng":19.04,"name":"Budapest"}]'::jsonb,
               $3, $4)
       RETURNING id`,
      [carrierId, evek, status, template],
    );
    return rows[0].id;
  }

  it('a 3 évnél régebbi lejárt járat leírása kiürül', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const id = await jarat({ carrierId: szallito.id, evek: JOB_PII_RETENTION_YEARS + 1 });

    await anonymizeOldCarrierRoutes();

    const { rows } = await db.query(
      'SELECT description, vehicle_description, anonymized_at FROM carrier_routes WHERE id = $1', [id],
    );
    expect(rows[0].description, 'a járat szabad szövege örökre megmaradt').toBeNull();
    expect(rows[0].vehicle_description).toBeNull();
    expect(rows[0].anonymized_at).toBeTruthy();
  });

  it('a SABLONT nem bántja (a szállító élő beállítása)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const id = await jarat({ carrierId: szallito.id, evek: JOB_PII_RETENTION_YEARS + 1, template: true });

    await anonymizeOldCarrierRoutes();

    const { rows } = await db.query('SELECT description FROM carrier_routes WHERE id = $1', [id]);
    expect(rows[0].description, 'egy élő járat-sablont anonimizált').toBeTruthy();
  });

  it('a friss járatot nem bántja', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const id = await jarat({ carrierId: szallito.id, evek: 0, status: 'open' });

    await anonymizeOldCarrierRoutes();

    const { rows } = await db.query('SELECT description FROM carrier_routes WHERE id = $1', [id]);
    expect(rows[0].description).toBeTruthy();
  });
});

describe('Vita-retenció (5 év, csak lezártra)', () => {
  async function vita({ jobId, userId, evek, lezart }) {
    const { rows } = await db.query(
      `INSERT INTO disputes (job_id, opened_by, description, evidence_url, status, resolved_at)
       VALUES ($1, $2, 'Sérülten érkezett, a szállító tagadja', 'https://r2.pelda.hu/bizonyitek.jpg',
               $3, CASE WHEN $4 THEN NOW() - ($5 || ' years')::interval ELSE NULL END)
       RETURNING id`,
      [jobId, userId, lezart ? 'resolved_refund' : 'open', lezart, evek],
    );
    return rows[0].id;
  }
  const letezik = async (id) => (await db.query('SELECT 1 FROM disputes WHERE id = $1', [id])).rowCount > 0;

  it('az 5 évnél régebben LEZÁRT vita törlődik, a bizonyíték-fájllal együtt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'completed', paid: true });
    const id = await vita({ jobId: job.id, userId: felado.id, evek: HOLD_RETENTION_YEARS + 1, lezart: true });
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDisputes();

    expect(await letezik(id), 'a lezárt vita 5 év után is megmaradt').toBe(false);
    expect(torles, 'ÁRVA FÁJL: a vita bizonyítéka a tárolóban maradt')
      .toHaveBeenCalledWith('https://r2.pelda.hu/bizonyitek.jpg');
  });

  it('a NYITOTT vita sosem évül el, akármilyen régi', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'disputed', paid: true });
    const id = await vita({ jobId: job.id, userId: felado.id, evek: HOLD_RETENTION_YEARS + 5, lezart: false });
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDisputes();

    expect(await letezik(id), 'egy NYITOTT vitát törölt a retenció!').toBe(true);
  });

  it('a frissen lezárt vita marad (bizonyíték-megőrzés)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'completed', paid: true });
    const id = await vita({ jobId: job.id, userId: felado.id, evek: 1, lezart: true });
    vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await purgeOldDisputes();

    expect(await letezik(id), '5 éven belül eltűnt a bizonyíték').toBe(true);
  });
});

describe('Számla-retenció (8 év — Számv. tv. 169. §)', () => {
  async function szamla(userId, evek) {
    const { rows } = await db.query(
      `INSERT INTO invoices (buyer_user_id, buyer_name, buyer_tax_id, buyer_address,
                             net_amount, vat_rate, vat_amount, gross_amount, status, created_at)
       VALUES ($1, 'Példa Elek', '12345678-2-06', '6800 Hódmezővásárhely, Fő u. 1.',
               394, 0.27, 106, 500, 'issued', NOW() - ($2 || ' years')::interval)
       RETURNING id`,
      [userId, evek],
    );
    return rows[0].id;
  }
  const letezik = async (id) => (await db.query('SELECT 1 FROM invoices WHERE id = $1', [id])).rowCount > 0;

  it('a 8 évnél régebbi számla elévül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const id = await szamla(felado.id, INVOICE_RETENTION_YEARS + 1);

    await purgeOldInvoices();

    expect(await letezik(id), 'a vevő neve/adószáma/címe örökre megmaradt').toBe(false);
  });

  it('a 8 éven belüli számla MARAD (jogszabályi megőrzési kötelezettség)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const id = await szamla(felado.id, INVOICE_RETENTION_YEARS - 1);

    await purgeOldInvoices();

    expect(
      await letezik(id),
      'a számviteli bizonylatot 8 éven BELÜL törölte — ez jogszabálysértés (Számv. tv. 169. §)',
    ).toBe(true);
  });
});

// ── A 3. kör maradék tételei (2026-08-09) ────────────────────────────────
describe('Anonimizálás: a leírás mellől kimaradt mezők', () => {
  it("a `title`, az AI-jegyzet, a termékkép és a lakás-adatok is elévülnek", async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await regiLezartFuvar(felado.id, szallito.id, JOB_PII_RETENTION_YEARS + 1);
    await db.query(
      `UPDATE jobs
          SET title = 'Anyukám bútorai a Fő utca 12-ből',
              ai_description_notes = 'A leírás említi: Kovács Anna, 06301234567',
              source_image_url = 'https://ikea.com/termek/kanape.jpg',
              pickup_floor = 3, pickup_has_elevator = FALSE
        WHERE id = $1`,
      [job.id],
    );

    await anonymizeOldJobs();

    const { rows } = await db.query(
      `SELECT title, ai_description_notes, source_image_url, pickup_floor FROM jobs WHERE id = $1`,
      [job.id],
    );
    expect(rows[0].title, 'a felhasználó által írt cím megmaradt').not.toContain('Fő utca');
    expect(
      rows[0].ai_description_notes,
      'az AI-jegyzet a törölt leírás PII-ját őrizte tovább',
    ).toBeNull();
    expect(rows[0].source_image_url, 'a vásárlás ténye (mit vett) megmaradt').toBeNull();
    expect(rows[0].pickup_floor, 'a lakás emelete megmaradt').toBe(0);
  });
});

describe('Admin-napló: a tömeges lekérés is nyomot hagy', () => {
  const request = require('supertest');
  const { app } = require('./helpers');

  async function naplo(adminId, action) {
    const { rows } = await db.query(
      'SELECT 1 FROM admin_access_log WHERE admin_id = $1 AND action = $2', [adminId, action],
    );
    return rows.length > 0;
  }

  it('a felhasználó-LISTA megnyitása naplózódik (nem csak a részletnézet)', async () => {
    const admin = await createUser({ role: 'admin' });
    await request(app).get('/admin/users').set({ Authorization: `Bearer ${admin.token}` }).expect(200);
    expect(
      await naplo(admin.id, 'users_list'),
      'egy kéréssel 200 ember elérhetősége lekérhető, nyomtalanul',
    ).toBe(true);
  });

  it('a fuvar-lista megnyitása is naplózódik', async () => {
    const admin = await createUser({ role: 'admin' });
    await request(app).get('/admin/jobs').set({ Authorization: `Bearer ${admin.token}` }).expect(200);
    expect(await naplo(admin.id, 'jobs_list')).toBe(true);
  });
});
