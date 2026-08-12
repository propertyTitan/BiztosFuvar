// =====================================================================
//  JOBS — A MARADÉK FEDETLEN ÁGAK (2026-08-12)
//
//  A `jobs-hibaagak.test.js` a méret/ár/címzett/szűrő/fizetés hibaágait
//  végigjárta. Ami maradt, három szűk, de valós rés:
//
//   (1) AZ ÁTVÉTELI IDŐABLAK SORRENDJE. A „nem dátum" és az irreális év
//       már szűrt (BUG-2), de azt SEMMI nem nézte, hogy a VÉGE korábban
//       van-e, mint a KEZDETE. Egy fordított ablak nem 500-at okoz —
//       ennél alattomosabb: bekerül a DB-be, a szállító egy ÜRES időablakot
//       lát („12:00–09:00"), és abból lesz a meghiúsult átvétel + vita.
//   (2) A LEMONDÁSI ÉRTESÍTÉS SZÖVEGE. Ugyanaz az esemény két üzenetet
//       ad attól függően, KI mondta le. Ha a feltétel megfordul, a másik
//       fél pontosan az ELLENKEZŐJÉT olvassa arról, ki lépett vissza —
//       és ez a mondat a vita első bizonyítéka.
//   (3) A FELADÁS UTÁNI MELLÉKHATÁSOK. Az útvonal-figyelők értesítése a
//       válasz UTÁN, `setImmediate`-ben fut. Ha ott elszáll egy ígéret
//       `.catch()` nélkül, az Node 18+ alatt MEGÖLI a backend folyamatot —
//       egy fuvarfeladás miatt.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const laneAlerts = require('../src/services/laneAlerts');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const ERVENYES = {
  title: 'Maradék-ág teszt fuvar',
  pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt ter 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};
const fuvar = (o = {}) => ({ ...ERVENYES, ...o });

