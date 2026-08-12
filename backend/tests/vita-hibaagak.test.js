// =====================================================================
//  VITA (dispute) — A BIZONYÍTÉK-KAPU ÉS A LEZÁRÁS HIBAÁGAI (2026-08-12)
//
//  ⚠️ MIÉRT EZ: a `POST /disputes` bizonyíték-URL ellenőrzése — a 2026-08-11-i
//  audit legfontosabb integritás-javítása — LEFEDETLEN volt. A kód
//  kommentje részletesen leírja a támadást (a támadó a saját fuvarjára nyit
//  vitát, `evidence_url`-nek beállítja MÁS ember objektum-URL-jét, majd
//  törli a fiókját → a rendszer az ÁLDOZAT fájlját törli az R2-ből, épp a
//  bizonyíték-rétegen), de egyetlen teszt sem őrizte, hogy a védelem él-e.
//  Egy `git revert` a javításon zölden ment volna át.
//
//  Amit ez a fájl őriz:
//   1. A csatolt bizonyíték CSAK ahhoz a fuvarhoz/foglaláshoz feltöltött fotó
//      lehet, amire a vita szól (TULAJDONJOG, nem URL-alak).
//   2. A nem létező fuvar/foglalás 404-et kap (nem 500-at, nem néma vitát).
//   3. A lezárás visszaadja a vita ELŐTTI státuszt, de a bizonyíték-zárolást
//      (`photo_retention_hold`) SZÁNDÉKOSAN bekapcsolva hagyja — az 5 éves
//      megőrzés ezen áll.
//   4. A NEM lezáró állapot (`under_review`) nem oldja fel a `disputed`-et.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Fotó-sor gyártása a tárolóból (a valós feltöltés eredményének mása). */
async function feltoltottFoto({ jobId = null, bookingId = null, uploaderId, url }) {
  const cim = url || `https://pub-teszt.r2.dev/${crypto.randomBytes(16).toString('hex')}.jpg`;
  await db.query(
    `INSERT INTO photos (job_id, booking_id, uploader_id, kind, url)
     VALUES ($1, $2, $3, 'pickup', $4)`,
    [jobId, bookingId, uploaderId, cim],
  );
  return cim;
}

/** Kifizetett, elfogadott fuvar mindkét féllel. */
async function vitazhatoFuvar() {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
  });
  return { felado, szallito, job };
}

const nyit = (token, body) => request(app).post('/disputes')
  .set('Authorization', `Bearer ${token}`).send(body);

async function vitakSzama(jobId) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM disputes WHERE job_id = $1', [jobId]);
  return rows[0].n;
}

