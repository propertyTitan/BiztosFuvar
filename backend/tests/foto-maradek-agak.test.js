// =====================================================================
//  FOTÓ-BIZONYÍTÉK — a `foto-hibaagak.test.js` UTÁN MARADT ágak
//
//  A meglévő készlet a FUVAR-ágat járja körbe alaposan (fájl-kapuk, kód,
//  zárolás, vita, GPS, listák). Ez a fájl azt fedi le, ami utána maradt —
//  és a maradék nagy része UGYANANNAK A MINTÁNAK a példája, ami ebben a
//  projektben többször okozott élő rést:
//
//      „egy védelem azon az úton épül meg, ahol felfedezték;
//       az egyenértékű úton nem."
//
//  A fuvar- és a foglalás-ág KÉT KÜLÖN kódút ugyanabban a fájlban. A
//  fuvar-ágon mért fájl-kapuk, a kód-zárolás és a párhuzamos-lezárás
//  védelme a foglalás-ágon EDDIG MÉRETLEN volt. Emellett:
//
//    * a tárolóhiba mentőága (a bizonyíték-fotó nem veszhet el),
//    * a felvételkori CÍMZETT-SMS TÉNYLEGES tartalma futásidőben
//      (a meglévő őr a FORRÁSSZÖVEGET olvassa — az elhinné a saját
//      állítását, ha a futásidejű érték elcsúszna),
//    * a kézbesítési értesítő levelek (a címzett gyakran nem felhasználó),
//    * és a foglalás-fotók idegen elől való zárása.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const fs = require('fs');
const {
  app, db, createUser, createJob, createBooking, TINY_PNG,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const smsModul = require('../src/services/sms');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Egy SVG, `image/png`-nek hazudva — script-képes formátum, a publikus
// tárolási domainen stored-XSS lenne belőle.
const ALCAZOTT_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const SIMA_SZOVEG = Buffer.from('ez egy sima szoveges fajl, nem kep');

function feltolt({
  url, token, kind, deliveryCode,
  buffer = TINY_PNG, contentType = 'image/png', filename = 'teszt.png',
}) {
  const r = request(app).post(url).set(auth(token)).field('kind', kind);
  if (deliveryCode) r.field('delivery_code', deliveryCode);
  return r.attach('file', buffer, { filename, contentType });
}
const jobFoto = (o) => feltolt({ url: `/jobs/${o.jobId}/photos`, ...o });
const bookingFoto = (o) => feltolt({ url: `/route-bookings/${o.bookingId}/photos`, ...o });

const jobFotok = async (jobId) => (await db.query(
  'SELECT * FROM photos WHERE job_id = $1', [jobId],
)).rows;
const bookingFotok = async (bookingId) => (await db.query(
  'SELECT * FROM photos WHERE booking_id = $1', [bookingId],
)).rows;
const jobSor = async (id) => (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
const bookingSor = async (id) => (await db.query('SELECT * FROM route_bookings WHERE id = $1', [id])).rows[0];

const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function vartig(feltetel, maxMs = 2000) {
  const hatar = Date.now() + maxMs;
  while (Date.now() < hatar) {
    if (feltetel()) return true;
    await varj(15);
  }
  return feltetel();
}

/**
 * A TÉNYLEGESEN kiküldött levelek elkapása a hálózati rétegen.
 * (A photos.js a `sendEmail`-t részben a fájl tetején, destrukturálva
 * importálja — modul-objektumra tett kém ott sosem futna le, vagyis a
 * teszt vakon zöld lenne. A `fetch` hívási időben oldódik fel.)
 */
async function elkapottLevelek(muvelet, { varjLevelekre = 1 } = {}) {
  const eredetiKulcs = process.env.RESEND_API_KEY;
  const levelek = [];
  const eredetiFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, opts) => {
    if (String(url).includes('resend.com')) {
      try { levelek.push(JSON.parse(opts.body)); } catch { /* nem levél */ }
      return { ok: true, status: 200, json: async () => ({ id: 'teszt-level' }), text: async () => '{}' };
    }
    return eredetiFetch(url, opts);
  });
  process.env.RESEND_API_KEY = 'teszt-kulcs-nem-eles';
  try {
    await muvelet();
    await vartig(() => levelek.length >= varjLevelekre);
    await varj(80);
  } finally {
    vi.unstubAllGlobals();
    process.env.RESEND_API_KEY = eredetiKulcs ?? '';
  }
  return levelek;
}

