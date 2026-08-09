// =====================================================================
//  ADATVÉDELMI KÖR — a 8 ügynökös audit GDPR-találatai
//
//  A mérnöki réteg erős volt (scrub-architektúra, privát KYC-bucket,
//  gépesített retenció), de hét ponton a rendszer TÖBBET ígért, mint amennyit
//  teljesített — és két helyen kifelé is szivárgott. Ez a suite mindegyiket
//  őrzi, hogy ne csússzon vissza.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const {
  purgeStaleLastKnownLocation, purgeOldNotifications, purgeOldAdminAccessLog,
} = require('../src/services/retention');
const { purgeOldKycFiles } = require('../src/services/kyc');

beforeEach(() => { __resetRateLimitsForTests(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// ─────────────────────────────────────────────────────────────────────
describe('Fuvar-lista: a nyitott piactéren kívül csak a saját ügyletek', () => {
  it('idegen NEM listázhatja a lezárt fuvarokat (címadat-bázis learatása)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const res = await request(app).get('/jobs?status=delivered').set(auth(idegen.token));
    expect(res.status).toBe(200);
    expect(
      res.body.length,
      'CÍMSZIVÁRGÁS: idegen kilistázta a lezárt fuvarokat (pontos lakcímekkel)!',
    ).toBe(0);
  });

  it('a saját lezárt fuvarjait viszont MINDKÉT fél látja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const feladoRes = await request(app).get('/jobs?status=delivered').set(auth(felado.token));
    const szallitoRes = await request(app).get('/jobs?status=delivered').set(auth(szallito.token));
    expect(feladoRes.body.length).toBe(1);
    expect(szallitoRes.body.length).toBe(1);
  });

  it('a NYITOTT piactér változatlanul böngészhető, pontos címmel', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({ shipperId: felado.id, status: 'bidding' });

    const res = await request(app).get('/jobs?status=bidding').set(auth(szallito.token));
    expect(res.status).toBe(200);
    const sajat = res.body.find((j) => j.pickup_address);
    expect(sajat, 'a szállító nem látja a böngészhető fuvarokat').toBeTruthy();
    // A böngészéshez a PONTOS cím kell — ez a szolgáltatás lényege
    expect(sajat.pickup_address).toContain('Teszt u. 1');
    expect(sajat.approximate_location).toBeUndefined();
  });

  it('elkelt fuvarnál a kívülálló csak KÖZELÍTŐ helyet kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const res = await request(app).get(`/jobs/${job.id}`).set(auth(idegen.token));
    expect(res.status).toBe(200);
    expect(res.body.approximate_location).toBe(true);
    expect(res.body.pickup_address, 'a pontos utca+házszám kikerült egy kívülállóhoz').not.toContain('Teszt u. 1');
    expect(res.body.pickup_address).toBe('Budapest');
    // ~1 km-re kerekített koordináta (2 tizedes), nem a nyers érték
    expect(res.body.pickup_lat).toBe(47.5);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('SOS: érintettség + kapcsolat-szűrés', () => {
  it('idegen fuvarra NEM küldhető vészjelzés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const tamado = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    const res = await request(app).post('/sos').set(auth(tamado.token))
      .send({ job_id: job.id, message: 'Hamis vészjelzés' });
    expect(res.status, 'idegen fuvarra is mehetett „vészjelzés" — spam/zaklatás-csatorna').toBe(403);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int c FROM notifications WHERE user_id = $1 AND type = 'sos_partner_alert'`,
      [felado.id],
    );
    expect(rows[0].c).toBe(0);
  });

  it('a saját fuvarra igen', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    const res = await request(app).post('/sos').set(auth(szallito.token))
      .send({ job_id: job.id, lat: 47.5, lng: 19.05, message: 'Defektet kaptam' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('telefonszám az SOS-üzenetben blokkolva (díj-megkerülés)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted' });

    const res = await request(app).post('/sos').set(auth(szallito.token))
      .send({ job_id: job.id, message: 'Hívj: 06 30 123 4567, megbeszéljük' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('az admin-értesítés nem tartalmaz telefonszámot és pontos GPS-t', async () => {
    await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET phone = $2 WHERE id = $1', [szallito.id, '+36301234567']);
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    await request(app).post('/sos').set(auth(szallito.token))
      .send({ job_id: job.id, lat: 47.49791, lng: 19.04023 });

    // A teljes suite-ban több admin-fiók is létezik, és az értesítés csak az
    // első 10-nek megy — ezért a LEGUTÓBBI sos_alert értesítést nézzük.
    const { rows } = await db.query(
      `SELECT body FROM notifications WHERE type = 'sos_alert' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0], 'az admin nem kapott SOS-értesítést').toBeTruthy();
    expect(rows[0].body, 'a TELJES TELEFONSZÁM bekerült a határidő nélkül tárolt értesítésbe').not.toContain('301234567');
    expect(rows[0].body, 'a pontos GPS bekerült az értesítésbe').not.toContain('47.49791');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Legacy értékelés-végpont: a kapcsolat-szűrő ott is fut', () => {
  it('a régi úton sem lehet telefonszámot a publikus kommentbe írni', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const res = await request(app)
      .post(`/jobs/${job.id}/reviews`)
      .set(auth(felado.token))
      .send({ rating: 5, comment: 'Szuper! Legközelebb hívj: 06 30 123 4567' });

    expect(res.status, 'TARTÓS HIRDETŐFELÜLET: telefonszám ment a publikus profilra').toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Retenció: minden adattípusnak van életciklusa', () => {
  it('a 7 napnál régebbi utolsó-pozíció törlődik (a nyers pingekkel együtt)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET last_known_lat = 47.5, last_known_lng = 19.05,
                        last_ping_at = NOW() - INTERVAL '8 days' WHERE id = $1`,
      [szallito.id],
    );
    await purgeStaleLastKnownLocation();

    const { rows } = await db.query('SELECT last_known_lat, last_known_lng FROM users WHERE id = $1', [szallito.id]);
    expect(rows[0].last_known_lat, 'a fiók élettartamáig megőrzött otthon-koordináta').toBeNull();
    expect(rows[0].last_known_lng).toBeNull();
  });

  it('a FRISS pozíciót nem bántja (a matchinghez kell)', async () => {
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET last_known_lat = 47.5, last_known_lng = 19.05, last_ping_at = NOW() WHERE id = $1`,
      [szallito.id],
    );
    await purgeStaleLastKnownLocation();
    const { rows } = await db.query('SELECT last_known_lat FROM users WHERE id = $1', [szallito.id]);
    expect(rows[0].last_known_lat).not.toBeNull();
  });

  it('a fél évnél régebbi értesítések törlődnek (PII-t hordozhatnak)', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, created_at)
       VALUES ($1, 'test', 'Régi', 'régi értesítés', NOW() - INTERVAL '7 months'),
              ($1, 'test', 'Friss', 'friss értesítés', NOW())`,
      [user.id],
    );
    await purgeOldNotifications();

    const { rows } = await db.query('SELECT title FROM notifications WHERE user_id = $1', [user.id]);
    expect(rows.map((r) => r.title)).toEqual(['Friss']);
  });

  it('az ELDÖNTETLEN (pending) KYC-fotó is elévül', async () => {
    const user = await createUser({ role: 'carrier' });
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, created_at)
       VALUES ($1, 'id_card', 'private:kyc/cccccccccccccccccccccccccccccccc.jpg', 'pending',
               NOW() - INTERVAL '61 days')`,
      [user.id],
    );
    await purgeOldKycFiles();

    const { rows } = await db.query('SELECT file_url, status FROM kyc_documents WHERE user_id = $1', [user.id]);
    expect(rows[0].file_url, 'a pending okmányfotó HATÁRIDŐ NÉLKÜL a tárolóban maradt').toBeNull();
    // A metaadat (státusz) marad — a csalásvédelemhez és az admin-döntéshez
    expect(rows[0].status).toBe('pending');
  });

  it('a FRISS pending okmányfotót nem bántja (az admin még dönt róla)', async () => {
    const user = await createUser({ role: 'carrier' });
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, created_at)
       VALUES ($1, 'id_card', 'private:kyc/dddddddddddddddddddddddddddddddd.jpg', 'pending', NOW())`,
      [user.id],
    );
    await purgeOldKycFiles();
    const { rows } = await db.query('SELECT file_url FROM kyc_documents WHERE user_id = $1', [user.id]);
    expect(rows[0].file_url).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Admin-hozzáférési napló', () => {
  const naplo = async (action) => (await db.query(
    'SELECT * FROM admin_access_log WHERE action = $1 ORDER BY created_at DESC LIMIT 1', [action],
  )).rows[0];

  it('a KYC-fotók listázása nyomot hagy', async () => {
    const admin = await createUser({ role: 'admin' });
    await request(app).get('/admin/kyc-documents').set(auth(admin.token));

    const sor = await naplo('kyc_documents_list');
    expect(sor, 'az okmányfotókhoz való hozzáférés nyomtalan maradt').toBeTruthy();
    expect(sor.admin_id).toBe(admin.id);
  });

  it('a felek chatjének megnyitása nyomot hagy, az ügylet azonosítójával', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    await request(app).get(`/admin/messages?job_id=${job.id}`).set(auth(admin.token));

    const sor = await naplo('chat_read');
    expect(sor).toBeTruthy();
    expect(sor.target_type).toBe('job');
    expect(sor.target_id).toBe(job.id);
  });

  it('a user-részletnézet is naplózódik', async () => {
    const admin = await createUser({ role: 'admin' });
    const user = await createUser({ role: 'shipper' });
    await request(app).get(`/admin/users/${user.id}`).set(auth(admin.token));

    const sor = await naplo('user_detail');
    expect(sor.target_id).toBe(user.id);
  });

  it('a napló NEM tartalmazza a megtekintett tartalmat', async () => {
    const admin = await createUser({ role: 'admin' });
    await request(app).get('/admin/kyc-documents').set(auth(admin.token));
    const sor = await naplo('kyc_documents_list');
    // Csak: ki, mit, mikor, melyik entitáson — semmi tartalom.
    expect(Object.keys(sor).sort()).toEqual(
      ['action', 'admin_id', 'created_at', 'id', 'target_id', 'target_type'],
    );
  });

  it('az 1 évnél régebbi naplósor elévül', async () => {
    const admin = await createUser({ role: 'admin' });
    await db.query(
      `INSERT INTO admin_access_log (admin_id, action, created_at)
       VALUES ($1, 'regi_muvelet', NOW() - INTERVAL '13 months')`,
      [admin.id],
    );
    await purgeOldAdminAccessLog();
    const { rows } = await db.query(`SELECT 1 FROM admin_access_log WHERE action = 'regi_muvelet'`);
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Adathordozhatóság: JSON-export (GDPR 20. cikk)', () => {
  it('a saját adatokat géppel olvasható formában kiadja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });

    const res = await request(app).get('/auth/me/export').set(auth(felado.token));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.profil.id).toBe(felado.id);
    expect(res.body.feladott_fuvarok.map((j) => j.id)).toContain(job.id);
    expect(res.body.export_keszult).toBeTruthy();
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('titkokat és MÁS felhasználók adatait NEM tartalmazza', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET phone = $2 WHERE id = $1', [szallito.id, '+36309998877']);
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });

    const res = await request(app).get('/auth/me/export').set(auth(felado.token));
    const nyers = JSON.stringify(res.body);

    expect(res.body.profil.password_hash).toBeUndefined();
    expect(res.body.profil.token_version).toBeUndefined();
    expect(nyers, 'a másik fél telefonszáma bekerült az exportba').not.toContain('309998877');
  });

  it('bejelentkezés nélkül nem érhető el', async () => {
    const res = await request(app).get('/auth/me/export');
    expect(res.status).toBe(401);
  });
});