// =====================================================================
//  1) A BIZONYÍTÉK-KAPU — a fájl-törlés fegyverré tétele ellen
// =====================================================================
describe('Vita-bizonyíték: csak a SAJÁT ügylethez tartozó fotó csatolható', () => {
  it('az ehhez a fuvarhoz feltöltött fotó elfogadva, és el is mentődik', async () => {
    const { felado, szallito, job } = await vitazhatoFuvar();
    const url = await feltoltottFoto({ jobId: job.id, uploaderId: szallito.id });

    const res = await nyit(felado.token, {
      job_id: job.id, description: 'A doboz sarka be volt szakadva.', evidence_url: url,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows } = await db.query('SELECT evidence_url FROM disputes WHERE id = $1', [res.body.id]);
    expect(
      rows[0].evidence_url,
      'A jogos bizonyíték-fotó NEM mentődött el a vitához. A kapu ilyenkor '
      + 'túl szigorú: a felhasználó nem tud bizonyítékot csatolni, ami épp a '
      + 'vitarendezés lényege lenne.',
    ).toBe(url);
  });

  it('MÁSIK fuvar fotóját NEM lehet a saját vitámhoz csatolni', async () => {
    const aldozat = await vitazhatoFuvar();
    const aldozatFoto = await feltoltottFoto({
      jobId: aldozat.job.id, uploaderId: aldozat.szallito.id,
    });

    const tamado = await vitazhatoFuvar();
    const res = await nyit(tamado.felado.token, {
      job_id: tamado.job.id,
      description: 'Sérült csomag.',
      evidence_url: aldozatFoto,
    });

    expect(
      res.status,
      'EGY IDEGEN FUVAR FOTÓJÁT RÁ LEHETETT AGGATNI A SAJÁT VITÁMRA.\n\n'
      + 'Ez INTEGRITÁS-TÁMADÁS, nem elméleti: a fájl-törlő gyűjtők '
      + '(fiók-törlés, admin entitás-törlés, 5 éves vita-purge) olvassák az '
      + '`evidence_url`-t, tehát a támadó a saját fiókja törlésével MÁS ember '
      + 'bizonyítékfotóját tünteti el az R2-ből — épp egy vitás fuvarét.',
    ).toBe(400);
    expect(res.body.code).toBe('INVALID_EVIDENCE_URL');
    expect(
      await vitakSzama(tamado.job.id),
      'A hibás bizonyíték ellenére LÉTREJÖTT a vita (csak URL nélkül) — a '
      + 'kérésnek egészében el kell hasalnia, különben a támadó észrevétlenül '
      + 'próbálkozhat tovább.',
    ).toBe(0);
  });

  it('tetszőleges tároló-URL (pl. MÁS ember avatarja) sem fogadható el', async () => {
    const { felado, job } = await vitazhatoFuvar();
    const idegen = await createUser({ role: 'carrier' });
    const avatar = `https://pub-teszt.r2.dev/${crypto.randomBytes(16).toString('hex')}.jpg`;
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [idegen.id, avatar]);

    const res = await nyit(felado.token, {
      job_id: job.id, description: 'Nem érkezett meg.', evidence_url: avatar,
    });

    expect(
      res.status,
      'A PUBLIKUS PROFILRÓL BÁRKI ÁLTAL LESZEDHETŐ AVATAR-URL-T ELFOGADTUK '
      + 'bizonyítéknak. Az URL ALAKJA (saját bucket-prefix) nem elég: az '
      + 'avatar, a hirdetés-fotó és a fuvar-fotó ugyanazt a prefixet kapja. '
      + 'A helyes szabály a TULAJDONJOG.',
    ).toBe(400);
  });

  it('a privát (KYC) bucket kulcsa sem adható meg kliensről', async () => {
    const { felado, job } = await vitazhatoFuvar();
    const res = await nyit(felado.token, {
      job_id: job.id,
      description: 'Sérülés.',
      evidence_url: 'private:kyc/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
    });
    expect(
      res.status,
      'EGY `private:` KULCS BEKERÜLHETETT A VITÁBA. Az a KYC-bucketre mutat: '
      + 'a törlő gyűjtőkön keresztül egy SZEMÉLYI IGAZOLVÁNY fotóját lehetne '
      + 'távolról megsemmisíteni.',
    ).toBe(400);
  });

  it('500 karakternél hosszabb URL-t akkor sem fogadunk el, ha a fotó a miénk', async () => {
    const { felado, szallito, job } = await vitazhatoFuvar();
    const hosszu = `https://pub-teszt.r2.dev/${'a'.repeat(520)}.jpg`;
    await feltoltottFoto({ jobId: job.id, uploaderId: szallito.id, url: hosszu });

    const res = await nyit(felado.token, {
      job_id: job.id, description: 'Sérülés.', evidence_url: hosszu,
    });
    expect(
      res.status,
      'A hossz-plafon nem él: egy tulajdonjogilag rendben lévő, de kóros '
      + 'méretű URL is bekerült a DB-be (a mező TEXT, tehát semmi nem fogja meg).',
    ).toBe(400);
  });

  it('üres / hiányzó bizonyíték esetén a vita simán megnyílik (nincs kötelező csatolmány)', async () => {
    for (const ertek of ['', null, undefined]) {
      const { felado, job } = await vitazhatoFuvar();
      const res = await nyit(felado.token, {
        job_id: job.id, description: 'Nem érkezett meg a csomag.', evidence_url: ertek,
      });
      expect(
        res.status,
        `A(z) ${JSON.stringify(ertek)} bizonyíték-értéket hibának vettük — a `
        + 'csatolmány OPCIONÁLIS, enélkül a felhasználó egyáltalán nem tudna '
        + 'vitát nyitni.',
      ).toBe(201);
      expect(res.body.evidence_url).toBeNull();
    }
  });

  it('a foglalási ágon is a foglaláshoz tartozó fotó kell (fuvar-fotó nem jó)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const sajat = await feltoltottFoto({ bookingId: booking.id, uploaderId: szallito.id });

    // Egy MÁSIK ügylet (fuvar) fotója — ugyanaz a bucket, ugyanaz az alak.
    const masik = await vitazhatoFuvar();
    const idegen = await feltoltottFoto({ jobId: masik.job.id, uploaderId: masik.szallito.id });

    const rossz = await nyit(felado.token, {
      booking_id: booking.id, description: 'Sérült csomag.', evidence_url: idegen,
    });
    expect(
      rossz.status,
      'A FOGLALÁSI ÁGON a védelem nem él: egy idegen FUVAR fotóját rá lehetett '
      + 'aggatni a foglalás vitájára. A két ág aszimmetriája pont az a minta, '
      + 'ami miatt a korábbi körök is elcsúsztak.',
    ).toBe(400);

    const jo = await nyit(felado.token, {
      booking_id: booking.id, description: 'Sérült csomag.', evidence_url: sajat,
    });
    expect(jo.status, JSON.stringify(jo.body)).toBe(201);
    expect(jo.body.evidence_url).toBe(sajat);
  });
});

