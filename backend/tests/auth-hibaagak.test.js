// =====================================================================
//  AUTH HIBAÁGAK — a be- és kilépési kapu „nem boldog" útjai
//
//  A src/routes/auth.js elágazás-lefedettsége 70% volt: a sikeres utak
//  végig vannak járva (szerep-lefedettség, feketedoboz-út), a HIBAÁGAK
//  viszont nagyrészt nem. Márpedig egy hitelesítési modulban pont a
//  hibaág a biztonsági határ: ott dől el, hogy a rossz jelszó, a lejárt
//  token, a felhasznált link vagy a body-ban csempészett `role: 'admin'`
//  tényleg elbukik-e.
//
//  Minden teszt egy KONKRÉT garanciát mér, és elbukik, ha az elromlik —
//  nem csak „meghívja" a kódot.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, uniqueEmail,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const storage = require('../src/services/storage');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (body) => request(app).post('/auth/register').send(body);

// Érvényes, 20 bájtos JPEG-fejléc — a magic-byte ellenőrzés ezt fogadja el.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

// A regisztráció óránként 5/IP, a belépés percenként 10/IP — a tesztek egy
// IP-ről (127.0.0.1) jönnek, ezért minden teszt tiszta vödörrel indul.
// (A limit SAJÁT tesztjei szándékosan nem resetelnek menet közben.)
beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

