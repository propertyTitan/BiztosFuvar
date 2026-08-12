// =====================================================================
//  AUTH — A MARADÉK FEDETLEN ÁGAK (2026-08-12)
//
//  Az `auth-hibaagak.test.js` a klasszikus hibaágakat lefedte (rossz
//  jelszó, lejárt token, felhasznált link, allowlist). Ami UTÁNA maradt,
//  az három osztály — és mindhárom ugyanazt a kérdést teszi fel:
//  „mi történik, ha a KÖRNYEZET romlik el, nem a felhasználó?"
//
//   (1) TÍPUS-ZAVAR a bemenetben — a validátorok `typeof` őrei. Ha
//       kiesnek, a `.trim()` egy számon TypeError-t dob, abból pedig
//       500 „Szerverhiba" lesz (a projekt SZ1 szabályának megsértése).
//   (2) SÉRÜLT / RÉGI ADAT a DB-ben — pl. kettőspont nélküli jelszó-hash.
//       Ilyen sor a fejlesztői/seed előzményből valóban van (a teszt-
//       helper is ilyet ír). A belépésnek ilyenkor 401-et kell adnia,
//       nem 500-at.
//   (3) MELLÉKHATÁS-HIBA — a „fire-and-forget" hívások (NAV-ellenőrzés,
//       aktivitás-napló, admin-értesítés, exportról szóló értesítés)
//       SOHA nem akaszthatják meg a fő utat, ÉS nem hagyhatnak maguk
//       után kezeletlen ígéret-elutasítást. Ez utóbbi nem kozmetika:
//       Node 18+ alatt az `unhandledRejection` alapértelmezés szerint
//       MEGÖLI a folyamatot — vagyis egy elmaradt `.catch()` a Railway
//       konténer újraindulását jelenti egy e-mail-hiba miatt.
//
//  Minden teszt egy konkrét garanciát mér: ha a védelem kiesik, a teszt
//  pirosra vált (mind az 5 kiemelt esetben visszaméréssel igazolva).
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, uniqueEmail,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const storage = require('../src/services/storage');
const navTaxpayer = require('../src/services/navTaxpayer');
const notifications = require('../src/services/notifications');
const pepper = require('../src/utils/pepper');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (body) => request(app).post('/auth/register').send(body);

// Érvényes JPEG-fejléc — a magic-byte ellenőrzés ezt fogadja el.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

/**
 * Kezeletlen ígéret-elutasítás figyelő.
 *
 * ⚠️ EZ AZ ŐR A LÉNYEG a „fire-and-forget" teszteknél. Ha csak azt
 * néznénk, hogy a végpont 200-at ad, a teszt a `.catch(...)` TÖRLÉSE
 * UTÁN IS ZÖLD maradna: a hívás nincs await-elve, tehát a válasz akkor is
 * kimegy. Ami elromlik, az a folyamat egészsége — Node 18+ alatt a
 * kezeletlen elutasítás leállítja a szervert. Ezért mérjük külön.
 */
function kezeletlenElutasitasFigyelo() {
  const talalatok = [];
  const kezelo = (ok) => talalatok.push(ok);
  process.on('unhandledRejection', kezelo);
  return {
    async leall() {
      // Két időzítő-kör: a fire-and-forget ígéretek elutasítása a
      // microtask-sor kiürülése UTÁN válik „kezeletlenné".
      await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 50));
      process.off('unhandledRejection', kezelo);
      return talalatok.map((e) => (e && e.message) || String(e));
    },
  };
}

// ── Csere-függvények visszaállítása ───────────────────────────────────
const visszaallitok = [];

/**
 * Modul-függvény cseréje ELUTASÍTÓ, de NEM vi-mock függvényre.
 *
 * ⚠️ MIÉRT NEM `vi.spyOn(...).mockRejectedValue(...)`: a vitest a mock által
 * visszaadott ígéretre BELSŐLEG rákapcsolódik (a `mock.settledResults`
 * könyveléséhez), ezért az MINDIG „kezelt" lesz — a fenti figyelő vakon zöld
 * maradna, akkor is, ha a termékkódból kivesszük a `.catch()`-et.
 * LEMÉRVE (2026-08-12): a NAV-hívás `.catch()`-ének törlése után a
 * vi-mockos változat végig zöld volt; sima függvénnyel PIROS.
 */
