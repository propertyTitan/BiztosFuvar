// =====================================================================
//  ADMIN VÉGPONTOK — hibaágak, allowlistek és a naplózás
//
//  A src/routes/admin.js elágazás-lefedettsége 61,8% volt. A boldog utakat
//  a szerep-lefedettség végigjárja, a jogosultság-elutasítást pedig a
//  hülyebiztos-matrix (SZ2) méri — ami ITT hiányzott, az a HIBAÁGAK és a
//  csendes garanciák:
//
//    · a 400/404/409 ágak (rossz státusz, hiányzó mező, nem létező elem),
//    · a mező-ALLOWLIST (mit írhat át egy admin egyáltalán),
//    · az adat-minimalizálás (a DAC7-adat NEM megy ki az admin-felületre),
//    · a hozzáférési NAPLÓ (a legérzékenyebb olvasások nyomot hagynak),
//    · a KYC-döntés mellékhatásai (user-státusz, értesítés, függő lenyomat),
//    · és hogy egy elutasított admin-kérés ne HAGYJON MAGA UTÁN változást.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const NEM_LETEZIK = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { __resetRateLimitsForTests(); });

/** Hány napló-sor keletkezett a megadott művelethez az időpont óta? */
async function naploSorok(action, ota) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM admin_access_log
      WHERE action = $1 AND created_at >= $2`,
    [action, ota],
  );
  return rows[0].c;
}

// =====================================================================
//  FOTÓ-MEGŐRZÉSI ZÁROLÁS
// =====================================================================
describe('PATCH /admin/photo-hold', () => {
  it('hiányzó vagy rossz típusú mezők → 400', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered' });

    const nincsId = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ hold: true });
    expect(nincsId.status, 'azonosító nélkül is elfogadta a zárolást').toBe(400);

    const nemBoolean = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: job.id, hold: 'igen' });
    expect(
      nemBoolean.status,
      'a "hold" mező nem-boolean értékkel átment — a bizonyíték-zárolás állapota kiszámíthatatlanná válna',
    ).toBe(400);

    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].photo_retention_hold, 'a hibás kérés mégis átállította a zárolást').toBe(false);
  });

  it('teljesen üres kérés-test → 400 (nem 500)', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).patch('/admin/photo-hold').set(auth(admin.token)).send();
    expect(res.status).toBe(400);
  });

  it('nem létező fuvarra 404 — a zárolás BE- és KIkapcsolásánál egyaránt', async () => {
    const admin = await createUser({ role: 'admin' });
    const be = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: NEM_LETEZIK, hold: true });
    expect(be.status).toBe(404);

    // A feloldó ág előbb a státuszt kérdezi le — nem létező sornál ez sem
    // omolhat össze (a `disputed`-ellenőrzés `rows[0]?.status`-t olvas).
    const ki = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: NEM_LETEZIK, hold: false });
    expect(ki.status, 'a feloldó ág nem létező azonosítón elszállt vagy némán sikeres lett').toBe(404);
  });

  it('a zárolás FELOLDHATÓ a nem vitás ügyleten (a védelem nem ragadhat be)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered' });
    await db.query('UPDATE jobs SET photo_retention_hold = TRUE WHERE id = $1', [job.id]);

    const res = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: job.id, hold: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.photo_retention_hold).toBe(false);

    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [job.id]);
    expect(
      rows[0].photo_retention_hold,
      'a lezárt (nem vitás) ügylet zárolása nem oldható fel — a fotók 30 nap helyett '
      + '5 évig maradnának, a tájékoztató ígérete ellenére',
    ).toBe(false);
  });

  it('a FOGLALÁSI ágon is működik (nem csak a fuvarnál)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered',
    });

    const res = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ booking_id: booking.id, hold: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entity).toBe('route_bookings');

    const { rows } = await db.query('SELECT photo_retention_hold FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].photo_retention_hold, 'a foglalás bizonyíték-zárolása nem állt be').toBe(true);
  });

  it('VITÁS ügyleten a zárolás NEM oldható fel (409) — különben örökre megmaradna a PII', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'disputed' });
    await db.query('UPDATE jobs SET photo_retention_hold = TRUE WHERE id = $1', [job.id]);

    const res = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: job.id, hold: false });
    expect(
      res.status,
      'a vitás fuvar zárolását fel lehetett oldani — a disputed + hold=FALSE kombináció '
      + 'MINDEN retenciós ágból kiesik, tehát a fuvar PII-ja határidő nélkül megmaradna',
    ).toBe(409);
    expect(res.body.code).toBe('DISPUTED_HOLD_LOCKED');

    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].photo_retention_hold, 'a zárolás mégis feloldódott').toBe(true);
  });

  it('a zárolás BEKAPCSOLÁSA vitás ügyleten is szabad (csak a feloldás tilos)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'disputed' });

    const res = await request(app).patch('/admin/photo-hold')
      .set(auth(admin.token)).send({ job_id: job.id, hold: true });
    expect(res.status, 'a védelem túl széles lett: a zárolás BEkapcsolását is tiltja').toBe(200);
    expect(res.body.photo_retention_hold).toBe(true);
  });
});

// =====================================================================
//  FELHASZNÁLÓK
// =====================================================================
describe('GET /admin/users — keresés, plafon, napló', () => {
  it('a keresés név / e-mail / telefon alapján szűr', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET full_name = $2 WHERE id = $1', [cel.id, 'Kereshető Kázmér']);

    const talalat = await request(app).get('/admin/users?search=Kereshető Káz').set(auth(admin.token));
    expect(talalat.status, JSON.stringify(talalat.body)).toBe(200);
    expect(
      talalat.body.some((u) => u.id === cel.id),
      'a keresés nem találta meg a felhasználót a neve alapján',
    ).toBe(true);

    const email = await request(app).get(`/admin/users?search=${encodeURIComponent(cel.email)}`)
      .set(auth(admin.token));
    expect(email.body.some((u) => u.id === cel.id), 'e-mail alapján nem talált').toBe(true);

    const nincs = await request(app).get('/admin/users?search=BiztosanNincsIlyenNev999')
      .set(auth(admin.token));
    expect(nincs.body.length, 'a szűrő nem szűr: értelmetlen keresésre is adott találatot').toBe(0);
  });

  it('a limit paraméter érvényesül', async () => {
    const admin = await createUser({ role: 'admin' });
    await createUser({ role: 'shipper' });
    await createUser({ role: 'shipper' });
    const res = await request(app).get('/admin/users?limit=1').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.length, 'a limit=1 mellett is több sort adott vissza').toBe(1);
  });

  it('a tömeges lista NYOMOT HAGY az admin-naplóban, a keresőkifejezés viszont NEM', async () => {
    const admin = await createUser({ role: 'admin' });
    const kezdet = new Date();
    const titkosNev = 'NagyonTitkosKeresoKifejezes';
    await request(app).get(`/admin/users?search=${titkosNev}`).set(auth(admin.token));

    expect(
      await naploSorok('users_list', kezdet),
      'a 200 ember elérhetőségét visszaadó lista NEM hagyott nyomot (GDPR 5. cikk (2))',
    ).toBeGreaterThan(0);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS c FROM admin_access_log
        WHERE created_at >= $1 AND (target_type ILIKE $2 OR target_id::text ILIKE $2)`,
      [kezdet, `%${titkosNev}%`],
    );
    expect(
      rows[0].c,
      'a keresőkifejezés bekerült a naplóba — az egy HARMADIK személy nevét írná be, '
      + 'vagyis a napló a PII második példánya lenne',
    ).toBe(0);
  });
});

