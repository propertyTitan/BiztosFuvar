// =====================================================================
//  FEKETEDOBOZ: a teljes felhasználói út, KIZÁRÓLAG a nyilvános felületen
//  (2026-08-12, a tesztelő kérésére)
//
//  ⚠️ MIÉRT KELLETT — A LEGNAGYOBB VAKFOLT A TESZT-PIRAMISBAN.
//
//  A backend suite 60 fájlja `createUser` / `createJob` SQL-fixtúrákkal épít
//  állapotot. Ez gyors és pontos — DE azt jelenti, hogy MINDEN teszt
//  MEGKERÜLI a valódi belépési pontokat: a regisztrációt, az e-mail-
//  megerősítést, a KYC-feltöltést, a fizetés-indítást.
//
//  Következmény: ha bármelyik NYILVÁNOS út elromlana (a regisztráció 500-at
//  ad, a verifikációs link nem működik, a KYC-feltöltés elutasít minden
//  képet), a suite ATTÓL MÉG ZÖLD MARADNA — mert a tesztek soha nem használják
//  őket. A `szerep-lefedettseg` őr ugyan meghívja mindegyiket, de KÜLÖN-KÜLÖN,
//  fixtúrával előkészített állapotból; azt nem méri, hogy a lépések EGYMÁSRA
//  ÉPÍTVE végigvihetők-e.
//
//  EZ A FÁJL SZABÁLYA: setuphoz NINCS `db.query`. Minden állapot HTTP-n
//  keresztül keletkezik, pontosan úgy, ahogy egy valódi felhasználónál.
//
//  KÉT INDOKOLT KIVÉTEL (mindkettő a valódi világot MODELLEZI, nem kerüli meg):
//    1. E-MAIL-CSATORNA: a verifikációs linket az elküldött LEVÉLBŐL olvassuk
//       ki (spy-jal), ahogy a felhasználó is a postaládájából. A tokenhez a
//       DB-ből hozzányúlni CSALÁS lenne — az e-mail az igazi csatorna.
//    2. ADMIN: adminná válni nincs nyilvános út (szándékosan). Egyetlen admin
//       sort SQL-lel vetünk el — ez a rendszer peremfeltétele, nem megkerülés.
//
//  A fájl végén LEFEDETTSÉGI JELENTÉS: hány végpontot ért el a tiszta
//  HTTP-út, és a mag-folyamat minden lépése benne van-e.
// =====================================================================
import {
  describe, it, expect, afterAll, vi,
} from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);

// ── Az e-mail-csatorna elfogása (a „postaláda") ──────────────────────
//
// ⚠️ A SORREND A LÉNYEG, nem a `vi.mock`. Két dolog miatt:
//   1. A route-ok DESTRUKTURÁLVA importálnak
//      (`const { sendEmailVerificationEmail } = require('../services/email')`),
//      tehát a hivatkozást a saját betöltésükkor rögzítik.
//   2. Ez a fájl `createRequire`-rel tölt be, ami a NODE CJS-cache-t
//      használja — a vitest `vi.mock`-ja azt nem látja.
//
// Ezért a levelező modult ELŐBB töltjük be és foltozzuk, MINT a szervert:
// mire az `auth.js` destrukturál, már a mi függvényünket kapja.
const POSTALADA = [];
const emailService = require('../src/services/email');
emailService.sendEmailVerificationEmail = async (arg) => {
  POSTALADA.push({ tipus: 'verify', ...arg });
  return { stub: true };
};

// …és CSAK EZUTÁN a szerver.
const jwt = require('jsonwebtoken');
const { app, db, TINY_PNG } = require('./helpers');

/** A NYILVÁNOS úton elért végpontok — a jelentéshez. */
//
// ⚠️ A SZERVER `request` ESEMÉNYÉRE kötünk, NEM middleware-ként. Egy
// `app.use(...)` a már felcsatolt route-ok UTÁN a stack VÉGÉRE kerül, tehát
// csak akkor futna le, ha egyetlen route sem kezelte a kérést — vagyis épp a
// sikeres hívásokat nem látná. (Az első változatom pontosan ezen bukott el;
// a `szerep-lefedettseg` őr ugyanezt a megoldást használja, ugyanezért.)
const ELERT = new Set();
app.on('request', (req, res) => {
  res.on('finish', () => {
    if (!req.route || res.statusCode >= 400) return;
    ELERT.add(`${req.method} ${((req.baseUrl || '') + req.route.path).replace(/\/{2,}/g, '/')}`);
  });
});

