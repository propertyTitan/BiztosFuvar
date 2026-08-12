// =====================================================================
//  SEGÉLYSZOLGÁLAT (towing): ÁLLAPOTGÉP + HOZZÁFÉRÉS + ADATVÉDELEM
//
//  A funkció élesben KI van kapcsolva (TOWING_ENABLED), teszt alatt BE — épp
//  azért, hogy a védelmei ne rothadjanak el holt kódként, és élesztéskor
//  azonnal ellenőrzöttek legyenek.
//
//  Amit a meglévő két suite fed: a kapcsoló (towing-kikapcsolva) és két
//  alapeset (mentos-kapu: KYC-kapu + a listás scrub GPS-ág). Amit NEM, és
//  ami itt következik:
//
//   (1) A LISTA-SCRUB MÁSIK ÁGA. A `GET /towing/incoming`-nak KÉT külön
//       lekérdezése van (GPS-alapú és GPS nélküli). A scrub-tesztet a
//       GPS-ágra írták — ha a másik ág nyers sort adna vissza, semmi nem
//       szólna. Pontosan az a minta, amit a projekt magáról írt: „a védelem
//       azon az úton épül meg, ahol felfedezték".
//   (2) AZ ÁLLAPOTGÉP: elvállalás (első nyer), megérkezés, lezárás, lemondás
//       — és hogy IDEGEN mentős egyikhez se férjen hozzá.
//   (3) A BEMENET-ELLENŐRZÉS: GPS, probléma-típus, keresési sugár, a mentős
//       szolgáltatás-listája.
//   (4) A KÖZELI MENTŐSÖK ÉRTESÍTÉSE: a hatókörön kívüli és az offline
//       mentős NEM kaphat riasztást (a bajba jutott helyzete nem közadat).
//
//  ⚠️ HÁLÓZAT: a `createNotification` fire-and-forget Expo-push-t indít, ami
//  VALÓDI HTTP-hívás lenne (exp.host). A fájl a globális `fetch`-et lecseréli
//  — teszt SOHA nem mehet hálózatra.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterAll, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const varakoz = (ms) => new Promise((r) => { setTimeout(r, ms); });

let halozatiHivasok = [];
beforeEach(() => {
  __resetRateLimitsForTests();
  halozatiHivasok = [];
  vi.stubGlobal('fetch', async (url) => {
    halozatiHivasok.push(String(url));
    return { ok: true, status: 200, text: async () => '' };
  });
});
afterAll(() => { vi.unstubAllGlobals(); });

// ── Segédek ──────────────────────────────────────────────────────────

/** Azonosított szállító, mentősként regisztrálva. */
async function ujMentos({ services = ['breakdown', 'flat_tire'] } = {}) {
  const u = await createUser({ role: 'carrier', kyc: 'verified' });
  const res = await request(app).post('/towing/register').set(auth(u.token))
    .send({ tow_services: services, tow_vehicle_description: 'Iveco trélerrel' });
  expect(res.status, `a mentős-regisztráció nem sikerült: ${JSON.stringify(res.body)}`).toBe(200);
  return u;
}