describe('GET /admin/users/:id — részletnézet', () => {
  it('nem létező user → 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).get(`/admin/users/${NEM_LETEZIK}`).set(auth(admin.token));
    expect(res.status).toBe(404);
  });

  it('a DAC7-adat NEM megy ki, csak a MEGADÁS TÉNYE (adat-minimalizálás)', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET personal_tax_id = '8123456789', birth_date = '1990-03-04' WHERE id = $1`,
      [cel.id],
    );

    const res = await request(app).get(`/admin/users/${cel.id}`).set(auth(admin.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.has_tax_data, 'a "megadta-e" tény nem látszik az adminnak').toBe(true);
    expect(
      res.body.personal_tax_id,
      'az ADÓAZONOSÍTÓ JEL kiment az admin-felületre — ez a legérzékenyebb kormányzati '
      + 'azonosító, amit magánszemély szállítóról tartunk, és csak a NAV-jelentéshez kell',
    ).toBeUndefined();
    expect(res.body.birth_date, 'a születési dátum kiment az admin-felületre').toBeUndefined();
    expect(res.body.password_hash, 'a jelszó-hash kiment az admin-felületre').toBeUndefined();
  });

  it('a részletnézet megnyitása naplózódik (a tájékoztató „hozzáférési audit log" ígérete)', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'shipper' });
    const kezdet = new Date();
    await request(app).get(`/admin/users/${cel.id}`).set(auth(admin.token));

    const { rows } = await db.query(
      `SELECT admin_id, target_id FROM admin_access_log
        WHERE action = 'user_detail' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
      [kezdet],
    );
    expect(rows[0], 'a teljes felhasználói profil megnyitása nyomtalan maradt').toBeTruthy();
    expect(rows[0].admin_id, 'a napló nem rögzítette, KI nézte meg').toBe(admin.id);
    expect(rows[0].target_id, 'a napló nem rögzítette, KIT nézett meg').toBe(cel.id);
  });
});