// =====================================================================
//  1. A FOGLALÁS-ÁG FÁJL-KAPUI (a fuvar-ág ikerpárja)
// =====================================================================
describe('Foglalás-fotó: a fájl maga', () => {
  it('hiányzó fájl / nem-kép MIME / kép-álcás SVG mind 400 — a foglalás-ágon is', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    // A magic-byte ellenőrzés a stored-XSS elleni kapu: a fájl TARTALMA
    // dönt, nem a kliens MIME-fejléce. A fuvar-ágon mérve volt, a
    // foglalás-ágon nem — pedig ugyanabba a PUBLIKUS bucketbe ír.
    const nincsFajl = await request(app).post(`/route-bookings/${booking.id}/photos`)
      .set(auth(szallito.token)).field('kind', 'pickup');
    expect(nincsFajl.status, 'a foglalás-ág fájl nélkül is elfogadja a feltöltést').toBe(400);
    expect(nincsFajl.body.error).toMatch(/fájl/i);

    const rosszMime = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'pickup',
      buffer: SIMA_SZOVEG, contentType: 'text/plain', filename: 'jegyzet.txt',
    });
    expect(rosszMime.status, 'a foglalás-ág elfogadja a nem-kép fájlt').toBe(400);

    const alca = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'pickup',
      buffer: ALCAZOTT_SVG, contentType: 'image/png', filename: 'artatlan.png',
    });
    expect(alca.status, 'az image/png-nek hazudott SVG átment a foglalás-ág magic-byte kapuján').toBe(400);
    expect(alca.body.error).toMatch(/nem érvényes képfájl/i);

    expect((await bookingFotok(booking.id)).length, 'az elutasított feltöltések fotósort hagytak').toBe(0);
    expect((await bookingSor(booking.id)).status, 'az elutasított feltöltés léptette a foglalást').toBe('confirmed');
  });
});

// =====================================================================
//  2. A FOGLALÁS-ÁG SORREND- ÉS KÓD-KAPUI
// =====================================================================
describe('Foglalás-fotó: kézbesíteni csak felvett foglaláson lehet', () => {
  it('a felvétel nélküli kézbesítés 409, kód nélkül pedig 400 — a foglalás nem zárul le', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    // A fuvar-ág PICKUP_REQUIRED_FIRST guardjának a párja: felvételi fotó
    // nélkül nincs bizonyíték arról, MILYEN ÁLLAPOTBAN vette át a szállító
    // a csomagot — vitánál pont ez a kép döntene.
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    const korai = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(korai.status, 'a foglalás felvételi fotó nélkül is lezárható kézbesítettként').toBe(409);
    expect(korai.body.error).toMatch(/felvett \(folyamatban/i);
    const sor = await bookingSor(booking.id);
    expect(sor.status, 'a felvétel nélküli kézbesítés mégis léptette a foglalást').toBe('confirmed');
    expect(sor.delivered_at, 'kézbesítési időpont keletkezett felvétel nélkül').toBeNull();
    expect((await bookingFotok(booking.id)).length, 'az elutasított kézbesítés fotósort hagyott').toBe(0);

    const { booking: uton } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const kodNelkul = await bookingFoto({
      bookingId: uton.id, token: szallito.token, kind: 'dropoff',
    });
    expect(kodNelkul.status, 'a foglalás átvételi kód NÉLKÜL is lezárható').toBe(400);
    expect(kodNelkul.body.error).toMatch(/átvételi kód/i);
    expect((await bookingSor(uton.id)).status, 'a kód nélküli kézbesítés lezárta a foglalást').toBe('in_progress');
  });

  it('foglalás-ág: 5 hibás kód után zárolás — utána a HELYES kód is 429-et kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    // A 6 jegyű kód 900 000 lehetőség — zárolás nélkül percek alatt
    // végigpróbálható, és a kód a kézbesítés EGYETLEN bizonyítéka. A
    // fuvar-ágon a lockout mérve volt; itt csak az első hibás próba.
    const uzenetek = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await bookingFoto({
        bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '000000',
      });
      expect(res.status, `a(z) ${i + 1}. hibás próbálkozás nem 403-at adott`).toBe(403);
      uzenetek.push((res.body.error.match(/még (\d+) próbálkozás/) || [])[1]);
    }
    expect(uzenetek, 'a hátralévő próbálkozások száma nem csökken lépésenként')
      .toEqual(['4', '3', '2', '1', undefined]);

    const zarolt = await bookingSor(booking.id);
    expect(zarolt.delivery_code_attempts, 'a foglalás-ágon nem gyűlnek a hibás próbák').toBe(5);
    expect(
      new Date(zarolt.delivery_code_locked_until).getTime(),
      'az 5. hibás próba után nincs zárolás a foglalás-ágon',
    ).toBeGreaterThan(Date.now());

    const jokoddal = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(jokoddal.status, 'zárolás alatt a HELYES kód is átengedi a lezárást').toBe(429);
    expect((await bookingSor(booking.id)).status, 'a zárolt foglalás mégis lezárult').toBe('in_progress');
    expect((await bookingFotok(booking.id)).length, 'a hibás kódpróbák fotósorokat hagytak').toBe(0);
  });
});