/** Kezeletlen ígéret-elutasítás figyelő (lásd auth-maradek-agak.test.js). */
function kezeletlenElutasitasFigyelo() {
  const talalatok = [];
  const kezelo = (ok) => talalatok.push(ok);
  process.on('unhandledRejection', kezelo);
  return {
    async leall() {
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
 * visszaadott ígéretre BELSŐLEG rákapcsolódik (mock.settledResults), ezért az
 * MINDIG „kezelt" — a kezeletlen-elutasítás figyelő vakon zöld maradna, akkor
 * is, ha a termékkódból kivesszük a `.catch()`-et. (Lemérve: 2026-08-12.)
 */
function elutasitoCsere(modul, nev, uzenet) {
  const eredeti = modul[nev];
  const hivasok = [];
  // eslint-disable-next-line no-param-reassign
  modul[nev] = (...args) => { hivasok.push(args); return Promise.reject(new Error(uzenet)); };
  visszaallitok.push(() => { modul[nev] = eredeti; });
  return hivasok;
}

beforeEach(() => __resetRateLimitsForTests());
afterEach(() => {
  while (visszaallitok.length) visszaallitok.pop()();
  vi.restoreAllMocks();
});

// =====================================================================
//  1. ÁTVÉTELI IDŐABLAK — a sorrend is szabály
// =====================================================================
describe('POST /jobs — az átvételi időablak sorrendje', () => {
  it('a VÉGE nem lehet korábban, mint a KEZDETE → 400 INVALID_PICKUP_WINDOW', async () => {
    const user = await createUser({ role: 'shipper' });
    const kezdet = new Date(Date.now() + 48 * 3600 * 1000);
    const veg = new Date(Date.now() + 24 * 3600 * 1000); // egy nappal KORÁBBAN

    const res = await request(app).post('/jobs').set(auth(user.token))
      .send(fuvar({
        pickup_window_start: kezdet.toISOString(),
        pickup_window_end: veg.toISOString(),
      }));

    expect(res.status,
      'a fordított időablak nem okoz DB-hibát, ezért csendben bekerülne — a szállító '
      + 'egy ÜRES (negatív hosszúságú) átvételi ablakot látna, amiből meghiúsult átvétel '
      + `és vita lesz. Kapott: ${res.status} ${JSON.stringify(res.body)}`)
      .toBe(400);
    expect(res.body.code).toBe('INVALID_PICKUP_WINDOW');
    expect(res.body.error).toMatch(/vége nem lehet korábban/i);

    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS c FROM jobs WHERE shipper_id = $1', [user.id],
    );
    expect(rows[0].c, 'elutasított feladásból nem keletkezhet fuvar-sor').toBe(0);
  });

  it('az AZONOS kezdet és vég MÉG elfogadható (a szabály nem szigorúbb a kelleténél)', async () => {
    const user = await createUser({ role: 'shipper' });
    const idopont = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const res = await request(app).post('/jobs').set(auth(user.token))
      .send(fuvar({ pickup_window_start: idopont, pickup_window_end: idopont }));

    expect(res.status,
      'a „pontosan ekkor" átvétel legitim eset (fix időpont) — ha az összehasonlítás '
      + '`<`-ről `<=`-re csúszik, ez a feladás indokolatlanul elbukna')
      .toBe(201);
  });

  it('a helyes sorrendű ablak MENTŐDIK is (nem csak átmegy a validáción)', async () => {
    const user = await createUser({ role: 'shipper' });
    const kezdet = new Date(Date.now() + 24 * 3600 * 1000);
    const veg = new Date(Date.now() + 27 * 3600 * 1000);

    const res = await request(app).post('/jobs').set(auth(user.token))
      .send(fuvar({
        pickup_window_start: kezdet.toISOString(),
        pickup_window_end: veg.toISOString(),
      }));
    expect(res.status).toBe(201);

    const { rows } = await db.query(
      'SELECT pickup_window_start, pickup_window_end FROM jobs WHERE id = $1', [res.body.id],
    );
    expect(new Date(rows[0].pickup_window_start).toISOString(),
      'a validátor normalizál (ISO-ra alakít) — ha közben elveszne az érték, a szállító '
      + 'nem tudná, mikor mehet a csomagért')
      .toBe(kezdet.toISOString());
    expect(new Date(rows[0].pickup_window_end).toISOString()).toBe(veg.toISOString());
  });

  it('üres string / null időablak → NULL, nem hiba (a mező opcionális)', async () => {
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).post('/jobs').set(auth(user.token))
      .send(fuvar({ pickup_window_start: '', pickup_window_end: null }));

    expect(res.status,
      'az űrlap üresen hagyott dátum-mezője üres stringként érkezik — ez NEM hibás dátum, '
      + 'hanem „nincs megadva". Ha a validátor ezt is elutasítja, a feladás fele elakad.')
      .toBe(201);
    const { rows } = await db.query(
      'SELECT pickup_window_start, pickup_window_end FROM jobs WHERE id = $1', [res.body.id],
    );
    expect(rows[0].pickup_window_start).toBeNull();
    expect(rows[0].pickup_window_end).toBeNull();
  });
});

// =====================================================================
//  2. LEMONDÁS — az értesítés megnevezi, KI lépett vissza
// =====================================================================
describe('POST /jobs/:id/cancel — a lemondási értesítés szövege', () => {
  /** Elfogadott, szállítós fuvar mindkét féllel. */
  async function elfogadottFuvar() {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { rows } = await db.query(
      `INSERT INTO jobs (shipper_id, carrier_id, title, pickup_address, pickup_lat, pickup_lng,
                         dropoff_address, dropoff_lat, dropoff_lng, status, accepted_price_huf,
                         delivery_code, sender_delivery_code)
       VALUES ($1,$2,'Lemondás-teszt fuvar','Budapest, Teszt u. 1.',47.4979,19.0402,
               'Szeged, Teszt ter 2.',46.2530,20.1414,'accepted',20000,'111222','333444')
       RETURNING *`,
      [felado.id, szallito.id],
    );
    return { felado, szallito, job: rows[0] };
  }

  const ertesites = async (userId, jobId) => (await db.query(
    `SELECT body FROM notifications
      WHERE user_id = $1 AND type = 'job_cancelled' AND link LIKE '%' || $2
      ORDER BY created_at DESC LIMIT 1`,
    [userId, jobId],
  )).rows[0];

  it('ha a FELADÓ mond le, a szállító azt olvassa, hogy a FELADÓ mondta le', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    const res = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(felado.token))
      .send({ reason: 'Mégsem kell' });
    expect(res.status).toBe(200);

    const n = await ertesites(szallito.id, job.id);
    expect(n, 'a másik félnek MINDIG szólni kell — ő már beütemezte az útját').toBeTruthy();
    expect(n.body,
      '⚠️ A MONDAT AZONOSÍTJA A LEMONDÓT. Ha a feltétel megfordul, a szállító azt olvassa, '
      + 'hogy Ő mondta le a fuvart, amit épp most vettek el tőle — és ez az üzenet a vita '
      + 'első bizonyítéka is.')
      .toMatch(/A feladó lemondta/);
    expect(n.body).not.toMatch(/A szállító lemondta/);
  });

  it('ha a SZÁLLÍTÓ mond le, a fuvar nem „lemondott" lesz, hanem ÚJRANYÍLIK — '
    + 'és az értesítés a díjmentességet is közli', async () => {
    const { felado, szallito, job } = await elfogadottFuvar();
    // Kifizetett díj: ilyenkor a szövegnek meg KELL nyugtatnia a feladót, hogy
    // nem kell újra fizetnie — különben azt hiszi, elbukta a pénzét.
    await db.query(
      `UPDATE jobs SET paid_at = NOW(), fee_consent_at = NOW(), connection_fee_huf = 500
        WHERE id = $1`, [job.id],
    );

    const res = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(szallito.token))
      .send({ reason: 'Elromlott a kocsi' });
    expect(res.status).toBe(200);
    expect(res.body.reopened,
      'a szállító visszalépése NEM viheti el a feladó fuvarát — díjmentesen újranyílik')
      .toBe(true);

    const { rows } = await db.query(
      `SELECT body FROM notifications
        WHERE user_id = $1 AND type = 'job_reopened' ORDER BY created_at DESC LIMIT 1`,
      [felado.id],
    );
    expect(rows[0], 'a feladónak tudnia kell, hogy szállítót kell választania').toBeTruthy();
    expect(rows[0].body,
      'az üzenet megnevezi, hogy a SZÁLLÍTÓ lépett vissza (nem a feladó)')
      .toMatch(/A szállító lemondta/);
    expect(rows[0].body,
      '⚠️ FIZETETT fuvarnál a szöveg kimondja, hogy a befizetett díj érvényben marad. '
      + 'Enélkül a feladó azt hiszi, újra fizetnie kell — és inkább elhagyja a platformot, '
      + 'épp azon a lépcsőn, ahol a bevétel már megvan.')
      .toMatch(/érvényes marad/i);

    const cancelErtesites = await ertesites(felado.id, job.id);
    expect(cancelErtesites,
      'szállítói visszalépésnél NEM mehet ki „Fuvar lemondva" értesítés — az azt sugallná, '
      + 'hogy a feladó fuvarja megszűnt, pedig épp újranyílt')
      .toBeFalsy();
  });
});