describe('PATCH /admin/users/:id — mező-allowlist', () => {
  it('érvénytelen szerepkör → 400, és a régi szerep megmarad', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'shipper' });
    const res = await request(app).patch(`/admin/users/${cel.id}`)
      .set(auth(admin.token)).send({ role: 'szuperadmin' });
    expect(res.status, 'ismeretlen szerepkör-string átment a users.role oszlopba').toBe(400);

    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [cel.id]);
    expect(rows[0].role).toBe('shipper');
  });

  it('nincs módosítandó mező → 400 (a csak tiltott mezőket tartalmazó kérés sem sikeres)', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'shipper' });
    // Felismerhető jelszó-hash, hogy a felülírás egyértelműen látszódjon.
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [cel.id, 'eredeti:hash']);

    const ures = await request(app).patch(`/admin/users/${cel.id}`).set(auth(admin.token)).send({});
    expect(ures.status).toBe(400);

    const tiltott = await request(app).patch(`/admin/users/${cel.id}`)
      .set(auth(admin.token))
      .send({ email: 'atirt@teszt.hu', password_hash: 'tamado:hash', token_version: 9 });
    expect(
      tiltott.status,
      'az admin átírhatta a felhasználó e-mail-címét/jelszó-hashét a mező-allowlist megkerülésével',
    ).toBe(400);

    const { rows } = await db.query(
      'SELECT email, password_hash, COALESCE(token_version, 0) AS tv FROM users WHERE id = $1', [cel.id],
    );
    expect(rows[0].email, 'a felhasználó e-mail-címe megváltozott (fiók-átvétel)').toBe(cel.email);
    expect(
      rows[0].password_hash,
      'a jelszó-hash felülíródott az admin-PATCH-csel — az admin ezzel bárki fiókjába beléphetne',
    ).toBe('eredeti:hash');
    expect(Number(rows[0].tv), 'a token_version kívülről állítható az admin-PATCH-en').toBe(0);
  });

  it('nem létező user módosítása → 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).patch(`/admin/users/${NEM_LETEZIK}`)
      .set(auth(admin.token)).send({ role: 'carrier' });
    expect(res.status).toBe(404);
  });

  it('érvényes szerep-váltás megtörténik (a boldog út nem romlott el)', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'shipper' });
    const res = await request(app).patch(`/admin/users/${cel.id}`)
      .set(auth(admin.token)).send({ role: 'carrier', identity_kyc_status: 'verified' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await db.query('SELECT role, identity_kyc_status FROM users WHERE id = $1', [cel.id]);
    expect(rows[0].role).toBe('carrier');
    expect(rows[0].identity_kyc_status).toBe('verified');
  });
});

