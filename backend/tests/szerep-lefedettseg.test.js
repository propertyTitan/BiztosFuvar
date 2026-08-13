// =====================================================================
//  SZEREP-LEFEDETTSÉG — a feladói ÉS a szállítói felület minden végpontja
//
//  Miért kellett (2026-08-07): megmértük, hogy a teszt-készlet melyik
//  végpontot futtatja le TÉNYLEGESEN SIKERESEN, és kiderült, hogy a 126-ból
//  csak 42-t. A többit a jogosultság-batteryk csak hibaágon „érintették"
//  (401/403) — vagyis a legtöbb funkcióról azt sem tudtuk, működik-e
//  egyáltalán. Egy 401 nem bizonyítja, hogy a végpont a helyes választ adja
//  annak, akinek szabad.
//
//  Ez a suite MINDEN végpontot a JOGOSULT szereplővel hív meg, és sikeres
//  választ vár. Nem az üzleti szabályokat mélyíti (azt a teljes-ut és a
//  hulyebiztos-matrix teszi) — azt garantálja, hogy a felület egyetlen
//  funkciója se legyen „soha senki által le nem futtatott" kód.
//
//  ⚠️ ÖNVÉDŐ: a fájl végén álló lefedettség-őr elhasal, ha bekerül egy új
//  végpont, amit itt senki nem hív le sikeresen — és nincs írásos indok a
//  KIVETELEK listában. Így a lefedettség nem tud némán visszacsúszni.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, expressApp, TINY_PNG } = require('./helpers');
const { listRoutes, routeKey } = require('./routeInventory');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

// ── Lefedettség-műszer ────────────────────────────────────────────────
// A szerverre kötve figyeljük, melyik route-mintát sikerült SIKERESEN
// meghívni. (Middleware-ként nem menne: a route-ok után a stack végére
// kerülne, és sosem futna le.)
const SIKERES = new Set();
app.on('request', (req, res) => {
  res.on('finish', () => {
    if (!req.route || res.statusCode >= 400) return;
    SIKERES.add(`${req.method} ${((req.baseUrl || '') + req.route.path).replace(/\/{2,}/g, '/')}`);
  });
});

