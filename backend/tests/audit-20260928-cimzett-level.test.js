// =====================================================================
//  A CÍMZETTI LEVÉL NEM LEHET MÉRETLEN, SZŰRETLEN, MÁRKÁZOTT RELÉ
//  (2026-09-28, audit P1 — R2-2 + R2-3)
//
//  (a) Minden sikeres `POST /jobs` (és járat-foglalás) a kérésben megadott,
//      MEG NEM ERŐSÍTETT `recipient_email`-re levelet küldött — napi plafon
//      nélkül, a lemondás ingyenes. Egy megerősített fiók percek alatt
//      elégethette a Resend-kvótát, utána a regisztrációs megerősítő és a
//      jelszó-visszaállító levél sem ment ki (a `requireVerifiedEmail` pedig
//      minden új felhasználó írását blokkolta). A lane-alert 1+N szorzót adott.
//  (b) A `recipient_name` csak `trim()`-et kapott: hossz- és kontakt-szűrés
//      nélkül ment a DKIM-aláírt, noreply@gofuvar.hu-s levélbe (a text/plain
//      részben a linkeket a levelező kattinthatóvá teszi) és a publikus
//      követő-oldalra („Szia {név}!"). A PR #147 ezt a `full_name`-re zárta
//      le, a címzett nevére nem — „a védelem azon az úton épült meg, ahol
//      felfedezték".
//
//  Az őr VISELKEDÉST mér (201/400 + ment-e levél), a végén pedig forrás-
//  szinten tartja az osztályt: minden címzett-író út a közös validátoron, és
//  minden feladáskori címzetti levél a közös kereten megy át.
// =====================================================================
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import request from 'supertest';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const emailSzolgaltatas = require('../src/services/email');
const { notifyMatchingAlerts } = require('../src/services/laneAlerts');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const alszik = (ms) => new Promise((r) => setTimeout(r, ms));
async function varakozz(feltetel, ms = 4000) {
  const vege = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await feltetel()) return true;
    if (Date.now() > vege) return false;
    // eslint-disable-next-line no-await-in-loop
    await alszik(30);
  }
}
/** A fire-and-forget levél-ág bevárása NEGATÍV állításhoz (setImmediate + pár DB-kör). */
const agLefutott = () => alszik(600);

function fuvar(mezok = {}) {
  return {
    title: 'Címzettes csomag',
    pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
    weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
    recipient_phone: '+36301112233',
    ...mezok,
  };
}
const egyediCimzett = (elo = 'cimzett') => `${elo}-${crypto.randomBytes(5).toString('hex')}@example.com`;

