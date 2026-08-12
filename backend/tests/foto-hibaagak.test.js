// =====================================================================
//  FOTÓ-BIZONYÍTÉK (photos.js) — a HIBAÁGAK
//
//  A fotó a platform egyik HIRDETETT bizalmi rétege: vitánál ez mutatja
//  meg, milyen állapotban vette át a szállító a csomagot, és az átvételi
//  kód ellenőrzése ehhez a végponthoz van kötve. Éppen ezért itt a
//  „mit utasítunk EL" legalább olyan fontos, mint a boldog út:
//
//    * a fájl TARTALMA dönt, nem a kliens MIME-ja (stored-XSS elleni magic
//      byte ellenőrzés) — és elutasításkor SEMMILYEN fotósor nem születhet,
//    * kézbesíteni csak elindított (felvett) fuvarnál lehet,
//    * a 6 jegyű kód nem próbálgatható végtelenszer,
//    * a vitát egy fotó-feltöltés nem tüntetheti el,
//    * a kívülálló csak a hirdetés-fotót láthatja, abból is csak 4 mezőt.
//
//  A tesztek a DB állapotát is mérik: egy „400-at ad, de közben már mentett"
//  hiba a puszta státuszkód-ellenőrzéssel láthatatlan maradna.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, createBooking, TINY_PNG,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());

const NEM_LETEZO = '00000000-0000-0000-0000-000000000000';

// Egy SVG, `image/png`-nek hazudva. Az SVG script-képes formátum: ha a
// publikus tárolási domainre feljutna, stored-XSS lenne belőle.
const ALCAZOTT_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const SIMA_SZOVEG = Buffer.from('ez egy sima szoveges fajl, nem kep');

function feltolt({
  url, token, kind, deliveryCode, gps,
  buffer = TINY_PNG, contentType = 'image/png', filename = 'teszt.png',
}) {
  const r = request(app).post(url).set(auth(token)).field('kind', kind);
  if (deliveryCode) r.field('delivery_code', deliveryCode);
  if (gps) {
    r.field('gps_lat', String(gps.lat));
    r.field('gps_lng', String(gps.lng));
    if (gps.acc != null) r.field('gps_accuracy_m', String(gps.acc));
  }
  return r.attach('file', buffer, { filename, contentType });
}

const jobFoto = (o) => feltolt({ url: `/jobs/${o.jobId}/photos`, ...o });
const bookingFoto = (o) => feltolt({ url: `/route-bookings/${o.bookingId}/photos`, ...o });

const jobFotok = async (jobId) => (await db.query(
  'SELECT * FROM photos WHERE job_id = $1 ORDER BY taken_at ASC', [jobId],
)).rows;
const bookingFotok = async (bookingId) => (await db.query(
  'SELECT * FROM photos WHERE booking_id = $1', [bookingId],
)).rows;
const jobSor = async (id) => (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
const bookingSor = async (id) => (await db.query('SELECT * FROM route_bookings WHERE id = $1', [id])).rows[0];

// =====================================================================
//  1. FÁJL-SZINTŰ KAPUK — és hogy elutasításkor NEM keletkezik fotósor
// =====================================================================
describe('Fotó-feltöltés: a fájl maga', () => {
  it('hiányzó fájl / nem-kép MIME / kép-álcás SVG mind 400 — és egy fotósor sem születik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    const nincsFajl = await request(app).post(`/jobs/${job.id}/photos`)
      .set(auth(szallito.token)).field('kind', 'pickup');
    expect(nincsFajl.status, 'fájl nélkül is elfogadja a feltöltést').toBe(400);
    expect(nincsFajl.body.error).toMatch(/fájl/i);

    const rosszMime = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'pickup',
      buffer: SIMA_SZOVEG, contentType: 'text/plain', filename: 'jegyzet.txt',
    });
    expect(rosszMime.status, 'a nem-kép MIME-t is elfogadja').toBe(400);

    // A KLIENS `image/png`-t állít, a TARTALOM viszont SVG → a magic-byte
    // ellenőrzésnek kell megfognia. Ez a védelem a stored-XSS elleni kapu.
    const alca = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'pickup',
      buffer: ALCAZOTT_SVG, contentType: 'image/png', filename: 'artatlan.png',
    });
    expect(alca.status, 'az image/png-nek hazudott SVG átment a magic-byte kapun').toBe(400);
    expect(alca.body.error).toMatch(/nem érvényes képfájl/i);

    expect(
      (await jobFotok(job.id)).length,
      'az elutasított feltöltések MÉGIS fotósort hoztak létre a bizonyíték-galériában',
    ).toBe(0);
    expect((await jobSor(job.id)).status, 'az elutasított feltöltés léptette a fuvar státuszát').toBe('accepted');
  });

  it('ismeretlen kind elutasítva; a foglalás-ágon a "listing" sem értelmezhető', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    for (const kind of ['akarmi', 'selfie', '']) {
      const res = await jobFoto({ jobId: job.id, token: szallito.token, kind });
      expect(res.status, `a(z) "${kind}" kind-ot elfogadta a fuvar-ág`).toBe(400);
    }

    // A foglalásnak nincs hirdetés-fotója (azt a JÁRAT hirdeti, nem a csomag),
    // ezért a 'listing' itt érvénytelen kell legyen.
    const listing = await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'listing' });
    expect(listing.status, 'a foglalás-ág elfogadta a "listing" fotót').toBe(400);
    expect((await bookingFotok(booking.id)).length).toBe(0);
  });
});