// =====================================================================
//  3. FELADÁS UTÁNI MELLÉKHATÁSOK
// =====================================================================
describe('POST /jobs — a válasz utáni fire-and-forget hívások', () => {
  it('az útvonal-figyelő értesítés hibája nem dönti le a folyamatot', async () => {
    const user = await createUser({ role: 'shipper' });
    const ertesito = elutasitoCsere(laneAlerts, 'notifyMatchingAlerts',
      'lane-alert lekérdezés elszállt');

    const figyelo = kezeletlenElutasitasFigyelo();
    const res = await request(app).post('/jobs').set(auth(user.token)).send(fuvar());
    const kezeletlen = await figyelo.leall();

    expect(res.status, 'a feladás sikeres — a figyelő-értesítés a válasz UTÁN fut').toBe(201);
    expect(ertesito.length,
      'minden új fuvarra elindul az útvonal-figyelők értesítése — enélkül a szállítók '
      + 'nem tudnának a rájuk illő fuvarról')
      .toBeGreaterThan(0);
    expect(kezeletlen,
      '⚠️ A `.catch()` nélkül itt kezeletlen ígéret-elutasítás keletkezne, ami Node 18+ '
      + 'alatt MEGÁLLÍTJA a folyamatot: egyetlen hibás lane-alert lekérdezés újraindítaná '
      + 'az egész backendet. A 201-es válasz ezt önmagában NEM mutatná ki.')
      .toEqual([]);
  });

  it('nem-JSON kérés-test → 400 „Hiányzó kötelező mezők", nem 500', async () => {
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).post('/jobs').set(auth(user.token))
      .set('Content-Type', 'text/plain')
      .send('ez nem json');

    expect(res.status,
      'ha a kliens rossz Content-Type-pal küld (megszakadt mobil-kérés, hibás integráció), '
      + 'a req.body undefined marad. A "req.body || {}" fallback nélkül a destrukturálás '
      + `TypeError-t dob → 500 + fölösleges Sentry-riasztás. Kapott: ${res.status}`)
      .toBe(400);
    expect(res.body.error).toMatch(/Hiányzó kötelező mezők/i);
  });
});
