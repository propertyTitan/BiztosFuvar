// =====================================================================
//  ÉLŐ GPS-KÖVETÉS: KAPUK ÉS HIBAÁGAK (2026-08-12)
//
//  ⚠️ 40%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT. A modul ma „alszik" (élő pozíció
//  csak a mobil-fázisban lesz), de a VÉGPONTJAI ÉLNEK — és pontosan ez a
//  minta okozta a mentős-kaput is: a felületről kikapcsolt funkció végpontjai
//  védtelenül futottak.
//
//  Amit ez a fájl őriz:
//   1. POZÍCIÓT CSAK A KIJELÖLT SZÁLLÍTÓ KÜLDHET. Nem a feladó, nem egy másik
//      szállító, nem egy kívülálló — a helyadat a legérzékenyebb adatunk.
//   2. LEZÁRT FUVARRA NINCS POZÍCIÓ (2026-08-07, GDPR-adattakarékosság):
//      kézbesített és LEMONDOTT fuvarhoz sem gyűjtünk élő helyadatot.
//   3. A KÖZELSÉG-ÉRTESÍTÉS A FELADÓNAK MEGY, és csak akkor, ha a csomag
//      tényleg úton van (in_progress) — nem a megállapodás után.
//   4. A CÍMZETTNEK KÜLDÖTT LEVÉL ESCAPE-EL: a szállító a saját NEVÉBE tett
//      linkkel nem küldethet GoFuvar-arculatú levelet (2026-08-10 audit).
//   5. Az élő pozíciót csak a fuvar fele kérdezheti le (IDOR).
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');
const emailSzolgaltatas = require('../src/services/email');
const realtime = require('../src/realtime');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// A célpont (a helper dropoff koordinátája: Szeged)
const CEL = { lat: 46.2530, lng: 20.1414 };
// ~2 km-re a céltól: benne van az 5 km-es körben, de a 300 m-esben nincs.
const KOZEL_2KM = { lat: 46.2710, lng: 20.1414 };
// ~180 km-re (Budapest)
const TAVOL = { lat: 47.4979, lng: 19.0402 };

let levelek;
beforeEach(() => {
  levelek = [];
  // A címzetti leveleket elkapjuk (a route lazy require-ral, hívás közben
  // destrukturál a modul-objektumból → a spy tényleg érvényesül).
  vi.spyOn(emailSzolgaltatas, 'sendEmail').mockImplementation(async (opts) => {
    levelek.push(opts);
    return { stub: true };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

/** Fire-and-forget ágra vár: a feltétel teljesüléséig pollozunk. */
async function varakozz(feltetel, ms = 4000) {
  const vege = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await feltetel()) return true;
    if (Date.now() > vege) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 40));
  }
}

const ertesitesekSzama = async (userId, tipus) => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2',
    [userId, tipus],
  );
  return rows[0].n;
};

/** Szereplők + egy fuvar a kívánt állapotban. */
async function felallas({ status = 'in_progress', paid = true, ...tobbi } = {}) {
  const shipper = await createUser({ role: 'shipper' });
  const carrier = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: shipper.id, carrierId: carrier.id, status, paid, ...tobbi,
  });
  return { shipper, carrier, job };
}

const ping = (jobId, token, body) => request(app)
  .post(`/jobs/${jobId}/location`).set(auth(token)).send(body);

// =====================================================================
//  1) KI KÜLDHET POZÍCIÓT
// =====================================================================
describe('Pozíció-küldés jogosultsága', () => {
  it('a FELADÓ nem küldhet pozíciót a saját fuvarján', async () => {
    const { shipper, job } = await felallas();
    const r = await ping(job.id, shipper.token, CEL);
    expect(
      r.status,
      'a feladó pozíciót írhatott a saját fuvarjára — a követő-oldal így hamis '
      + 'helyadatot mutatna, és bárki „mozgathatná" a szállítót',
    ).toBe(403);

    const { rows } = await db.query('SELECT count(*)::int n FROM location_pings WHERE job_id=$1', [job.id]);
    expect(rows[0].n, 'a 403 ellenére bekerült a ping a naplóba').toBe(0);
  });

  it('IDEGEN szállító nem küldhet pozíciót', async () => {
    const { job } = await felallas();
    const idegen = await createUser({ role: 'carrier' });
    expect(
      (await ping(job.id, idegen.token, CEL)).status,
      'egy idegen szállító írhatott a fuvar helyadat-naplójába (IDOR)',
    ).toBe(403);
  });

  it('nem létező fuvarra 404 (nem 403, nem 500)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const r = await ping('00000000-0000-0000-0000-000000000000', carrier.token, CEL);
    expect(r.status).toBe(404);
  });

  it('szállító nélküli (nyitott) fuvarra senki nem küldhet pozíciót', async () => {
    const shipper = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: null, status: 'bidding' });
    expect(
      (await ping(job.id, carrier.token, CEL)).status,
      'egy nyitott (még el nem vállalt) fuvarhoz bármelyik szállító küldhetett '
      + 'pozíciót — a feladó azt hinné, hogy már úton van a csomagja',
    ).toBe(403);
  });

  it('token nélkül nincs pozíció-küldés', async () => {
    const { job } = await felallas();
    expect((await request(app).post(`/jobs/${job.id}/location`).send(CEL)).status).toBe(401);
  });
});