// =====================================================================
//  2. KI TÖLTHET FEL MIT
// =====================================================================
describe('Fotó-feltöltés: jogosultság', () => {
  it('hirdetés-fotót CSAK a feladó, felvételit/kézbesítésit CSAK a kijelölt szállító', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    const listingSzallitotol = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'listing' });
    expect(listingSzallitotol.status, 'a szállító tölthet fel HIRDETÉS-fotót a feladó fuvarjára').toBe(403);

    for (const kind of ['pickup', 'dropoff', 'damage', 'document']) {
      const res = await jobFoto({ jobId: job.id, token: felado.token, kind, deliveryCode: '111222' });
      expect(res.status, `a feladó tölthet fel "${kind}" bizonyítékot a szállító helyett`).toBe(403);
    }

    const listingFeladotol = await jobFoto({ jobId: job.id, token: felado.token, kind: 'listing' });
    expect(listingFeladotol.status, 'a feladó nem tudja feltölteni a saját hirdetés-fotóját').toBe(201);
    expect((await jobFotok(job.id)).length, 'a jogosulatlan feltöltések is bekerültek a galériába').toBe(1);
  });

  it('idegen fuvarra/foglalásra nem lehet feltölteni; nem létező azonosítóra 404', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    const idegenFuvar = await jobFoto({ jobId: job.id, token: idegen.token, kind: 'pickup' });
    expect(idegenFuvar.status, 'idegen szállító tölthet fel bizonyítékot más fuvarjára').toBe(403);

    // A foglalás-ágon a FELADÓ sem tölthet: ott minden fotó a szállítóé.
    const feladoFoglalasra = await bookingFoto({ bookingId: booking.id, token: felado.token, kind: 'pickup' });
    expect(feladoFoglalasra.status, 'a feladó tölthet fel felvételi fotót a saját foglalására').toBe(403);

    expect((await jobFotok(job.id)).length + (await bookingFotok(booking.id)).length,
      'a jogosulatlan feltöltések fotósort hoztak létre').toBe(0);

    const nincsFuvar = await jobFoto({ jobId: NEM_LETEZO, token: szallito.token, kind: 'pickup' });
    expect(nincsFuvar.status).toBe(404);
    const nincsFoglalas = await bookingFoto({ bookingId: NEM_LETEZO, token: szallito.token, kind: 'pickup' });
    expect(nincsFoglalas.status).toBe(404);
  });
});