// =====================================================================
//  2) NEM LÉTEZŐ ENTITÁS — 404, nem 500 és nem néma vita
// =====================================================================
describe('Vita nyitása nem létező ügyletre', () => {
  it('ismeretlen fuvar-azonosítóra 404, és nem keletkezik vita', async () => {
    const felado = await createUser({ role: 'shipper' });
    const ures = crypto.randomUUID();

    const res = await nyit(felado.token, { job_id: ures, description: 'Semmi sem érkezett.' });

    expect(
      res.status,
      'Egy nem létező fuvar-azonosítóra nem 404 jött. Ha 500: a Sentry-t '
      + 'zajjal terheli minden szkennelés; ha 201: gazdátlan vita keletkezik, '
      + 'amit az admin sosem tud lezárni.',
    ).toBe(404);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM disputes WHERE job_id = $1', [ures]);
    expect(rows[0].n).toBe(0);
  });

  it('ismeretlen foglalás-azonosítóra 404', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await nyit(felado.token, {
      booking_id: crypto.randomUUID(), description: 'Semmi sem érkezett.',
    });
    expect(res.status, 'a foglalási ág nem adott 404-et ismeretlen azonosítóra').toBe(404);
  });

  it('az ÉRTESÍTÉS hibája nem buktathatja a vita megnyitását', async () => {
    const { felado, job } = await vitazhatoFuvar();

    // Célzott hiba: csak az értesítés-INSERT hasal el. A vita sora ekkor MÁR
    // bekerült a DB-be — ha a kérés 500-zal végződne, a felhasználó azt hinné,
    // nem sikerült, újrapróbálna, és 409-et kapna („már van nyitott vita").
    //
    // ⚠️ EZ MÉLYSÉGI VÉDELMET mér: KÉT réteg őrzi (a `createNotification`
    // saját try/catch-e ÉS az itteni hívó oldali catch). Lemérve: bármelyik
    // egyedüli eltávolítása mellett a teszt HELYESEN zöld marad (a viselkedés
    // nem romlik el), MINDKETTŐÉ mellett pirosra vált.
    const dbModul = require('../src/db');
    let talalat = 0;
    const eredeti = dbModul.query.bind(dbModul);
    vi.spyOn(dbModul, 'query').mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && /INSERT INTO notifications/i.test(sql)) {
        talalat += 1;
        throw new Error('szimulált DB-hiba a teszthez');
      }
      return eredeti(sql, params);
    });

    const res = await nyit(felado.token, { job_id: job.id, description: 'Nem érkezett meg.' });

    expect(talalat, 'értesítés-írás meg sem történt — a teszt nem mér semmit').toBeGreaterThan(0);
    expect(
      res.status,
      'AZ ÉRTESÍTÉS ELBUKÁSA 500-at okozott, MIKÖZBEN A VITA MÁR LÉTREJÖTT. '
      + 'A felhasználó úgy látja, nem sikerült; újrapróbálkozáskor 409-et kap '
      + '(„már van nyitott vita"), és semmilyen módon nem tud kilábalni.',
    ).toBe(201);

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'a fuvar nem került vitás állapotba').toBe('disputed');
  });

  it('nem-JSON kérés-törzsre 400 jön, nem összeomlás', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await request(app).post('/disputes')
      .set('Authorization', `Bearer ${felado.token}`)
      .set('Content-Type', 'text/plain')
      .send('ez nem json');
    expect(
      res.status,
      'Törzs nélküli / nem-JSON kérésre 500 jött. Ez a rendszer SZ1 szabálya '
      + '(„egyetlen végpont sem adhat 500-at rossz inputra"): élesben minden '
      + 'megszakadt mobil-kérés hamis Sentry-riasztást szülne, és a valódi '
      + 'hibák elvesznének a zajban. A védelmet a `requireText` típus-'
      + 'ellenőrzése adja — nyers `description.trim()`-re a teszt pirosra vált '
      + '(lemérve).',
    ).toBe(400);
  });
});