// =====================================================================
//  2) ÁLLAPOT-KAPU — lezárt fuvarhoz nem gyűjtünk helyadatot
// =====================================================================
describe('Lezárt fuvarra nincs pozíció (GDPR-adattakarékosság)', () => {
  for (const status of ['delivered', 'completed', 'cancelled']) {
    it(`"${status}" státuszban 409 JOB_CLOSED, és semmi nem kerül a naplóba`, async () => {
      const { carrier, job } = await felallas({ status });
      const r = await ping(job.id, carrier.token, CEL);
      expect(
        r.status,
        `a(z) "${status}" fuvarhoz elfogadtunk élő helyadatot. A LEMONDOTT `
        + 'fuvarnál ez különösen rossz: olyan ügylethez gyűjtünk GPS-t, ami már '
        + 'nem létezik (2026-08-07, a teljes-út mátrix találata).',
      ).toBe(409);
      expect(r.body.code, 'a hívó nem tudja gépi kóddal megkülönböztetni a lezárt fuvart').toBe('JOB_CLOSED');

      const { rows } = await db.query('SELECT count(*)::int n FROM location_pings WHERE job_id=$1', [job.id]);
      expect(rows[0].n, 'a 409 ellenére eltároltuk a helyadatot').toBe(0);
    });
  }

  it('aktív (accepted / in_progress) fuvarnál viszont átmegy', async () => {
    for (const status of ['accepted', 'in_progress']) {
      // eslint-disable-next-line no-await-in-loop
      const { carrier, job } = await felallas({ status });
      // eslint-disable-next-line no-await-in-loop
      const r = await ping(job.id, carrier.token, CEL);
      expect(r.status, `a(z) "${status}" élő fuvarnál elutasítottuk a pozíciót`).toBe(200);
    }
  });
});