function elutasitoCsere(modul, nev, uzenet) {
  const eredeti = modul[nev];
  const hivasok = [];
  // eslint-disable-next-line no-param-reassign
  modul[nev] = (...args) => { hivasok.push(args); return Promise.reject(new Error(uzenet)); };
  // eslint-disable-next-line no-param-reassign
  visszaallitok.push(() => { modul[nev] = eredeti; });
  return hivasok;
}

/** db.query átengedő csere, ami CSAK a megadott SQL-részletre hibázik. */
function dbHibaCsak(sqlReszlet) {
  const eredeti = db.query;
  db.query = (sql, params) => {
    if (typeof sql === 'string' && sql.includes(sqlReszlet)) {
      return Promise.reject(new Error(`szimulált DB-hiba: ${sqlReszlet}`));
    }
    return eredeti.call(db, sql, params);
  };
  visszaallitok.push(() => { db.query = eredeti; });
}

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => {
  while (visszaallitok.length) visszaallitok.pop()();
  vi.restoreAllMocks();
});

// =====================================================================
//  1. TÍPUS-ZAVAR — a validátorok `typeof` őrei
// =====================================================================
describe('Regisztrációs validátorok: NEM STRING bemenet', () => {
  it('szám / objektum a név, telefonszám és rendszám mezőben → 400, sosem 500', async () => {
    const esetek = [
      { mezo: 'full_name', ertek: 12345, minta: /Érvénytelen név/i },
      { mezo: 'phone', ertek: { a: 1 }, minta: /Érvénytelen telefonszám/i },
      { mezo: 'phone', ertek: 36201234567, minta: /Érvénytelen telefonszám/i },
      { mezo: 'vehicle_plate', ertek: 42, minta: /Érvénytelen rendszám/i },
      { mezo: 'vehicle_plate', ertek: ['ABC-123'], minta: /Érvénytelen rendszám/i },
    ];
    for (const e of esetek) {
      const res = await reg({
        email: uniqueEmail('tipus'),
        password: 'ErosJelszo123',
        full_name: 'Teszt Elek',
        [e.mezo]: e.ertek,
      });
      expect(res.status,
        `a ${e.mezo} mezőbe küldött ${JSON.stringify(e.ertek)} nem-string értékre 400 jár. `
        + 'Ha a validátor typeof-őre kiesik, a .trim() TypeError-t dob → 500 "Szerverhiba", '
        + `és a felhasználó azt hiszi, nálunk van a baj. Kapott: ${res.status} ${JSON.stringify(res.body)}`)
        .toBe(400);
      expect(res.body.error).toMatch(e.minta);
    }
  });

  it('30 karakternél hosszabb telefonszám → 400 (a hossz-korlát külön ág)', async () => {
    const res = await reg({
      email: uniqueEmail('hosszutel'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
      // 6–15 számjegy közé esne a szeparátorok nélkül, de a nyers hossz 30 felett van
      phone: '+36 (20) 123-4567 / 123-4567 / 12',
    });
    expect(res.status,
      'a 30 karakternél hosszabb telefonszám-mező elutasítandó — enélkül tetszőleges '
      + 'hosszúságú szemét kerülne a profilba (a mező a másik fél előtt is megjelenik)')
      .toBe(400);
    expect(res.body.error).toMatch(/Érvénytelen telefonszám/i);
  });

  it('tiltott karakter a rendszámban → 400, a szabályos rendszám viszont átmegy (nagybetűsítve)', async () => {
    const rossz = await reg({
      email: uniqueEmail('plate-rossz'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
      vehicle_plate: 'ABC@12',
    });
    expect(rossz.status,
      'a rendszám karakter-készlete zárt (betű/szám/kötőjel/szóköz) — a @ nem fér bele')
      .toBe(400);
    expect(rossz.body.error).toMatch(/Érvénytelen rendszám/i);

    const jo = await reg({
      email: uniqueEmail('plate-jo'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
      vehicle_plate: ' abc-123 ',
    });
    expect(jo.status, 'a szabályos rendszámot nem szabad elutasítani (a szűrő nem lehet túl széles)').toBe(201);
    const { rows } = await db.query('SELECT vehicle_plate FROM users WHERE id = $1', [jo.body.user.id]);
    expect(rows[0].vehicle_plate,
      'a rendszám trimmelve és NAGYBETŰSÍTVE tárolódik — enélkül ugyanaz a rendszám '
      + 'többféle írásmódban létezne, és az összevetés (pl. duplikátum-keresés) elromlana')
      .toBe('ABC-123');
  });
});

// =====================================================================
//  2. SÉRÜLT DB-ADAT — a belépés nem omolhat össze tőle
// =====================================================================
describe('Belépés sérült jelszó-hash-sel', () => {
  it('kettőspont nélküli password_hash → 401, NEM 500 (a scrypt-formátum őre)', async () => {
    // A createUser helper `'x'`-et ír a password_hash-be — pontosan olyan sor,
    // amilyen a seed/fejlesztői előzményből valóban keletkezhet.
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).post('/auth/login')
      .send({ email: user.email, password: 'BarmilyenJelszo1' });
    expect(res.status,
      'a "salt:derived" formátumot nem követő hash-nél a verifyPassword-nek false-t kell adnia. '
      + 'Ha a `!salt || !derived` őr kiesik, a Buffer.from(undefined) / timingSafeEqual dob → '
      + '500, és a hibaüzenetből az is kiderül, hogy a fiók LÉTEZIK (enumeráció).')
      .toBe(401);
    expect(res.body.error).toMatch(/Hibás email vagy jelszó/i);
  });

  it('sérült hash-nél is UGYANAZ a válasz, mint nem létező fióknál (nincs enumeráció)', async () => {
    const user = await createUser({ role: 'shipper' });
    const serult = await request(app).post('/auth/login')
      .send({ email: user.email, password: 'BarmilyenJelszo1' });
    const nincsIlyen = await request(app).post('/auth/login')
      .send({ email: 'nincs-ilyen-fiok@teszt.gofuvar.hu', password: 'BarmilyenJelszo1' });
    expect(serult.status).toBe(nincsIlyen.status);
    expect(serult.body.error,
      'a sérült hash-ű létező fiók és a nem létező fiók válasza NEM térhet el — '
      + 'különben a hibaüzenet különbsége fiók-létezést szivárogtat')
      .toBe(nincsIlyen.body.error);
  });
});

// =====================================================================
//  3. NEM-JSON KÉRÉS-TEST — a `req.body || {}` fallback
// =====================================================================
describe('Nem-JSON kérés-test (a body-parser nem tölti ki a req.body-t)', () => {
  it('text/plain törzs a register / forgot-password / reset-password végponton → 400, sosem 500', async () => {
    const esetek = [
      { ut: '/auth/register', minta: /Hiányzó mezők/i },
      { ut: '/auth/forgot-password', minta: /Email kötelező/i },
      { ut: '/auth/reset-password', minta: /Hiányzó adatok/i },
    ];
    for (const e of esetek) {
      const res = await request(app).post(e.ut)
        .set('Content-Type', 'text/plain')
        .send('nem json');
      expect(res.status,
        `${e.ut}: ha a kliens nem JSON-t küld, a req.body undefined marad. A "req.body || {}" `
        + 'fallback nélkül a destrukturálás TypeError-t dob → 500. Élesben ez minden '
        + `megszakadt mobil-kérésnél hamis Sentry-riasztás. Kapott: ${res.status}`)
        .toBe(400);
      expect(res.body.error).toMatch(e.minta);
    }
  });
});

// =====================================================================
//  4. FÁJL-FELTÖLTÉSI HIBÁK — a multer-hiba nem lehet 500
// =====================================================================
describe('POST /auth/avatar — feltöltési hibák és az árva-fájl guard', () => {
  it('rossz mezőnévvel küldött fájl → 400 „Fájl feltöltési hiba" (nem 500, nem 413)', async () => {
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).post('/auth/avatar')
      .set(auth(user.token))
      .attach('kep', JPEG, 'profil.jpg'); // a végpont a 'file' mezőt várja
    expect(res.status,
      'a nem várt mezőnév MulterError-t dob (LIMIT_UNEXPECTED_FILE). Ez NEM méret-hiba, '
      + 'tehát nem 413; és nem is a mi hibánk, tehát nem 500 — a wrapper 400-at ad. '
      + `Kapott: ${res.status} ${JSON.stringify(res.body)}`)
      .toBe(400);
    expect(res.body.error).toMatch(/Fájl feltöltési hiba/i);
    expect(res.body.detail, 'a multer üzenete diagnosztikaként visszajön').toBeTruthy();
  });

  it('az ELSŐ avatar-feltöltésnél nem hívjuk a tároló törlését (nincs mit törölni)', async () => {
    const user = await createUser({ role: 'shipper' });
    // ⚠️ A `saveFile` NEM kémlelhető: az auth.js a modul betöltésekor
    // destrukturálja, tehát a modul-objektum cseréje nem látszik nála.
    // A `deleteFile` viszont a modul-objektumon át hívódik — épp azt mérjük.
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    const res = await request(app).post('/auth/avatar')
      .set(auth(user.token))
      .attach('file', JPEG, 'profil.jpg');

    expect(res.status).toBe(200);
    const { rows } = await db.query('SELECT avatar_url FROM users WHERE id = $1', [user.id]);
    expect(rows[0].avatar_url, 'az új avatar URL-je a profilra kerül').toBe(res.body.url);
    expect(torles,
      'korábbi avatar híján a törlést MEG SEM SZABAD hívni. Az `elozoAvatar &&` őr nélkül '
      + 'a tároló null/undefined kulccsal kapna törlés-parancsot — a legjobb esetben zajos '
      + 'hiba, a rosszabbikban egy üres kulcsra futó törlés.')
      .not.toHaveBeenCalled();
  });

  it('a MÁSODIK feltöltés a régi fájlt törli, de a tároló hibája nem dönti el a kérést', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2',
      ['https://r2.teszt/regi-avatar.jpg', user.id]);
    const torles = elutasitoCsere(storage, 'deleteFile', 'R2 kiesés');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).post('/auth/avatar')
      .set(auth(user.token))
      .attach('file', JPEG, 'profil.jpg');
    const kezeletlen = await figyelo.leall();

    expect(res.status, 'az avatar-csere nem bukhat el attól, hogy a RÉGI fájl törlése nem sikerült').toBe(200);
    expect(torles.map((a) => a[0]),
      'a RÉGI avatar kulcsával kell hívni a törlést — enélkül árva fájl marad a '
      + 'publikus bucketben, egy éves immutable cache-sel')
      .toContain('https://r2.teszt/regi-avatar.jpg');
    expect(kezeletlen,
      'a törlés hibája `.catch()`-elve van — enélkül kezeletlen ígéret-elutasítás keletkezne, '
      + 'ami Node 18+ alatt MEGÖLI a backend folyamatot egy R2-kiesés miatt')
      .toEqual([]);
  });
});