// =====================================================================
//  3. HIÁNYZÓ FELADÓI VÉSZHELYZETI KÓD
// =====================================================================
describe('Átvételi kód: a hiányzó feladói vészhelyzeti kód', () => {
  it('ha nincs vészhelyzeti kód, a rossz kód 403 (nem hiba), a címzetti kód viszont lezár', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    // A vészhelyzeti kód OPCIONÁLIS (régebbi fuvarokon nincs). Az
    // összehasonlítás konstans idejű hash-eléssel megy: üres „elvárt" érték
    // mellett a `timingSafeEqual` kivételt dobna — a végpont 500-zal szállna
    // el minden hibás kódpróbán, ahelyett hogy 403-at adna.
    await db.query('UPDATE jobs SET sender_delivery_code = NULL WHERE id = $1', [job.id]);

    const rossz = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '000000',
    });
    expect(rossz.status, 'vészhelyzeti kód nélküli fuvarnál a hibás kód szerverhibát ad').toBe(403);
    expect((await jobSor(job.id)).status, 'a hibás kód mégis lezárta a fuvart').toBe('in_progress');

    const jo = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(jo.status, 'a címzetti kód nem zárja le a vészhelyzeti kód nélküli fuvart').toBe(201);
    const sor = await jobSor(job.id);
    expect(sor.status).toBe('delivered');
    expect(sor.closed_by_code_type, 'a lezárás nem címzetti kódként naplózódott').toBe('recipient');
  });
});

// =====================================================================
//  4. PÁRHUZAMOS KÉZBESÍTÉS — csak az egyik zárhat le
// =====================================================================
describe('Párhuzamos kézbesítés (dupla kattintás / kettős kérés)', () => {
  it('fuvar: két egyidejű, HELYES kódos kézbesítésből pontosan egy zár le', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    // A státusz-átmenet atomi (`WHERE ... AND status = 'in_progress'`), a
    // vesztes ág 409-et kap. Enélkül a lezárás mellékhatásai (értesítés,
    // ajánlói jutalom-trigger, DAC7-trigger, gamification) KÉTSZER futnának
    // le ugyanarra a fuvarra.
    const valaszok = await Promise.all([
      jobFoto({ jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222' }),
      jobFoto({ jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222' }),
    ]);
    const kodok = valaszok.map((r) => r.status).sort();

    expect(
      kodok.filter((k) => k === 201).length,
      `mindkét egyidejű kézbesítés sikeresnek jelentette magát (státuszok: ${kodok})`,
    ).toBe(1);
    expect(
      kodok.filter((k) => k === 409).length,
      `a vesztes kérés nem ütközés-hibát kapott (státuszok: ${kodok})`,
    ).toBe(1);

    const sor = await jobSor(job.id);
    expect(sor.status).toBe('delivered');
    expect(sor.delivered_at, 'a kézbesítés időpontja nem rögzült').toBeTruthy();
  });

  it('foglalás: két egyidejű kézbesítésből is pontosan egy zár le', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const valaszok = await Promise.all([
      bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222' }),
      bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222' }),
    ]);
    const kodok = valaszok.map((r) => r.status).sort();

    expect(
      kodok.filter((k) => k === 201).length,
      `a foglalás-ágon mindkét egyidejű kézbesítés sikeres lett (státuszok: ${kodok})`,
    ).toBe(1);
    expect((await bookingSor(booking.id)).status).toBe('delivered');
  });
});

// =====================================================================
//  5. A TÁROLÓ KIESÉSE — a bizonyíték nem veszhet el
// =====================================================================
describe('Tárolóhiba: a fotó mentőágon is megmarad', () => {
  it('ha a tároló írása elszáll, a fotó beágyazva (data URL) menekül meg', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    // A felvételi fotó a platform egyik hirdetett bizalmi rétege. Ha a
    // tároló írása hibázik (R2-kiesés, tele lemez), a végpont NEM szállhat
    // el 500-zal: a szállító a helyszínen áll a csomaggal, és nem tudná
    // elindítani a fuvart. A mentőág beágyazza a képet a DB-be.
    const eredetiIras = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((utvonal, ...tobbi) => {
      if (String(utvonal).includes('uploads')) throw new Error('a tároló nem elérhető');
      return eredetiIras.call(fs, utvonal, ...tobbi);
    });

    const res = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'pickup' });

    expect(res.status, 'a tároló hibája miatt a szállító nem tudja elindítani a fuvart').toBe(201);
    expect(
      res.body.photo.url,
      'a tárolóhiba után nem beágyazott kép jött vissza — a bizonyíték elveszett',
    ).toMatch(/^data:image\/png;base64,/);

    const fotok = await jobFotok(job.id);
    expect(fotok.length, 'a mentőág nem mentette el a fotósort').toBe(1);
    expect(fotok[0].url.startsWith('data:image/'), 'a DB-be nem a beágyazott kép került').toBe(true);
    expect((await jobSor(job.id)).status, 'a mentőágon a fuvar nem indult el').toBe('in_progress');
  });
});