// =====================================================================
//  3) A PING ADATTARTALMA
// =====================================================================
describe('A ping tárolása és szétosztása', () => {
  it('a koordináta és a sebesség pontosan úgy kerül a naplóba, ahogy érkezett', async () => {
    const { carrier, job } = await felallas();
    await ping(job.id, carrier.token, { lat: 46.25301, lng: 20.14142, speed_kmh: 51.5 });

    const { rows } = await db.query(
      'SELECT lat, lng, speed_kmh FROM location_pings WHERE job_id=$1', [job.id],
    );
    expect(rows.length, 'nem keletkezett ping-sor').toBe(1);
    expect(Number(rows[0].lat)).toBeCloseTo(46.25301, 5);
    expect(Number(rows[0].lng)).toBeCloseTo(20.14142, 5);
    expect(Number(rows[0].speed_kmh), 'a sebesség elveszett vagy elcsúszott').toBeCloseTo(51.5, 2);
  });

  it('sebesség nélkül is átmegy (a mező opcionális)', async () => {
    const { carrier, job } = await felallas();
    expect((await ping(job.id, carrier.token, CEL)).status).toBe(200);
    const { rows } = await db.query('SELECT speed_kmh FROM location_pings WHERE job_id=$1', [job.id]);
    expect(rows[0].speed_kmh, 'hiányzó sebességből nem NULL lett').toBeNull();
  });

  it('a 0,0 koordináta ÉRVÉNYES (a hiány-ellenőrzés nem „falsy"-alapú)', async () => {
    const { carrier, job } = await felallas();
    expect(
      (await ping(job.id, carrier.token, { lat: 0, lng: 0 })).status,
      'a 0 koordinátát hiányzónak vettük. Ez a klasszikus `if (!lat)` hiba: '
      + 'egy `== null` helyett írt falsy-ellenőrzés az Egyenlítőn/kezdő '
      + 'délkörön mozgó szállítót némán kizárná.',
    ).toBe(200);
  });

  it('hiányzó koordinátára 400, és a hívás meg sem érinti az adatbázist', async () => {
    const { carrier, job } = await felallas();
    for (const body of [{}, { lat: 46.25 }, { lng: 20.14 }, { lat: null, lng: null }]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ping(job.id, carrier.token, body);
      expect(r.status, `a(z) ${JSON.stringify(body)} testre nem 400 jött`).toBe(400);
    }
    const { rows } = await db.query('SELECT count(*)::int n FROM location_pings WHERE job_id=$1', [job.id]);
    expect(rows[0].n).toBe(0);
  });

  it('szemét koordináta/sebesség 400-at ad, SOHA nem 500-at', async () => {
    const { carrier, job } = await felallas();
    const szemet = [
      { lat: 'abc', lng: 'def' },
      { lat: {}, lng: [] },
      { lat: true, lng: false },
      { lat: 46.25, lng: 20.14, speed_kmh: 'gyors' },
      { lat: 46.25, lng: 20.14, speed_kmh: 1e9 },   // NUMERIC(6,2) túlcsordulás
    ];
    for (const body of szemet) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ping(job.id, carrier.token, body);
      expect(
        r.status,
        `a(z) ${JSON.stringify(body)} testre ${r.status} jött. Egy 500 itt `
        + 'hamis Sentry-riasztást szülne minden hibás mobil-kérésnél (SZ1 szabály).',
      ).toBeLessThan(500);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('az utolsó ismert pozíció a felhasználón is frissül (backhaul-párosításhoz)', async () => {
    const { carrier, job } = await felallas();
    await ping(job.id, carrier.token, { lat: 46.111, lng: 20.222 });
    const megvan = await varakozz(async () => {
      const { rows } = await db.query('SELECT last_known_lat, last_ping_at FROM users WHERE id=$1', [carrier.id]);
      return rows[0].last_known_lat !== null && rows[0].last_ping_at !== null;
    });
    expect(
      megvan,
      'a szállító utolsó ismert pozíciója nem frissült — a visszafuvar-ajánlás '
      + 'és az azonnali fuvar közelség-párosítása elavult helyre épülne',
    ).toBe(true);
  });

  it('a pozíció a FUVAR szobájába megy, nem globálisan', async () => {
    const { carrier, job } = await felallas();
    const szobak = [];
    vi.spyOn(realtime, 'emitToJob').mockImplementation((id, esemeny, payload) => {
      szobak.push({ id, esemeny, payload });
    });
    await ping(job.id, carrier.token, { lat: 46.3, lng: 20.1, speed_kmh: 40 });

    expect(szobak.length, 'nem ment ki élő pozíció-esemény').toBe(1);
    expect(
      szobak[0].id,
      'a pozíció nem a fuvar szobájába ment — élő GPS-t kaphatna olyan, akinek '
      + 'semmi köze a fuvarhoz (a piactér-feed szivárgás osztálya)',
    ).toBe(job.id);
    expect(szobak[0].esemeny).toBe('tracking:ping');
    expect(szobak[0].payload.lat).toBe(46.3);
  });
});

// =====================================================================
//  4) KÖZELSÉG-ÉRTESÍTÉS
// =====================================================================
describe('Közelség-értesítés (5 km / 300 m)', () => {
  it('5 km-en belül a FELADÓ kap értesítést, a szállító nem', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, KOZEL_2KM);

    expect(
      await varakozz(async () => (await ertesitesekSzama(shipper.id, 'driver_entering_city')) === 1),
      'a feladó NEM kapott értesítést arról, hogy a szállító beért a városba — '
      + 'ez a követés egyetlen felhasználó felé látszó haszna',
    ).toBe(true);
    expect(
      await ertesitesekSzama(carrier.id, 'driver_entering_city'),
      'a SZÁLLÍTÓ is kapott értesítést a saját érkezéséről (fölösleges zaj)',
    ).toBe(0);
    expect(
      await ertesitesekSzama(shipper.id, 'driver_nearby'),
      '2 km-ről már a „egy saroknyira van" értesítés is elment — a 300 m-es '
      + 'küszöb elcsúszott, és a feladó túl korán készül az átvételre',
    ).toBe(0);

    const { rows } = await db.query('SELECT notif_city_sent FROM jobs WHERE id=$1', [job.id]);
    expect(rows[0].notif_city_sent, 'a „város-értesítés elment" jelző nem állt be').toBe(true);
  });

  it('300 m-en belül MINDKÉT értesítés elmegy', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, CEL);
    expect(
      await varakozz(async () => (await ertesitesekSzama(shipper.id, 'driver_nearby')) === 1),
      'a szállító a kapuban van, de a feladó nem kapott „egy saroknyira" jelzést',
    ).toBe(true);
    expect(await ertesitesekSzama(shipper.id, 'driver_entering_city')).toBe(1);
  });

  it('ugyanaz a küszöb nem riaszt kétszer (ismételt pingek)', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, KOZEL_2KM);
    await varakozz(async () => (await ertesitesekSzama(shipper.id, 'driver_entering_city')) === 1);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ping(job.id, carrier.token, KOZEL_2KM);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 120));
    }
    expect(
      await ertesitesekSzama(shipper.id, 'driver_entering_city'),
      'MINDEN ping újraküldte a „beért a városba" értesítést. A szállító '
      + '15 másodpercenként pingel — a feladó percek alatt tucatnyi push-t kapna.',
    ).toBe(1);
  });

  it('távoli pozíció nem riaszt', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, TAVOL);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await ertesitesekSzama(shipper.id, 'driver_entering_city'),
      '180 km-ről is „megérkezett" értesítést küldtünk — a távolság-számítás '
      + 'vagy a küszöb elromlott',
    ).toBe(0);
  });

  it('„accepted" (még el sem indult) fuvarnál nincs érkezés-értesítés', async () => {
    const { shipper, carrier, job } = await felallas({ status: 'accepted' });
    await ping(job.id, carrier.token, CEL);
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await ertesitesekSzama(shipper.id, 'driver_entering_city'),
      'a csomag még FEL SEM VOLT VÉVE (accepted), mégis azt üzentük a feladónak, '
      + 'hogy „hamarosan nálad a csomag" — a szállító csak arra járt',
    ).toBe(0);
    expect(levelek, 'ilyenkor a címzettnek is kiment levél').toEqual([]);
  });

  it('az értesítési ág hibája nem rántja magával a folyamatot', async () => {
    // A közelség-blokk `setImmediate`-ben, a válasz UTÁN fut. Egy ott dobott,
    // el nem kapott hiba KEZELETLEN PROMISE-ELUTASÍTÁS lenne — Node 15 óta ez
    // alapból megöli a process-t, vagyis egyetlen hibás értesítés az EGÉSZ
    // backendet újraindítaná.
    const { carrier, job } = await felallas();
    vi.spyOn(realtime, 'emitToUser').mockImplementation(() => {
      throw new Error('socket-réteg szétesett');
    });
    const kezeletlen = [];
    const figyelo = (e) => kezeletlen.push(e);
    process.on('unhandledRejection', figyelo);
    try {
      const r = await ping(job.id, carrier.token, CEL);
      expect(r.status, 'az értesítési hiba magát a pozíció-küldést is elvitte').toBe(200);
      await new Promise((res) => setTimeout(res, 300));
      expect(
        kezeletlen,
        'AZ ÉRTESÍTÉSI ÁG HIBÁJA KEZELETLEN PROMISE-ELUTASÍTÁSSÁ VÁLT. '
        + 'Ez élesben a teljes backend-process újraindítását jelentené — '
        + 'egyetlen hibás push miatt.',
      ).toEqual([]);
    } finally {
      process.off('unhandledRejection', figyelo);
    }
  });

  it('az értesítés a cím TELEPÜLÉS-részét nevezi meg, nem a teljes címet', async () => {
    // A magyar Google-formátum („Város, Utca hsz.") és a vessző nélküli alak is.
    for (const [cim, vartVaros] of [
      ['Szeged, Teszt tér 2.', 'Szeged'],
      ['Debrecen', 'Debrecen'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { shipper, carrier, job } = await felallas({ dropoffAddress: cim });
      // eslint-disable-next-line no-await-in-loop
      await ping(job.id, carrier.token, KOZEL_2KM);
      // eslint-disable-next-line no-await-in-loop
      const megvan = await varakozz(async () => (await ertesitesekSzama(shipper.id, 'driver_entering_city')) === 1);
      expect(megvan, `nem érkezett értesítés a(z) "${cim}" címhez`).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await db.query(
        `SELECT body FROM notifications WHERE user_id=$1 AND type='driver_entering_city'`, [shipper.id],
      );
      expect(
        rows[0].body,
        `a(z) "${cim}" címből nem a település neve került az értesítésbe — a `
        + 'feladó egy utcanevet vagy egy irányítószámot látna „városként"',
      ).toContain(`${vartVaros} városba`);
    }
  });
});