// =====================================================================
//  3. STÁTUSZ- ÉS SORREND-KAPUK
// =====================================================================
describe('Fotó-feltöltés: státusz- és sorrend-kapuk', () => {
  it('a fizetetlen fuvaron nem indul munka, de a KÁR-fotó (damage) nem esik a díj-kapu alá', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    const pickup = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'pickup' });
    expect(pickup.status, 'a kapcsolatfelvételi díj kifizetése ELŐTT is elindítható a fuvar').toBe(409);
    expect(pickup.body.error).toMatch(/kapcsolatfelvételi díjat/i);
    expect((await jobSor(job.id)).status, 'a fizetetlen fuvar mégis elindult').toBe('accepted');

    // A kár/dokumentum fotó SZÁNDÉKOSAN nem díj-függő: az a vita bizonyítéka,
    // nem a munkavégzés része. Ha ez is 409 lenne, a károsult fél épp akkor
    // nem tudna bizonyítékot rögzíteni, amikor a legnagyobb szüksége van rá.
    const damage = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'damage' });
    expect(damage.status, 'a díj-kapu a KÁR-fotót is blokkolja — így vitánál nincs bizonyíték').toBe(201);
  });

  it('kézbesíteni csak elindított (felvett) fuvarnál lehet — a felvételi fotó nem ugorható át', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    const res = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(res.status, 'a szállító átugorhatja a felvételi fotót és egyből lezárhat').toBe(409);
    expect(res.body.code).toBe('PICKUP_REQUIRED_FIRST');

    const sor = await jobSor(job.id);
    expect(sor.status, 'a felvétel nélküli kézbesítés mégis lezárta a fuvart').toBe('accepted');
    expect(sor.delivered_at, 'kézbesítési időpont keletkezett felvétel nélkül').toBeNull();
    expect((await jobFotok(job.id)).length, 'az elutasított kézbesítés fotósort hagyott maga után').toBe(0);
  });

  it('lezárt (delivered/cancelled) fuvarra nem megy felvételi/kézbesítési fotó, kár-fotó viszont igen', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    for (const status of ['delivered', 'completed', 'cancelled']) {
      const job = await createJob({
        shipperId: felado.id, carrierId: szallito.id, status, paid: true,
      });
      const pickup = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'pickup' });
      expect(pickup.status, `a(z) "${status}" fuvarra még mindig tölthető felvételi fotó`).toBe(409);
      expect(pickup.body.error, `a(z) "${status}" hibaüzenete nem mondja meg, miért nem megy`).toMatch(new RegExp(status));

      // Utólagos kár-bizonyíték: SZÁNDÉKOSAN engedett (a terminál-kapu csak a
      // pickup/dropoff-ra vonatkozik). Ha ez elromlana, egy kézbesítés utáni
      // sérülésről nem lehetne fotót csatolni.
      const damage = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'damage' });
      expect(damage.status, `a(z) "${status}" fuvarhoz nem csatolható utólagos kár-fotó`).toBe(201);
    }
  });

  it('foglalás-ág: lezárt/elutasított foglalásra SEMMILYEN fotó nem megy', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    for (const status of ['delivered', 'cancelled', 'rejected']) {
      const { booking } = await createBooking({
        shipperId: felado.id, carrierId: szallito.id, status, paid: true,
      });
      // A foglalás-ág terminál-kapuja szélesebb, mint a fuvaré: itt a kár- és
      // dokumentum-fotó is tiltott a lezárás után.
      for (const kind of ['pickup', 'damage']) {
        const res = await bookingFoto({ bookingId: booking.id, token: szallito.token, kind });
        expect(res.status, `a(z) "${status}" foglalásra feltölthető "${kind}" fotó`).toBe(409);
      }
      expect((await bookingFotok(booking.id)).length).toBe(0);
    }
  });
});