// =====================================================================
//  5. NAV CÉG-ELLENŐRZÉS — a mellékhatás nem akaszthatja meg a fő utat
// =====================================================================
describe('NAV „Ellenőrzött cég" háttér-ellenőrzés', () => {
  it('konfigurált NAV-integrációnál a CÉGES regisztráció elindítja az ellenőrzést, '
    + 'és annak hibája sem akasztja meg a fiók létrejöttét', async () => {
    vi.spyOn(navTaxpayer, 'isConfigured').mockReturnValue(true);
    const ellenorzes = elutasitoCsere(navTaxpayer, 'verifyCompanyUser', 'NAV nem elérhető');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await reg({
      email: uniqueEmail('nav-ceg'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
      account_type: 'company',
      company_name: 'Teszt Kft.',
      tax_id: '12345678-1-42',
    });
    const kezeletlen = await figyelo.leall();

    expect(res.status, 'a NAV-hívás best-effort: a regisztrációnak sikerülnie kell').toBe(201);
    expect(ellenorzes.map((a) => a[0]),
      'konfigurált integrációnál a céges regisztráció MEGINDÍTJA a NAV-ellenőrzést — '
      + 'enélkül az „Ellenőrzött cég" jelvény sosem jönne létre magától')
      .toEqual([res.body.user.id]);
    expect(kezeletlen,
      'a NAV-hívás hibája `.catch()`-elve van — enélkül kezeletlen elutasítás, '
      + 'vagyis egy NAV-kiesés a teljes backendet újraindítaná')
      .toEqual([]);
  });

  it('az ajánlói kód generálásának hibája sem hiúsíthatja meg a regisztrációt', async () => {
    // A getOrCreateReferralCode ELSŐ lekérdezése try-blokkon kívül van, tehát
    // egy DB-hiba valóban elutasított ígéretet ad vissza a register-nek.
    dbHibaCsak('SELECT referral_code FROM users WHERE id = $1');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await reg({
      email: uniqueEmail('ref-hiba'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
    });
    const kezeletlen = await figyelo.leall();

    expect(res.status,
      'az ajánlói kód kényelmi funkció — ha nem sikerül legenerálni, a fiók akkor is '
      + 'jöjjön létre (a kód a GET /auth/referral hívásakor pótolható)')
      .toBe(201);
    expect(res.body.token, 'a felhasználó azonnal be tud lépni').toBeTruthy();
    expect(kezeletlen,
      'a `.catch()` nélkül ez kezeletlen ígéret-elutasítás lenne — Node 18+ alatt '
      + 'minden ilyen regisztráció újraindítaná a backendet')
      .toEqual([]);
  });

  it('MAGÁNSZEMÉLY regisztrációnál NEM indul NAV-ellenőrzés (nincs mit ellenőrizni)', async () => {
    vi.spyOn(navTaxpayer, 'isConfigured').mockReturnValue(true);
    const ellenorzes = vi.spyOn(navTaxpayer, 'verifyCompanyUser').mockResolvedValue({ ok: true });

    const res = await reg({
      email: uniqueEmail('nav-maganszemely'),
      password: 'ErosJelszo123',
      full_name: 'Teszt Elek',
    });

    expect(res.status).toBe(201);
    expect(ellenorzes,
      'magánszemélynél nincs adószám — a NAV-lekérdezés fölösleges külső hívás lenne, '
      + 'és a NAV-kvótát is fogyasztaná minden egyes regisztrációnál')
      .not.toHaveBeenCalled();
  });

  it('cégadat módosításakor (PATCH /me) újraindul az ellenőrzés — de csak céges fióknál', async () => {
    vi.spyOn(navTaxpayer, 'isConfigured').mockReturnValue(true);
    const ellenorzes = elutasitoCsere(navTaxpayer, 'verifyCompanyUser', 'NAV időtúllépés');

    const ceg = await createUser({ role: 'shipper' });
    await db.query(
      `UPDATE users SET account_type = 'company', company_name = 'Régi Kft.', tax_id = '12345678-1-42'
        WHERE id = $1`, [ceg.id],
    );
    const maganszemely = await createUser({ role: 'shipper' });

    const figyelo = kezeletlenElutasitasFigyelo();
    const cegRes = await request(app).patch('/auth/me').set(auth(ceg.token))
      .send({ company_name: 'Új Név Kft.' });
    const kezeletlen = await figyelo.leall();

    expect(cegRes.status).toBe(200);
    expect(cegRes.body.company_verification_status,
      'cégadat-változásnál a jelvény VISSZAÁLL pending-re, amíg a NAV újra nem hagyja jóvá')
      .toBe('pending');
    expect(ellenorzes.map((a) => a[0])).toEqual([ceg.id]);
    expect(kezeletlen, 'a NAV-hiba itt sem hagyhat kezeletlen elutasítást').toEqual([]);

    ellenorzes.length = 0;
    const maganRes = await request(app).patch('/auth/me').set(auth(maganszemely.token))
      .send({ company_name: 'Nem Céges Bt.' });
    expect(maganRes.status).toBe(200);
    expect(ellenorzes,
      'magánszemély fióknál a cégnév-mező kitöltése NEM indíthat NAV-lekérdezést '
      + '(nincs adószáma, amit ellenőrizni lehetne)')
      .toEqual([]);
  });
});

// =====================================================================
//  6. BEJELENTKEZÉS — az aktivitás-napló nem kritikus út
// =====================================================================
describe('POST /auth/login — az aktivitás-napló hibája', () => {
  it('ha a belépés-számláló írása elhasal, a bejelentkezés AKKOR IS sikerül', async () => {
    // Valódi jelszóval regisztrált fiók kell (a helper hash-e sérült formátumú).
    const email = uniqueEmail('napló');
    const jelszo = 'ErosJelszo123';
    await reg({ email, password: jelszo, full_name: 'Teszt Elek' });

    dbHibaCsak('login_count = login_count + 1');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).post('/auth/login').send({ email, password: jelszo });
    const kezeletlen = await figyelo.leall();

    expect(res.status,
      'az aktivitás-napló írása "fire-and-forget": egy DB-hiba a naplózáskor NEM zárhatja ki '
      + `a felhasználót a saját fiókjából. Kapott: ${res.status} ${JSON.stringify(res.body)}`)
      .toBe(200);
    expect(res.body.token, 'a token akkor is kiadandó').toBeTruthy();
    expect(kezeletlen,
      'a naplózás hibája `.catch()`-elve van — enélkül minden ilyen belépés kezeletlen '
      + 'elutasítást hagyna, ami Node 18+ alatt megállítja a szervert')
      .toEqual([]);
  });
});

// =====================================================================
//  7. AJÁNLÓI LINK — a megosztható URL alapja
// =====================================================================
describe('GET /auth/referral — a link alapcíme', () => {
  it('a beállított WEB_BASE_URL-re mutat; hiányában a gofuvar.hu-ra esik vissza', async () => {
    const user = await createUser({ role: 'shipper' });
    const eredeti = process.env.WEB_BASE_URL;
    try {
      process.env.WEB_BASE_URL = 'https://elonezet.gofuvar.hu';
      const beallitva = await request(app).get('/auth/referral').set(auth(user.token));
      expect(beallitva.status).toBe(200);
      expect(beallitva.body.code, 'az ajánlói kód a lekérdezéskor létrejön, ha még nem volt').toBeTruthy();
      expect(beallitva.body.link,
        'az ajánlói link a KONFIGURÁLT webcímre kell mutasson — ha a kód hardkódolna, '
        + 'egy domain-váltás után minden megosztott link halott lenne')
        .toBe(`https://elonezet.gofuvar.hu/bejelentkezes?mode=register&ref=${beallitva.body.code}`);

      delete process.env.WEB_BASE_URL;
      const alapertelmezett = await request(app).get('/auth/referral').set(auth(user.token));
      expect(alapertelmezett.body.link,
        'env nélkül az éles domainre esünk vissza — SOSEM localhostra, mert a link '
        + 'e-mailben/üzenetben másokhoz jut el')
        .toBe(`https://gofuvar.hu/bejelentkezes?mode=register&ref=${beallitva.body.code}`);
    } finally {
      if (eredeti === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = eredeti;
    }
  });
});

// =====================================================================
//  8. KYC — korábban törölt fiók okmánya + az értesítés-hiba
// =====================================================================
describe('POST /auth/kyc-document — okmány-előzmény és mellékhatás-hibák', () => {
  /** Közös beállítás: privát tároló + AI-válasz. */
  function kycMock(okmanyszam, extra = {}) {
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/teszt.jpg');
    vi.spyOn(storage, 'getSignedPrivateUrl').mockResolvedValue('https://alairt.teszt/kyc.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true,
      confidence: 0.97,
      documentNumber: okmanyszam,
      // ⚠️ camelCase: a services/kycReview.js `aiResult.holderName` /
      // `aiResult.likelyCopy` néven olvassa. Snake_case-szel a név-egyezés
      // sosem teljesülne, és minden „tiszta" eset NAME_MISMATCH-re futna —
      // vagyis a teszt hamis okból lenne zöld.
      holderName: 'Teszt Shipper',
      likelyCopy: false,
      underage: false,
      reason: null,
      ...extra,
    });
  }

  it('korábban TÖRÖLT fiók okmánya → emberi ellenőrzés (nem automatikus jóváhagyás, '
    + 'és nem is kizárás)', async () => {
    const user = await createUser({ role: 'shipper', kyc: 'pending' });
    await db.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Teszt Shipper', user.id]);

    // A lenyomat túléli a fiók törlését: ugyanaz a HMAC, deleted_account_count > 0.
    const okmanyszam = 'AB1234567';
    const lenyomat = pepper.hmac(okmanyszam.trim().toUpperCase());
    await db.query(
      `INSERT INTO kyc_doc_history (doc_number_hash, hash_algo, deleted_account_count, last_deletion_reason)
       VALUES ($1, 'hmac-sha256', 1, 'self')
       ON CONFLICT (doc_number_hash) DO UPDATE SET deleted_account_count = 1`,
      [lenyomat],
    );
    kycMock(okmanyszam);

    const res = await request(app).post('/auth/kyc-document')
      .set(auth(user.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, 'szemelyi.jpg');

    expect(res.status).toBe(200);
    expect(res.body.status,
      'az AI „valid" ítélete ÖNMAGÁBAN nem elég, ha ezzel az okmánnyal korábban már volt '
      + 'fiók: a törlés + újraregisztrálás így nem ad ELŐZMÉNY NÉLKÜLI tiszta lapot '
      + '(user-döntés, 2026-08-10). Ha ez az ág kiesik, a kitiltott felhasználó '
      + 'automatikusan visszahitelesítené magát.')
      .toBe('pending');
    expect(res.body.ok, 'a pending nem „sikeres" hitelesítés').toBe(false);
    expect(res.body.ai_reason).toMatch(/korábban már volt fiók/i);

    const { rows } = await db.query(
      'SELECT identity_kyc_status FROM users WHERE id = $1', [user.id],
    );
    expect(rows[0].identity_kyc_status,
      'a fiók KYC-státusza sem ugorhat verified-re — az admin dönt')
      .toBe('pending');
  });

  it('ELŐZMÉNY NÉLKÜLI okmánynál a gyors út megmarad (a védelem nem túl széles)', async () => {
    const user = await createUser({ role: 'shipper', kyc: 'pending' });
    await db.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Teszt Shipper', user.id]);
    kycMock(`ZZ${Date.now() % 1000000}${Math.floor(Math.random() * 90) + 10}`);

    const res = await request(app).post('/auth/kyc-document')
      .set(auth(user.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, 'szemelyi.jpg');

    expect(res.body.status,
      'tiszta esetben az automatikus hitelesítés MEGMARAD — ha az előzmény-őr mindenkit '
      + 'emberhez terelne, az admin-teher megsokszorozódna, és a teszt nem bizonyítaná, '
      + 'hogy tényleg az ELŐZMÉNY volt a kiváltó ok')
      .toBe('verified');
  });

  it('ha az admin-értesítés írása elhasal, a KYC-döntés akkor is megszületik', async () => {
    // Admin, akinek szólna az értesítés
    await createUser({ role: 'admin', email: uniqueEmail('kyc-admin') })
      .then((a) => db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [a.id]));
    const user = await createUser({ role: 'shipper', kyc: 'pending' });
    kycMock(null, { valid: false, reason: 'Homályos fotó' });
    const ertesites = elutasitoCsere(notifications, 'createNotification',
      'notifications tábla elérhetetlen');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).post('/auth/kyc-document')
      .set(auth(user.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, 'szemelyi.jpg');
    const kezeletlen = await figyelo.leall();

    expect(res.status, 'a felhasználó dolgát nem akaszthatja meg az admin-értesítés hibája').toBe(200);
    expect(res.body.status).toBe('pending');
    expect(ertesites.length,
      'az értesítés-kísérlet megtörtént (a hiba nem a hívás elmaradása)')
      .toBeGreaterThan(0);
    const { rows } = await db.query(
      `SELECT status FROM kyc_documents WHERE user_id = $1 AND doc_type = 'id_card'`, [user.id],
    );
    expect(rows[0].status,
      'a dokumentum sora a DB-ben is létrejön — enélkül a fotó ÁRVA maradna a privát '
      + 'bucketben (a purge és a fiók-törlés csak a DB-sorból éri el)')
      .toBe('pending');
    expect(kezeletlen,
      'az értesítés-hiba `.catch()`-elve van; enélkül minden ilyen KYC-feltöltés kezeletlen '
      + 'elutasítást hagyna maga után')
      .toEqual([]);
  });
});

// =====================================================================
//  9. ADATEXPORT — az értesítés-hiba nem tarthatja vissza az adatot
// =====================================================================
describe('GET /auth/me/export — az export-értesítés hibája', () => {
  it('ha az „adatexport készült" értesítés nem menthető, az export AKKOR IS kimegy', async () => {
    const user = await createUser({ role: 'shipper' });
    const ertesites = elutasitoCsere(notifications, 'createNotification',
      'notifications tábla elérhetetlen');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).get('/auth/me/export').set(auth(user.token));
    const kezeletlen = await figyelo.leall();

    expect(res.status,
      'a GDPR 20. cikk szerinti adatkiadás JOG — nem függhet attól, hogy sikerült-e '
      + 'egy tájékoztató értesítést elmenteni')
      .toBe(200);
    expect(res.body.profil.id).toBe(user.id);
    expect(res.headers['content-disposition']).toMatch(/gofuvar-adatexport-/);
    expect(ertesites.length,
      'a „valaki letöltötte az adataidat" értesítést MEG KELL kísérelni — ez az egyetlen '
      + 'jel a felhasználónak, ha ellopott tokennel vitték ki a teljes adatdumpját')
      .toBeGreaterThan(0);
    expect(kezeletlen,
      'az értesítés hibája `.catch()`-elve van — enélkül minden export kezeletlen '
      + 'elutasítást hagyna')
      .toEqual([]);
  });
});

// =====================================================================
//  10. FIÓK-TÖRLÉS — a meghiúsult tranzakció nem vihet el fájlokat
// =====================================================================
describe('DELETE /auth/me — meghiúsuló törlési tranzakció', () => {
  it('ha a tranzakció elhasal, a fiók MEGMARAD és a tárolóból SEMMIT nem törlünk', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2',
      ['https://r2.teszt/avatar-nem-torlendo.jpg', user.id]);
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    // Olyan kliens, ami az audit-sor beszúrásán elhasal, ÉS a ROLLBACK-en is.
    const eredetiConnect = db.pool.connect.bind(db.pool);
    vi.spyOn(db.pool, 'connect').mockImplementation((...args) => {
      // ⚠️ A `pool.query()` BELÜL is a connect-et hívja — CALLBACK-kel.
      // Ha azt is Promise-szal válaszolnánk meg, minden sima db.query
      // örökre függve maradna (mérve: 30 mp-es teszt-időtúllépés).
      if (args.length > 0) return eredetiConnect(...args);
      return eredetiConnect().then((valodi) => ({
        query: (sql, params) => {
          if (typeof sql === 'string' && sql.includes('INSERT INTO deleted_accounts')) {
            return Promise.reject(new Error('szimulált séma-hiba (23502)'));
          }
          if (sql === 'ROLLBACK') {
            return valodi.query('ROLLBACK')
              .then(() => Promise.reject(new Error('a ROLLBACK visszajelzése is elveszett')));
          }
          return valodi.query(sql, params);
        },
        release: () => valodi.release(),
      }));
    });

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).delete('/auth/me').set(auth(user.token));
    const kezeletlen = await figyelo.leall();

    expect(res.status,
      'a meghiúsult törlés HIBA — nem szabad sikert hazudni (a felhasználó azt hinné, '
      + 'törölték az adatait)')
      .toBeGreaterThanOrEqual(500);
    const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [user.id]);
    expect(rows.length,
      'a tranzakció visszagördült, tehát a fiók megmaradt')
      .toBe(1);
    expect(torles,
      '⚠️ EZ A LÉNYEG: a fájl-törlés VISSZAFORDÍTHATATLAN, ezért CSAK sikeres commit után '
      + 'futhat. A korábbi sorrend fordított volt: a személyi igazolvány fotóját véglegesen '
      + 'törölte, majd a DELETE elhasalt — a felhasználó „Szerverhibát" kapott, a fiókja '
      + 'megmaradt, az okmánya viszont nem.')
      .not.toHaveBeenCalled();
    expect(kezeletlen,
      'még a ROLLBACK hibája sem hagyhat kezeletlen elutasítást')
      .toEqual([]);
  });
});