afterAll(() => { vi.restoreAllMocks(); });

const egyediEmail = (mi) => `feketedoboz-${mi}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const JELSZO = 'FeketeDoboz12345';

/** Regisztráció + e-mail-megerősítés, KIZÁRÓLAG a nyilvános úton. */
async function regisztralEsMegerosit(nev) {
  const email = egyediEmail(nev);
  const reg = await request(app).post('/auth/register').send({
    email, password: JELSZO, full_name: `Feketedoboz ${nev}`, phone: '+36201234567',
  });
  expect(reg.status, `a regisztráció elbukott (${nev}): ${JSON.stringify(reg.body)}`).toBe(201);

  // A verifikációs linket a LEVÉLBŐL vesszük — ahogy a felhasználó is.
  const level = POSTALADA.filter((l) => l.to === email).pop();
  expect(level, `nem ment ki verifikációs levél (${nev}) — a felhasználó nem tudná megerősíteni magát`).toBeTruthy();
  const token = String(level.verifyUrl).split('token=')[1];
  expect(token, 'a levélben nincs használható token').toBeTruthy();

  const ver = await request(app).get(`/auth/verify-email?token=${token}`);
  expect([200, 302]).toContain(ver.status);

  const login = await request(app).post('/auth/login').send({ email, password: JELSZO });
  expect(login.status, 'a bejelentkezés elbukott a megerősítés után').toBe(200);
  return { email, token: login.body.token, id: login.body.user.id };
}

describe('Feketedoboz: a teljes út a nyilvános felületen', () => {
  it('regisztráció → megerősítés → fuvar → ajánlat → fizetés → kézbesítés → értékelés', async () => {
    // ── 1. Két felhasználó, valódi regisztrációval ──────────────────
    const felado = await regisztralEsMegerosit('felado');
    const szallito = await regisztralEsMegerosit('szallito');

    // ── 2. A szállító KYC-t tölt fel (nyilvános úton, valódi képpel) ─
    const gemini = require('../src/services/gemini');
    vi.spyOn(gemini, 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.95, documentNumber: `FD${Date.now()}`,
      holder_name: null, likely_copy: false, birthDate: '1990-01-01',
    });
    const kyc = await request(app)
      .post('/auth/kyc-document')
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('doc_type', 'id_card')
      .attach('file', TINY_PNG, 'szemelyi.png');
    expect(kyc.status, `a KYC-feltöltés elbukott: ${JSON.stringify(kyc.body)}`).toBe(200);

    // A szállító-móddal járó nyilatkozat is nyilvános úton
    const nyil = await request(app)
      .post('/auth/accept-driver-terms')
      .set('Authorization', `Bearer ${szallito.token}`).send({});
    expect(nyil.status).toBe(200);

    // ── 2/b. Az ADMIN jóváhagyja a KYC-t (a dokumentált kivétel) ────
    //
    // Adminná válni nincs nyilvános út — szándékosan. Ez a rendszer
    // PEREMFELTÉTELE, nem megkerülés: az admin léte adottság, a MŰVELETEI
    // viszont innentől megint a nyilvános admin-API-n mennek.
    //
    // ⚠️ Az AI-válaszunkban `holder_name: null`, ezért a KYC KÉZI
    // ELLENŐRZÉSRE kerül (kycReview) — vagyis ez az ág a VALÓDI működés,
    // nem kerülőút. Épp ezért méri egyben az admin-jóváhagyást is.
    const adminEmail = egyediEmail('admin');
    const { rows: adminSor } = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone,
                          identity_kyc_status, driver_kyc_status, email_verified)
       VALUES ('admin', $1, 'x', 'Feketedoboz admin', '+36201234567',
               'verified', 'verified', TRUE)
       RETURNING id`,
      [adminEmail],
    );
    const adminToken = jwt.sign(
      { sub: adminSor[0].id, role: 'admin', email: adminEmail, tv: 0 },
      process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1d' },
    );

    const kycLista = await request(app)
      .get('/admin/kyc-documents')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(kycLista.status, 'az admin nem éri el a KYC-listát').toBe(200);
    const dok = (kycLista.body.documents || kycLista.body || [])
      .find((d) => d.user_id === szallito.id);
    expect(dok, 'a feltöltött KYC-dokumentum nem jelent meg az admin-listán').toBeTruthy();

    const jovahagy = await request(app)
      .patch(`/admin/kyc-documents/${dok.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' });
    expect(jovahagy.status, `a KYC-jóváhagyás elbukott: ${JSON.stringify(jovahagy.body)}`).toBe(200);

    // ── 3. A feladó fuvart ad fel ───────────────────────────────────
    const fuvar = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({
        title: 'Feketedoboz teszt-fuvar',
        description: 'Egy doboz, óvatosan',
        pickup_address: 'Budapest, Váci út 1.',
        pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Kossuth tér 1.',
        dropoff_lat: 46.2530, dropoff_lng: 20.1414,
        weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
      });
    expect(fuvar.status, `a fuvarfeladás elbukott: ${JSON.stringify(fuvar.body)}`).toBe(201);
    const jobId = fuvar.body.id;

    // ⚠️ A LÉTREHOZÁS VÁLASZA nem adhatja ki a címzett kódját (2026-08-06).
    expect(fuvar.body.delivery_code, 'a feladó megkapta a CÍMZETT átvételi kódját').toBeUndefined();

    // ── 4. A szállító ajánlatot tesz, a feladó elfogadja ────────────
    const ajanlat = await request(app)
      .post(`/jobs/${jobId}/bids`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ amount_huf: 25000, eta_minutes: 240, message: 'Vállalom', return_policy: 'included' });
    expect(ajanlat.status, `az ajánlattétel elbukott: ${JSON.stringify(ajanlat.body)}`).toBe(201);

    const elfogad = await request(app)
      .post(`/bids/${ajanlat.body.id}/accept`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(elfogad.status, `az elfogadás elbukott: ${JSON.stringify(elfogad.body)}`).toBe(200);

    // ── 5. A DÍJ-KAPU: kontakt CSAK fizetés után ────────────────────
    const fizetesElott = await request(app)
      .get(`/jobs/${jobId}`)
      .set('Authorization', `Bearer ${szallito.token}`);
    expect(fizetesElott.status).toBe(200);
    expect(
      fizetesElott.body.contact,
      'A KONTAKT FIZETÉS ELŐTT KIMENT — ez a platform egyetlen bevételi kapuja.',
    ).toBeFalsy();

    const fizetes = await request(app)
      .post(`/jobs/${jobId}/pay`)
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ consent: true });
    expect(fizetes.status, `a fizetés-indítás elbukott: ${JSON.stringify(fizetes.body)}`).toBe(200);

    // Stub-providernél a nyugtázás a nyilvános úton megy (élesben a webhook).
    const nyugta = await request(app)
      .post(`/jobs/${jobId}/confirm-payment`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect([200, 409]).toContain(nyugta.status);

    // ── 6. Felvétel fotóval, majd kézbesítés a kóddal ───────────────
    const felvetel = await request(app)
      .post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'pickup')
      .attach('file', TINY_PNG, 'felvetel.png');
    expect(felvetel.status, `a felvételi fotó elbukott: ${JSON.stringify(felvetel.body)}`).toBe(201);

    // A kódot a FELADÓ kapja meg a saját fuvar-nézetében (nincs külön címzett).
    const sajatNezet = await request(app)
      .get(`/jobs/${jobId}`)
      .set('Authorization', `Bearer ${felado.token}`);
    const kod = sajatNezet.body.sender_delivery_code || sajatNezet.body.delivery_code;
    expect(kod, 'a feladó nem kapott átvételi kódot — a fuvart nem lehetne lezárni').toBeTruthy();

    const kezbesites = await request(app)
      .post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'dropoff')
      .field('delivery_code', kod)
      .attach('file', TINY_PNG, 'kezbesites.png');
    expect(
      kezbesites.status,
      `a kézbesítés elbukott: ${JSON.stringify(kezbesites.body)}`,
    ).toBe(201);

    // ── 7. Értékelés + adatexport + fiók-törlés ─────────────────────
    const ertekeles = await request(app)
      .post(`/jobs/${jobId}/reviews`)
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ rating: 5, comment: 'Minden rendben ment' });
    expect([201, 200]).toContain(ertekeles.status);

    const exportRes = await request(app)
      .get('/auth/me/export')
      .set('Authorization', `Bearer ${felado.token}`);
    expect(exportRes.status, 'az adatexport elbukott a nyilvános úton').toBe(200);
    expect(
      Array.isArray(exportRes.body.feladott_fuvarok) && exportRes.body.feladott_fuvarok.length,
      'az export nem tartalmazza a most feladott fuvart',
    ).toBeTruthy();

    // A szállító fiókja törölhető (nincs blokkoló ügylete a lezárás után).
    const torles = await request(app)
      .delete('/auth/me')
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ password: JELSZO });
    expect([200, 409]).toContain(torles.status);
  }, 60_000);

  it('LEFEDETTSÉGI JELENTÉS: a mag-folyamat minden lépése a nyilvános úton megy', () => {
    // A rendszer „gerince": ha ezek bármelyike csak fixtúrával érhető el,
    // akkor a valódi felhasználó számára elromolhat úgy, hogy nem vesszük észre.
    const MAG = [
      'POST /auth/register',
      'GET /auth/verify-email',
      'POST /auth/login',
      'POST /auth/kyc-document',
      'POST /auth/accept-driver-terms',
      'POST /jobs/',
      'GET /jobs/:id',
      'POST /jobs/:jobId/bids',
      'POST /bids/:id/accept',
      'POST /jobs/:id/pay',
      'POST /jobs/:jobId/photos',
      'GET /auth/me/export',
    ];
    const hianyzik = MAG.filter((v) => !ELERT.has(v));

    expect(
      hianyzik,
      `A mag-folyamat ezen lépései NEM futottak le a tiszta HTTP-úton:\n  ${hianyzik.join('\n  ')}\n\n`
      + 'Ez azt jelenti, hogy a rendszer ezen része KIZÁRÓLAG SQL-fixtúrával\n'
      + 'tesztelt — vagyis elromolhat a valódi felhasználó számára úgy, hogy a\n'
      + 'suite zöld marad. Ha egy lépés szándékosan nem érhető el nyilvánosan\n'
      + '(pl. admin-jog), vedd ki a MAG listából, írásos indoklással.\n\n'
      + `A feketedoboz-út ${ELERT.size} végpontot ért el összesen.`,
    ).toEqual([]);

    // eslint-disable-next-line no-console
    console.log(`[feketedoboz] a tiszta HTTP-út ${ELERT.size} végpontot ért el`);
  });

  it('a fájl NEM használ SQL-fixtúrát az állapot felépítéséhez', () => {
    // ⚠️ ÖNVÉDELEM. Ha valaki „megjavítja" ezt a tesztet egy gyors
    // `createUser`-rel, azzal pontosan azt a vakfoltot hozza vissza, ami
    // miatt a fájl létrejött — és a feketedoboz-jelleg némán elveszik.
    const { readFileSync } = require('fs');
    const forras = readFileSync(__filename, 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // A neveket DARABOKBÓL rakjuk össze, különben ez a lista MAGA lenne a
    // találat (az első változatom pontosan ezen bukott el).
    const tiltottak = ['create' + 'User(', 'create' + 'Job(', 'create' + 'Booking('];
    // Egyetlen `db.query` megengedett: az admin-sor (peremfeltétel). Ha több
    // lenne, az már állapot-építés SQL-lel — vagyis a feketedoboz-jelleg vége.
    const dbHivasok = (forras.match(/db\.query\(/g) || []).length;
    expect(
      dbHivasok,
      `${dbHivasok} db.query-hívás van a fájlban. Pontosan EGY megengedett: az `
      + 'admin-sor elvetése, mert adminná válni nincs nyilvános út. Minden más '
      + 'állapotnak a HTTP-felületen kell keletkeznie.',
    ).toBeLessThanOrEqual(1);
    for (const tiltott of tiltottak) {
      expect(
        forras.includes(tiltott),
        `A feketedoboz-teszt SQL-fixtúrát használ (${tiltott}). Az egész fájl `
        + 'értelme, hogy az állapot a NYILVÁNOS úton keletkezzen.',
      ).toBe(false);
    }
  });
});
