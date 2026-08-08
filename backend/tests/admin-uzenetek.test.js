// =====================================================================
//  Admin ↔ felhasználó üzenetküldés (2026-08-08)
//
//  A védett üzleti szabályok:
//   1. A felhasználó MAGÁTÓL nem írhat az adminnak (403 NO_CHANNEL).
//   2. A csatornát CSAK a közvetlen ('direct') admin-üzenet nyitja meg —
//      a körüzenet NEM (különben az első körüzenet után mindenki írhatna).
//   3. A körüzenet pontosan a célcsoportnak megy (admin sosem címzett).
//   4. A user-részletnézet a DAC7-adatot és a titkokat NEM adja ki,
//      a céges/számlázási/aktivitás-adatokat viszont igen.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => __resetRateLimitsForTests());

async function ujVilag() {
  const admin = await createUser({ role: 'admin' });
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  return { admin, felado, szallito };
}

describe('Admin → user közvetlen üzenet', () => {
  it('kézbesül, értesítést kelt, és megnyitja a válasz-csatornát', async () => {
    const { admin, felado } = await ujVilag();

    const kuldes = await request(app)
      .post(`/admin/dm/with/${felado.id}`)
      .set(auth(admin.token))
      .send({ body: 'Szia! A számlázási címed hiányzik.' });
    expect(kuldes.status).toBe(201);
    expect(kuldes.body.kind).toBe('direct');

    // A user látja, és válaszolhat
    const szal = await request(app).get('/me/admin-messages').set(auth(felado.token));
    expect(szal.status).toBe(200);
    expect(szal.body.messages).toHaveLength(1);
    expect(szal.body.messages[0].body).toContain('számlázási címed');
    expect(szal.body.can_reply).toBe(true);

    // In-app értesítés is született
    const { rows } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'admin_message'`,
      [felado.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toBe('/uzenetek');
  });

  it('adminnak nem küldhető (ADMIN_TARGET), nem létező usernek 404', async () => {
    const { admin } = await ujVilag();
    const masikAdmin = await createUser({ role: 'admin' });

    const adminra = await request(app)
      .post(`/admin/dm/with/${masikAdmin.id}`)
      .set(auth(admin.token)).send({ body: 'teszt' });
    expect(adminra.status).toBe(400);
    expect(adminra.body.code).toBe('ADMIN_TARGET');

    const senkinek = await request(app)
      .post('/admin/dm/with/00000000-0000-0000-0000-000000000000')
      .set(auth(admin.token)).send({ body: 'teszt' });
    expect(senkinek.status).toBe(404);
  });

  it('üres / nem-string body → 400, sosem 500', async () => {
    const { admin, felado } = await ujVilag();
    for (const rossz of [{}, { body: '' }, { body: '   ' }, { body: 123 }, { body: null }]) {
      __resetRateLimitsForTests();
      const res = await request(app)
        .post(`/admin/dm/with/${felado.id}`).set(auth(admin.token)).send(rossz);
      expect(res.status).toBe(400);
    }
  });
});

describe('A "maguktól nem írhatnak" szabály', () => {
  it('admin-üzenet NÉLKÜL a user válasza 403 NO_CHANNEL', async () => {
    const { felado } = await ujVilag();
    const res = await request(app)
      .post('/me/admin-messages').set(auth(felado.token))
      .send({ body: 'Helló admin, kérdésem van!' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_CHANNEL');

    // Semmi nem íródott be
    const { rows } = await db.query(
      'SELECT * FROM admin_messages WHERE user_id = $1', [felado.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('a KÖRÜZENET nem nyitja meg a csatornát — a válasz utána is 403', async () => {
    const { admin, felado } = await ujVilag();
    await request(app)
      .post('/admin/dm/broadcast').set(auth(admin.token))
      .send({ body: 'Karbantartás lesz este.', target: 'all' });

    // A user megkapta a körüzenetet…
    const szal = await request(app).get('/me/admin-messages').set(auth(felado.token));
    expect(szal.body.messages).toHaveLength(1);
    expect(szal.body.messages[0].kind).toBe('broadcast');
    // …de válaszolni továbbra sem tud
    expect(szal.body.can_reply).toBe(false);
    const valasz = await request(app)
      .post('/me/admin-messages').set(auth(felado.token)).send({ body: 'oké' });
    expect(valasz.status).toBe(403);
    expect(valasz.body.code).toBe('NO_CHANNEL');
  });

  it('közvetlen üzenet UTÁN a válasz megy, és az admin szálában landol', async () => {
    const { admin, szallito } = await ujVilag();
    await request(app)
      .post(`/admin/dm/with/${szallito.id}`).set(auth(admin.token))
      .send({ body: 'A rendszámod hiányzik a profilodról.' });

    const valasz = await request(app)
      .post('/me/admin-messages').set(auth(szallito.token))
      .send({ body: 'Köszi, pótoltam!' });
    expect(valasz.status).toBe(201);
    expect(valasz.body.kind).toBe('user_reply');

    // Az admin szál-nézetében ott a válasz, a threads-ben olvasatlanként
    const threads = await request(app).get('/admin/dm/threads').set(auth(admin.token));
    const sor = threads.body.find((t) => t.user_id === szallito.id);
    expect(sor).toBeTruthy();
    expect(sor.unread_count).toBe(1);
    expect(sor.last_sender).toBe('user');

    const szal = await request(app)
      .get(`/admin/dm/with/${szallito.id}`).set(auth(admin.token));
    expect(szal.body.messages).toHaveLength(2);
    // A megnyitás olvasottra állította a user válaszát
    const ujraThreads = await request(app).get('/admin/dm/threads').set(auth(admin.token));
    expect(ujraThreads.body.find((t) => t.user_id === szallito.id).unread_count).toBe(0);

    // Az admin kapott értesítést a válaszról
    const { rows } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'admin_dm_reply'`,
      [admin.id],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a user olvasás-visszajelzése az admin felé is látszik (read_at)', async () => {
    const { admin, felado } = await ujVilag();
    await request(app)
      .post(`/admin/dm/with/${felado.id}`).set(auth(admin.token))
      .send({ body: 'Fontos infó.' });

    // A user még nem nyitotta meg → read_at üres
    let szal = await request(app).get(`/admin/dm/with/${felado.id}`).set(auth(admin.token));
    expect(szal.body.messages[0].read_at).toBeNull();

    // A user megnyitja a szálát → az admin-üzenet olvasottra áll
    await request(app).get('/me/admin-messages').set(auth(felado.token));
    szal = await request(app).get(`/admin/dm/with/${felado.id}`).set(auth(admin.token));
    expect(szal.body.messages[0].read_at).not.toBeNull();
  });
});