// =====================================================================
//  FUVAROK
// =====================================================================
describe('GET /admin/jobs — szűrők', () => {
  it('érvénytelen státuszra 400 (tiszta hiba, nem enum-összeomlás)', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).get('/admin/jobs?status=nincs-ilyen').set(auth(admin.token));
    expect(
      res.status,
      'a job_status enumon kívüli érték elszállt volna a Postgresben — 400 kell, nem 500',
    ).toBe(400);
    expect(res.body.error, 'a hibaüzenet nem nevezi meg a rossz értéket').toMatch(/nincs-ilyen/);
  });

  it('a státusz-szűrő tényleg szűr', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const kezbesitett = await createJob({ shipperId: felado.id, status: 'delivered' });
    const licites = await createJob({ shipperId: felado.id, status: 'bidding' });

    const res = await request(app).get('/admin/jobs?status=delivered&limit=200').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.some((j) => j.id === kezbesitett.id), 'a szűrő kihagyta a találatot').toBe(true);
    expect(
      res.body.some((j) => j.id === licites.id),
      'a delivered-szűrőben megjelent egy bidding státuszú fuvar is',
    ).toBe(false);
  });

  it('az üres/szóköz keresőkifejezés nem szűkít (nem ad hamis üres listát)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const res = await request(app).get('/admin/jobs?search=%20%20&limit=200').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(
      res.body.some((j) => j.id === job.id),
      'a csupa-szóköz keresés kiürítette a listát — az admin azt hinné, nincs fuvar',
    ).toBe(true);
  });
});

describe('DELETE + PATCH /admin/jobs/:id', () => {
  it('nem létező fuvar törlése → 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).delete(`/admin/jobs/${NEM_LETEZIK}`).set(auth(admin.token));
    expect(res.status).toBe(404);
  });

  it('státusz nélküli PATCH → 400', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const res = await request(app).patch(`/admin/jobs/${job.id}`).set(auth(admin.token)).send({});
    expect(res.status).toBe(400);
  });

  it('a „disputed" státusz KÉZZEL nem állítható be (retenciós zsákutca)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });

    const res = await request(app).patch(`/admin/jobs/${job.id}`)
      .set(auth(admin.token)).send({ status: 'disputed' });
    expect(
      res.status,
      'egy admin-kattintással „vitatott"-ra lehetett állítani a fuvart — a status_before_dispute '
      + 'és a zárolás nélkül a fuvar PII-ja ÖRÖKRE megmaradna (nincs kód-út, ami kihozná)',
    ).toBe(400);
    expect(res.body.code).toBe('DISPUTED_NOT_MANUAL');

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'a fuvar mégis vitatott lett').toBe('accepted');
  });

  it('érvényes státusz-váltás működik, nem létező fuvarra 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });

    const ok = await request(app).patch(`/admin/jobs/${job.id}`)
      .set(auth(admin.token)).send({ status: 'cancelled' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('cancelled');

    const nincs = await request(app).patch(`/admin/jobs/${NEM_LETEZIK}`)
      .set(auth(admin.token)).send({ status: 'cancelled' });
    expect(nincs.status).toBe(404);
  });
});

describe('POST /admin/users/:id/force-logout', () => {
  it('nem létező felhasználóra 404 (nem néma siker)', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).post(`/admin/users/${NEM_LETEZIK}/force-logout`).set(auth(admin.token));
    expect(res.status).toBe(404);
  });
});