// =====================================================================
//  4. AZ ÁTVÉTELI KÓD
// =====================================================================
describe('Átvételi kód: kötelező, próbálgatás-védett, naplózott', () => {
  it('hiányzó kód 400; kód nélküli (régi) fuvar 409 — státusz egyik esetben sem változik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const nincsKod = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'dropoff' });
    expect(nincsKod.status, 'kód nélkül is lezárható a fuvar').toBe(400);
    const uresKod = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '   ' });
    expect(uresKod.status, 'a csupa-szóköz kódot elfogadja a végpont').toBe(400);
    expect((await jobSor(job.id)).status).toBe('in_progress');

    const kodNelkuli = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    await db.query('UPDATE jobs SET delivery_code = NULL, sender_delivery_code = NULL WHERE id = $1', [kodNelkuli.id]);
    const res = await jobFoto({
      jobId: kodNelkuli.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(res.status, 'a kód nélküli fuvar bármilyen kóddal lezárható (fallback-lyuk)').toBe(409);
    expect((await jobSor(kodNelkuli.id)).status, 'a kód nélküli fuvar mégis lezárult').toBe('in_progress');
  });

  it('rossz kód: 403 + visszaszámláló, az 5. után 1 órás zárolás — a jó kód is elakad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const maradek = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await jobFoto({
        jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '000000',
      });
      expect(res.status, `a(z) ${i + 1}. hibás próbálkozás nem 403-at adott`).toBe(403);
      maradek.push((res.body.error.match(/még (\d+) próbálkozás/) || [])[1]);
    }
    expect(maradek, 'a hátralévő próbálkozások száma nem csökken lépésenként')
      .toEqual(['4', '3', '2', '1', undefined]);

    const sor = await jobSor(job.id);
    expect(sor.delivery_code_attempts, 'a hibás próbálkozások nem gyűlnek').toBe(5);
    expect(new Date(sor.delivery_code_locked_until).getTime(), 'az 5. hibás próba után nincs zárolás')
      .toBeGreaterThan(Date.now());

    const jokoddal = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(jokoddal.status, 'zárolás alatt a HELYES kód is átengedi a lezárást').toBe(429);
    expect((await jobSor(job.id)).status, 'a zárolt fuvar mégis lezárult').toBe('in_progress');
    expect((await jobFotok(job.id)).length, 'a hibás kódpróbák fotósorokat hagytak a galériában').toBe(0);
  });

  it('a helyes kód NULLÁZZA a hibás próbálkozás-számlálót (nem ragad be a zárolás felé)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    for (let i = 0; i < 2; i += 1) {
      await jobFoto({ jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '999999' });
    }
    expect((await jobSor(job.id)).delivery_code_attempts).toBe(2);

    const ok = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(ok.status).toBe(201);
    const sor = await jobSor(job.id);
    expect(sor.delivery_code_attempts, 'a sikeres kód után is megmaradt a hibás próbák száma').toBe(0);
    expect(sor.delivery_code_locked_until, 'a sikeres kód nem oldotta fel a zárolási mezőt').toBeNull();
    expect(sor.status).toBe('delivered');
  });

  it('a feladó VÉSZHELYZETI kódja is lezár — de a napló megkülönbözteti a címzettitől', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const veszhelyzeti = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const vesz = await jobFoto({
      jobId: veszhelyzeti.id, token: szallito.token, kind: 'dropoff', deliveryCode: '333444',
    });
    expect(vesz.status, 'a feladói vészhelyzeti kód nem zárja le a fuvart').toBe(201);
    const veszSor = await jobSor(veszhelyzeti.id);
    expect(veszSor.status).toBe('delivered');
    expect(
      veszSor.closed_by_code_type,
      'nem derül ki a naplóból, hogy vészhelyzeti (feladói) kóddal zárult — vitánál ez a különbség',
    ).toBe('sender_emergency');

    const normal = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    await jobFoto({ jobId: normal.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222' });
    expect((await jobSor(normal.id)).closed_by_code_type, 'a címzetti kóddal zárt fuvar rossz jelölést kapott')
      .toBe('recipient');
  });

  it('a MÁSIK fuvar kódja nem nyitja ki ezt a fuvart (kereszt-szennyeződés)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const enyem = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
      deliveryCode: '424243', senderDeliveryCode: '424244',
    });
    const masik = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
      deliveryCode: '777888', senderDeliveryCode: '777999',
    });

    const res = await jobFoto({
      jobId: enyem.id, token: szallito.token, kind: 'dropoff', deliveryCode: '777888',
    });
    expect(res.status, 'egy MÁSIK fuvar kódjával is lezárható ez a fuvar').toBe(403);
    expect((await jobSor(enyem.id)).status).toBe('in_progress');
    expect((await jobSor(masik.id)).status, 'a másik fuvar is elmozdult').toBe('in_progress');
  });

  it('foglalás-ág: rossz kód 403 + zárolás, a kód nélküli foglalás 409', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    await db.query('UPDATE route_bookings SET delivery_code = NULL WHERE id = $1', [booking.id]);
    const nincsKod = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(nincsKod.status, 'a kód nélküli foglalás bármilyen kóddal lezárható').toBe(409);
    expect((await bookingSor(booking.id)).status).toBe('in_progress');

    const { booking: b2 } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const rossz = await bookingFoto({
      bookingId: b2.id, token: szallito.token, kind: 'dropoff', deliveryCode: '000000',
    });
    expect(rossz.status).toBe(403);
    expect((await bookingSor(b2.id)).delivery_code_attempts, 'a foglalás-ágon nem számoljuk a hibás próbákat').toBe(1);
  });
});