// =====================================================================
//  6. A FELVÉTELKORI CÍMZETT-SMS — futásidejű tartalom
// =====================================================================
describe('Felvételkori SMS: a címzett egyetlen csatornája', () => {
  it('a CÍMZETT számára megy, tartalmazza a kódot, a nevet vágja, a számot normalizálja, és 2 szegmensbe fér', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // A tárolt telefonszám a felhasználó SAJÁT formázása lehet (szóközökkel),
    // a név pedig tetszőlegesen hosszú. Mindkettő az SMS hosszát növeli:
    // 134 karakter fölött 3. szegmens indul (~+19 Ft MINDEN fuvaron).
    await db.query(
      `UPDATE users SET full_name = 'Nagybetűs Szállítófőnök Kázmér', phone = '+36 30 123 4567' WHERE id = $1`,
      [szallito.id],
    );
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
      deliveryCode: '135791',
    });

    const kem = vi.spyOn(smsModul, 'sendSms').mockResolvedValue({ ok: true, stub: true });
    const res = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'pickup' });
    expect(res.status).toBe(201);
    await vartig(() => kem.mock.calls.length > 0);

    expect(kem.mock.calls.length, 'a címzett NEM kap SMS-t a csomag felvételekor').toBe(1);
    const [szam, szoveg] = kem.mock.calls[0];
    expect(szam, 'az SMS nem a CÍMZETT számára ment').toBe('+36301112233');
    expect(szoveg, 'az SMS-ből hiányzik az átvételi kód — a címzett nem tudja átvenni a csomagot').toContain('135791');
    expect(szoveg, 'a szállító neve nincs 14 karakterre vágva (3. szegmens = +19 Ft/fuvar)')
      .not.toContain('Nagybetűs Szállítófőnök Kázmér');
    expect(szoveg, 'a szállító neve teljesen kimaradt — a címzett nem tudja, kit vár').toContain('Nagybetűs Szál');
    expect(szoveg, 'a telefonszám a tárolt, szóközös alakban ment ki (hosszabb és rosszabbul hívható)')
      .toContain('+36301234567');
    expect(szoveg, 'az adatkezelési tájékoztató mutatója hiányzik (GDPR 14. cikk)').toMatch(/gofuvar\.hu\/a/);
    expect(
      szoveg.length,
      `az SMS ${szoveg.length} karakter — 134 fölött 3 szegmensbe kerül (~+19 Ft/fuvar)`,
    ).toBeLessThanOrEqual(134);
  });
});