const ENV_KULCSOK = [
  'RECIPIENT_EMAIL_DAILY_CAP_PER_USER', 'RECIPIENT_EMAIL_DAILY_CAP', 'LANE_ALERT_EMAIL_DAILY_CAP_PER_CARRIER',
  'RESEND_API_KEY',
];
let mentettEnv;
beforeEach(() => {
  mentettEnv = Object.fromEntries(ENV_KULCSOK.map((k) => [k, process.env[k]]));
  __resetRateLimitsForTests();
  // A riasztás-fojtás állapota — a modul a javítással jön létre.
  try { require('../src/services/levelKeret').__resetLevelKeretForTests(); } catch { /* régi kód */ }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(mentettEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function nyitottJarat() {
  const szallito = await createUser({ role: 'carrier' });
  const { rows } = await db.query(
    `INSERT INTO carrier_routes (carrier_id, title, departure_at, status)
     VALUES ($1, 'Teszt járat', NOW() + INTERVAL '1 day', 'open') RETURNING id`,
    [szallito.id],
  );
  await db.query(`INSERT INTO carrier_route_prices (route_id, size, price_huf) VALUES ($1, 'M', 12000)`, [rows[0].id]);
  return rows[0].id;
}
function foglalas(mezok = {}) {
  return {
    length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
    pickup_address: 'Budapest, Teszt utca 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
    recipient_phone: '+36301112233',
    ...mezok,
  };
}

/** A feladó utolsó 24 órás, címzett-e-mailes fuvarjai (seed). */
async function seedCimzettesFuvarok(shipperId, db_, { status = 'cancelled' } = {}) {
  for (let i = 0; i < db_; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const job = await createJob({ shipperId, status });
    // eslint-disable-next-line no-await-in-loop
    await db.query('UPDATE jobs SET recipient_email = $2 WHERE id = $1', [job.id, egyediCimzett('seed')]);
  }
}

// ─────────────────────────────────────────────────────────────────────
describe('1. recipient_name — POST /jobs', () => {
  it('legfeljebb 100 karakter: 101 → 400 RECIPIENT_NAME_TOO_LONG, 100 → 201', async () => {
    const felado = await createUser();
    const hosszu = `Kovács ${'a'.repeat(94)}`; // 101
    expect(hosszu.length).toBe(101);
    const r = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({ recipient_name: hosszu }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('RECIPIENT_NAME_TOO_LONG');

    __resetRateLimitsForTests();
    const ok = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({ recipient_name: hosszu.slice(0, 100) }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('link / e-mail / @handle / üzenetküldő a névben → 400 CONTACT_LEAK', async () => {
    const felado = await createUser();
    for (const nev of [
      'Anna www.csalo-oldal.hu',
      'Anna https://csalo.example/nyeremeny',
      'Anna csalo-oldal.hu',
      'Anna anna@csalo.hu',
      'Anna @anna_fuvar',
      'Anna írj Viberen',
    ]) {
      __resetRateLimitsForTests();
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({ recipient_name: nev }));
      expect(r.status, `"${nev}" átment a szűrőn: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.code, `"${nev}"`).toBe('CONTACT_LEAK');
    }
  });

  it('számjegy a névben (telefonszám, dátum) → 400 NAME_HAS_DIGITS, a regisztráció üzenetével', async () => {
    const felado = await createUser();
    for (const nev of ['Kovács Péter 2', 'Anna 06 30 123 4567', '1988.02.12 Anna']) {
      __resetRateLimitsForTests();
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({ recipient_name: nev }));
      expect(r.status, `"${nev}": ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.code, `"${nev}"`).toBe('NAME_HAS_DIGITS');
      expect(r.body.error).toBe('A név nem tartalmazhat számokat.');
    }
  });

  it('nem-string név és rejtett vezérlő-/irányváltó karakter → 400 RECIPIENT_NAME_INVALID', async () => {
    const felado = await createUser();
    for (const nev of [{ a: 1 }, ['Anna'], true, 'Anna\nKattints a linkre', 'Anna\u202ekcatta', 'An\u200bna',
      // a lágy kötőjel és a U+180E is formázó karakter (\p{Cf}) — a kézi lista kihagyta
      'An\u00adna', 'An\u180ena']) {
      __resetRateLimitsForTests();
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({ recipient_name: nev }));
      expect(r.status, `${JSON.stringify(nev)}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.code, JSON.stringify(nev)).toBe('RECIPIENT_NAME_INVALID');
    }
  });

  it('normál név („Kovács Péter") → 201, trimmelve mentve, és megy a feladáskori levél', async () => {
    const felado = await createUser();
    const kem = vi.spyOn(emailSzolgaltatas, 'sendRecipientTrackingEmail').mockResolvedValue({ stub: true });
    const cimzett = egyediCimzett();
    const r = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ recipient_name: '  Kovács Péter  ', recipient_email: cimzett }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { rows } = await db.query('SELECT recipient_name FROM jobs WHERE id = $1', [r.body.id]);
    expect(rows[0].recipient_name).toBe('Kovács Péter');
    expect(await varakozz(() => kem.mock.calls.some((c) => c[0].to === cimzett))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('2. a foglalási ág ugyanazt a kaput kapja (POST /carrier-routes/:id/bookings)', () => {
  it('név: hossz / kontakt / számjegy; e-mail: formátum — a foglalás eddig MINDENT átengedett', async () => {
    const jaratId = await nyitottJarat();
    const felado = await createUser();
    const esetek = [
      [{ recipient_name: `Kovács ${'a'.repeat(94)}` }, 'RECIPIENT_NAME_TOO_LONG'],
      [{ recipient_name: 'Anna www.csalo-oldal.hu' }, 'CONTACT_LEAK'],
      [{ recipient_name: 'Anna 06 30 123 4567' }, 'NAME_HAS_DIGITS'],
      [{ recipient_name: { a: 1 } }, 'RECIPIENT_NAME_INVALID'],
      [{ recipient_name: 'Kovács Anna', recipient_email: 'nem-email' }, 'RECIPIENT_EMAIL_INVALID'],
      [{ recipient_name: 'Kovács Anna', recipient_phone: 'hívj fel' }, 'RECIPIENT_PHONE_INVALID'],
    ];
    for (const [mezok, kod] of esetek) {
      __resetRateLimitsForTests();
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post(`/carrier-routes/${jaratId}/bookings`).set(auth(felado.token)).send(foglalas(mezok));
      expect(r.status, `${JSON.stringify(mezok)}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.code, JSON.stringify(mezok)).toBe(kod);
    }
    __resetRateLimitsForTests();
    const ok = await request(app).post(`/carrier-routes/${jaratId}/bookings`).set(auth(felado.token))
      .send(foglalas({ recipient_name: 'Kovács Anna', recipient_email: egyediCimzett() }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('3. napi keret a feladáskori címzetti levélre (a Resend-kvóta védelme)', () => {
  it('alapértékek: 10 / feladó / 24 h, 60 / platform / 24 h, 20 lane-alert / szállító / 24 h; üres/hibás env → alap', () => {
    const { keretek } = require('../src/services/levelKeret');
    for (const k of ENV_KULCSOK.slice(0, 3)) delete process.env[k];
    expect(keretek()).toEqual({ cimzettFeladonkent: 10, cimzettPlatform: 60, laneAlertSzallitonkent: 20 });
    process.env.RECIPIENT_EMAIL_DAILY_CAP_PER_USER = '';
    process.env.RECIPIENT_EMAIL_DAILY_CAP = 'abc';
    process.env.LANE_ALERT_EMAIL_DAILY_CAP_PER_CARRIER = '-3';
    expect(keretek()).toEqual({ cimzettFeladonkent: 10, cimzettPlatform: 60, laneAlertSzallitonkent: 20 });
    process.env.RECIPIENT_EMAIL_DAILY_CAP_PER_USER = '3';
    process.env.RECIPIENT_EMAIL_DAILY_CAP = '0';
    expect(keretek()).toMatchObject({ cimzettFeladonkent: 3, cimzettPlatform: 0 });
  });

  it('a feladó 11. címzettes fuvarja 24 órán belül: 201, de a címzett NEM kap levelet (a lemondás nem szabadít fel)', async () => {
    delete process.env.RECIPIENT_EMAIL_DAILY_CAP_PER_USER; // az alapérték (10) él
    process.env.RECIPIENT_EMAIL_DAILY_CAP = '1000000';
    const felado = await createUser();
    await seedCimzettesFuvarok(felado.id, 9); // lemondottak — a keretbe beszámítanak
    const kem = vi.spyOn(emailSzolgaltatas, 'sendRecipientTrackingEmail').mockResolvedValue({ stub: true });

    const tizedik = egyediCimzett('tizedik');
    const r10 = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ recipient_name: 'Kovács Péter', recipient_email: tizedik }));
    expect(r10.status, JSON.stringify(r10.body)).toBe(201);
    expect(await varakozz(() => kem.mock.calls.some((c) => c[0].to === tizedik)), 'a 10. (kereten belüli) levél nem ment ki').toBe(true);

    __resetRateLimitsForTests();
    const tizenegyedik = egyediCimzett('tizenegyedik');
    const r11 = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ recipient_name: 'Kovács Péter', recipient_email: tizenegyedik }));
    expect(r11.status, 'a fuvar a keret felett is létrejön').toBe(201);
    expect(r11.body.recipient_email, 'a válasz változatlan').toBe(tizenegyedik);
    await agLefutott();
    expect(
      kem.mock.calls.filter((c) => c[0].to === tizenegyedik).length,
      'a 11. címzettes fuvar is levelet küldött — a feladó korlátlanul égetheti a Resend-kvótát',
    ).toBe(0);
  });

  it('a feladónkénti keret a fuvar- ÉS a foglalási ágat együtt számolja', async () => {
    delete process.env.RECIPIENT_EMAIL_DAILY_CAP_PER_USER;
    process.env.RECIPIENT_EMAIL_DAILY_CAP = '1000000';
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'cancelled' });
      // eslint-disable-next-line no-await-in-loop
      await db.query('UPDATE route_bookings SET recipient_email = $2 WHERE id = $1', [booking.id, egyediCimzett('seedb')]);
    }
    const kem = vi.spyOn(emailSzolgaltatas, 'sendRecipientTrackingEmail').mockResolvedValue({ stub: true });

    const fuvarCimzett = egyediCimzett('fuvar');
    const r1 = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ recipient_name: 'Kovács Péter', recipient_email: fuvarCimzett }));
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);

    __resetRateLimitsForTests();
    const jaratId = await nyitottJarat();
    const foglalasCimzett = egyediCimzett('foglalas');
    const r2 = await request(app).post(`/carrier-routes/${jaratId}/bookings`).set(auth(felado.token))
      .send(foglalas({ recipient_name: 'Kovács Anna', recipient_email: foglalasCimzett }));
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);

    await agLefutott();
    expect(kem.mock.calls.filter((c) => c[0].to === fuvarCimzett).length, 'fuvar-ág: keret felett is ment levél').toBe(0);
    expect(kem.mock.calls.filter((c) => c[0].to === foglalasCimzett).length, 'foglalási ág: keret nélkül ment levél').toBe(0);
  });

  it('platform-szintű keret: felette a levél kimarad, és óránként legfeljebb EGY Sentry-figyelmeztetés megy', async () => {
    process.env.RECIPIENT_EMAIL_DAILY_CAP_PER_USER = '1000000';
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*) FROM jobs WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours')
            + (SELECT COUNT(*) FROM route_bookings WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours') AS db`,
    );
    process.env.RECIPIENT_EMAIL_DAILY_CAP = String(Number(rows[0].db) + 1);
    const kem = vi.spyOn(emailSzolgaltatas, 'sendRecipientTrackingEmail').mockResolvedValue({ stub: true });
    const riasztas = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');

    const cimzettek = [egyediCimzett('p1'), egyediCimzett('p2'), egyediCimzett('p3')];
    for (const c of cimzettek) {
      __resetRateLimitsForTests();
      // eslint-disable-next-line no-await-in-loop
      const felado = await createUser();
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ recipient_name: 'Kovács Péter', recipient_email: c }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      // eslint-disable-next-line no-await-in-loop
      await agLefutott();
    }
    expect(kem.mock.calls.filter((c) => c[0].to === cimzettek[0]).length, 'a kereten belüli levél nem ment ki').toBe(1);
    expect(kem.mock.calls.filter((c) => c[0].to === cimzettek[1]).length, 'platform-keret felett is ment levél').toBe(0);
    expect(kem.mock.calls.filter((c) => c[0].to === cimzettek[2]).length, 'platform-keret felett is ment levél').toBe(0);
    const figyelmeztetesek = riasztas.mock.calls.filter((c) => /címzett/i.test(String(c[0])));
    expect(figyelmeztetesek.length, 'a platform-keret átlépéséről nincs (vagy fojtatlanul több) Sentry-jelzés').toBe(1);
    expect(figyelmeztetesek[0][1]?.level).toBe('warning');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('4. lane-alert: szállítónként napi e-mail-plafon (az in-app értesítés marad)', () => {
  const RESEND_URL = 'https://api.resend.com/emails';
  async function figyeloSzallito(korabbiRiasztasok) {
    const szallito = await createUser({ role: 'carrier' });
    await db.query(
      `INSERT INTO carrier_alerts (carrier_id, label, from_lat, from_lng, radius_km, active)
       VALUES ($1, 'keret-teszt', 47.4979, 19.0402, 25, TRUE)`,
      [szallito.id],
    );
    for (let i = 0; i < korabbiRiasztasok; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO notifications (user_id, type, title, created_at) VALUES ($1, 'lane_alert', 'régi', NOW() - INTERVAL '1 hour')`,
        [szallito.id],
      );
    }
    return szallito;
  }

  it('a 21. lane-alert 24 órán belül: in-app megy, e-mail NEM; 20. még e-mailt kap', async () => {
    delete process.env.LANE_ALERT_EMAIL_DAILY_CAP_PER_CARRIER;
    process.env.RESEND_API_KEY = 'teszt-hamis-resend-kulcs-nem-eles';
    const levelek = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      let body = {};
      try { body = JSON.parse(opts?.body || '{}'); } catch { /* nem JSON */ }
      levelek.push({ url: String(url), body });
      return { ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '' };
    });
    const felado = await createUser();
    const betelt = await figyeloSzallito(20);
    const kontroll = await figyeloSzallito(19);

    await notifyMatchingAlerts({
      id: crypto.randomUUID(), shipper_id: felado.id, title: 'Kanapé',
      pickup_lat: 47.4979, pickup_lng: 19.0402, dropoff_lat: 46.253, dropoff_lng: 20.1414,
      pickup_address: 'Budapest, Váci út 1, 1132', dropoff_address: 'Szeged, Kossuth Lajos sugárút 12, 6722',
      suggested_price_huf: 25000, weight_kg: null,
    });
    const levelNeki = (u) => levelek.filter((l) => l.url === RESEND_URL && (l.body.to || []).includes(u.email));
    expect(await varakozz(() => levelNeki(kontroll).length > 0), 'a kereten belüli (20.) lane-alert e-mail nem ment ki').toBe(true);
    await agLefutott();
    expect(levelNeki(betelt).length, 'a napi 20 feletti lane-alert is e-mailt küldött').toBe(0);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db FROM notifications WHERE user_id = $1 AND type = 'lane_alert'`, [betelt.id],
    );
    expect(rows[0].db, 'az in-app értesítésnek a keret felett is meg kell jelennie').toBe(21);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('5. osztály-őr: minden címzett-író út és minden feladáskori címzetti levél a közös kapun', () => {
  const SRC = path.join(__dirname, '..', 'src');
  const kodKomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  function fajlok(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
      e.isDirectory() ? fajlok(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])
    ));
  }

  it('aki sendRecipientTrackingEmail-t hív, az előbb a cimzettiLevelMehet keretet kérdezi', () => {
    const hivok = fajlok(SRC)
      .filter((f) => !f.endsWith(path.join('services', 'email.js')))
      .map((f) => [path.relative(SRC, f), kodKomment(fs.readFileSync(f, 'utf8'))])
      .filter(([, kod]) => /sendRecipientTrackingEmail\s*\(/.test(kod));
    expect(hivok.length, 'a mérés vak: egyetlen hívót sem talált').toBeGreaterThan(0);
    for (const [nev, kod] of hivok) {
      expect(/cimzettiLevelMehet\s*\(/.test(kod), `${nev}: napi keret nélkül küld címzetti levelet`).toBe(true);
    }
  });

  it('minden route, ami recipient_name-et ír (INSERT/UPDATE), az ellenorizCimzett validátort hívja', () => {
    const irok = fajlok(path.join(SRC, 'routes'))
      .map((f) => [path.relative(SRC, f), kodKomment(fs.readFileSync(f, 'utf8'))])
      .filter(([, kod]) => (kod.match(/`[^`]*`/g) || [])
        .some((sql) => /recipient_name/.test(sql) && /\bINSERT\s+INTO\b|\bSET\b/i.test(sql)
          && !/\bSELECT\b/i.test(sql.split(/recipient_name/)[0].slice(-400))));
    expect(irok.map(([n]) => n).sort(), 'a mérés vak: a két ismert író út nincs meg').toEqual(
      expect.arrayContaining([path.join('routes', 'jobs.js'), path.join('routes', 'carrierRoutes.js')]),
    );
    for (const [nev, kod] of irok) {
      expect(/ellenorizCimzett\s*\(/.test(kod), `${nev}: a címzett nevét validálatlanul írja`).toBe(true);
    }
  });
});