/** Sikeres hívást vár; hiba esetén a válasz-testet is kiírja. */
async function sikeres(cim, keres) {
  __resetRateLimitsForTests();
  const res = await keres;
  expect(
    res.status,
    `${cim} → ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`,
  ).toBeLessThan(400);
  return res;
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// ── Közös világ ───────────────────────────────────────────────────────
let V; // a fixture

beforeAll(async () => {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const admin = await createUser({ role: 'admin' });
  const masodikSzallito = await createUser({ role: 'carrier' });

  // Fuvarok különböző állapotokban
  const licitalhato = await createJob({ shipperId: felado.id, status: 'bidding' });
  const uton = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
  });
  const kezbesitett = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
  });

  // Ajánlat a licitálható fuvarra
  const { rows: bidRows } = await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 14000) RETURNING id`,
    [licitalhato.id, szallito.id],
  );

  // Járat + foglalás
  const { booking, routeId } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
  });

  // Vita a kézbesített fuvarra
  const { rows: vitaRows } = await db.query(
    `INSERT INTO disputes (job_id, opened_by, against_user, description)
     VALUES ($1, $2, $3, 'Teszt vita') RETURNING id`,
    [kezbesitett.id, felado.id, szallito.id],
  );

  // Értesítés a feladónak
  const { rows: ertRows } = await db.query(
    `INSERT INTO notifications (user_id, type, title, body)
     VALUES ($1, 'system', 'Teszt értesítés', 'törzsszöveg') RETURNING id`,
    [felado.id],
  );

  V = {
    felado, szallito, admin, masodikSzallito,
    licitalhato, uton, kezbesitett,
    bidId: bidRows[0].id, booking, routeId,
    vitaId: vitaRows[0].id, ertesitesId: ertRows[0].id,
  };
});

// =====================================================================
//  PUBLIKUS FELÜLET
// =====================================================================
describe('Publikus végpontok', () => {
  it('életjel, lefedettségi zónák, ár-kalkulátor', async () => {
    await sikeres('GET /health', request(app).get('/health'));
    await sikeres('GET /coverage/zones', request(app).get('/coverage/zones'));
    await sikeres('GET /calculator/estimate', request(app)
      .get('/calculator/estimate')
      .query({ pickup_lat: 47.4979, pickup_lng: 19.0402, dropoff_lat: 46.253, dropoff_lng: 20.1414, weight_kg: 5 }));
  });

  it('privát fájl CSAK érvényes aláírással olvasható (KYC disk-fallback)', async () => {
    const storage = require('../src/services/storage');
    const privateUrl = await storage.savePrivateFile(TINY_PNG, 'okmany.png', 'image/png');
    const signed = await storage.getSignedPrivateUrl(privateUrl);
    expect(signed).toMatch(/^\/private-files\//);

    await sikeres('GET /private-files/:name', request(app).get(signed));

    // Aláírás nélkül / hamis aláírással nincs hozzáférés
    const utNev = signed.split('?')[0];
    expect((await request(app).get(utNev)).status).toBe(404);
    expect((await request(app).get(`${utNev}?exp=99999999999&sig=${'a'.repeat(32)}`)).status).toBe(404);
    // …és a statikus kiszolgálás sem adja ki a private mappát
    expect((await request(app).get(`/uploads/private/${utNev.split('/').pop()}`)).status).toBe(404);
  });

  it('adatexport: a felhasználó letöltheti a saját adatait (GDPR 20. cikk)', async () => {
    await sikeres('GET /auth/me/export', request(app).get('/auth/me/export').set(auth(V.felado.token)));
  });

  it('nyilvános küldemény-követés a címzett tokenjével', async () => {
    const { rows } = await db.query('SELECT tracking_token FROM jobs WHERE id = $1', [V.uton.id]);
    const res = await sikeres('GET /tracking/:token',
      request(app).get(`/tracking/${rows[0].tracking_token}`));
    // A címzett látja a PIN-t — ez a token értelme
    expect(res.body.delivery_code).toBeTruthy();
  });

  it('belépés jelszóval', async () => {
    const email = `belepes-${Date.now()}@teszt.gofuvar.hu`;
    const jelszo = 'Jelszo123!';
    const reg = await sikeres('POST /auth/register', request(app).post('/auth/register')
      .send({ email, password: jelszo, full_name: 'Belépő Béla' }));
    expect(reg.body.token).toBeTruthy();

    const be = await sikeres('POST /auth/login',
      request(app).post('/auth/login').send({ email, password: jelszo }));
    expect(be.body.token).toBeTruthy();
  });

  it('elfelejtett jelszó kérése és email-megerősítő link', async () => {
    await sikeres('POST /auth/forgot-password',
      request(app).post('/auth/forgot-password').send({ email: V.felado.email }));

    // Email-verifikációs token: a DB-ben csak a HASH-e van tárolva (a nyers
    // tokent csak a levél tartalmazza), ezért ugyanúgy hasheljük, mint a kód.
    const crypto = require('crypto');
    const token = 'teszt-verify-token-' + Date.now();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query(
      `UPDATE users SET email_verification_token_hash = $1 WHERE id = $2`,
      [tokenHash, V.masodikSzallito.id],
    );
    await sikeres('GET /auth/verify-email',
      request(app).get('/auth/verify-email').query({ token }));
  });
});

// =====================================================================
//  KÖZÖS (belépett) FELÜLET
// =====================================================================
describe('Közös felület: profil, értesítések, üzenetek', () => {
  it('profil olvasása és szerkesztése', async () => {
    await sikeres('GET /auth/me', request(app).get('/auth/me').set(auth(V.felado.token)));
    await sikeres('PATCH /auth/me', request(app).patch('/auth/me')
      .set(auth(V.felado.token)).send({ full_name: 'Módosított Név', bio: 'rövid bemutatkozás' }));
    await sikeres('GET /auth/users/:id/profile', request(app)
      .get(`/auth/users/${V.szallito.id}/profile`).set(auth(V.felado.token)));
    await sikeres('GET /auth/referral', request(app).get('/auth/referral').set(auth(V.felado.token)));
  });

  it('értesítések listája, olvasottá tétel', async () => {
    await sikeres('GET /notifications', request(app).get('/notifications').set(auth(V.felado.token)));
    await sikeres('GET /notifications/unread-count',
      request(app).get('/notifications/unread-count').set(auth(V.felado.token)));
    await sikeres('POST /notifications/:id/read', request(app)
      .post(`/notifications/${V.ertesitesId}/read`).set(auth(V.felado.token)).send({}));
    await sikeres('POST /notifications/read-all',
      request(app).post('/notifications/read-all').set(auth(V.felado.token)).send({}));
  });

  it('chat: üzenetküldés és -olvasás mindkét irányban', async () => {
    await sikeres('POST /messages (feladó)', request(app).post('/messages')
      .set(auth(V.felado.token)).send({ job_id: V.uton.id, body: 'Mikor érsz ide?' }));
    await sikeres('POST /messages (szállító)', request(app).post('/messages')
      .set(auth(V.szallito.token)).send({ job_id: V.uton.id, body: 'Fél óra múlva.' }));
    await sikeres('GET /messages', request(app).get('/messages')
      .query({ job_id: V.uton.id }).set(auth(V.felado.token)));
  });

  it('push-token regisztrálás és AI-segéd', async () => {
    await sikeres('POST /auth/push-token', request(app).post('/auth/push-token')
      .set(auth(V.szallito.token)).send({ token: 'ExponentPushToken[teszt]', platform: 'android' }));
    // Gemini kulcs nélkül stub-választ ad — a kódút így is lefut
    await sikeres('POST /ai/chat', request(app).post('/ai/chat')
      .set(auth(V.felado.token)).send({ message: 'Hogyan működik a GoFuvar?' }));
  });

  it('KYC-dokumentum feltöltés és státusz', async () => {
    await sikeres('POST /auth/kyc-document', request(app).post('/auth/kyc-document')
      .set(auth(V.masodikSzallito.token))
      .field('doc_type', 'id_card').attach('file', TINY_PNG, 'id.png'));
    await sikeres('GET /auth/kyc-status',
      request(app).get('/auth/kyc-status').set(auth(V.masodikSzallito.token)));
    await sikeres('POST /auth/avatar', request(app).post('/auth/avatar')
      .set(auth(V.felado.token)).attach('file', TINY_PNG, 'avatar.png'));
    await sikeres('POST /auth/resend-verification',
      request(app).post('/auth/resend-verification').set(auth(V.masodikSzallito.token)).send({}));
  });
});

// =====================================================================
//  FELADÓI FELÜLET
// =====================================================================
describe('Feladói felület: minden funkció lefut', () => {
  it('fuvarjaim, fuvar-részletek, díj-állapot', async () => {
    await sikeres('GET /jobs/', request(app).get('/jobs/').set(auth(V.felado.token)));
    await sikeres('GET /jobs/mine/list', request(app).get('/jobs/mine/list').set(auth(V.felado.token)));
    await sikeres('GET /jobs/:id', request(app).get(`/jobs/${V.uton.id}`).set(auth(V.felado.token)));
    await sikeres('GET /jobs/:jobId/escrow',
      request(app).get(`/jobs/${V.uton.id}/escrow`).set(auth(V.felado.token)));
    await sikeres('GET /payments/payout-status/:jobId',
      request(app).get(`/payments/payout-status/${V.uton.id}`).set(auth(V.felado.token)));
    await sikeres('GET /jobs/:jobId/photos',
      request(app).get(`/jobs/${V.uton.id}/photos`).set(auth(V.felado.token)));
    await sikeres('GET /jobs/:jobId/location/last',
      request(app).get(`/jobs/${V.uton.id}/location/last`).set(auth(V.felado.token)));
  });

  it('beérkezett ajánlatok kezelése: listázás, ellenajánlat', async () => {
    await sikeres('GET /jobs/:jobId/bids',
      request(app).get(`/jobs/${V.licitalhato.id}/bids`).set(auth(V.felado.token)));
    await sikeres('POST /bids/:id/counter', request(app)
      .post(`/bids/${V.bidId}/counter`).set(auth(V.felado.token)).send({ amount: 13000 }));
    // …és a szállító elfogadja az ellenajánlatot
    await sikeres('POST /bids/:id/accept-counter', request(app)
      .post(`/bids/${V.bidId}/accept-counter`).set(auth(V.szallito.token)).send({}));
  });

  it('kérdés-válasz a fuvar alatt', async () => {
    // SAJÁT, friss fuvar: a közös `licitalhato`-t az ellenajánlat-elfogadás
    // már „accepted"-re vitte, kérdést pedig csak nyitott fuvarra lehet
    // feltenni — így a teszt nem függ a futási sorrendtől.
    const nyitott = await createJob({ shipperId: V.felado.id, status: 'bidding' });
    const kerdes = await sikeres('POST /jobs/:jobId/questions', request(app)
      .post(`/jobs/${nyitott.id}/questions`).set(auth(V.masodikSzallito.token))
      .send({ question: 'Van lift a lerakodási címen?' }));
    await sikeres('GET /jobs/:jobId/questions',
      request(app).get(`/jobs/${nyitott.id}/questions`).set(auth(V.felado.token)));
    await sikeres('POST /questions/:id/answer', request(app)
      .post(`/questions/${kerdes.body.id}/answer`).set(auth(V.felado.token))
      .send({ answer: 'Igen, van lift.' }));
    V.kerdesId = kerdes.body.id;   // az admin-blokk rejti el
  });

  it('járat-böngészés és foglalás', async () => {
    await sikeres('GET /carrier-routes',
      request(app).get('/carrier-routes').set(auth(V.felado.token)));
    await sikeres('GET /carrier-routes/:id',
      request(app).get(`/carrier-routes/${V.routeId}`).set(auth(V.felado.token)));
    // A járatnak lennie kell M-es árának, különben nem vállalja a csomagot
    await db.query(
      `INSERT INTO carrier_route_prices (route_id, size, price_huf)
       VALUES ($1, 'M', 9000) ON CONFLICT DO NOTHING`,
      [V.routeId],
    );
    await sikeres('POST /carrier-routes/:id/bookings', request(app)
      .post(`/carrier-routes/${V.routeId}/bookings`).set(auth(V.felado.token))
      .send({
        package_size: 'M', length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Kossuth L. sgt. 1.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
      }));
    await sikeres('GET /route-bookings/mine',
      request(app).get('/route-bookings/mine').set(auth(V.felado.token)));
    await sikeres('GET /route-bookings/:id',
      request(app).get(`/route-bookings/${V.booking.id}`).set(auth(V.felado.token)));
    await sikeres('GET /route-bookings/:bookingId/photos',
      request(app).get(`/route-bookings/${V.booking.id}/photos`).set(auth(V.felado.token)));
  });

  it('vitáim és értékelés', async () => {
    await sikeres('GET /disputes/mine',
      request(app).get('/disputes/mine').set(auth(V.felado.token)));
    await sikeres('GET /disputes/:id',
      request(app).get(`/disputes/${V.vitaId}`).set(auth(V.felado.token)));
    await sikeres('POST /reviews', request(app).post('/reviews')
      .set(auth(V.felado.token))
      .send({ job_id: V.kezbesitett.id, stars: 5, comment: 'Pontos, korrekt.' }));
    await sikeres('GET /reviews', request(app).get('/reviews')
      .query({ user_id: V.szallito.id }).set(auth(V.felado.token)));
  });

  it('SOS-jelzés', async () => {
    await sikeres('POST /sos', request(app).post('/sos').set(auth(V.felado.token))
      .send({ job_id: V.uton.id, kind: 'other', message: 'Segítség kell.' }));
    await sikeres('GET /sos/mine', request(app).get('/sos/mine').set(auth(V.felado.token)));
  });
});

// =====================================================================
//  SZÁLLÍTÓI FELÜLET
// =====================================================================
describe('Szállítói felület: minden funkció lefut', () => {
  it('elérhető fuvarok, ajánlataim, ajánlat-előnézet', async () => {
    await sikeres('GET /jobs/ (szállító)', request(app).get('/jobs/').set(auth(V.szallito.token)));
    await sikeres('GET /bids/mine', request(app).get('/bids/mine').set(auth(V.szallito.token)));
    await sikeres('GET /bids/preview', request(app).get('/bids/preview')
      .query({ amount: 14000 }).set(auth(V.szallito.token)));
  });

  it('járataim: létrehozás, szerkesztés, státusz, foglalások', async () => {
    const uj = await sikeres('POST /carrier-routes', request(app).post('/carrier-routes')
      .set(auth(V.szallito.token))
      .send({
        title: 'Szerep-teszt járat',
        departure_at: new Date(Date.now() + 86400000).toISOString(),
        waypoints: [
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
          { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
        ],
        prices: [{ size: 'M', price_huf: 9000 }],
      }));
    await sikeres('GET /carrier-routes/mine',
      request(app).get('/carrier-routes/mine').set(auth(V.szallito.token)));
    await sikeres('PATCH /carrier-routes/:id', request(app)
      .patch(`/carrier-routes/${uj.body.id}`).set(auth(V.szallito.token))
      .send({ vehicle_description: 'Kisteherautó, 1 m³' }));
    await sikeres('PATCH /carrier-routes/:id/status', request(app)
      .patch(`/carrier-routes/${uj.body.id}/status`).set(auth(V.szallito.token))
      .send({ status: 'open' }));
    await sikeres('GET /carrier-routes/:id/bookings', request(app)
      .get(`/carrier-routes/${V.routeId}/bookings`).set(auth(V.szallito.token)));
    await sikeres('GET /carrier-routes/:id/along-jobs', request(app)
      .get(`/carrier-routes/${uj.body.id}/along-jobs`).set(auth(V.szallito.token)));
  });

  it('visszafuvar-ajánlatok', async () => {
    await sikeres('GET /backhaul/suggestions', request(app)
      .get('/backhaul/suggestions').set(auth(V.szallito.token)));
    await sikeres('GET /backhaul/for-trip/:jobId', request(app)
      .get(`/backhaul/for-trip/${V.uton.id}`).set(auth(V.szallito.token)));
  });

  it('útvonal-figyelő (lane alert) teljes életciklusa', async () => {
    const alert = await sikeres('POST /carrier-alerts', request(app)
      .post('/carrier-alerts').set(auth(V.szallito.token))
      .send({
        from_city: 'Budapest', to_city: 'Szeged',
        from_lat: 47.4979, from_lng: 19.0402, to_lat: 46.253, to_lng: 20.1414,
        radius_km: 25,
      }));
    await sikeres('GET /carrier-alerts',
      request(app).get('/carrier-alerts').set(auth(V.szallito.token)));
    await sikeres('PATCH /carrier-alerts/:id', request(app)
      .patch(`/carrier-alerts/${alert.body.id}`).set(auth(V.szallito.token))
      .send({ active: false }));
    await sikeres('DELETE /carrier-alerts/:id', request(app)
      .delete(`/carrier-alerts/${alert.body.id}`).set(auth(V.szallito.token)));
  });

  it('szállítói statisztika és irányítópult', async () => {
    await sikeres('GET /driver-stats', request(app).get('/driver-stats').set(auth(V.szallito.token)));

    await sikeres('GET /auth/me/driver-dashboard',
      request(app).get('/auth/me/driver-dashboard').set(auth(V.szallito.token)));
    await sikeres('GET /auth/me/game-stats',
      request(app).get('/auth/me/game-stats').set(auth(V.szallito.token)));
  });

  it('foglalás kezelése: megerősítés és fizetés-visszaigazolás', async () => {
    const { booking } = await createBooking({
      shipperId: V.felado.id, carrierId: V.szallito.id, status: 'pending', paid: false,
    });
    await sikeres('POST /route-bookings/:id/confirm', request(app)
      .post(`/route-bookings/${booking.id}/confirm`).set(auth(V.szallito.token)).send({}));
    await sikeres('POST /route-bookings/:id/pay', request(app)
      .post(`/route-bookings/${booking.id}/pay`).set(auth(V.felado.token)).send({ consent: true }));
    await sikeres('POST /route-bookings/:id/confirm-payment', request(app)
      .post(`/route-bookings/${booking.id}/confirm-payment`).set(auth(V.felado.token)).send({}));
  });

  it('foglalás elutasítása és lemondása', async () => {
    const a = await createBooking({
      shipperId: V.felado.id, carrierId: V.szallito.id, status: 'pending', paid: false,
    });
    await sikeres('POST /route-bookings/:id/reject', request(app)
      .post(`/route-bookings/${a.booking.id}/reject`).set(auth(V.szallito.token)).send({}));

    const b = await createBooking({
      shipperId: V.felado.id, carrierId: V.szallito.id, status: 'confirmed', paid: false,
    });
    await sikeres('POST /route-bookings/:id/cancel', request(app)
      .post(`/route-bookings/${b.booking.id}/cancel`).set(auth(V.felado.token)).send({}));
  });

  it('foglalás végrehajtása: felvétel és kézbesítés', async () => {
    const { booking } = await createBooking({
      shipperId: V.felado.id, carrierId: V.szallito.id, status: 'confirmed', paid: true,
    });
    await sikeres('POST /route-bookings/:bookingId/photos (felvétel)', request(app)
      .post(`/route-bookings/${booking.id}/photos`).set(auth(V.szallito.token))
      .field('kind', 'pickup').attach('file', TINY_PNG, 'p.png'));
    await sikeres('POST /route-bookings/:bookingId/photos (kézbesítés)', request(app)
      .post(`/route-bookings/${booking.id}/photos`).set(auth(V.szallito.token))
      .field('kind', 'dropoff').field('delivery_code', '111222')
      .attach('file', TINY_PNG, 'd.png'));
  });

  it('azonnali fuvar elfogadása', async () => {
    const instant = await createJob({ shipperId: V.felado.id, status: 'bidding' });
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [instant.id],
    );
    await sikeres('POST /jobs/:id/instant-accept', request(app)
      .post(`/jobs/${instant.id}/instant-accept`).set(auth(V.szallito.token)).send({}));
  });

  it('élő pozíció küldése úton lévő fuvaron', async () => {
    await sikeres('POST /jobs/:jobId/location', request(app)
      .post(`/jobs/${V.uton.id}/location`).set(auth(V.szallito.token))
      .send({ lat: 47.2, lng: 19.5, speed_kmh: 80 }));
  });

  it('adóazonosító megadása (DAC7)', async () => {
    await sikeres('POST /auth/tax-data', request(app).post('/auth/tax-data')
      .set(auth(V.szallito.token))
      .send({ personal_tax_id: '8000000008', birth_date: '1985-04-12', address: '6800 Hódmezővásárhely, Fő u. 1.' }));
  });
});

// =====================================================================
//  A FŐ TRANZAKCIÓS ÚT — sikeres hívással minden lépésen
//
//  A teljes-ut suite az üzleti SZABÁLYOKAT mélyíti; itt az a cél, hogy a
//  lefedettség-őr önmagában teljes legyen: ne más fájlok mellékhatásaira
//  támaszkodjon annak eldöntése, hogy egy végpont valaha lefutott-e.
// =====================================================================
describe('Fő tranzakciós út: feladástól az értékelésig', () => {
  it('minden lépés sikeresen lefut', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    await sikeres('POST /auth/accept-driver-terms',
      request(app).post('/auth/accept-driver-terms').set(auth(szallito.token)).send({}));

    const job = await sikeres('POST /jobs/', request(app).post('/jobs/')
      .set(auth(felado.token))
      .send({
        title: 'Lefedettségi teszt fuvar',
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Kossuth L. sgt. 1.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
        weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
        suggested_price_huf: 15000,
      }));

    const licit = await sikeres('POST /jobs/:jobId/bids', request(app)
      .post(`/jobs/${job.body.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 14000, return_policy: 'included' }));

    await sikeres('POST /bids/:id/accept', request(app)
      .post(`/bids/${licit.body.id}/accept`).set(auth(felado.token)).send({}));

    await sikeres('POST /jobs/:id/pay', request(app)
      .post(`/jobs/${job.body.id}/pay`).set(auth(felado.token)).send({ consent: true }));
    await db.query('UPDATE jobs SET paid_at = NOW() WHERE id = $1', [job.body.id]);

    await sikeres('POST /jobs/:jobId/photos (felvétel)', request(app)
      .post(`/jobs/${job.body.id}/photos`).set(auth(szallito.token))
      .field('kind', 'pickup').attach('file', TINY_PNG, 'p.png'));

    const { rows } = await db.query('SELECT delivery_code FROM jobs WHERE id = $1', [job.body.id]);
    await sikeres('POST /jobs/:jobId/photos (kézbesítés)', request(app)
      .post(`/jobs/${job.body.id}/photos`).set(auth(szallito.token))
      .field('kind', 'dropoff').field('delivery_code', rows[0].delivery_code)
      .attach('file', TINY_PNG, 'd.png'));

    await sikeres('POST /jobs/:jobId/reviews', request(app)
      .post(`/jobs/${job.body.id}/reviews`).set(auth(felado.token))
      .send({ rating: 5, comment: 'Gyors és pontos.' }));

    await sikeres('POST /disputes', request(app).post('/disputes')
      .set(auth(felado.token))
      .send({ job_id: job.body.id, reason: 'damaged', description: 'Utólagos észrevétel.' }));
  });

  it('szállító-csere (reopen) sikeres ága', async () => {
    // A reopen a korábbi szállító ajánlatát ELUTASÍTOTTRA állítja (hogy ne
    // lehessen ugyanazt visszaválasztani), a többiét viszont visszateszi
    // függőbe — ezért két ajánlat kell hozzá.
    const felado = await createUser({ role: 'shipper' });
    const elso = await createUser({ role: 'carrier' });
    const masodik = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: elso.id, status: 'accepted', paid: true,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
       VALUES ($1, $2, 14000, 'accepted'), ($1, $3, 15000, 'rejected')`,
      [job.id, elso.id, masodik.id],
    );
    await sikeres('POST /jobs/:id/reopen', request(app)
      .post(`/jobs/${job.id}/reopen`).set(auth(felado.token)).send({}));
  });

  it('lemondás sikeres ága', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    await sikeres('POST /jobs/:id/cancel', request(app)
      .post(`/jobs/${job.id}/cancel`).set(auth(felado.token)).send({}));
  });
});

// =====================================================================
//  MENTŐS (TOWING) FELÜLET
// =====================================================================
describe('Mentős felület', () => {
  it('regisztráció, elérhetőség, kérés és a teljes menete', async () => {
    const mentos = await createUser({ role: 'carrier' });
    const bajbajutott = await createUser({ role: 'shipper' });

    await sikeres('POST /towing/register', request(app).post('/towing/register')
      .set(auth(mentos.token))
      .send({
        service_name: 'Teszt Autómentő', phone: '+36301234567',
        base_lat: 47.5, base_lng: 19.05, radius_km: 50,
        tow_services: ['breakdown', 'flat_tire'],
      }));
    await sikeres('POST /towing/toggle-available', request(app)
      .post('/towing/toggle-available').set(auth(mentos.token)).send({ is_available: true }));

    const keres = await sikeres('POST /towing/request', request(app).post('/towing/request')
      .set(auth(bajbajutott.token))
      .send({ lat: 47.51, lng: 19.06, vehicle_type: 'car', description: 'Lerobbantam.' }));

    await sikeres('GET /towing/incoming', request(app).get('/towing/incoming').set(auth(mentos.token)));
    await sikeres('GET /towing/my-requests',
      request(app).get('/towing/my-requests').set(auth(bajbajutott.token)));
    await sikeres('POST /towing/:id/accept', request(app)
      .post(`/towing/${keres.body.id}/accept`).set(auth(mentos.token)).send({}));
    await sikeres('POST /towing/:id/arrive', request(app)
      .post(`/towing/${keres.body.id}/arrive`).set(auth(mentos.token)).send({}));
    await sikeres('POST /towing/:id/complete', request(app)
      .post(`/towing/${keres.body.id}/complete`).set(auth(mentos.token)).send({}));

    const masik = await sikeres('POST /towing/request', request(app).post('/towing/request')
      .set(auth(bajbajutott.token))
      .send({ lat: 47.52, lng: 19.07, vehicle_type: 'car', description: 'Megint.' }));
    await sikeres('POST /towing/:id/cancel', request(app)
      .post(`/towing/${masik.body.id}/cancel`).set(auth(bajbajutott.token)).send({}));
  });
});

// =====================================================================
//  ADMIN FELÜLET
// =====================================================================
describe('Admin felület: minden nézet és művelet lefut', () => {
  it('áttekintő nézetek', async () => {
    for (const [cim, ut] of [
      ['stats', '/auth/admin/stats'], ['users', '/admin/users'], ['jobs', '/admin/jobs'],
      ['routes', '/admin/routes'], ['bookings', '/admin/bookings'],
      ['kyc', '/admin/kyc-documents'], ['live', '/admin/live'],
      ['fizetési napló', '/payments/admin/log'],
      ['banki felkészülési anyag', '/admin/dokumentumok/bank-felkeszules'],
    ]) {
      await sikeres(`GET ${ut} (${cim})`, request(app).get(ut).set(auth(V.admin.token)));
    }
    await sikeres('GET /admin/bids/:jobId',
      request(app).get(`/admin/bids/${V.licitalhato.id}`).set(auth(V.admin.token)));
    await sikeres('GET /admin/messages', request(app).get('/admin/messages')
      .query({ job_id: V.uton.id }).set(auth(V.admin.token)));
  });

  it('szerkesztő és karbantartó műveletek', async () => {
    await sikeres('PATCH /admin/jobs/:id', request(app)
      .patch(`/admin/jobs/${V.licitalhato.id}`).set(auth(V.admin.token)).send({ status: 'bidding' }));
    await sikeres('PATCH /admin/photo-hold', request(app)
      .patch('/admin/photo-hold').set(auth(V.admin.token))
      .send({ job_id: V.kezbesitett.id, hold: true }));
    await sikeres('PATCH /admin/coverage/:zoneId', request(app)
      .patch('/admin/coverage/europe').set(auth(V.admin.token)).send({ active: true }));
    await sikeres('POST /auth/admin/grant-monthly-vouchers', request(app)
      .post('/auth/admin/grant-monthly-vouchers').set(auth(V.admin.token)).send({}));
    await sikeres('PATCH /disputes/:id', request(app)
      .patch(`/disputes/${V.vitaId}`).set(auth(V.admin.token))
      .send({ status: 'resolved_no_action', resolution_note: 'Rendezve.' }));
    await sikeres('GET /disputes', request(app).get('/disputes').set(auth(V.admin.token)));
    await sikeres('PATCH /questions/:id/hide', request(app)
      .patch(`/questions/${V.kerdesId}/hide`).set(auth(V.admin.token)).send({}));
  });

  it('KYC-elbírálás és felhasználó-kezelés', async () => {
    const jelolt = await createUser({ role: 'carrier', kyc: 'pending' });
    const { rows } = await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'id_card', 'https://example.invalid/x.png', 'pending') RETURNING id`,
      [jelolt.id],
    );
    await sikeres('PATCH /admin/kyc-documents/:id', request(app)
      .patch(`/admin/kyc-documents/${rows[0].id}`).set(auth(V.admin.token))
      .send({ action: 'approve' }));
    await sikeres('PATCH /admin/users/:id', request(app)
      .patch(`/admin/users/${jelolt.id}`).set(auth(V.admin.token)).send({ role: 'carrier' }));
    await sikeres('POST /admin/users/:id/force-logout', request(app)
      .post(`/admin/users/${jelolt.id}/force-logout`).set(auth(V.admin.token)).send({}));
    await sikeres('DELETE /admin/users/:id', request(app)
      .delete(`/admin/users/${jelolt.id}`).set(auth(V.admin.token)));
  });

  it('admin törlő műveletek a többi entitáson', async () => {
    const f = await createUser({ role: 'shipper' });
    const sz = await createUser({ role: 'carrier' });
    const j = await createJob({ shipperId: f.id, status: 'bidding' });
    const { rows: b } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 10000) RETURNING id`,
      [j.id, sz.id],
    );
    await sikeres('DELETE /admin/bids/:id',
      request(app).delete(`/admin/bids/${b[0].id}`).set(auth(V.admin.token)));

    const { booking, routeId } = await createBooking({
      shipperId: f.id, carrierId: sz.id, status: 'pending', paid: false,
    });
    await sikeres('DELETE /admin/bookings/:id',
      request(app).delete(`/admin/bookings/${booking.id}`).set(auth(V.admin.token)));
    await sikeres('DELETE /admin/routes/:id',
      request(app).delete(`/admin/routes/${routeId}`).set(auth(V.admin.token)));
    await sikeres('DELETE /admin/jobs/:id',
      request(app).delete(`/admin/jobs/${j.id}`).set(auth(V.admin.token)));
  });

  it('user-részletnézet és admin ↔ user üzenetküldés', async () => {
    await sikeres('GET /admin/users/:id', request(app)
      .get(`/admin/users/${V.felado.id}`).set(auth(V.admin.token)));

    // Admin ír a feladónak (ez nyitja meg a válasz-csatornát)…
    await sikeres('POST /admin/dm/with/:userId', request(app)
      .post(`/admin/dm/with/${V.felado.id}`).set(auth(V.admin.token))
      .send({ body: 'Szia! Minden rendben a fiókoddal.' }));
    // …a feladó elolvassa és válaszol…
    await sikeres('GET /me/admin-messages',
      request(app).get('/me/admin-messages').set(auth(V.felado.token)));
    await sikeres('POST /me/admin-messages', request(app)
      .post('/me/admin-messages').set(auth(V.felado.token))
      .send({ body: 'Köszönöm a tájékoztatást!' }));
    // …az admin a szál-listában és a szálban is látja.
    await sikeres('GET /admin/dm/threads',
      request(app).get('/admin/dm/threads').set(auth(V.admin.token)));
    await sikeres('GET /admin/dm/with/:userId', request(app)
      .get(`/admin/dm/with/${V.felado.id}`).set(auth(V.admin.token)));

    // Körüzenet + napló
    await sikeres('POST /admin/dm/broadcast', request(app)
      .post('/admin/dm/broadcast').set(auth(V.admin.token))
      .send({ body: 'Rendszer-közlemény: minden működik.', target: 'all' }));
    await sikeres('GET /admin/dm/broadcasts',
      request(app).get('/admin/dm/broadcasts').set(auth(V.admin.token)));

    // Csatorna lezárása + visszanyitása
    await sikeres('PATCH /admin/dm/channel', request(app)
      .patch('/admin/dm/channel').set(auth(V.admin.token))
      .send({ user_id: V.felado.id, closed: false }));
  });
});

// =====================================================================
//  FIÓK-TÖRLÉS (a végén, mert visszafordíthatatlan)
// =====================================================================
describe('Fiók törlése', () => {
  it('a felhasználó törölheti a saját fiókját', async () => {
    const elkoszono = await createUser({ role: 'shipper' });
    await sikeres('DELETE /auth/me',
      request(app).delete('/auth/me').set(auth(elkoszono.token)));
  });
});

// =====================================================================
//  LEFEDETTSÉG-ŐR — ennek KELL utolsónak futnia
// =====================================================================
describe('Lefedettség-őr', () => {
  /**
   * Végpontok, amiket SZÁNDÉKOSAN nem hívunk le sikeresen — mindegyikhez
   * írásos indokkal. Ha ide kerül valami, azt tudatosan tettük.
   */
  const KIVETELEK = {
    'GET /link-preview': 'valódi külső HTTP-kérést igényel (IKEA/OBI oldal); a web E2E mockolja',
    'POST /payments/cib/callback': 'PSP szerver-szerver webhook (CIB vPOS, a launch fizetése); a hamisítás-védelmet a fizetes-webhook suite fedi (mockolt PSP-visszaolvasás)',
    'POST /payments/qvik/callback': 'PSP szerver-szerver webhook (QVIK, dormant); élesítéskor kap éles tesztet',
    'POST /auth/reset-password': 'a jelszó-reset tokent email-ben küldjük; a token-ágat a session-invalidacio suite fedi',
    'POST /auth/verify-company': 'NAV Online Számla technikai user kell hozzá; a nav-cegellenorzes suite mockolt NAV-val fedi',
    'POST /jobs/:id/confirm-payment': 'élesben TILTOTT (a webhook a hiteles forrás); a fizetes-es-lezaras suite fedi a tiltást',
  };

  it('minden végpontra fut legalább egy SIKERES hívás valamelyik tesztből', () => {
    const osszes = listRoutes(expressApp).map(routeKey);
    const hianyzik = osszes.filter((r) => !SIKERES.has(r) && !KIVETELEK[r]);

    expect(
      hianyzik,
      'LEFEDETLEN VÉGPONT — nincs rá egyetlen sikeres hívás sem.\n' +
      'Vagy írj rá tesztet ebbe a fájlba, vagy vedd fel a KIVETELEK közé INDOKKAL:\n' +
      hianyzik.map((r) => `  '${r}': '???',`).join('\n'),
    ).toEqual([]);
  });

  it('a kivétel-lista nem tartalmaz elavult bejegyzést', () => {
    const osszes = new Set(listRoutes(expressApp).map(routeKey));
    const elavult = Object.keys(KIVETELEK).filter((r) => !osszes.has(r));
    expect(elavult, `Nem létező végpont a kivétel-listán: ${elavult.join(', ')}`).toEqual([]);

    // Ha egy kivételt közben mégis lefedtünk, töröljük a listáról
    const feleslegesen = Object.keys(KIVETELEK).filter((r) => SIKERES.has(r));
    expect(
      feleslegesen,
      `Ezek MÁR le vannak fedve — töröld őket a KIVETELEK közül: ${feleslegesen.join(', ')}`,
    ).toEqual([]);
  });
});