// =====================================================================
//  5) A CÍMZETTNEK KÜLDÖTT LEVÉL
// =====================================================================
describe('Címzetti értesítő levél', () => {
  it('a szállító NEVE escape-elve kerül a levélbe (HTML-injektálás ellen)', async () => {
    const { carrier, job } = await felallas();
    // Telefonszám nélküli szállító: a levélben ne maradjon üres „tel:" link.
    await db.query(
      `UPDATE users SET full_name = $2, phone = NULL WHERE id = $1`,
      [carrier.id, '<a href="https://csalo.example">Kattints ide a fizetéshez</a>'],
    );
    await db.query(`UPDATE jobs SET recipient_email = 'cimzett@teszt.gofuvar.hu' WHERE id = $1`, [job.id]);

    await ping(job.id, carrier.token, KOZEL_2KM);
    expect(await varakozz(async () => levelek.length > 0)).toBe(true);

    const html = levelek[0].html;
    expect(
      html,
      'telefonszám nélküli szállítónál üres/„null" tel: link került a levélbe',
    ).not.toMatch(/tel:(""|null|undefined|")/);
    expect(
      html,
      'A SZÁLLÍTÓ NEVÉBE ÍRT HTML NYERSEN BEKERÜLT A LEVÉLBE.\n\n'
      + 'Egy szállító a profilneve átírásával kattintható phishing-linket '
      + 'tehetne egy noreply@gofuvar.hu-ról érkező, GoFuvar-arculatú levélbe, '
      + 'amit a CÍMZETT kap — aki nem is felhasználónk (2026-08-10 audit).',
    ).not.toContain('<a href="https://csalo.example">');
    expect(html, 'az escape-elt alak nem jelent meg').toContain('&lt;a href=');
  });

  it('a levél a címzettnek szól: átvételi kód + követő link + GDPR-tájékoztató', async () => {
    const { carrier, job } = await felallas({ deliveryCode: '987654' });
    await db.query(`UPDATE jobs SET recipient_email = 'cimzett@teszt.gofuvar.hu' WHERE id = $1`, [job.id]);

    await ping(job.id, carrier.token, CEL);
    expect(await varakozz(async () => levelek.length >= 2)).toBe(true);

    const sarok = levelek.find((l) => /saroknyira/.test(l.subject || ''));
    const varos = levelek.find((l) => /megérkezik/.test(l.subject || ''));
    expect(sarok, 'a „egy saroknyira van" levél nem ment ki').toBeTruthy();
    expect(varos, 'a „beért a városba" levél nem ment ki').toBeTruthy();

    expect(
      sarok.html,
      'az átvételi kód hiányzik a levélből — a címzett nem tudja átvenni a '
      + 'csomagot, a szállító nem tudja lezárni a fuvart',
    ).toContain('987654');
    expect(
      varos.html,
      'a követő link hiányzik a levélből — a címzettnek nincs fiókja, ez az '
      + 'EGYETLEN útja megnézni, hol tart a csomagja',
    ).toContain(job.tracking_token);
    for (const [mi, level] of [['saroknyira', sarok], ['városba érés', varos]]) {
      expect(
        level.html,
        `a CÍMZETTNEK szóló "${mi}" levélből hiányzik a GDPR 14. cikk szerinti `
        + 'tájékoztatás (adatkezelő + honnan van az adata) — ő nem felhasználónk, '
        + 'tőle sosem kaptunk hozzájárulást. Ez az a hibaminta, amit a 2026-08-11-i '
        + 'kör „egy úton javítottuk, a többin nem" néven nevesített.',
      ).toMatch(/Tiszta Hód Kft/);
    }
  });

  it('e-mail-cím nélküli címzettnek nem küldünk levelet (csak telefonszáma van)', async () => {
    const { carrier, job } = await felallas();
    await db.query(`UPDATE jobs SET recipient_email = NULL WHERE id = $1`, [job.id]);
    await ping(job.id, carrier.token, CEL);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      levelek,
      'e-mail-cím nélkül is próbáltunk levelet küldeni — a Resend hibát adna, '
      + 'és minden ilyen fuvar hamis riasztást szülne',
    ).toEqual([]);
  });

  it('HIÁNYOS adatoknál sem kerül „undefined"/„null" a felhasználó elé', async () => {
    // A legszegényebb eset: nincs címzett-elérhetőség, nincs használható
    // cím-szöveg, és a szállítónak nincs kitöltött neve.
    const { shipper, carrier, job } = await felallas({ dropoffAddress: '' });
    await db.query(
      `UPDATE jobs SET recipient_email = NULL, recipient_phone = NULL, recipient_name = NULL WHERE id = $1`,
      [job.id],
    );
    await db.query(`UPDATE users SET full_name = '', phone = NULL WHERE id = $1`, [carrier.id]);

    const r = await ping(job.id, carrier.token, CEL);
    expect(r.status, 'hiányos adatoknál elszállt a pozíció-küldés').toBe(200);

    expect(
      await varakozz(async () => (await ertesitesekSzama(shipper.id, 'driver_entering_city')) === 1),
      'hiányos adatoknál elmaradt az értesítés',
    ).toBe(true);

    const { rows } = await db.query(
      `SELECT title, body FROM notifications WHERE user_id=$1 AND type='driver_entering_city'`, [shipper.id],
    );
    const szoveg = `${rows[0].title} ${rows[0].body}`;
    expect(
      szoveg,
      'A FELHASZNÁLÓNAK MEGJELENŐ ÉRTESÍTÉSBE „undefined"/„null" KERÜLT. '
      + 'Ez a leggyakoribb „amatőr" hibajel a felületen — üres cím esetén '
      + 'általános megfogalmazás kell („a célvárosba").',
    ).not.toMatch(/undefined|null/i);
    expect(szoveg, 'üres címnél nem az általános megfogalmazás jelent meg').toContain('a célvárosba');

    expect(levelek, 'elérhetőség nélküli címzettnek is próbáltunk levelet küldeni').toEqual([]);
  });
});

// =====================================================================
//  6) AZ UTOLSÓ POZÍCIÓ LEKÉRDEZÉSE (IDOR)
// =====================================================================
describe('GET /jobs/:id/location/last', () => {
  const utolso = (jobId, token) => request(app)
    .get(`/jobs/${jobId}/location/last`).set(auth(token));

  it('kívülálló nem láthatja a szállító élő pozícióját', async () => {
    const { carrier, job } = await felallas();
    await ping(job.id, carrier.token, CEL);
    const idegen = await createUser({ role: 'shipper' });
    expect(
      (await utolso(job.id, idegen.token)).status,
      'BÁRKI LEKÉRDEZHETTE A SZÁLLÍTÓ ÉLŐ POZÍCIÓJÁT egy fuvar-azonosító '
      + 'ismeretében — ez a legérzékenyebb adatunk (IDOR)',
    ).toBe(403);
  });

  it('a fuvar mindkét fele lekérdezheti', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, { lat: 46.5, lng: 20.5, speed_kmh: 33 });
    for (const [ki, token] of [['feladó', shipper.token], ['szállító', carrier.token]]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await utolso(job.id, token);
      expect(r.status, `a(z) ${ki} nem érte el a saját fuvarja pozícióját`).toBe(200);
      expect(Number(r.body.lat)).toBeCloseTo(46.5, 4);
    }
  });

  it('mindig a LEGUTOLSÓ pozíciót adja vissza', async () => {
    const { shipper, carrier, job } = await felallas();
    await ping(job.id, carrier.token, { lat: 47.0, lng: 19.0 });
    await new Promise((r) => setTimeout(r, 30));
    await ping(job.id, carrier.token, { lat: 46.5, lng: 20.5 });

    const r = await utolso(job.id, shipper.token);
    expect(
      Number(r.body.lat),
      'nem a legfrissebb pozíciót kaptuk — a követő-oldal egy régi helyen '
      + 'mutatná a szállítót',
    ).toBeCloseTo(46.5, 4);
  });

  it('ping nélkül null-t ad (nem 404-et, nem üres objektumot)', async () => {
    const { shipper, job } = await felallas();
    const r = await utolso(job.id, shipper.token);
    expect(r.status).toBe(200);
    expect(r.body, 'ping nélküli fuvarnál nem null jött vissza — a frontend a '
      + 'null-ból tudja, hogy nincs mit rajzolni a térképre').toBeNull();
  });

  it('nem létező fuvarra 404', async () => {
    const u = await createUser({ role: 'shipper' });
    expect((await utolso('00000000-0000-0000-0000-000000000000', u.token)).status).toBe(404);
  });
});