describe('Körüzenet-célzás', () => {
  it('carriers-célzásnál csak a szállító kapja, admin sosem', async () => {
    const { admin, felado, szallito } = await ujVilag();
    const res = await request(app)
      .post('/admin/dm/broadcast').set(auth(admin.token))
      .send({ body: 'Szállítói hír.', target: 'carriers' });
    expect(res.status).toBe(201);

    const szallitoSzal = await request(app).get('/me/admin-messages').set(auth(szallito.token));
    expect(szallitoSzal.body.messages).toHaveLength(1);
    const feladoSzal = await request(app).get('/me/admin-messages').set(auth(felado.token));
    expect(feladoSzal.body.messages).toHaveLength(0);
    const { rows } = await db.query(
      'SELECT * FROM admin_messages WHERE user_id = $1', [admin.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('company-célzás csak a céges fiókoknak megy', async () => {
    const { admin, felado } = await ujVilag();
    const ceges = await createUser({ role: 'shipper' });
    await db.query(`UPDATE users SET account_type = 'company' WHERE id = $1`, [ceges.id]);

    await request(app)
      .post('/admin/dm/broadcast').set(auth(admin.token))
      .send({ body: 'Céges hír: NAV-jelvény elérhető.', target: 'company' });

    const cegesSzal = await request(app).get('/me/admin-messages').set(auth(ceges.token));
    expect(cegesSzal.body.messages).toHaveLength(1);
    const maganSzal = await request(app).get('/me/admin-messages').set(auth(felado.token));
    expect(maganSzal.body.messages).toHaveLength(0);
  });

  it('a válasz és a napló stimmel: recipient_count + broadcasts lista', async () => {
    const { admin } = await ujVilag();
    const res = await request(app)
      .post('/admin/dm/broadcast').set(auth(admin.token))
      .send({ body: 'Mindenkinek szóló hír.', target: 'all' });
    // Az ujVilag 2 nem-admin usert csinált; más tesztek userei izolált
    // DB-ben nem látszanak, de a suite-on belül igen — ezért ≥ 2-t várunk.
    expect(res.body.recipient_count).toBeGreaterThanOrEqual(2);

    const lista = await request(app).get('/admin/dm/broadcasts').set(auth(admin.token));
    expect(lista.status).toBe(200);
    expect(lista.body[0].recipient_count).toBe(res.body.recipient_count);
    expect(lista.body[0].target).toBe('all');
  });

  it('érvénytelen célcsoport → 400 INVALID_TARGET (SQL-injekció esélye sincs)', async () => {
    const { admin } = await ujVilag();
    for (const rossz of ['everyone', "all'; DROP TABLE users;--", '', null, 123]) {
      __resetRateLimitsForTests();
      const res = await request(app)
        .post('/admin/dm/broadcast').set(auth(admin.token))
        .send({ body: 'teszt', target: rossz });
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /admin/users/:id — teljes részletnézet', () => {
  it('kiadja a céges/számlázási/aktivitás-adatokat, de a DAC7-et és titkokat SOHA', async () => {
    const { admin, szallito } = await ujVilag();
    await db.query(
      `UPDATE users SET account_type = 'company', company_name = 'Teszt Fuvar Kft.',
              tax_id = '12345678-2-06', billing_address = 'Szeged, Fő u. 1.',
              billing_country = 'HU', vehicle_type = 'kistehergépkocsi',
              personal_tax_id = '8412345678', birth_date = '1990-05-05',
              referral_code = 'TESZT123'
        WHERE id = $1`,
      [szallito.id],
    );

    const res = await request(app)
      .get(`/admin/users/${szallito.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);

    // Amit LÁTNIA kell
    expect(res.body.company_name).toBe('Teszt Fuvar Kft.');
    expect(res.body.tax_id).toBe('12345678-2-06');
    expect(res.body.billing_address).toBe('Szeged, Fő u. 1.');
    expect(res.body.email_verified).toBeDefined();
    expect(res.body.referral_code).toBe('TESZT123');
    expect(res.body.vehicle_type).toBe('kistehergépkocsi');
    expect(res.body.jobs_as_shipper).toBe(0);
    // DAC7: csak a TÉNY
    expect(res.body.has_tax_data).toBe(true);

    // Amit SOHA
    expect(res.body).not.toHaveProperty('personal_tax_id');
    expect(res.body).not.toHaveProperty('birth_date');
    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('email_verification_token_hash');
    expect(res.body).not.toHaveProperty('password_reset_token_hash');
  });

  it('nem létező user → 404; nem-admin → 403', async () => {
    const { admin, felado, szallito } = await ujVilag();
    const nincs = await request(app)
      .get('/admin/users/00000000-0000-0000-0000-000000000000').set(auth(admin.token));
    expect(nincs.status).toBe(404);

    const civil = await request(app)
      .get(`/admin/users/${szallito.id}`).set(auth(felado.token));
    expect(civil.status).toBe(403);
  });
});