// =====================================================================
//  CHAT-BETEKINTÉS
// =====================================================================
describe('GET /admin/messages', () => {
  it('azonosító nélkül 400', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).get('/admin/messages').set(auth(admin.token));
    expect(res.status).toBe(400);
  });

  it('a FOGLALÁSI ág is működik, és a betekintés naplózódik', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    await db.query(
      `INSERT INTO messages (booking_id, sender_id, recipient_id, body)
       VALUES ($1, $2, $3, 'foglalás-chat teszt')`,
      [booking.id, felado.id, szallito.id],
    );
    const kezdet = new Date();

    const res = await request(app).get(`/admin/messages?booking_id=${booking.id}`).set(auth(admin.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.length, 'az admin nem látta a foglalás chatjét (vitarendezési bizonyíték)').toBe(1);
    expect(res.body[0].body).toBe('foglalás-chat teszt');

    const { rows } = await db.query(
      `SELECT target_type, target_id FROM admin_access_log
        WHERE action = 'chat_read' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
      [kezdet],
    );
    expect(
      rows[0],
      'a felek PRIVÁT levelezésébe való betekintés nyomtalan maradt — ez a KYC-fotó melletti '
      + 'legérzékenyebb admin-művelet',
    ).toBeTruthy();
    expect(rows[0].target_type).toBe('booking');
    expect(rows[0].target_id).toBe(booking.id);
  });
});

// =====================================================================
//  LICITEK / JÁRATOK / FOGLALÁSOK
// =====================================================================
describe('Licitek, járatok, foglalások admin-műveletei', () => {
  it('GET /admin/bids/:jobId a szállító nevét is hozza, és naplózódik', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status) VALUES ($1, $2, 12000, 'pending')`,
      [job.id, szallito.id],
    );
    const kezdet = new Date();

    const res = await request(app).get(`/admin/bids/${job.id}`).set(auth(admin.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].carrier_name, 'az ajánlat mellől hiányzik a szállító neve').toBeTruthy();
    expect(await naploSorok('bids_read', kezdet), 'az ajánlat-betekintés nyomtalan').toBeGreaterThan(0);
  });

  it('DELETE /admin/bids/:id tényleg törli az ajánlatot', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const { rows: bid } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
       VALUES ($1, $2, 12000, 'pending') RETURNING id`,
      [job.id, szallito.id],
    );

    const res = await request(app).delete(`/admin/bids/${bid[0].id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    const { rows } = await db.query('SELECT 1 FROM bids WHERE id = $1', [bid[0].id]);
    expect(rows.length, 'az ajánlat a "sikeres" törlés után is megvan').toBe(0);
  });

  it('nem létező járat / foglalás törlése → 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const jarat = await request(app).delete(`/admin/routes/${NEM_LETEZIK}`).set(auth(admin.token));
    expect(jarat.status).toBe(404);
    const foglalas = await request(app).delete(`/admin/bookings/${NEM_LETEZIK}`).set(auth(admin.token));
    expect(foglalas.status).toBe(404);
  });

  it('a járat- és foglalás-lista naplózódik (b.* a címzett adatait és az átvételi kódot is hozza)', async () => {
    const admin = await createUser({ role: 'admin' });
    const kezdet = new Date();
    await request(app).get('/admin/routes').set(auth(admin.token));
    await request(app).get('/admin/bookings').set(auth(admin.token));
    expect(await naploSorok('routes_list', kezdet), 'a járat-lista nyomtalan').toBeGreaterThan(0);
    expect(
      await naploSorok('bookings_list', kezdet),
      'a foglalás-lista nyomtalan — pedig foglalásonként adja a címzett elérhetőségét, '
      + 'az átvételi kódot és a követő-tokent',
    ).toBeGreaterThan(0);
  });
});