/** Mentés-kérés a megadott helyre. */
async function ujKeres(user, mezok = {}) {
  const res = await request(app).post('/towing/request').set(auth(user.token)).send({
    lat: 47.497912, lng: 19.040235, address: 'Budapest, Váci út 1.',
    issue_type: 'breakdown', vehicle_type: 'car', vehicle_plate: 'ABC-123',
    issue_description: 'Nem indul, hívj: 06 30 111 2222',
    ...mezok,
  });
  expect(res.status, `a mentés-kérés nem jött létre: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body;
}

const allapot = async (id) => (await db.query('SELECT * FROM tow_requests WHERE id = $1', [id])).rows[0];
const ertesitesek = async (userId, tipus) => (await db.query(
  'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC', [userId, tipus],
)).rows;

// =====================================================================
//  1) BEMENET-ELLENŐRZÉS
// =====================================================================
describe('Mentés-kérés: bemenet-ellenőrzés', () => {
  it('GPS nélkül / értelmezhetetlen koordinátával 400, és nem keletkezik kérés', async () => {
    const user = await createUser({ role: 'shipper' });
    // ✅ A `lat: null` / `''` / `[]` esetet az ügynök SZÁNDÉKOSAN kihagyta
    // innen, mert akkor még termékhiba volt (a `Number(null) === 0` miatt a
    // kérés a (0,0) koordinátára került, 201-gyel). 2026-08-12-én JAVÍTVA —
    // az esetek a `termek-hibak-lefedettsegi-kor.test.js`-ben kaptak őrt,
    // ezért itt már nem hiányzik. A helyes döntés az volt, hogy a hibás
    // viselkedést NEM kodifikálta helyesként: ha ideírja a 201-et, a javítás
    // ezt a tesztet buktatta volna meg, és úgy nézne ki, mintha a JAVÍTÁS
    // rontott volna el valamit.
    const rosszak = [
      ['hiányzó koordináta', {}],
      ['szöveg a koordinátában', { lat: 'valahol', lng: 'arra' }],
      ['magyar tizedesvessző', { lat: '47,4979', lng: '19,0402' }],
      ['objektum a koordinátában', { lat: { a: 1 }, lng: { b: 2 } }],
    ];
    for (const [nev, body] of rosszak) {
      const res = await request(app).post('/towing/request').set(auth(user.token)).send(body);
      expect(res.status, `${nev}: nem 400-at kaptunk (${res.status}) — a GPS-ellenőrzés nélkül `
        + 'a NOT NULL oszlopon hasal el a beszúrás, és a bajba jutott nyers „Szerverhibát" lát').toBe(400);
    }
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM tow_requests WHERE requester_id = $1', [user.id]);
    expect(rows[0].c, 'érvénytelen kérésből mégis lett sor a DB-ben').toBe(0);
  });

  it('ismeretlen probléma-típus 400 — csak a felsorolt értékek mehetnek', async () => {
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).post('/towing/request').set(auth(user.token))
      .send({ lat: 47.5, lng: 19.05, issue_type: '<script>alert(1)</script>' });
    expect(
      res.status,
      'AZ ISSUE_TYPE FEHÉRLISTA KIMARADT — a mentősök listájában szabad szöveg\n'
      + 'jelenne meg (a UI ebből képez címkét), és a push-üzenet szövegébe is\n'
      + 'bekerülne a felhasználó által írt tartalom.',
    ).toBe(400);
    const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM tow_requests WHERE requester_id = $1', [user.id]);
    expect(rows[0].c).toBe(0);
  });

  it('KÉRÉS-TEST NÉLKÜLI hívás sem omlik össze (400, nem 500)', async () => {
    const user = await createUser({ role: 'shipper' });
    // Content-Type és test nélkül a `req.body` nem is létezik — a kód
    // `req.body || {}`-ja pontosan ezt az esetet fogja el (elfelejtett fejléc,
    // félbeszakadt kérés).
    const res = await request(app).post('/towing/request').set(auth(user.token));
    expect(res.status, 'test nélküli kérésre nem érthető 400 jött').toBe(400);
    expect(res.status, 'test nélküli kérésre ÖSSZEOMLOTT a végpont').not.toBe(500);
  });

  it('a keresési sugár 5-100 km közé szorítva mentődik', async () => {
    const user = await createUser({ role: 'shipper' });
    const esetek = [
      ['irreálisan nagy', 5000, 100],
      ['irreálisan kicsi', 1, 5],
      ['hiányzó → alapérték', undefined, 30],
      ['szemét → alapérték', 'sok', 30],
    ];
    for (const [nev, be, vart] of esetek) {
      const keres = await ujKeres(user, { search_radius_km: be });
      expect(
        keres.search_radius_km,
        `${nev}: a sugár nem lett ${vart} km-re szorítva.\n`
        + 'Plafon nélkül egyetlen kérés az egész ország (Európa) minden mentősét\n'
        + 'felriasztaná, a padló alatt pedig senkihez nem érne el.',
      ).toBe(vart);
    }
  });
});

describe('Mentős-regisztráció: a szolgáltatás-lista ellenőrzése', () => {
  it('üres/érvénytelen szolgáltatás-lista 400, és NEM lesz mentős', async () => {
    for (const rossz of [[], ['repulogep-mentes'], 'breakdown', null, [123, {}]]) {
      const u = await createUser({ role: 'carrier', kyc: 'verified' });
      const res = await request(app).post('/towing/register').set(auth(u.token))
        .send({ tow_services: rossz });
      expect(res.status, `a(z) ${JSON.stringify(rossz)} bemenetre nem 400 jött`).toBe(400);
      const { rows } = await db.query('SELECT is_tow_driver FROM users WHERE id = $1', [u.id]);
      expect(
        rows[0].is_tow_driver,
        'ELUTASÍTOTT REGISZTRÁCIÓ UTÁN MÉGIS MENTŐS LETT — a mentős sérülékeny\n'
        + 'helyzetben lévők adataihoz fér hozzá, ide nem lehet mellékhatásként bejutni.',
      ).toBe(false);
    }
  });

  it('a listából csak az ISMERT szolgáltatások mentődnek el', async () => {
    const u = await createUser({ role: 'carrier', kyc: 'verified' });
    const res = await request(app).post('/towing/register').set(auth(u.token))
      .send({ tow_services: ['breakdown', 'kamu-szolgaltatas', 'fuel'] });
    expect(res.status).toBe(200);
    expect(
      res.body.tow_services,
      'ISMERETLEN SZOLGÁLTATÁS-KULCS KERÜLT A PROFILBA — a mező a mentős\n'
      + 'nyilvános kínálata, szabad szöveggel hirdetési felületté válna.',
    ).toEqual(['breakdown', 'fuel']);
  });
});

// =====================================================================
//  2) A LISTA-SCRUB MINDKÉT ÁGON
// =====================================================================
describe('GET /towing/incoming — a bajba jutott adatai elvállalás ELŐTT', () => {
  it('GPS NÉLKÜLI ágon is scrubolva jön a lista (nem csak a GPS-alapún)', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);

    // A mentősnek nincs ismert pozíciója, és nem küld lat/lng paramétert →
    // a végpont a MÁSIK (mindent listázó) lekérdezési ágra fut.
    const mentos = await ujMentos();
    await db.query('UPDATE users SET last_known_lat = NULL, last_known_lng = NULL WHERE id = $1', [mentos.id]);

    const res = await request(app).get('/towing/incoming').set(auth(mentos.token));
    expect(res.status).toBe(200);
    const sajat = res.body.find((r) => r.id === keres.id);
    expect(sajat, 'a friss kérés nem jelent meg a GPS nélküli listában').toBeTruthy();

    for (const mezo of ['requester_phone', 'lat', 'lng', 'address', 'vehicle_plate',
      'issue_description', 'requester_name', 'requester_id']) {
      expect(
        sajat[mezo],
        `A(Z) "${mezo}" MEZŐ SZIVÁROG A GPS NÉLKÜLI LISTÁZÓ ÁGON.\n\n`
        + 'A `scrubTowRequestForList` a GPS-alapú ágon fut le — ha a másik ág\n'
        + 'kimarad belőle, elég paraméter nélkül lekérni a végpontot, és minden\n'
        + 'bajba jutott TELJES telefonszáma, PONTOS GPS-e és címe egy kéréssel\n'
        + 'learatható (a `requester_id`-vel a teljes név is, a publikus profilról).\n'
        + 'Ez sérülékeny helyzetben lévő emberek adata: egyedül, éjszaka, elakadva.',
      ).toBeUndefined();
    }
    expect(sajat.approx_lat, 'a közelítő hely ~1 km-re kerekített kell legyen').toBe(47.5);
    expect(sajat.approx_lng).toBe(19.04);
    expect(sajat.requester_first_name, 'a döntéshez a keresztnév jár').toBe('Teszt');
    expect(sajat.issue_type, 'a probléma típusa jár (enélkül nem tud dönteni a mentős)').toBe('breakdown');
  });

  // ⚠️ A `scrubTowRequestForList` „nincs név / nincs koordináta" ága
  // SZÁNDÉKOSAN nincs tesztelve: a `users.full_name` és a `tow_requests.lat/lng`
  // is NOT NULL a sémában, tehát ezek védekező (elérhetetlen) ágak. Egy
  // közvetlen SQL-lel kikényszerített állapot nem valós rendszerállapotot
  // mérne — a séma-kényszer maga a bizonyíték.

  it('a saját keresési sugarán KÍVÜL eső kérés nem jelenik meg a listában', async () => {
    // ⚠️ A KOORDINÁTÁK SZÁNDÉKOSAN a lekérdezés ±50 km-es téglalapján BELÜL
    // vannak: különben már az SQL kiszűrné a sort, és a JS-beli sugár-szűrés
    // kivétele mellett is „zöld" maradna a teszt (ezt lemértem: egy szegedi,
    // 170 km-es esetnél a szűrő eltávolítása NEM buktatta el a tesztet).
    const bajban = await createUser({ role: 'shipper' });
    const HONNAN = { lat: 47.4979, lng: 19.0402 };
    const TAVOL = { lat: 47.7500, lng: 19.4200 }; // ~36 km — a téglalapon belül

    const szuk = await ujKeres(bajban, { ...TAVOL, search_radius_km: 5 });
    const tag = await ujKeres(bajban, { ...TAVOL, search_radius_km: 100 });
    const kozeli = await ujKeres(bajban, { lat: 47.5000, lng: 19.0500, search_radius_km: 30 });

    const mentos = await ujMentos();
    const res = await request(app).get(`/towing/incoming?lat=${HONNAN.lat}&lng=${HONNAN.lng}`)
      .set(auth(mentos.token));
    expect(res.status).toBe(200);
    const idk = res.body.map((r) => r.id);

    expect(idk, 'a közeli kérés kimaradt — a szűrés túl szoros').toContain(kozeli.id);
    // Ez a sor bizonyítja, hogy a helyszín az SQL-téglalapon BELÜL van:
    // ugyanaz a pont NAGY sugárral megjelenik.
    expect(
      idk,
      'ugyanaz a hely 100 km-es sugárral sem jelent meg — a teszt nem a\n'
      + 'JS-beli sugár-szűrést méri, hanem az SQL téglalapot (értéktelen lenne)',
    ).toContain(tag.id);
    expect(
      idk,
      'A KÉRÉS SAJÁT KERESÉSI SUGARÁNAK SZŰRÉSE NEM MŰKÖDIK.\n\n'
      + 'A bajba jutott azt kérte, hogy 5 km-en belül keressünk mentőst; egy\n'
      + '36 km-re lévő mentősnek nem szabad látnia (sem elvállalnia) — a kérés\n'
      + 'így órákig „elkelt" állapotban ragadna, miközben senki nem indul el.',
    ).not.toContain(szuk.id);
    expect(res.body.find((r) => r.id === kozeli.id).distance_km, 'a távolság nincs kiszámolva')
      .toBeGreaterThanOrEqual(0);
  });

  it('a LEJÁRT és az ELVÁLLALT kérés eltűnik a listából', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const lejart = await ujKeres(bajban);
    const elvallalt = await ujKeres(bajban);
    await db.query("UPDATE tow_requests SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [lejart.id]);

    const mentos = await ujMentos();
    const elfogadas = await request(app).post(`/towing/${elvallalt.id}/accept`).set(auth(mentos.token)).send({});
    expect(elfogadas.status, JSON.stringify(elfogadas.body)).toBe(200);

    const masikMentos = await ujMentos();
    const res = await request(app).get('/towing/incoming?lat=47.4979&lng=19.0402').set(auth(masikMentos.token));
    const idk = res.body.map((r) => r.id);
    expect(
      idk,
      'LEJÁRT KÉRÉS MARADT A LISTÁN — a mentős olyan emberhez indulna el, aki\n'
      + 'fél órája nem vár rá (a kérés 30 perc után jár le).',
    ).not.toContain(lejart.id);
    expect(
      idk,
      'MÁR ELVÁLLALT KÉRÉS MARADT A LISTÁN — több mentős indulna ugyanahhoz.',
    ).not.toContain(elvallalt.id);
  });

  it('csak regisztrált mentős kérheti le a listát', async () => {
    const civil = await createUser({ role: 'shipper' });
    const nemRegisztralt = await createUser({ role: 'carrier', kyc: 'verified' });
    for (const u of [civil, nemRegisztralt]) {
      const res = await request(app).get('/towing/incoming').set(auth(u.token));
      expect(
        res.status,
        'BÁRKI LEKÉRHETI A MENTÉS-KÉRÉSEK LISTÁJÁT — a mentős-regisztráció\n'
        + '(és a mögötte lévő KYC-kapu) így megkerülhető lenne.',
      ).toBe(403);
    }
  });
});

// =====================================================================
//  3) ELVÁLLALÁS — „első nyer", és utána jár a pontos hely
// =====================================================================
describe('POST /towing/:id/accept', () => {
  it('elvállalás után a mentős megkapja a PONTOS helyet (a lista-scrub csak addig szűkít)', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const mentos = await ujMentos();

    const res = await request(app).post(`/towing/${keres.id}/accept`)
      .set(auth(mentos.token)).send({ estimated_price_huf: 25000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.requester_lat,
      'AZ ELVÁLLALÓ MENTŐS NEM KAPJA MEG A PONTOS HELYET — a scrub túl széles:\n'
      + 'a közelítő (~1 km) hely a KERESÉSHEZ elég, a kiérkezéshez nem.',
    ).toBe(47.497912);
    expect(res.body.requester_lng).toBe(19.040235);

    const sor = await allapot(keres.id);
    expect(sor.status).toBe('accepted');
    expect(sor.responder_id).toBe(mentos.id);
    expect(sor.estimated_price_huf).toBe(25000);
    expect(sor.accepted_at, 'az elvállalás időpontja nem rögzült').not.toBeNull();
  });

  it('a MÁSODIK mentős 409-et kap, és a kérés nem kerül át hozzá', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const elso = await ujMentos();
    const masodik = await ujMentos();

    expect((await request(app).post(`/towing/${keres.id}/accept`).set(auth(elso.token)).send({})).status).toBe(200);
    const res = await request(app).post(`/towing/${keres.id}/accept`).set(auth(masodik.token)).send({});

    expect(
      res.status,
      'A MÁSODIK MENTŐS IS ELVÁLLALHATTA A KÉRÉST („első nyer" sérült).\n\n'
      + 'A válasz a bajba jutott PONTOS GPS-ét adja ki — vagyis egy már\n'
      + 'elvállalt kérésnél tetszőleges számú mentős szerezhetné meg a\n'
      + 'sérülékeny helyzetben lévő ember pontos helyzetét.',
    ).toBe(409);
    const sor = await allapot(keres.id);
    expect(sor.responder_id, 'a második elvállaló elvette a kérést az elsőtől').toBe(elso.id);
  });

  it('a SAJÁT kérését senki nem vállalhatja el (403)', async () => {
    const bajban = await ujMentos(); // mentős, aki maga is bajba jut
    const keres = await ujKeres(bajban);
    const res = await request(app).post(`/towing/${keres.id}/accept`).set(auth(bajban.token)).send({});
    expect(res.status, 'a saját kérését is elvállalhatta').toBe(403);
    expect((await allapot(keres.id)).status).toBe('searching');
  });

  it('lejárt kérésre 410, nem létezőre 404, lemondottra 409', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const mentos = await ujMentos();

    const lejart = await ujKeres(bajban);
    await db.query("UPDATE tow_requests SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [lejart.id]);
    expect(
      (await request(app).post(`/towing/${lejart.id}/accept`).set(auth(mentos.token)).send({})).status,
      'a LEJÁRT kérés is elvállalható volt — a mentős fölöslegesen indulna el',
    ).toBe(410);

    expect(
      (await request(app).post('/towing/00000000-0000-0000-0000-000000000000/accept')
        .set(auth(mentos.token)).send({})).status,
      'nem létező kérésre nem 404 jött',
    ).toBe(404);

    const lemondott = await ujKeres(bajban);
    await request(app).post(`/towing/${lemondott.id}/cancel`).set(auth(bajban.token)).send({});
    const res = await request(app).post(`/towing/${lemondott.id}/accept`).set(auth(mentos.token)).send({});
    expect(res.status, 'a LEMONDOTT kérés is elvállalható volt').toBe(409);
    expect((await allapot(lemondott.id)).responder_id, 'lemondott kéréshez mégis rendelődött mentős').toBeNull();
  });

  it('nem regisztrált mentős nem vállalhat el (403)', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const civil = await createUser({ role: 'carrier', kyc: 'verified' });
    const res = await request(app).post(`/towing/${keres.id}/accept`).set(auth(civil.token)).send({});
    expect(
      res.status,
      'MENTŐS-REGISZTRÁCIÓ NÉLKÜL IS ELVÁLLALHATÓ VOLT A KÉRÉS — így a\n'
      + 'regisztrációra tett KYC-kapu (és vele a pontos GPS védelme) kikerülhető.',
    ).toBe(403);
  });
});

// =====================================================================
//  4) MEGÉRKEZÉS / LEZÁRÁS — csak az elvállaló mentős
// =====================================================================
describe('Megérkezés és lezárás', () => {
  /** Bajba jutott + elvállalt kérés + az elvállaló mentős. */
  async function elvallaltKeres() {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const mentos = await ujMentos();
    const res = await request(app).post(`/towing/${keres.id}/accept`).set(auth(mentos.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { bajban, keres, mentos };
  }

  it('IDEGEN mentős nem jelentheti a megérkezést és nem zárhatja le', async () => {
    const { keres } = await elvallaltKeres();
    const idegen = await ujMentos();

    const erkezes = await request(app).post(`/towing/${keres.id}/arrive`).set(auth(idegen.token)).send({});
    expect(
      erkezes.status,
      'IDEGEN MENTŐS JELENTHETTE A MEGÉRKEZÉST.\n\n'
      + 'A bajba jutott értesítést kapna, hogy „a mentős a helyszínen van",\n'
      + 'miközben nem az. Az állapot-átmenetnek a responder_id-hez kell kötve\n'
      + 'lennie, nem csak az azonosítóhoz.',
    ).toBe(404);

    const lezaras = await request(app).post(`/towing/${keres.id}/complete`)
      .set(auth(idegen.token)).send({ final_price_huf: 99000 });
    expect(
      lezaras.status,
      'IDEGEN MENTŐS ZÁRHATTA LE A MENTÉST — ráadásul saját végösszeget írhatott\n'
      + 'egy olyan ügyletre, amiben nem vett részt.',
    ).toBe(404);

    expect((await allapot(keres.id)).status, 'az idegen mégis módosította az állapotot').toBe('accepted');
  });

  it('az elvállaló mentős végigviszi: megérkezés → lezárás végösszeggel', async () => {
    const { bajban, keres, mentos } = await elvallaltKeres();

    expect((await request(app).post(`/towing/${keres.id}/arrive`).set(auth(mentos.token)).send({})).status).toBe(200);
    let sor = await allapot(keres.id);
    expect(sor.status).toBe('arrived');
    expect(sor.arrived_at, 'a megérkezés időpontja nem rögzült').not.toBeNull();

    const lezaras = await request(app).post(`/towing/${keres.id}/complete`)
      .set(auth(mentos.token)).send({ final_price_huf: 32500 });
    expect(lezaras.status).toBe(200);
    sor = await allapot(keres.id);
    expect(sor.status).toBe('completed');
    expect(sor.final_price_huf, 'a végösszeg nem mentődött el').toBe(32500);

    const ertesites = (await ertesitesek(bajban.id, 'tow_completed'))[0];
    expect(ertesites, 'a bajba jutott nem kapott értesítést a lezárásról').toBeTruthy();
    expect(
      ertesites.body.replace(/[\s  ]/g, ''),
      'A LEZÁRÓ ÉRTESÍTÉS NEM TARTALMAZZA A VÉGÖSSZEGET — a bajba jutott a\n'
      + 'helyszínen készpénzben fizet, az összeget írásban is meg kell kapnia.',
    ).toContain('32500Ft');
  });

  it('végösszeg nélküli lezárásnál „Ár egyeztetés alapján" megy ki', async () => {
    const { bajban, keres, mentos } = await elvallaltKeres();
    // Szándékosan TEST NÉLKÜL (a mentős appja csak megnyomja a „Kész" gombot).
    const res = await request(app).post(`/towing/${keres.id}/complete`).set(auth(mentos.token));
    expect(res.status).toBe(200);
    expect(res.body.final_price_huf, 'végösszeg nélkül nem lehet összeg a válaszban').toBeNull();
    const ertesites = (await ertesitesek(bajban.id, 'tow_completed'))[0];
    expect(
      ertesites.body,
      'VÉGÖSSZEG NÉLKÜL IS SZÁMOT ÍRTUNK AZ ÉRTESÍTÉSBE („0 Ft" / „null Ft") —\n'
      + 'a helyszínen egyeztetett árnál ez félrevezető.',
    ).toContain('Ár egyeztetés alapján');
  });

  it('a rossz állapotból indított átmenet 404 (nincs „ugrás" a sorrendben)', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const mentos = await ujMentos();

    // Még senki nem vállalta el:
    expect(
      (await request(app).post(`/towing/${keres.id}/arrive`).set(auth(mentos.token)).send({})).status,
      'EL NEM VÁLLALT KÉRÉSRE IS BEJELENTHETŐ VOLT A MEGÉRKEZÉS',
    ).toBe(404);
    expect(
      (await request(app).post(`/towing/${keres.id}/complete`).set(auth(mentos.token)).send({})).status,
      'EL NEM VÁLLALT KÉRÉS IS LEZÁRHATÓ VOLT',
    ).toBe(404);
    expect((await allapot(keres.id)).status).toBe('searching');
  });
});

// =====================================================================
//  5) LEMONDÁS
// =====================================================================
describe('POST /towing/:id/cancel', () => {
  it('a kérő lemondhatja, és az elvállaló mentős értesítést kap', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const mentos = await ujMentos();
    await request(app).post(`/towing/${keres.id}/accept`).set(auth(mentos.token)).send({});

    const res = await request(app).post(`/towing/${keres.id}/cancel`).set(auth(bajban.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sor = await allapot(keres.id);
    expect(sor.status).toBe('cancelled');
    expect(sor.cancelled_at).not.toBeNull();
    expect(
      (await ertesitesek(mentos.id, 'tow_cancelled')).length,
      'A MÁR ÚTON LÉVŐ MENTŐS NEM KAPOTT ÉRTESÍTÉST A LEMONDÁSRÓL — feleslegesen\n'
      + 'tenné meg az utat egy olyan emberhez, aki már nem várja.',
    ).toBe(1);
  });

  it('IDEGEN nem mondhatja le más kérését', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const idegen = await createUser({ role: 'shipper' });
    const mentos = await ujMentos();

    for (const tamado of [idegen, mentos]) {
      const res = await request(app).post(`/towing/${keres.id}/cancel`).set(auth(tamado.token)).send({});
      expect(
        res.status,
        'IDEGEN LEMONDHATTA MÁS MENTÉS-KÉRÉSÉT.\n\n'
        + 'Egy elakadt ember segélykérése töröltethető lenne kívülről —\n'
        + 'a lemondásnak a requester_id-hez kell kötve lennie.',
      ).toBe(404);
    }
    expect((await allapot(keres.id)).status, 'az idegen mégis lemondta a kérést').toBe('searching');
  });

  it('lezárt mentés már nem mondható le', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const mentos = await ujMentos();
    await request(app).post(`/towing/${keres.id}/accept`).set(auth(mentos.token)).send({});
    await request(app).post(`/towing/${keres.id}/complete`).set(auth(mentos.token)).send({ final_price_huf: 1000 });

    const res = await request(app).post(`/towing/${keres.id}/cancel`).set(auth(bajban.token)).send({});
    expect(res.status, 'a már ELVÉGZETT mentés utólag „lemondható" volt').toBe(404);
    expect((await allapot(keres.id)).status).toBe('completed');
  });
});

// =====================================================================
//  6) ELÉRHETŐSÉG-KAPCSOLÓ
// =====================================================================
describe('POST /towing/toggle-available', () => {
  it('csak regisztrált mentős kapcsolhatja, és a DB követi az állapotot', async () => {
    const civil = await createUser({ role: 'shipper' });
    expect(
      (await request(app).post('/towing/toggle-available').set(auth(civil.token)).send({ available: true })).status,
      'NEM MENTŐS IS ELÉRHETŐVÉ TETTE MAGÁT — a mentős-lista (és vele a\n'
      + 'riasztások) KYC nélküli fiókokkal telne meg.',
    ).toBe(403);

    const mentos = await ujMentos();
    const ki = await request(app).post('/towing/toggle-available').set(auth(mentos.token)).send({ available: false });
    expect(ki.status).toBe(200);
    expect(ki.body.tow_available).toBe(false);
    expect((await db.query('SELECT tow_available FROM users WHERE id = $1', [mentos.id])).rows[0].tow_available)
      .toBe(false);

    const be = await request(app).post('/towing/toggle-available').set(auth(mentos.token)).send({ available: true });
    expect(be.body.tow_available, 'a visszakapcsolás nem működik — a mentős nem tudna újra munkába állni').toBe(true);
  });
});

// =====================================================================
//  7) SAJÁT KÉRÉSEIM — a kölcsönös adatkiadás iránya
// =====================================================================
describe('GET /towing/my-requests', () => {
  it('csak a sajátjait látja, és a mentős elérhetőségét CSAK elvállalás után', async () => {
    const bajban = await createUser({ role: 'shipper' });
    const masik = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban);
    const idegenKeres = await ujKeres(masik);

    let res = await request(app).get('/towing/my-requests').set(auth(bajban.token));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id), 'IDEGEN MENTÉS-KÉRÉS jelent meg a saját listában').not.toContain(idegenKeres.id);
    const sajat = res.body.find((r) => r.id === keres.id);
    expect(sajat.responder_phone, 'elvállalás előtt nincs kinek a telefonját mutatni').toBeNull();

    const mentos = await ujMentos();
    await request(app).post(`/towing/${keres.id}/accept`).set(auth(mentos.token)).send({});

    res = await request(app).get('/towing/my-requests').set(auth(bajban.token));
    const frissitett = res.body.find((r) => r.id === keres.id);
    expect(
      frissitett.responder_phone,
      'AZ ELVÁLLALÁS UTÁN SEM KAPJA MEG A BAJBA JUTOTT A MENTŐS ELÉRHETŐSÉGÉT —\n'
      + 'nem tudná felhívni, hogy hol pontosan várja.',
    ).toBeTruthy();
    expect(frissitett.responder_name).toBeTruthy();
    expect(frissitett.responder_vehicle).toBe('Iveco trélerrel');
  });
});

// =====================================================================
//  8) KÖZELI MENTŐSÖK RIASZTÁSA
// =====================================================================
describe('A közeli mentősök riasztása', () => {
  /** Mentős ismert pozícióval + push-eszközzel (a lekérdezés JOIN-olja). */
  async function mentosPozicioval(lat, lng, { elerheto = true } = {}) {
    const m = await ujMentos();
    await db.query(
      'UPDATE users SET last_known_lat = $2, last_known_lng = $3, tow_available = $4 WHERE id = $1',
      [m.id, lat, lng, elerheto],
    );
    await db.query('INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)',
      [m.id, `ExponentPushToken[teszt-${m.id}]`]);
    return m;
  }

  it('csak a hatókörön belüli, ELÉRHETŐ mentős kap riasztást', async () => {
    // ⚠️ A „távoli" mentős SZÁNDÉKOSAN a lekérdezés téglalapján BELÜL van
    // (a sugárból képzett fok-határokon belül), csak a KÖR-en kívül: így a
    // teszt tényleg a JS-beli távolság-szűrést méri. Egy szegedi (170 km-es)
    // mentőssel a szűrő kivétele mellett is zöld maradt — lemértem.
    const kozeli = await mentosPozicioval(47.5100, 19.0500);                       // ~2 km
    const tavoli = await mentosPozicioval(47.7200, 19.4000);                       // ~36 km
    const offline = await mentosPozicioval(47.5000, 19.0450, { elerheto: false }); // közel, de offline

    const bajban = await createUser({ role: 'shipper' });
    const keres = await ujKeres(bajban, { search_radius_km: 30, issue_type: 'flat_tire' });

    // A riasztás fire-and-forget (setImmediate) — várjunk rá.
    await varakoz(400);

    const kozeliEr = await ertesitesek(kozeli.id, 'tow_request_nearby');
    expect(
      kozeliEr.length,
      'A KÖZELI MENTŐS NEM KAPOTT RIASZTÁST — a funkció lényege veszne el:\n'
      + 'a bajba jutott hiába kér segítséget, senki nem tudna róla.',
    ).toBe(1);
    expect(kozeliEr[0].body, 'a riasztás nem nevezi meg a problémát/távolságot').toMatch(/Defekt/);

    expect(
      (await ertesitesek(tavoli.id, 'tow_request_nearby')).length,
      'A 36 KM-RE LÉVŐ MENTŐS IS RIASZTÁST KAPOTT 30 KM-ES SUGÁRNÁL.\n\n'
      + 'A kör-alapú szűrés nélkül a hatókör a téglalap SARKAIRA is kiterjed\n'
      + '(a sugár ~1,4-szerese), és minden kérés messze több mentőst riasztana,\n'
      + 'mint amennyit a bajba jutott kért — elárulva, hol van baj.',
    ).toBe(0);

    // …és ugyanez a mentős NAGYOBB sugárnál MEGKAPJA: ez bizonyítja, hogy a
    // téglalapon belül van, tehát tényleg a kör-szűrés zárta ki.
    await ujKeres(bajban, { search_radius_km: 60, issue_type: 'flat_tire' });
    await varakoz(400);
    expect(
      (await ertesitesek(tavoli.id, 'tow_request_nearby')).length,
      '60 km-es sugárnál sem kapott riasztást a 36 km-re lévő mentős — akkor\n'
      + 'a fenti „nem kapott" állítás nem a kör-szűrést méri, hanem az SQL\n'
      + 'téglalapot (a teszt értéktelen lenne)',
    ).toBe(1);
    expect(
      (await ertesitesek(offline.id, 'tow_request_nearby')).length,
      'AZ OFFLINE (nem elérhető) MENTŐS IS RIASZTÁST KAPOTT — az „elérhető\n'
      + 'vagyok" kapcsoló nem hatna semmire.',
    ).toBe(0);

    // A kérés még mindig ott van, ahol volt (a riasztás nem módosít).
    expect((await allapot(keres.id)).status).toBe('searching');
    // Hálózatra teszt SOHA nem mehet: ha az Expo-push valódi fetch lenne,
    // itt látszana — ezt a stub fogja el.
    expect(halozatiHivasok.every((u) => u.startsWith('https://exp.host/')), halozatiHivasok.join(', ')).toBe(true);
  });

  it('a bajba jutott saját magát nem riasztja (ha ő is mentős)', async () => {
    const bajbaJutottMentos = await mentosPozicioval(47.4980, 19.0400);
    await ujKeres(bajbaJutottMentos, { search_radius_km: 30 });
    await varakoz(400);

    expect(
      (await ertesitesek(bajbaJutottMentos.id, 'tow_request_nearby')).length,
      'A KÉRŐ SAJÁT MAGÁTÓL KAPOTT RIASZTÁST — értelmetlen értesítés, és\n'
      + 'jelezné, hogy a kizárás (u.id <> requester_id) kiesett a lekérdezésből.',
    ).toBe(0);
  });
});