// =====================================================================
//  3) A LEZÁRÁS — státusz-visszaállítás ÉS a bizonyíték-zárolás megtartása
// =====================================================================
describe('PATCH /disputes/:id — admin döntés', () => {
  async function nyitottVita() {
    const { felado, szallito, job } = await vitazhatoFuvar();
    const res = await nyit(felado.token, { job_id: job.id, description: 'Sérült csomag érkezett.' });
    expect(res.status).toBe(201);
    const admin = await createUser({ role: 'admin' });
    return {
      felado, szallito, job, admin, vita: res.body,
    };
  }

  const patch = (token, id, body) => request(app).patch(`/disputes/${id}`)
    .set('Authorization', `Bearer ${token}`).send(body);

  it('érvénytelen státuszt elutasít (400), a vita változatlan marad', async () => {
    const { admin, vita } = await nyitottVita();

    for (const rossz of ['megoldva', 'OPEN', '', null, 42, 'resolved_', { a: 1 }]) {
      const res = await patch(admin.token, vita.id, { status: rossz });
      expect(
        res.status,
        `A(z) ${JSON.stringify(rossz)} státuszt elfogadtuk. A `
        + '`disputes.status` DB-CHECK-je ilyenkor 500-zal dobna vissza, vagy '
        + '— ami rosszabb — egy értelmezhetetlen állapotba kerülne a vita.',
      ).toBe(400);
    }
    const { rows } = await db.query('SELECT status FROM disputes WHERE id = $1', [vita.id]);
    expect(rows[0].status).toBe('open');
  });

  it('nem létező vitára 404 (és nem hallgatólagos siker)', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await patch(admin.token, crypto.randomUUID(), { status: 'closed' });
    expect(res.status, 'ismeretlen vita-azonosítóra nem 404 jött').toBe(404);
  });

  it('csak admin dönthet — a felek nem zárhatják le a saját vitájukat', async () => {
    const { felado, szallito, vita } = await nyitottVita();
    for (const [nev, tok] of [['feladó', felado.token], ['szállító', szallito.token]]) {
      const res = await patch(tok, vita.id, { status: 'resolved_no_action' });
      expect(
        res.status,
        `A(z) ${nev} SAJÁT MAGA lezárta a vitát. Ezzel a másik fél ellen `
        + 'indított eljárást egyoldalúan eltüntethetné.',
      ).toBe(403);
    }
    const { rows } = await db.query('SELECT status FROM disputes WHERE id = $1', [vita.id]);
    expect(rows[0].status).toBe('open');
  });

  it('„under_review" NEM oldja fel a fuvar disputed állapotát', async () => {
    const { admin, job, vita } = await nyitottVita();

    const res = await patch(admin.token, vita.id, { status: 'under_review' });
    expect(res.status).toBe(200);
    expect(res.body.resolved_at, 'a vizsgálat alatti állapot LEZÁRTNAK jelölte a vitát').toBeNull();

    const { rows } = await db.query(
      'SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id],
    );
    expect(
      rows[0].status,
      'A vizsgálat MEGKEZDÉSE visszaállította a fuvart nem-vitás állapotba. '
      + 'Ezzel a fuvar kikerülne a vitás védelem alól, miközben a vita él.',
    ).toBe('disputed');
    expect(
      rows[0].status_before_dispute,
      'a „hova térünk vissza" érték elveszett a köztes állapotban — a vita '
      + 'lezárásakor már nem lenne mire visszaállni',
    ).toBe('in_progress');
  });

  it('a lezárás visszaadja a vita ELŐTTI státuszt, de a zárolás MARAD', async () => {
    const { admin, job, vita } = await nyitottVita();

    const res = await patch(admin.token, vita.id, {
      status: 'resolved_no_action', resolution_note: 'A fotók alapján a csomag ép volt.',
    });
    expect(res.status).toBe(200);
    expect(res.body.resolved_at).toBeTruthy();
    expect(res.body.resolved_by).toBe(admin.id);

    const { rows } = await db.query(
      'SELECT status, status_before_dispute, photo_retention_hold FROM jobs WHERE id = $1', [job.id],
    );
    expect(
      rows[0].status,
      'A vita lezárása után a fuvar „disputed" maradt — ez volt a régi '
      + 'egyirányú utca (053-as migráció előtti állapot): a fuvar örökre '
      + 'vitásnak látszott akkor is, ha az admin szerint nincs teendő.',
    ).toBe('in_progress');
    expect(rows[0].status_before_dispute, 'a visszaállítás után nem ürült ki a segéd-mező').toBeNull();
    expect(
      rows[0].photo_retention_hold,
      'A LEZÁRÁS FELOLDOTTA A BIZONYÍTÉK-ZÁROLÁST. A vitás ügylet fotói és '
      + 'chatje a lezárás UTÁN is 5 évig kellenek (Ptk-s igényérvényesítés) — '
      + 'e nélkül a 30 napos fotó-purge már a következő hónapban elvinné a '
      + 'bizonyítékot.',
    ).toBe(true);
  });

  it('a foglalási ág lezárása is visszaáll, és ott is megmarad a zárolás', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const nyitas = await nyit(felado.token, {
      booking_id: booking.id, description: 'A csomag nem érkezett meg.',
    });
    expect(nyitas.status).toBe(201);

    const admin = await createUser({ role: 'admin' });
    const res = await patch(admin.token, nyitas.body.id, {
      status: 'resolved_partial', resolution_note: 'Részleges megegyezés.', refund_huf: 1500,
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.refund_huf), 'a döntés összege nem rögzült').toBe(1500);

    const { rows } = await db.query(
      'SELECT status, status_before_dispute, photo_retention_hold FROM route_bookings WHERE id = $1',
      [booking.id],
    );
    expect(
      rows[0].status,
      'A FOGLALÁSI ág vitája lezárás után is „disputed" maradt — a fuvar-ágon '
      + 'megépült visszaállítás itt nem fut le, és a foglalás beragad.',
    ).toBe('in_progress');
    expect(rows[0].status_before_dispute).toBeNull();
    expect(rows[0].photo_retention_hold, 'a foglalási ágon feloldódott a bizonyíték-zárolás').toBe(true);
  });

  it('indoklás nélküli döntésnél is értelmes értesítést kap mindkét fél', async () => {
    const {
      admin, felado, szallito, vita,
    } = await nyitottVita();

    const res = await patch(admin.token, vita.id, { status: 'closed' });
    expect(res.status).toBe(200);

    for (const [nev, uid] of [['feladó', felado.id], ['szállító', szallito.id]]) {
      const { rows } = await db.query(
        `SELECT type, body FROM notifications
          WHERE user_id = $1 AND type LIKE 'dispute%'
          ORDER BY created_at DESC LIMIT 1`,
        [uid],
      );
      expect(rows[0], `a(z) ${nev} semmilyen értesítést nem kapott a vita lezárásáról`).toBeTruthy();
      expect(rows[0].type).toBe('dispute_resolved');
      expect(
        rows[0].body,
        'Indoklás nélküli döntésnél üres/„undefined" szöveget kapott a fél — '
        + 'a vita eredménye így nem derül ki a felhasználó számára.',
      ).toContain('closed');
    }
  });
});