// =====================================================================
//  KYC-DOKUMENTUMOK
// =====================================================================
describe('KYC admin-felület', () => {
  /** Egy KYC-sor gyártása közvetlenül a DB-be. */
  async function kycSor(userId, { status = 'pending', fileUrl = 'private:kyc/teszt.jpg', pending = null } = {}) {
    const { rows } = await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, pending_doc_number_hash, hash_algo)
       VALUES ($1, 'id_card', $2, $3, $4, CASE WHEN $4::text IS NULL THEN NULL ELSE 'hmac-sha256' END)
       ON CONFLICT (user_id, doc_type) DO UPDATE SET
         file_url = EXCLUDED.file_url, status = EXCLUDED.status,
         pending_doc_number_hash = EXCLUDED.pending_doc_number_hash
       RETURNING id`,
      [userId, fileUrl, status, pending],
    );
    return rows[0].id;
  }

  it('a privát okmányfotóhoz ALÁÍRT link megy ki, sosem a nyers tároló-kulcs', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier', kyc: 'pending' });
    const docId = await kycSor(cel.id, { fileUrl: 'private:kyc/nagyontitkos.jpg' });
    const kezdet = new Date();

    const res = await request(app).get('/admin/kyc-documents?status=pending').set(auth(admin.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sor = res.body.find((d) => d.id === docId);
    expect(sor, 'a függő dokumentum nem jelent meg az admin-listában').toBeTruthy();
    expect(
      sor.file_url,
      'a válasz a NYERS privát kulcsot adta vissza — az admin-felületen a kép nem jelenne meg, '
      + 'és a privát tárolás jelölője kikerülne a kliensre',
    ).not.toMatch(/^private:/);
    expect(sor.file_url, 'nem készült olvasó-link a KYC-fotóhoz').toBeTruthy();
    expect(
      await naploSorok('kyc_documents_list', kezdet),
      'a rendszer legérzékenyebb hozzáférése (személyi igazolvány fotói) nyomtalan maradt',
    ).toBeGreaterThan(0);
  });

  it('a státusz-szűrő tényleg szűr (a jóváhagyottak nem jönnek a függők közé)', async () => {
    const admin = await createUser({ role: 'admin' });
    const jovahagyott = await createUser({ role: 'carrier' });
    const docId = await kycSor(jovahagyott.id, { status: 'approved' });

    const fuggo = await request(app).get('/admin/kyc-documents?status=pending').set(auth(admin.token));
    expect(fuggo.body.some((d) => d.id === docId), 'jóváhagyott dokumentum a függők listájában').toBe(false);

    const approved = await request(app).get('/admin/kyc-documents?status=approved').set(auth(admin.token));
    expect(approved.body.some((d) => d.id === docId), 'a jóváhagyott lista nem hozta a sort').toBe(true);
  });

  it('érvénytelen művelet / indoklás nélküli elutasítás / nem létező dokumentum → 4xx', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier', kyc: 'pending' });
    const docId = await kycSor(cel.id);

    const rosszAction = await request(app).patch(`/admin/kyc-documents/${docId}`)
      .set(auth(admin.token)).send({ action: 'torles' });
    expect(rosszAction.status).toBe(400);

    const indokNelkul = await request(app).patch(`/admin/kyc-documents/${docId}`)
      .set(auth(admin.token)).send({ action: 'reject', reason: '   ' });
    expect(
      indokNelkul.status,
      'indoklás nélkül el lehetett utasítani a KYC-t — a felhasználó nem tudná, mit javítson',
    ).toBe(400);

    const nincs = await request(app).patch(`/admin/kyc-documents/${NEM_LETEZIK}`)
      .set(auth(admin.token)).send({ action: 'approve' });
    expect(nincs.status).toBe(404);

    const { rows } = await db.query('SELECT status FROM kyc_documents WHERE id = $1', [docId]);
    expect(rows[0].status, 'az elutasított admin-kérés mégis átállította a dokumentumot').toBe('pending');
  });

  it('JÓVÁHAGYÁS: a user KYC-státusza is átáll, értesítést kap, és a FÜGGŐ lenyomat előlép', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier', kyc: 'pending' });
    const fuggoHash = require('crypto').randomBytes(32).toString('hex');
    const docId = await kycSor(cel.id, { pending: fuggoHash });

    const res = await request(app).patch(`/admin/kyc-documents/${docId}`)
      .set(auth(admin.token)).send({ action: 'approve' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('approved');

    const { rows: dok } = await db.query(
      'SELECT status, reviewed_by, doc_number_hash, pending_doc_number_hash FROM kyc_documents WHERE id = $1',
      [docId],
    );
    expect(dok[0].status).toBe('approved');
    expect(dok[0].reviewed_by, 'nem rögzült, MELYIK admin hagyta jóvá').toBe(admin.id);
    expect(
      dok[0].doc_number_hash,
      'a duplikátum-gyanú miatt FÜGGŐBE tett okmány-lenyomat nem lépett elő a jóváhagyáskor — '
      + 'akire egyszer gyanú esett, arra az „egy okmány = egy fiók" védelem VÉGLEG elveszne',
    ).toBe(fuggoHash);
    expect(dok[0].pending_doc_number_hash, 'a függő oszlop nem ürült ki').toBeNull();

    const { rows: user } = await db.query('SELECT identity_kyc_status FROM users WHERE id = $1', [cel.id]);
    expect(user[0].identity_kyc_status, 'a jóváhagyás nem állította át a felhasználó KYC-státuszát').toBe('verified');

    const { rows: ert } = await db.query(
      `SELECT type FROM notifications WHERE user_id = $1 AND type = 'kyc_approved'`, [cel.id],
    );
    expect(ert.length, 'a felhasználó nem kapott értesítést a jóváhagyásról').toBeGreaterThan(0);
  });

  it('ISMERETLEN doc_type jóváhagyása NEM ad azonosítást a felhasználónak', async () => {
    // A doc_type szabad szöveg a DB-ben; a felhasználó KYC-mezőjét fix
    // whitelist (KYC_DOC_FIELD) képezi le. Ha egy nem szereplő típus is
    // állítaná a mezőt, egy tetszőleges irat jóváhagyásával azonosítottá
    // válna a fiók.
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier', kyc: 'pending' });
    const { rows: doc } = await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'insurance', 'private:kyc/biztositas.jpg', 'pending') RETURNING id`,
      [cel.id],
    );

    const res = await request(app).patch(`/admin/kyc-documents/${doc[0].id}`)
      .set(auth(admin.token)).send({ action: 'approve' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { rows } = await db.query(
      'SELECT identity_kyc_status, driver_kyc_status, company_verification_status FROM users WHERE id = $1',
      [cel.id],
    );
    expect(
      rows[0].identity_kyc_status,
      'egy NEM személyazonosító irat jóváhagyása azonosítottá tette a fiókot — '
      + 'a KYC-kapu tetszőleges dokumentummal megkerülhető lenne',
    ).toBe('pending');
    expect(rows[0].driver_kyc_status).toBe('pending');
    expect(rows[0].company_verification_status).not.toBe('verified');
  });

  it('ELUTASÍTÁS: az indok eljut a felhasználóhoz, és a függő lenyomat MEGMARAD', async () => {
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser({ role: 'carrier', kyc: 'pending' });
    const fuggoHash = require('crypto').randomBytes(32).toString('hex');
    const docId = await kycSor(cel.id, { pending: fuggoHash });

    const res = await request(app).patch(`/admin/kyc-documents/${docId}`)
      .set(auth(admin.token)).send({ action: 'reject', reason: 'Olvashatatlan a fotó.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { rows: dok } = await db.query(
      'SELECT status, rejection_reason, doc_number_hash, pending_doc_number_hash FROM kyc_documents WHERE id = $1',
      [docId],
    );
    expect(dok[0].status).toBe('rejected');
    expect(dok[0].rejection_reason).toBe('Olvashatatlan a fotó.');
    expect(dok[0].doc_number_hash, 'elutasításkor is előlépett a függő lenyomat').toBeNull();
    expect(
      dok[0].pending_doc_number_hash,
      'az elutasítás eldobta a függő lenyomatot — egy későbbi jóváhagyáskor már nem lenne mit előléptetni',
    ).toBe(fuggoHash);

    const { rows: user } = await db.query('SELECT identity_kyc_status FROM users WHERE id = $1', [cel.id]);
    expect(user[0].identity_kyc_status).toBe('rejected');

    const { rows: ert } = await db.query(
      `SELECT body FROM notifications WHERE user_id = $1 AND type = 'kyc_rejected'`, [cel.id],
    );
    expect(ert.length, 'a felhasználó nem kapott értesítést az elutasításról').toBeGreaterThan(0);
    expect(ert[0].body, 'az elutasítás indoka nem jutott el a felhasználóhoz').toContain('Olvashatatlan a fotó.');
  });
});