// =====================================================================
//  5. VITA ALATT: a fizikai út folytatódik, a vita NEM tűnik el
// =====================================================================
describe('Vita alatti fotó-feltöltés', () => {
  it('vita alatti FELVÉTEL: a státusz "disputed" marad, csak a visszatérési pont lép', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'disputed', paid: true,
    });
    await db.query(`UPDATE jobs SET status_before_dispute = 'accepted' WHERE id = $1`, [job.id]);

    const res = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'pickup' });
    expect(res.status, 'vita alatt nem lehet felvenni a csomagot — a szállító beragad').toBe(201);

    const sor = await jobSor(job.id);
    expect(sor.status, 'egy FOTÓ-feltöltés eltüntette a nyitott vitát').toBe('disputed');
    expect(
      sor.status_before_dispute,
      'a vita lezárása után a fuvar rossz állapotba térne vissza (nem indulna el)',
    ).toBe('in_progress');
  });

  it('vita alatti KÉZBESÍTÉS: delivered_at rögzül, de a fuvar vitás marad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'disputed', paid: true,
    });
    await db.query(`UPDATE jobs SET status_before_dispute = 'in_progress' WHERE id = $1`, [job.id]);

    const res = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(res.status, 'vita alatt a szállító nem tudja kézbesíteni a csomagot').toBe(201);

    const sor = await jobSor(job.id);
    expect(sor.status, 'a kézbesítés némán lezárta a vitát').toBe('disputed');
    expect(sor.delivered_at, 'a kézbesítés ténye nem rögzült').toBeTruthy();
    expect(sor.status_before_dispute, 'a vita lezárása után a fuvar nem kézbesítettként térne vissza').toBe('delivered');
    expect(sor.closed_by_code_type, 'vita alatt nem naplózódik, milyen kóddal zárult').toBe('recipient');
  });
});

// =====================================================================
//  6. GPS-BIZONYÍTÉK
// =====================================================================
describe('GPS: a fotó mellé rögzített helyadat', () => {
  it('a küldött koordináták rögzülnek; ha nincs GPS, NULL marad (nem 0)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    const gpsSel = await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'pickup',
      gps: { lat: 47.4979, lng: 19.0402, acc: 12.5 },
    });
    expect(gpsSel.status).toBe(201);
    expect(gpsSel.body.photo.gps_lat, 'a felvétel helye nem került a bizonyítékba').toBeCloseTo(47.4979, 4);
    expect(gpsSel.body.photo.gps_lng).toBeCloseTo(19.0402, 4);
    expect(gpsSel.body.photo.gps_accuracy_m, 'a mérés pontossága elveszett').toBeCloseTo(12.5, 2);

    const gpsNelkul = await jobFoto({ jobId: job.id, token: szallito.token, kind: 'damage' });
    expect(gpsNelkul.status).toBe(201);
    expect(gpsNelkul.body.photo.gps_lat, 'GPS nélküli feltöltésnél kitalált (0) koordináta került a sorba').toBeNull();
    expect(gpsNelkul.body.photo.gps_lng).toBeNull();
    expect(gpsNelkul.body.photo.gps_accuracy_m).toBeNull();
  });

  it('a foglalás-ág UGYANÚGY rögzíti a helyadatot (az ikerpár nem csúszhat szét)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    // A két fotó-végpont (fuvar / foglalás) külön kódút. A projekt visszatérő
    // hibamintája, hogy egy garancia csak azon az úton épül meg, ahol
    // felfedezték — a bizonyíték-értékű GPS-nek MINDKETTŐN egyeznie kell.
    const gpsSel = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'pickup',
      gps: { lat: 46.253, lng: 20.1414, acc: 7.5 },
    });
    expect(gpsSel.status).toBe(201);
    expect(gpsSel.body.photo.gps_lat, 'a foglalás-ágon nem rögzül a felvétel helye').toBeCloseTo(46.253, 4);
    expect(gpsSel.body.photo.gps_lng).toBeCloseTo(20.1414, 4);
    expect(gpsSel.body.photo.gps_accuracy_m, 'a foglalás-ágon elveszik a mérés pontossága').toBeCloseTo(7.5, 2);

    const gpsNelkul = await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'document' });
    expect(gpsNelkul.body.photo.gps_lat, 'GPS nélkül is koordináta került a foglalás-fotóra').toBeNull();
  });
});