// =====================================================================
//  7. KÉZBESÍTÉSI ÉRTESÍTŐ LEVELEK
// =====================================================================
describe('Kézbesítéskor kimenő levelek', () => {
  it('fuvar-ág: a FELADÓ és a megadott CÍMZETT is levelet kap az átvételről', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const cimzettEmail = `cimzett-fuvar-${Math.random().toString(36).slice(2, 9)}@teszt.gofuvar.hu`;
    await db.query('UPDATE jobs SET recipient_email = $2 WHERE id = $1', [job.id, cimzettEmail]);

    const levelek = await elkapottLevelek(async () => {
      const res = await jobFoto({
        jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
      });
      expect(res.status).toBe(201);
    }, { varjLevelekre: 2 });

    const cimzetti = levelek.find((l) => l.to?.[0] === cimzettEmail);
    expect(cimzetti, 'a címzett nem kap visszaigazolást az átvételről').toBeTruthy();
    expect(cimzetti.subject, 'a címzetti levél tárgya nem az átvételről szól').toMatch(/átvéve/i);
    expect(
      cimzetti.html,
      'a címzetti levélből hiányzik a GDPR 14. cikk szerinti tájékoztatás (ő nem felhasználó)',
    ).toContain('Tiszta Hód Kft.');

    const feladoi = levelek.find((l) => l.to?.[0] === felado.email);
    expect(feladoi, 'a feladó nem kap értesítést a kézbesítésről').toBeTruthy();
    expect(
      feladoi.html,
      'a feladói levél nem emlékeztet, hogy a fuvardíj készpénzben jár a szállítónak',
    ).toMatch(/készpénz/i);
  });

  it('foglalás-ág: ugyanígy a feladó és a címzett is levelet kap (az ikerpár nem csúszhat szét)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const cimzettEmail = `cimzett-foglalas-${Math.random().toString(36).slice(2, 9)}@teszt.gofuvar.hu`;
    await db.query('UPDATE route_bookings SET recipient_email = $2 WHERE id = $1', [booking.id, cimzettEmail]);

    const levelek = await elkapottLevelek(async () => {
      const res = await bookingFoto({
        bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
      });
      expect(res.status).toBe(201);
    }, { varjLevelekre: 2 });

    const cimzetti = levelek.find((l) => l.to?.[0] === cimzettEmail);
    expect(cimzetti, 'a foglalás-ágon a címzett nem kap visszaigazolást az átvételről').toBeTruthy();
    expect(cimzetti.html, 'a foglalás-ági címzetti levélből hiányzik a 14. cikk szerinti tájékoztatás')
      .toContain('Tiszta Hód Kft.');

    const feladoi = levelek.find((l) => l.to?.[0] === felado.email);
    expect(feladoi, 'a foglalás-ágon a feladó nem kap értesítést a kézbesítésről').toBeTruthy();
    expect(feladoi.html, 'a foglalás-ági feladói levél nem szól a készpénzes fuvardíjról').toMatch(/készpénz/i);
  });
});

// =====================================================================
//  8. FOGLALÁS-FOTÓK: idegen elől zárva
// =====================================================================
describe('Foglalás-fotók listája (GET /route-bookings/:id/photos)', () => {
  it('a foglalásban NEM érintett felhasználó 403-at kap, bizonyíték nélkül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'pickup' });

    // A felvételi/kézbesítési fotó PRIVÁT bizonyíték: a beágyazott GPS a
    // felvétel helyét ~méteres pontossággal mutatja (jellemzően a feladó
    // otthonát). A fuvar-ág ikerpárja itt kimarad — ott a kívülálló a
    // hirdetés-fotót láthatja, a foglalásnak viszont nincs hirdetés-fotója.
    const res = await request(app).get(`/route-bookings/${booking.id}/photos`).set(auth(idegen.token));

    expect(res.status, 'bárki lekérheti egy idegen foglalás bizonyíték-fotóit').toBe(403);
    expect(Array.isArray(res.body), 'a 403 mellé fotólista is ment').toBe(false);
    expect(JSON.stringify(res.body), 'a 403 mellé fotó-URL vagy GPS is ment').not.toMatch(/gps_|url/);

    const felek = await request(app).get(`/route-bookings/${booking.id}/photos`).set(auth(felado.token));
    expect(felek.status, 'a foglalás feladója nem látja a saját csomagjáról készült fotót').toBe(200);
    expect(felek.body.length).toBe(1);
  });
});