// =====================================================================
//  COVERAGE ZÓNÁK
// =====================================================================
describe('PATCH /admin/coverage/:zoneId', () => {
  it('ismeretlen zóna → 404', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).patch('/admin/coverage/marsz').set(auth(admin.token)).send({ active: true });
    expect(res.status).toBe(404);
  });

  it('a létező zóna aktív állapota állítható (és vissza is kapcsolható)', async () => {
    const admin = await createUser({ role: 'admin' });
    const { ZONES } = require('../src/utils/coverage');
    try {
      const ki = await request(app).patch('/admin/coverage/europe')
        .set(auth(admin.token)).send({ active: false });
      expect(ki.status, JSON.stringify(ki.body)).toBe(200);
      expect(ki.body.zone.active, 'a zóna kikapcsolása nem hatott').toBe(false);
      expect(
        ZONES.find((z) => z.id === 'europe').active,
        'a végpont válasza szerint kikapcsolt, de a tényleges konfiguráció nem változott',
      ).toBe(false);
    } finally {
      // ⚠️ A ZONES modul-szintű állapot: ha kikapcsolva marad, MINDEN további
      // fuvarfeladás „Hamarosan elérhető" hibát kapna a suite hátralévő részében.
      await request(app).patch('/admin/coverage/europe').set(auth(admin.token)).send({ active: true });
    }
    expect(ZONES.find((z) => z.id === 'europe').active).toBe(true);
  });
});