// =====================================================================
//  7. FOTÓ-LISTÁK — ki mit lát
// =====================================================================
describe('Fotó-listák: a kívülálló csak a hirdetés-fotót látja', () => {
  it('GET /jobs/:id/photos — kívülállónak CSAK listing, abból is csak 4 mező (10. mérés A1)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    await jobFoto({
      jobId: job.id, token: felado.token, kind: 'listing',
      gps: { lat: 47.4979, lng: 19.0402, acc: 5 },
    });
    await jobFoto({
      jobId: job.id, token: szallito.token, kind: 'pickup',
      gps: { lat: 47.5, lng: 19.05, acc: 8 },
    });

    const fel = await request(app).get(`/jobs/${job.id}/photos`).set(auth(felado.token));
    expect(fel.status).toBe(200);
    expect(fel.body.length, 'a fuvar fele nem látja az összes bizonyítékot').toBe(2);

    const kivul = await request(app).get(`/jobs/${job.id}/photos`).set(auth(bongeszo.token));
    expect(kivul.status).toBe(200);
    expect(kivul.body.length, 'a kívülálló a PRIVÁT bizonyíték-fotókat is látja').toBe(1);
    expect(kivul.body[0].kind).toBe('listing');
    expect(
      Object.keys(kivul.body[0]).sort(),
      'a kívülálló nyers fotósort kapott — benne a feltöltő azonosítója és a GPS-e',
    ).toEqual(['id', 'job_id', 'kind', 'url']);

    const nincs = await request(app).get(`/jobs/${NEM_LETEZO}/photos`).set(auth(felado.token));
    expect(nincs.status).toBe(404);
  });

  it('GET /route-bookings/:id/photos — az admin látja, a nem létező foglalás 404', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'pickup' });

    const adminRes = await request(app).get(`/route-bookings/${booking.id}/photos`).set(auth(admin.token));
    expect(adminRes.status, 'az admin nem fér hozzá a vita rendezéséhez kellő bizonyítékhoz').toBe(200);
    expect(adminRes.body.length).toBe(1);

    const nincs = await request(app).get(`/route-bookings/${NEM_LETEZO}/photos`).set(auth(admin.token));
    expect(nincs.status).toBe(404);
  });
});

// =====================================================================
//  8. FOGLALÁS-ÁG: a felvétel léptet és értesít
// =====================================================================
describe('Foglalás-ág: felvétel utáni állapot és értesítés', () => {
  it('a felvételi fotó in_progress-re léptet és értesíti a feladót; kézbesítés után nincs újranyitás', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });

    const pickup = await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'pickup' });
    expect(pickup.status).toBe(201);
    expect((await bookingSor(booking.id)).status, 'a felvételi fotó nem léptette a foglalást').toBe('in_progress');

    const { rows: ert } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'booking_picked_up'`, [felado.id],
    );
    expect(ert.length, 'a feladó nem tudja meg, hogy elindult a csomagja').toBe(1);

    const dropoff = await bookingFoto({
      bookingId: booking.id, token: szallito.token, kind: 'dropoff', deliveryCode: '111222',
    });
    expect(dropoff.status).toBe(201);
    const sor = await bookingSor(booking.id);
    expect(sor.status).toBe('delivered');
    expect(sor.delivered_at, 'a kézbesítés időpontja nem rögzült').toBeTruthy();

    // Lezárás UTÁN a felvételi fotó már nem nyithatja vissza a foglalást.
    const ujraPickup = await bookingFoto({ bookingId: booking.id, token: szallito.token, kind: 'pickup' });
    expect(ujraPickup.status, 'a lezárt foglalás egy új felvételi fotóval visszanyitható').toBe(409);
    expect((await bookingSor(booking.id)).status).toBe('delivered');
  });
});