// =====================================================================
//  REGISZTRÁCIÓ
// =====================================================================
describe('POST /auth/register — hibaágak', () => {
  it('a body-ban küldött role:"admin" NEM ad admin jogot (jogosultság-eszkaláció)', async () => {
    const email = uniqueEmail('escalate');
    const res = await reg({
      email, password: 'JoJelszo123', full_name: 'Rossz Szándék', role: 'admin',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(
      res.body.user.role,
      'a regisztráció visszaadta az admin szerepet — a body-ból SOHA nem fogadható el',
    ).not.toBe('admin');

    const { rows } = await db.query('SELECT role FROM users WHERE email = $1', [email]);
    expect(
      rows[0].role,
      'a DB-be admin szerep került a regisztrációs body-ból — minden admin-végpont megnyílna',
    ).toBe('shipper');

    // És a kiadott JWT-vel sem lehet admin-végpontra menni.
    const stats = await request(app).get('/auth/admin/stats').set(auth(res.body.token));
    expect(stats.status, 'a friss token admin-végpontot nyitott').toBe(403);
  });

  it('foglalt e-mail → 409, nagybetűs írásmóddal is (a normalizálás nem kerülhető meg)', async () => {
    const email = uniqueEmail('dupla');
    const elso = await reg({ email, password: 'JoJelszo123', full_name: 'Első Fiók' });
    expect(elso.status, JSON.stringify(elso.body)).toBe(201);

    const masodik = await reg({
      email: email.toUpperCase(), password: 'MasikJelszo9', full_name: 'Második Fiók',
    });
    expect(
      masodik.status,
      'ugyanaz az e-mail NAGYBETŰVEL új fiókot nyitott — a login LOWER()-rel keres, '
      + 'tehát két fiók ütközne ugyanazon a címen',
    ).toBe(409);
    expect(masodik.body.error).toMatch(/foglalt/i);

    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    expect(rows[0].c, 'két fiók jött létre ugyanarra az e-mailre').toBe(1);
  });

  it('hiányzó kötelező mezők → 400 (mindhárom kombináció)', async () => {
    for (const [nev, body] of [
      ['nincs e-mail', { password: 'JoJelszo123', full_name: 'Teszt Elek' }],
      ['nincs jelszó', { email: uniqueEmail('h'), full_name: 'Teszt Elek' }],
      ['nincs név', { email: uniqueEmail('h'), password: 'JoJelszo123' }],
    ]) {
      const res = await reg(body);
      expect(res.status, `${nev}: a regisztráció átment kötelező mező nélkül`).toBe(400);
      expect(res.body.error).toMatch(/hiányzó/i);
    }
  });

  it('érvénytelen e-mail formátumok → 400 (és nem keletkezik user)', async () => {
    for (const rossz of ['nincs-kukac', 'a@b', 'ket@@kukac.hu', 'sz kozos@teszt.hu', `${'x'.repeat(250)}@teszt.hu`]) {
      const res = await reg({ email: rossz, password: 'JoJelszo123', full_name: 'Teszt Elek' });
      expect(res.status, `a(z) "${rossz}" e-mailt elfogadta a regisztráció`).toBe(400);
      expect(res.body.error).toMatch(/e-mail/i);
    }
    const { rows } = await db.query("SELECT COUNT(*)::int AS c FROM users WHERE email LIKE '%@b'");
    expect(rows[0].c, 'formátumtalan e-maillel user jött létre').toBe(0);
  });

  it('érvénytelen rendszám → 400 (a regisztrációs ág is szűr, nem csak a PATCH)', async () => {
    const res = await reg({
      email: uniqueEmail('plate'), password: 'JoJelszo123', full_name: 'Teszt Elek',
      vehicle_plate: '<script>alert(1)</script>',
    });
    expect(res.status, 'szemét rendszám átment a regisztráción').toBe(400);
    expect(res.body.error).toMatch(/rendszám/i);
  });

  it('kapcsolat-szivárgás a NÉVBEN → 400 CONTACT_LEAK (a név a legláthatóbb mező)', async () => {
    const res = await reg({
      email: uniqueEmail('leak'), password: 'JoJelszo123', full_name: 'Hívj 06 30 123 4567',
    });
    expect(
      res.status,
      'telefonszámot tartalmazó NÉVVEL létre lehetett hozni fiókot — a szám minden '
      + 'ajánlaton és a publikus profilon látszana, a díj örökre megkerülhető lenne',
    ).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('kapcsolat-szivárgás a CÉGNÉVBEN és a jármű-leírásban is 400', async () => {
    const ceg = await reg({
      email: uniqueEmail('leak'), password: 'JoJelszo123', full_name: 'Tiszta Név',
      account_type: 'company', company_name: 'Fuvar Kft. info@fuvar.hu', tax_id: '12345678-1-42',
    });
    expect(ceg.status, 'e-mail-címet tartalmazó cégnév átment').toBe(400);
    expect(ceg.body.code).toBe('CONTACT_LEAK');

    const jarmu = await reg({
      email: uniqueEmail('leak'), password: 'JoJelszo123', full_name: 'Tiszta Név',
      vehicle_type: 'Furgon, hívj: +36301234567',
    });
    expect(jarmu.status, 'telefonszámot tartalmazó jármű-leírás átment').toBe(400);
    expect(jarmu.body.code).toBe('CONTACT_LEAK');
  });

  it('céges fiók: cégnév / adószám kötelező, és a formátum ellenőrzött', async () => {
    const nincsNev = await reg({
      email: uniqueEmail('ceg'), password: 'JoJelszo123', full_name: 'Céges Ügyvezető',
      account_type: 'company', tax_id: '12345678-1-42',
    });
    expect(nincsNev.status, 'céges fiók cégnév nélkül létrejött').toBe(400);
    expect(nincsNev.body.error).toMatch(/cégnév/i);

    const nincsAdo = await reg({
      email: uniqueEmail('ceg'), password: 'JoJelszo123', full_name: 'Céges Ügyvezető',
      account_type: 'company', company_name: 'Teszt Fuvar Kft.',
    });
    expect(nincsAdo.status, 'céges fiók adószám nélkül létrejött').toBe(400);
    expect(nincsAdo.body.error).toMatch(/adószám/i);

    const rosszAdo = await reg({
      email: uniqueEmail('ceg'), password: 'JoJelszo123', full_name: 'Céges Ügyvezető',
      account_type: 'company', company_name: 'Teszt Fuvar Kft.', tax_id: '12345678',
    });
    expect(rosszAdo.status, 'formátumtalan adószám átment (a NAV-ellenőrzés erre épül)').toBe(400);
    expect(rosszAdo.body.error).toMatch(/adószám/i);
  });

  it('ismeretlen account_type → "individual" (nem lehet vele KYB-kaput ugrani)', async () => {
    const email = uniqueEmail('acct');
    const res = await reg({
      email, password: 'JoJelszo123', full_name: 'Teszt Elek', account_type: 'kormanyzat',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows } = await db.query('SELECT account_type FROM users WHERE email = $1', [email]);
    expect(
      rows[0].account_type,
      'ismeretlen account_type került a DB-be — a céges ágak (ÁFA, DAC7, NAV) rá nem futnának le helyesen',
    ).toBe('individual');
  });

  it('csupa szóköz / túl hosszú jelszó → 400', async () => {
    const hosszu = await reg({
      email: uniqueEmail('pw'), password: 'x'.repeat(129), full_name: 'Teszt Elek',
    });
    expect(hosszu.status, '129 karakteres jelszó átment (scrypt DoS-felület)').toBe(400);

    const rovid = await reg({
      email: uniqueEmail('pw'), password: 'rovid', full_name: 'Teszt Elek',
    });
    expect(rovid.status, '5 karakteres jelszó átment').toBe(400);
  });

  it('a "carrier" szerep VISZONT elfogadható a body-ból (a szállítói regisztráció útja)', async () => {
    const email = uniqueEmail('carrier');
    const res = await reg({
      email, password: 'JoJelszo123', full_name: 'Szállító Sándor', role: 'carrier',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows } = await db.query('SELECT role FROM users WHERE email = $1', [email]);
    expect(
      rows[0].role,
      'a szállítóként regisztrálót is feladóvá tettük — a védelem túl széles lett',
    ).toBe('carrier');
  });

  it('érvényes céges regisztráció átmegy, de „Ellenőrzött cég" jelvényt NEM kap magától', async () => {
    const email = uniqueEmail('cegok');
    const res = await reg({
      email, password: 'JoJelszo123', full_name: 'Céges Ügyvezető',
      account_type: 'company', company_name: 'Teszt Fuvar Kft.', tax_id: '12345678-1-42',
      company_reg_number: '01-09-123456', billing_address: '1051 Budapest, Fő tér 1.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user.account_type).toBe('company');

    const { rows } = await db.query(
      'SELECT account_type, company_name, tax_id, company_verification_status FROM users WHERE email = $1',
      [email],
    );
    expect(rows[0].company_name, 'a cégnév nem mentődött el').toBe('Teszt Fuvar Kft.');
    expect(rows[0].tax_id).toBe('12345678-1-42');
    expect(
      rows[0].company_verification_status,
      'a puszta regisztráció „ellenőrzött" céggé tett valakit — a jelvény a NAV-egyeztetéstől '
      + 'függ, különben bárki beírhatná más cég adószámát',
    ).not.toBe('verified');
  });

  it('teljesen üres kérés-test → 400 (nem 500)', async () => {
    const res = await request(app).post('/auth/register').send();
    expect(res.status).toBe(400);
  });

  it('rate limit: óránként 5 regisztráció / IP, a 6. már 429', async () => {
    // A limiter MINDEN kérést számol (a sikertelent is) — szándékosan
    // érvénytelen body-t küldünk, hogy ne gyártsunk 5 fölösleges fiókot.
    for (let i = 0; i < 5; i++) {
      const res = await reg({ email: 'nincs-kukac', password: 'JoJelszo123', full_name: 'X Y' });
      expect(res.status, `a ${i + 1}. kérés már korlátozva lett (túl szigorú limit)`).toBe(400);
    }
    const hatodik = await reg({
      email: uniqueEmail('rl'), password: 'JoJelszo123', full_name: 'Hatodik Fiók',
    });
    expect(
      hatodik.status,
      'a 6. regisztráció is átment egy IP-ről egy órán belül — tömeges fiókgyártás nyitva',
    ).toBe(429);
    expect(hatodik.body.retry_after_seconds).toBeGreaterThan(0);
  });
});

// =====================================================================
//  BEJELENTKEZÉS
// =====================================================================
describe('POST /auth/login — hibaágak', () => {
  /** Regisztrál egy usert ismert jelszóval, és visszaadja az adatait. */
  async function ujFiok(jelszo = 'JoJelszo123') {
    const email = uniqueEmail('login');
    const res = await reg({ email, password: jelszo, full_name: 'Belépő Elek' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { email, jelszo, id: res.body.user.id };
  }

  it('hiányzó mezők → 400', async () => {
    const a = await request(app).post('/auth/login').send({ email: 'a@b.hu' });
    expect(a.status).toBe(400);
    const b = await request(app).post('/auth/login').send({ password: 'x' });
    expect(b.status).toBe(400);
  });

  it('nem létező e-mail és rossz jelszó UGYANAZT a 401-et adja (enumeration-védelem)', async () => {
    const u = await ujFiok();
    const nincsIlyen = await request(app).post('/auth/login')
      .send({ email: uniqueEmail('sehol'), password: 'JoJelszo123' });
    const rosszJelszo = await request(app).post('/auth/login')
      .send({ email: u.email, password: 'RosszJelszo9' });

    expect(nincsIlyen.status).toBe(401);
    expect(rosszJelszo.status, 'rossz jelszóval be lehetett lépni').toBe(401);
    expect(
      rosszJelszo.body.error,
      'a hibaüzenet elárulja, hogy létezik-e a fiók (e-mail-enumeráció)',
    ).toBe(nincsIlyen.body.error);
  });

  it('helyes belépés NAGYBETŰS e-maillel is megy, és nem ad ki password_hash-t', async () => {
    const u = await ujFiok();
    const res = await request(app).post('/auth/login')
      .send({ email: `  ${u.email.toUpperCase()}  `, password: u.jelszo });
    expect(res.status, 'nagybetűs/szóközös e-maillel nem lehetett belépni').toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(
      res.body.user.password_hash,
      'a bejelentkezés válasza tartalmazza a jelszó-hasht',
    ).toBeUndefined();
  });

  it('sikeres belépés növeli a login_count-ot és NULLÁZZA az alvó-fiók figyelmeztetést', async () => {
    const u = await ujFiok();
    await db.query(
      `UPDATE users SET login_count = 7, dormant_warned_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [u.id],
    );
    const res = await request(app).post('/auth/login').send({ email: u.email, password: u.jelszo });
    expect(res.status).toBe(200);

    // A frissítés fire-and-forget — pár ms-ot adunk neki.
    await new Promise((r) => { setTimeout(r, 200); });
    const { rows } = await db.query(
      'SELECT login_count, last_login_at, dormant_warned_at FROM users WHERE id = $1', [u.id],
    );
    expect(rows[0].login_count, 'a belépés-számláló nem nőtt').toBe(8);
    expect(rows[0].last_login_at, 'nincs utolsó-belépés időbélyeg').toBeTruthy();
    expect(
      rows[0].dormant_warned_at,
      'a belépés NEM nullázta az alvó-fiók órát — a frissen aktívvá vált felhasználó '
      + 'fiókját a következő retenciós kör törölné',
    ).toBeNull();
  });

  it('rate limit: percenként 10 belépési kísérlet / IP, a 11. már 429', async () => {
    const u = await ujFiok();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/auth/login')
        .send({ email: u.email, password: 'RosszJelszo9' });
      expect(res.status, `a ${i + 1}. próbálkozás már korlátozva lett`).toBe(401);
    }
    const tizenegy = await request(app).post('/auth/login')
      .send({ email: u.email, password: 'RosszJelszo9' });
    expect(
      tizenegy.status,
      'a 11. jelszó-próbálkozás is átment — a brute-force védelem nem fog',
    ).toBe(429);
  });
});

// =====================================================================
//  JELSZÓ-RESET
// =====================================================================
describe('Jelszó-reset — token-életciklus', () => {
  it('forgot-password: e-mail nélkül 400, ismeretlen címre 200 + generic (nem szivárog)', async () => {
    const ures = await request(app).post('/auth/forgot-password').send({});
    expect(ures.status).toBe(400);

    const nincsIlyen = await request(app).post('/auth/forgot-password')
      .send({ email: uniqueEmail('sehol') });
    const letezo = await createUser({ role: 'shipper' });
    const van = await request(app).post('/auth/forgot-password').send({ email: letezo.email });

    expect(nincsIlyen.status).toBe(200);
    expect(van.status).toBe(200);
    expect(
      van.body,
      'a létező és a nem létező e-mail válasza eltér — ebből kideríthető, ki regisztrált',
    ).toEqual(nincsIlyen.body);

    // A létező fióknál viszont TÉNYLEG keletkezett token.
    const { rows } = await db.query(
      'SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = $1',
      [letezo.id],
    );
    expect(rows[0].password_reset_token_hash, 'nem készült reset-token a létező fióknak').toBeTruthy();
    expect(new Date(rows[0].password_reset_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('forgot-password: a DB-ben csak a token HASH-e van, sosem a nyers token', async () => {
    const u = await createUser({ role: 'shipper' });
    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const { rows } = await db.query('SELECT password_reset_token_hash FROM users WHERE id = $1', [u.id]);
    expect(
      rows[0].password_reset_token_hash,
      'a reset-token nem 64 hex karakteres SHA-256 lenyomat — ha nyersen tároljuk, '
      + 'egy DB-szivárgásból minden fiók átvehető',
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reset-password: hiányzó adat / rövid jelszó / hamis token → 400', async () => {
    const nincs = await request(app).post('/auth/reset-password').send({ token: 'x' });
    expect(nincs.status).toBe(400);

    const rovid = await request(app).post('/auth/reset-password')
      .send({ token: 'x'.repeat(64), password: 'rovid' });
    expect(rovid.status, '8 karakternél rövidebb jelszót elfogadott a reset').toBe(400);

    const hamis = await request(app).post('/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'UjJoJelszo123' });
    expect(hamis.status, 'kitalált tokennel jelszót lehetett állítani').toBe(400);
    expect(hamis.body.error).toMatch(/érvénytelen|lejárt/i);
  });

  it('LEJÁRT token nem használható (a 30 perces ablak tényleg zár)', async () => {
    const u = await createUser({ role: 'shipper' });
    const nyers = 'b'.repeat(64);
    const hash = require('crypto').createHash('sha256').update(nyers).digest('hex');
    await db.query(
      `UPDATE users SET password_reset_token_hash = $1,
              password_reset_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $2`,
      [hash, u.id],
    );
    const res = await request(app).post('/auth/reset-password')
      .send({ token: nyers, password: 'UjJoJelszo123' });
    expect(
      res.status,
      'egy LEJÁRT reset-linkkel át lehetett venni a fiókot — a lejárat nem véd',
    ).toBe(400);
  });

  it('a reset-token EGYSZER használható (a második próbálkozás 400)', async () => {
    const u = await createUser({ role: 'shipper' });
    const nyers = 'c'.repeat(64);
    const hash = require('crypto').createHash('sha256').update(nyers).digest('hex');
    await db.query(
      `UPDATE users SET password_reset_token_hash = $1,
              password_reset_expires_at = NOW() + INTERVAL '10 minutes' WHERE id = $2`,
      [hash, u.id],
    );

    const elso = await request(app).post('/auth/reset-password')
      .send({ token: nyers, password: 'UjJoJelszo123' });
    expect(elso.status, JSON.stringify(elso.body)).toBe(200);

    const masodik = await request(app).post('/auth/reset-password')
      .send({ token: nyers, password: 'MegUjabb9999' });
    expect(
      masodik.status,
      'ugyanaz a reset-link MÁSODSZOR is működött — egy kiszivárgott e-mailből '
      + 'a támadó bármikor újra átveheti a fiókot',
    ).toBe(400);
  });
});

// =====================================================================
//  E-MAIL MEGERŐSÍTÉS
// =====================================================================
describe('E-mail-megerősítés', () => {
  it('verify-email: token nélkül 400, hamis tokennel 400', async () => {
    const nincs = await request(app).get('/auth/verify-email');
    expect(nincs.status).toBe(400);
    const hamis = await request(app).get('/auth/verify-email?token=' + 'd'.repeat(64));
    expect(hamis.status, 'kitalált tokennel meg lehetett erősíteni egy címet').toBe(400);
  });

  it('a megerősítő link EGYSZER használható, és tényleg megerősít', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: false });
    const nyers = 'e'.repeat(64);
    const hash = require('crypto').createHash('sha256').update(nyers).digest('hex');
    await db.query('UPDATE users SET email_verification_token_hash = $1 WHERE id = $2', [hash, u.id]);

    const elso = await request(app).get(`/auth/verify-email?token=${nyers}`);
    expect(elso.status, JSON.stringify(elso.body)).toBe(200);
    const { rows } = await db.query('SELECT email_verified, email_verification_token_hash FROM users WHERE id = $1', [u.id]);
    expect(rows[0].email_verified, 'a link nem erősítette meg a címet').toBe(true);
    expect(rows[0].email_verification_token_hash, 'a felhasznált token bennmaradt a DB-ben').toBeNull();

    const masodik = await request(app).get(`/auth/verify-email?token=${nyers}`);
    expect(masodik.status, 'a megerősítő link újra felhasználható volt').toBe(400);
  });

  it('resend-verification: már megerősített fiók nem kap új tokent', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: true });
    const res = await request(app).post('/auth/resend-verification').set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.body.already_verified, 'a már megerősített fióknak új linket küldtünk').toBe(true);

    const { rows } = await db.query('SELECT email_verification_token_hash FROM users WHERE id = $1', [u.id]);
    expect(rows[0].email_verification_token_hash, 'fölöslegesen új tokent írt a DB-be').toBeNull();
  });

  it('resend-verification: 60 másodpercen belül 429 (e-mail-bombázás védelem)', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: false });
    await db.query('UPDATE users SET email_verification_sent_at = NOW() WHERE id = $1', [u.id]);
    const res = await request(app).post('/auth/resend-verification').set(auth(u.token));
    expect(
      res.status,
      'másodpercenként újraküldhető a megerősítő e-mail — az áldozat postaládája '
      + 'a mi domainünkről bombázható',
    ).toBe(429);
  });

  it('resend-verification: ha még SOHA nem küldtünk linket, azonnal küld (nincs hamis 429)', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: false });
    await db.query(
      'UPDATE users SET email_verification_sent_at = NULL, email_verification_token_hash = NULL WHERE id = $1',
      [u.id],
    );
    const res = await request(app).post('/auth/resend-verification').set(auth(u.token));
    expect(
      res.status,
      'az a felhasználó is 429-et kapott, akinek még sosem küldtünk megerősítő linket — '
      + 'így soha nem tudná feloldani a fiókját',
    ).toBe(200);
    const { rows } = await db.query(
      'SELECT email_verification_token_hash, email_verification_sent_at FROM users WHERE id = $1', [u.id],
    );
    expect(rows[0].email_verification_token_hash, 'nem készült megerősítő token').toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].email_verification_sent_at, 'nem rögzült a küldés ideje (a 60 mp-es fék nem működne)').toBeTruthy();
  });

  it('resend-verification: 60 mp után ÚJ token kerül a DB-be (a régi érvénytelenné válik)', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: false });
    await db.query(
      `UPDATE users SET email_verification_token_hash = 'regi-hash',
              email_verification_sent_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`,
      [u.id],
    );
    const res = await request(app).post('/auth/resend-verification').set(auth(u.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await db.query('SELECT email_verification_token_hash FROM users WHERE id = $1', [u.id]);
    expect(rows[0].email_verification_token_hash, 'nem cserélődött ki a megerősítő token').not.toBe('regi-hash');
    expect(rows[0].email_verification_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =====================================================================
//  PROFIL-SZERKESZTÉS
// =====================================================================
describe('PATCH /auth/me — allowlist és validációk', () => {
  it('a nem engedélyezett mezők NÉMÁN kimaradnak (nem szereznek jogot)', async () => {
    const u = await createUser({ role: 'shipper', kyc: 'pending' });
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({
      full_name: 'Rendes Új Név',
      role: 'admin',
      identity_kyc_status: 'verified',
      driver_kyc_status: 'verified',
      trust_score: 9999,
      email: 'atvett@teszt.hu',
      token_version: 42,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { rows } = await db.query(
      `SELECT full_name, role, identity_kyc_status, driver_kyc_status,
              trust_score, email, token_version FROM users WHERE id = $1`,
      [u.id],
    );
    expect(rows[0].full_name, 'az ENGEDÉLYEZETT mező módosítása nem ment át').toBe('Rendes Új Név');
    expect(rows[0].role, 'a PATCH /auth/me admin szerepet adott — teljes jogosultság-eszkaláció').toBe('shipper');
    expect(rows[0].identity_kyc_status, 'a felhasználó saját magát KYC-hitelesítette').toBe('pending');
    expect(rows[0].driver_kyc_status, 'a felhasználó saját magának adott szállítói KYC-t').toBe('pending');
    expect(rows[0].trust_score, 'a bizalmi pontszám kívülről írható').not.toBe(9999);
    expect(rows[0].email, 'a fiók e-mail-címe átírható a profil-szerkesztéssel (fiók-átvétel)').toBe(u.email);
    expect(Number(rows[0].token_version), 'a token_version kívülről állítható').toBe(0);
  });

  it('üres body → 400 "Nincs módosítandó mező" (nem néma no-op)', async () => {
    const u = await createUser({ role: 'shipper' });
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/módosítandó/i);
  });

  it('csak tiltott mezőket küldve is 400 — nem hazudunk sikert', async () => {
    const u = await createUser({ role: 'shipper' });
    const res = await request(app).patch('/auth/me').set(auth(u.token))
      .send({ role: 'admin', avatar_url: 'https://x.hu/a.jpg' });
    expect(
      res.status,
      'a csak tiltott mezőket tartalmazó PATCH 200-at adott — a hívó azt hinné, sikerült',
    ).toBe(400);
  });

  it('érvénytelen név / telefonszám a PATCH-en → 400 (ugyanaz a szabály, mint a regisztrációnál)', async () => {
    const u = await createUser({ role: 'shipper' });
    const nev = await request(app).patch('/auth/me').set(auth(u.token)).send({ full_name: '   ' });
    expect(nev.status, 'csupa-szóköz névre lehetett átírni a profilt').toBe(400);

    const tel = await request(app).patch('/auth/me').set(auth(u.token)).send({ phone: 'hivj-fel' });
    expect(tel.status, 'szemét telefonszám átment a profil-szerkesztésen').toBe(400);

    const { rows } = await db.query('SELECT full_name, phone FROM users WHERE id = $1', [u.id]);
    expect(rows[0].full_name.trim().length, 'a név mégis kiürült').toBeGreaterThan(1);
    expect(rows[0].phone, 'a telefonszám mégis felülíródott').toBe('+36201234567');
  });

  it('rossz adószám-formátum és túl hosszú bemutatkozás → 400', async () => {
    const u = await createUser({ role: 'shipper' });
    const ado = await request(app).patch('/auth/me').set(auth(u.token)).send({ tax_id: '1234' });
    expect(ado.status, 'szemét adószám ment a számlázási mezőbe').toBe(400);

    const bio = await request(app).patch('/auth/me').set(auth(u.token)).send({ bio: 'x'.repeat(1001) });
    expect(bio.status, '1000 karakternél hosszabb bemutatkozás átment').toBe(400);
  });

  it('kapcsolat-szivárgás a bio-ban → 400 CONTACT_LEAK', async () => {
    const u = await createUser({ role: 'carrier' });
    const res = await request(app).patch('/auth/me').set(auth(u.token))
      .send({ bio: 'Keress bátran: 06 30 111 2233' });
    expect(
      res.status,
      'telefonszám írható a publikus bemutatkozásba — a díj tartósan megkerülhető',
    ).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
  });

  it('cégadat módosítása VISSZAÁLLÍTJA a NAV-jelvényt "pending"-re', async () => {
    const u = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET account_type = 'company', company_name = 'Régi Kft.',
              tax_id = '12345678-1-42', company_verification_status = 'verified' WHERE id = $1`,
      [u.id],
    );
    const res = await request(app).patch('/auth/me').set(auth(u.token))
      .send({ company_name: 'Vadonatúj Kft.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { rows } = await db.query('SELECT company_verification_status FROM users WHERE id = $1', [u.id]);
    expect(
      rows[0].company_verification_status,
      'az „Ellenőrzött cég" jelvény megmaradt a cégnév átírása után — bármelyik '
      + 'ellenőrzött cég átnevezhetné magát egy másik cégre a jelvénnyel együtt',
    ).toBe('pending');
  });

  it('üres string a rendszámban → NULL (tényleges törlés, nem üres string)', async () => {
    const u = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET vehicle_plate = $2 WHERE id = $1', [u.id, 'ABC-123']);
    const res = await request(app).patch('/auth/me').set(auth(u.token)).send({ vehicle_plate: '' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows } = await db.query('SELECT vehicle_plate FROM users WHERE id = $1', [u.id]);
    expect(rows[0].vehicle_plate, 'az üres rendszám nem törölte az értéket').toBeNull();
  });
});

// =====================================================================
//  KYC-FELTÖLTÉS HIBAÁGAI
// =====================================================================
describe('POST /auth/kyc-document — hibaágak és a döntési fa', () => {
  it('hiányzó fájl → 400, nem-kép MIME → 400', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    const nincsFajl = await request(app).post('/auth/kyc-document')
      .set(auth(u.token)).field('doc_type', 'id_card');
    expect(nincsFajl.status).toBe(400);
    expect(nincsFajl.body.error).toMatch(/fájl/i);

    const pdf = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'o.pdf', contentType: 'application/pdf' });
    expect(pdf.status, 'PDF-et fel lehetett tölteni okmányként').toBe(400);
  });

  it('a 15 MB-os plafon fölötti fotó BARÁTSÁGOS 413-at kap, nem „Szerverhibát"', async () => {
    // A telefonos okmányfotók 6-12 MB-osak; a régi 5 MB-os limit nyers
    // MulterError-t dobott, amiből a központi hibakezelő ijesztő 500-at
    // csinált — a tesztelők KYC-feltöltése emiatt szállt el.
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    const tulNagy = Buffer.concat([JPEG, Buffer.alloc(16 * 1024 * 1024)]);
    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', tulNagy, { filename: 'nagy.jpg', contentType: 'image/jpeg' });

    expect(
      res.status,
      'a túl nagy fotó nem 413-at kapott — nyers Multer-hibából „Szerverhiba" lenne, '
      + 'a felhasználó pedig nem tudná, hogy kisebb képet kell küldenie',
    ).toBe(413);
    expect(res.body.error, 'a hibaüzenet nem mondja meg, mit tegyen a felhasználó').toMatch(/MB|kisebb|tömörít/i);
  });

  it('image/png-nek ÁLCÁZOTT SVG → 400 (a tartalom dönt, nem a kliens MIME-ja)', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', svg, { filename: 'okmany.png', contentType: 'image/png' });
    expect(
      res.status,
      'image/png-nek hazudott SVG bejutott a tárolóba — stored-XSS az admin KYC-felületén',
    ).toBe(400);
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM kyc_documents WHERE user_id = $1', [u.id]);
    expect(rows[0].c, 'az elutasított feltöltéshez mégis készült KYC-sor').toBe(0);
  });

  it('CSAK a személyi igazolvány fogadható el (adat-minimalizálás, GDPR 5.(1)c)', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    for (const tipus of ['drivers_license', 'company_document', 'lakcimkartya', '']) {
      const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
        .field('doc_type', tipus)
        .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });
      expect(
        res.status,
        `a(z) "${tipus}" dokumentumtípust elfogadta a rendszer — olyan okmányt gyűjtünk, `
        + 'amire nincs szükségünk (a lakcímkártya hátulján a személyi azonosító van!)',
      ).toBe(400);
    }
  });

  it('AI nem elérhető → "pending" + kézi ellenőrzés (SOSEM automatikus jóváhagyás)', async () => {
    // A teszt-környezetben nincs GEMINI_API_KEY, tehát a valódi szolgáltatás
    // fail-closed módon `pending: true`-t ad — ezt az utat mérjük, mock nélkül.
    // Admin kell hozzá, különben nincs kinek szólni a kézi ellenőrzésről.
    await createUser({ role: 'admin' });
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/ai-nincs.jpg');
    const kezdet = new Date();

    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.status,
      'AI nélkül AUTOMATIKUSAN hitelesített a rendszer — a KYC és az „egy okmány = '
      + 'egy fiók" védelem is megkerülhető lenne egy Gemini-kieséssel',
    ).toBe('pending');
    expect(res.body.ok, 'a válasz sikerként jelentette a kézi ellenőrzésre várást').toBe(false);

    const { rows } = await db.query('SELECT identity_kyc_status FROM users WHERE id = $1', [u.id]);
    expect(rows[0].identity_kyc_status).toBe('pending');

    const { rows: ertesites } = await db.query(
      `SELECT COUNT(*)::int AS c FROM notifications
        WHERE type = 'kyc_manual_review' AND created_at >= $1`, [kezdet],
    );
    expect(ertesites[0].c, 'senki nem kapott értesítést a kézi ellenőrzésről — a dokumentum örökre pendingben ülne').toBeGreaterThan(0);
  });

  it('AI-kifogás (valid:false) → "pending", NEM automatikus elutasítás (GDPR 22. cikk)', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/kifogas.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: false, pending: false, confidence: 0.9, reason: 'Homályos a kép.',
      documentNumber: null, holderName: null, likelyCopy: false, underage: false,
    });

    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    const { rows } = await db.query(
      'SELECT status FROM kyc_documents WHERE user_id = $1 AND doc_type = $2', [u.id, 'id_card'],
    );
    expect(
      rows[0]?.status,
      'az AI EGYEDÜL utasította el a felhasználót — a tájékoztató, a DPIA és az '
      + 'érdekmérlegelési teszt is azt állítja, hogy a végső nemet ember mondja ki',
    ).toBe('pending');
    const { rows: user } = await db.query('SELECT identity_kyc_status FROM users WHERE id = $1', [u.id]);
    expect(user[0].identity_kyc_status).not.toBe('rejected');
  });

  it('18 év alatti gyanú → pending + admin-értesítés PII (e-mail, születési dátum) NÉLKÜL', async () => {
    // Admin kell, hogy legyen kinek szólni a gyanúról.
    await createUser({ role: 'admin' });
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/fiatal.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: false, confidence: 0.95, reason: 'A dokumentum tulajdonosa 18 év alatti.',
      documentNumber: 'KISKORU1', holderName: 'Teszt carrier', likelyCopy: false,
      underage: true, birthDate: '2012-05-04',
    });
    const kezdet = new Date();

    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.underage, 'a 18 év alatti gyanút nem jelezte a válasz').toBe(true);
    expect(res.body.status, '18 év alatti gyanúnál automatikusan hitelesített a rendszer').toBe('pending');

    const { rows } = await db.query(
      `SELECT body FROM notifications WHERE type = 'kyc_underage_alert' AND created_at >= $1
        ORDER BY created_at DESC LIMIT 1`, [kezdet],
    );
    expect(rows[0], 'nem ment admin-értesítés a 18 év alatti gyanúról').toBeTruthy();
    expect(
      rows[0].body,
      'a felhasználó E-MAIL-CÍME bekerült az értesítés szövegébe — a notifications '
      + 'tábla határidő nélkül őrzi (adat-minimalizálás, 2026-08-09 audit)',
    ).not.toContain(u.email);
    expect(
      rows[0].body,
      'a SZÜLETÉSI DÁTUM bekerült az értesítés szövegébe',
    ).not.toMatch(/\d{4}[-.]\d{2}[-.]\d{2}/);
  });

  it('tiszta eset → automatikus hitelesítés (a gyors út nem romlott el)', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/tiszta.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.97, reason: 'Rendben.',
      documentNumber: `TISZTA${Date.now()}`, holderName: 'Teszt carrier',
      likelyCopy: false, underage: false,
    });

    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok, 'a tiszta eset sem megy át automatikusan — az admin-tehermentesítés elveszett').toBe(true);
    expect(res.body.status).toBe('verified');
    const { rows } = await db.query('SELECT identity_kyc_status FROM users WHERE id = $1', [u.id]);
    expect(rows[0].identity_kyc_status).toBe('verified');
    expect(
      res.body.file_url,
      'a válasz a NYERS privát tároló-kulcsot adta vissza aláírt link helyett',
    ).not.toMatch(/^private:/);
  });

  it('KOCKÁZATI JEL (másolat-gyanú) → pending, akkor is, ha az AI valid:true-t mond', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'pending' });
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/masolat.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.99, reason: 'Rendben.',
      documentNumber: `MASOLAT${Date.now()}`, holderName: 'Teszt carrier',
      likelyCopy: true, underage: false,
    });

    const res = await request(app).post('/auth/kyc-document').set(auth(u.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, { filename: 'o.jpg', contentType: 'image/jpeg' });

    expect(
      res.body.status,
      'a képernyőfotóról készült okmány AUTOMATIKUSAN hitelesített — a vak auto-approve visszatért',
    ).toBe('pending');
  });
});