// =====================================================================
//  ELUTASÍTOTT ADMIN-KÉRÉS: NINCS MELLÉKHATÁS
// =====================================================================
//  A hülyebiztos-matrix (SZ2) azt méri, hogy a nem-admin STÁTUSZKÓDOT kap.
//  Amit ott nem mérünk: a 403 mellett tényleg elmaradt-e az ÍRÁS. Ha egy
//  kapu valaha a művelet UTÁNRA csúszna (vagy handleren belüli szerep-
//  ellenőrzéssé alakulna), a státuszkód változatlan maradna, a kár viszont
//  megtörténne.
// =====================================================================
describe('A nem-admin írási kísérletei nyom nélkül maradnak', () => {
  it('403 mellett SEMMI nem változik (törlés, státusz, szerep, KYC, zárolás)', async () => {
    const tamado = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const aldozat = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'accepted' });
    const { booking, routeId } = await createBooking({
      shipperId: felado.id, carrierId: tamado.id, status: 'confirmed',
    });
    const { rows: doc } = await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'id_card', 'private:kyc/x.jpg', 'pending') RETURNING id`,
      [aldozat.id],
    );

    const probak = [
      ['fuvar törlése', request(app).delete(`/admin/jobs/${job.id}`)],
      ['fuvar státusz átírása', request(app).patch(`/admin/jobs/${job.id}`).send({ status: 'delivered' })],
      ['felhasználó törlése', request(app).delete(`/admin/users/${aldozat.id}`)],
      ['adminná léptetés', request(app).patch(`/admin/users/${tamado.id}`).send({ role: 'admin' })],
      ['KYC jóváhagyása', request(app).patch(`/admin/kyc-documents/${doc[0].id}`).send({ action: 'approve' })],
      ['bizonyíték-zárolás feloldása', request(app).patch('/admin/photo-hold').send({ job_id: job.id, hold: true })],
      ['járat törlése', request(app).delete(`/admin/routes/${routeId}`)],
      ['foglalás törlése', request(app).delete(`/admin/bookings/${booking.id}`)],
      ['kényszer-kiléptetés', request(app).post(`/admin/users/${aldozat.id}/force-logout`)],
    ];
    for (const [nev, keres] of probak) {
      const res = await keres.set(auth(tamado.token));
      expect(res.status, `"${nev}": a sima felhasználó admin-műveletet hajtott végre`).toBe(403);
    }

    const { rows: allapot } = await db.query(
      `SELECT
         (SELECT status::text FROM jobs WHERE id = $1) AS job_status,
         (SELECT photo_retention_hold FROM jobs WHERE id = $1) AS hold,
         (SELECT COUNT(*)::int FROM users WHERE id = $2) AS aldozat_megvan,
         (SELECT role FROM users WHERE id = $3) AS tamado_szerep,
         (SELECT COALESCE(token_version, 0) FROM users WHERE id = $2) AS aldozat_tv,
         (SELECT status FROM kyc_documents WHERE id = $4) AS kyc_status,
         (SELECT COUNT(*)::int FROM carrier_routes WHERE id = $5) AS jarat_megvan,
         (SELECT COUNT(*)::int FROM route_bookings WHERE id = $6) AS foglalas_megvan`,
      [job.id, aldozat.id, tamado.id, doc[0].id, routeId, booking.id],
    );
    const a = allapot[0];
    expect(a.job_status, 'a fuvar státusza megváltozott egy 403-as kérés után').toBe('accepted');
    expect(a.hold, 'a bizonyíték-zárolás megváltozott egy 403-as kérés után').toBe(false);
    expect(a.aldozat_megvan, 'a nem-admin törölt egy felhasználót').toBe(1);
    expect(a.tamado_szerep, 'a nem-admin adminná léptette magát').toBe('carrier');
    expect(Number(a.aldozat_tv), 'a nem-admin kiléptette az áldozatot minden eszközéről').toBe(0);
    expect(a.kyc_status, 'a nem-admin jóváhagyott egy KYC-dokumentumot').toBe('pending');
    expect(a.jarat_megvan, 'a nem-admin törölt egy járatot').toBe(1);
    expect(a.foglalas_megvan, 'a nem-admin törölt egy foglalást').toBe(1);
  });
});