// =====================================================================
//  AVATAR
// =====================================================================
describe('POST /auth/avatar — hibaágak', () => {
  it('hiányzó fájl → 400, nem-kép MIME → 400, álcázott tartalom → 400', async () => {
    const u = await createUser({ role: 'shipper' });
    const nincs = await request(app).post('/auth/avatar').set(auth(u.token));
    expect(nincs.status).toBe(400);

    const txt = await request(app).post('/auth/avatar').set(auth(u.token))
      .attach('file', Buffer.from('csak szoveg'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);

    const alcazott = await request(app).post('/auth/avatar').set(auth(u.token))
      .attach('file', Buffer.from('<html><script>x</script></html>'), { filename: 'a.png', contentType: 'image/png' });
    expect(alcazott.status, 'image/png-nek hazudott HTML bejutott az avatar-tárolóba').toBe(400);

    const { rows } = await db.query('SELECT avatar_url FROM users WHERE id = $1', [u.id]);
    expect(rows[0].avatar_url, 'az elutasított feltöltés mégis beírta az avatar_url-t').toBeNull();
  });
});

// =====================================================================
//  PUBLIKUS PROFIL + ADMIN-KAPUK AZ AUTH-BAN
// =====================================================================
describe('GET /auth/users/:id/profile', () => {
  it('nem létező felhasználó → 404 (nem üres 200)', async () => {
    const u = await createUser({ role: 'shipper' });
    const res = await request(app)
      .get('/auth/users/11111111-1111-1111-1111-111111111111/profile').set(auth(u.token));
    expect(res.status).toBe(404);
  });

  it('a publikus profil NEM adja ki a rendszámot, az e-mailt és a telefont', async () => {
    const nezo = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET vehicle_plate = $2, vehicle_type = $3 WHERE id = $1',
      [szallito.id, 'ABC-123', 'Furgon']);

    const res = await request(app).get(`/auth/users/${szallito.id}/profile`).set(auth(nezo.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.vehicle_plate,
      'a rendszám (GDPR szerint személyes adat) bárki által lekérhető a publikus profilról',
    ).toBeUndefined();
    expect(res.body.email, 'az e-mail-cím kiszivárgott a publikus profilon').toBeUndefined();
    expect(res.body.phone, 'a telefonszám kiszivárgott a publikus profilon — a díj megkerülhető').toBeUndefined();
    expect(res.body.vehicle_type, 'a jármű TÍPUSA viszont maradjon (döntéshez hasznos, nem azonosít)').toBe('Furgon');
  });

  it('a teljesített fuvarok száma a lezárt fuvarokat számolja (a folyamatban lévőket nem)', async () => {
    const nezo = await createUser({ role: 'shipper' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });

    const res = await request(app).get(`/auth/users/${szallito.id}/profile`).set(auth(nezo.token));
    expect(
      res.body.completed_jobs,
      'a publikus profil a FOLYAMATBAN lévő fuvart is teljesítettként számolja — hamis reputáció',
    ).toBe(1);
  });
});

describe('Az auth.js saját admin-kapui (nem middleware, hanem kézi ellenőrzés)', () => {
  it('GET /auth/admin/stats: nem-admin 403, admin 200 + valós számok', async () => {
    const felado = await createUser({ role: 'shipper' });
    const admin = await createUser({ role: 'admin' });

    const tiltott = await request(app).get('/auth/admin/stats').set(auth(felado.token));
    expect(tiltott.status, 'bármelyik felhasználó lekérdezhette a platform statisztikáit').toBe(403);

    const elotte = await request(app).get('/auth/admin/stats').set(auth(admin.token));
    expect(elotte.status, JSON.stringify(elotte.body)).toBe(200);
    await createJob({ shipperId: felado.id, status: 'bidding' });
    const utana = await request(app).get('/auth/admin/stats').set(auth(admin.token));

    expect(
      utana.body.active_jobs - elotte.body.active_jobs,
      'az „aktív fuvarok" számláló nem reagált egy új, ajánlatokra váró fuvarra',
    ).toBe(1);
    expect(utana.body.total_users).toBeGreaterThan(0);
  });

  it('POST /auth/admin/grant-monthly-vouchers: nem-admin 403', async () => {
    const u = await createUser({ role: 'carrier' });
    const res = await request(app).post('/auth/admin/grant-monthly-vouchers').set(auth(u.token));
    expect(res.status, 'bárki oszthatott magának havi kuponokat').toBe(403);
  });
});

// =====================================================================
//  PUSH TOKEN + FIÓK-TÖRLÉS
// =====================================================================
describe('Egyéb auth-végpontok hibaágai', () => {
  it('POST /auth/push-token: token nélkül 400; megadott platform mentődik', async () => {
    const u = await createUser({ role: 'shipper' });
    const res = await request(app).post('/auth/push-token').set(auth(u.token)).send({});
    expect(res.status).toBe(400);

    const eszkozToken = `ExponentPushToken[teszt-${Date.now()}]`;
    const ok = await request(app).post('/auth/push-token').set(auth(u.token))
      .send({ token: eszkozToken, platform: 'android' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const { rows } = await db.query('SELECT user_id, platform FROM push_tokens WHERE token = $1', [eszkozToken]);
    expect(rows[0], 'a push-token nem mentődött el').toBeTruthy();
    expect(rows[0].platform, 'a megadott platform helyett az „ios" alapértelmezés került be').toBe('android');

    // Ugyanaz az eszköz egy MÁSIK fiókkal: a token átkerül (nem duplikálódik),
    // különben az előző tulajdonos kapná a push-értesítéseket.
    const masik = await createUser({ role: 'shipper' });
    await request(app).post('/auth/push-token').set(auth(masik.token))
      .send({ token: eszkozToken, platform: 'ios' });
    const { rows: utana } = await db.query('SELECT user_id, platform FROM push_tokens WHERE token = $1', [eszkozToken]);
    expect(utana.length, 'ugyanaz az eszköz-token kétszer került be').toBe(1);
    expect(
      utana[0].user_id,
      'az eszköz új tulajdonosa helyett a RÉGI fiók kapná a push-értesítéseket',
    ).toBe(masik.id);
    expect(utana[0].platform).toBe('ios');
  });

  it('DELETE /auth/me: aktív, KIFIZETETT ügylettel nem törölhető a fiók', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const res = await request(app).delete('/auth/me').set(auth(felado.token));
    expect(
      res.status,
      'a feladó egy folyamatban lévő, kifizetett fuvar közepén törölhette a fiókját — '
      + 'a szállító elveszítette volna az ügyletet',
    ).toBe(409);
    expect(res.body.code).toBe('USER_HAS_ACTIVE_PAID');

    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [felado.id]);
    expect(rows.length, 'a fiók mégis törlődött').toBe(1);
  });

  it('DELETE /auth/me: sikeres törlésnél a naplóba HMAC-lenyomat kerül, nem a nyers e-mail', async () => {
    const u = await createUser({ role: 'shipper' });
    const res = await request(app).delete('/auth/me').set(auth(u.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { rows } = await db.query(
      'SELECT email_hash, hash_algo FROM deleted_accounts WHERE original_user_id = $1', [u.id],
    );
    expect(rows[0], 'nem keletkezett nyom a fiók törléséről').toBeTruthy();
    expect(
      rows[0].email_hash,
      'a törölt fiók e-mail-címe olvashatóan (vagy sózatlan hash-ként) maradt meg — '
      + 'épp attól, aki a törléshez való jogát gyakorolta',
    ).not.toContain('@');
    expect(rows[0].hash_algo).toBe('hmac-sha256');

    const { rows: user } = await db.query('SELECT 1 FROM users WHERE id = $1', [u.id]);
    expect(user.length, 'a felhasználó sora megmaradt a "sikeres" törlés után').toBe(0);
  });
});
