// =====================================================================
//  JÁRAT + FOGLALÁS — a `jarat-hibaagak.test.js` UTÁN MARADT ágak
//
//  Ez a fájl NEM ismétli a meglévő hibaág-készletet (kötelező mezők,
//  státusz-fehérlista, kontakt-szűrő az objektum-alakú megállókon,
//  jogosultságok, díjsávok, consent, lemondás). Azt fedi le, ami utána
//  maradt — és ami mind ELLENŐRIZETLEN ÍGÉRET volt:
//
//    * a tranzakció valóban visszagördül-e, ha az árak beszúrása elszáll
//      (különben ár nélküli, foglalhatatlan „fél kész" járat marad a listán),
//    * a múltbeli indulás tilalma SZERKESZTÉSSEL is érvényes-e (a POST-on
//      megvolt, a PATCH-en nem volt mérve),
//    * a kontakt-szűrő a STRING alakú megállón is fog-e (a szűrő két
//      alakot ismer, de csak az egyiket mérték),
//    * a szállító foglalás-listáján érvényes-e a DÍJ-KAPU (a címzett
//      elérhetősége csak fizetés után) — eddig csak a scrub-függvény volt
//      unit-tesztelve, a VÉGPONTON át senki nem mérte,
//    * mi történik, ha a fizetésszolgáltató elérhetetlen (a foglalás nem
//      maradhat „megerősítve, de fizetési munkamenet nélkül"),
//    * a címzett tényleg kap-e értesítést a foglalásról — és hogy SMS-t
//      NEM (2026-07-13 user-döntés: fuvaronként EGY SMS, felvételkor),
//    * a díj-visszaigazoló levél (45/2014. 18. § tartós adathordozó).
//
//  Minden teszt ÁLLAPOTOT is mér: egy elutasított kérés után a DB-nek
//  változatlannak kell lennie.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser, createBooking } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const paymentProvider = require('../src/services/paymentProvider');
const smsModul = require('../src/services/sms');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
beforeEach(() => __resetRateLimitsForTests());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const NEM_LETEZO = '00000000-0000-0000-0000-000000000000';
const HOLNAP = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

// ⚠️ A szövegmezőkbe SOHA ne kerüljön 9+ jegyű számsor: a kontakt-szűrő
// telefonszámnak veszi (a Date.now() 13 jegyű). Betűs egyedi nevet használunk.
let sorszam = 0;
function egyediNev(elotag) {
  sorszam += 1;
  const betuk = 'abcdefghijklmnopqrstuvwxyz';
  const suffix = Array.from({ length: 7 }, () => betuk[Math.floor(Math.random() * 26)]).join('');
  return `${elotag}-${betuk[sorszam % 26]}${suffix}`;
}

function jaratBody(o = {}) {
  return {
    title: 'Teszt járat',
    departure_at: HOLNAP(),
    waypoints: [
      { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ],
    prices: [{ size: 'M', price_huf: 10000 }],
    ...o,
  };
}

async function letrehozJarat(carrier, o = {}) {
  const res = await request(app).post('/carrier-routes').set(auth(carrier.token)).send(jaratBody(o));
  expect(res.status, `a járat-fixtúra létrehozása elhasalt: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body;
}

const jaratSorok = async (carrierId) => (await db.query(
  'SELECT * FROM carrier_routes WHERE carrier_id = $1', [carrierId],
)).rows;
const jaratSor = async (id) => (await db.query(
  'SELECT * FROM carrier_routes WHERE id = $1', [id],
)).rows[0];
const foglalasSor = async (id) => (await db.query(
  'SELECT * FROM route_bookings WHERE id = $1', [id],
)).rows[0];

const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** Vár, amíg a feltétel teljesül (a setImmediate-es mellékhatásokhoz). */
async function vartig(feltetel, maxMs = 2000) {
  const hatar = Date.now() + maxMs;
  while (Date.now() < hatar) {
    if (feltetel()) return true;
    await varj(15);
  }
  return feltetel();
}

/**
 * Elkapja a TÉNYLEGESEN kiküldött leveleket.
 *
 * ⚠️ Miért a hálózati réteg és nem `vi.spyOn(email, ...)`: a carrierRoutes.js
 * a levélküldőket a fájl tetején, DESTRUKTURÁLVA importálja — a kötés a
 * betöltéskor rögzül, tehát a modul-objektumra tett kém sosem futna le
 * (vakon zöld teszt lenne). A `fetch` viszont hívási időben oldódik fel,
 * és minden levelet elkap, importálási stílustól függetlenül.
 */
async function elkapottLevelek(muvelet, { varjLevelekre = 1 } = {}) {
  const eredetiKulcs = process.env.RESEND_API_KEY;
  const levelek = [];
  const eredetiFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, opts) => {
    if (String(url).includes('resend.com')) {
      try { levelek.push(JSON.parse(opts.body)); } catch { /* nem JSON — nem levél */ }
      return { ok: true, status: 200, json: async () => ({ id: 'teszt-level' }), text: async () => '{}' };
    }
    return eredetiFetch(url, opts);
  });
  process.env.RESEND_API_KEY = 'teszt-kulcs-nem-eles';
  try {
    await muvelet();
    await vartig(() => levelek.length >= varjLevelekre);
    // Rövid utóvárakozás: a párban induló leveleknek is legyen esélyük.
    await varj(60);
  } finally {
    vi.unstubAllGlobals();
    process.env.RESEND_API_KEY = eredetiKulcs ?? '';
  }
  return levelek;
}

// =====================================================================
//  1. AZ ÁRTÁBLA (attachPrices) — üres lista és sorrend
// =====================================================================
describe('Járat-ártábla (attachPrices)', () => {
  it('a járat nélküli szállító ÜRES listát kap, nem hibát', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });

    // Az `attachPrices` egy `WHERE route_id = ANY($1)` lekérdezést indítana
    // ÜRES tömbbel, ha nem lenne rövidzár — a végpont a legelső, teljesen
    // hétköznapi állapotban (frissen regisztrált szállító) hibázna el.
    const sajat = await request(app).get('/carrier-routes/mine').set(auth(szallito.token));
    expect(sajat.status, 'a frissen regisztrált szállító „Járataim" oldala elszáll').toBe(200);
    expect(sajat.body, 'üres helyett nem tömböt kaptunk').toEqual([]);

    const bongeszo = await request(app)
      .get(`/carrier-routes?city=${encodeURIComponent(egyediNev('Nincsilyenvaros'))}`)
      .set(auth(felado.token));
    expect(bongeszo.status, 'a találat nélküli járat-keresés hibázik').toBe(200);
    expect(bongeszo.body, 'a találat nélküli keresés nem üres tömböt ad').toEqual([]);
  });

  it('az árak MINDIG S→M→L→XL sorrendben jönnek, bármilyen sorrendben vitték fel', async () => {
    const szallito = await createUser({ role: 'carrier' });

    // A feladó a járat-kártyán fentről lefelé olvassa az ártáblát. A DB
    // semmilyen sorrendet nem garantál (a `carrier_route_prices` PK-ja
    // (route_id, size)), ezért a rendezés a kódban van — ha kiesik, az
    // ártábla összevissza jelenik meg, méret-kategóriánként keveredve.
    const jarat = await letrehozJarat(szallito, {
      prices: [
        { size: 'XL', price_huf: 30000 },
        { size: 'S', price_huf: 2500 },
        { size: 'M', price_huf: 9000 },
      ],
    });
    expect(
      jarat.prices.map((p) => p.size),
      'a létrehozás válaszában nem kanonikus a méret-sorrend',
    ).toEqual(['S', 'M', 'XL']);

    const sajat = await request(app).get('/carrier-routes/mine').set(auth(szallito.token));
    const enyem = sajat.body.find((r) => r.id === jarat.id);
    expect(
      enyem.prices.map((p) => p.size),
      'a „Járataim" listán más (nem kanonikus) a méret-sorrend',
    ).toEqual(['S', 'M', 'XL']);
    expect(enyem.prices.map((p) => p.price_huf), 'az árak nem a méretükhöz tartoznak').toEqual([2500, 9000, 30000]);
  });
});

// =====================================================================
//  2. LÉTREHOZÁS — ár-kötelezettség, string-megállók, tranzakció
// =====================================================================
describe('Járat létrehozás: ár nélkül nincs járat, és a tranzakció visszagördül', () => {
  it('ár nélküli (hiányzó vagy üres) járat 400 — nem keletkezik foglalhatatlan hirdetés', async () => {
    const szallito = await createUser({ role: 'carrier' });

    for (const [nev, prices] of [['hiányzó', undefined], ['üres tömb', []], ['nem tömb', { M: 1000 }]]) {
      const res = await request(app).post('/carrier-routes').set(auth(szallito.token))
        .send(jaratBody({ prices }));
      expect(res.status, `"${nev}" árlistával létrejött a járat — a feladó nem tudna rá foglalni`).toBe(400);
      expect(res.body.error, `"${nev}" esetén a hibaüzenet nem az árakról szól`).toMatch(/méret-kategóriát/i);
    }
    expect((await jaratSorok(szallito.id)).length, 'ár nélkül is keletkezett járat-sor').toBe(0);
  });

  it('a kontakt-szűrő a STRING alakú megállón is fog (nem csak az objektumon)', async () => {
    const szallito = await createUser({ role: 'carrier' });

    // A `waypoints` kliens-oldali szabad JSON: a szűrő SZÁNDÉKOSAN kétféle
    // alakot kezel — objektumot (`{name}`) és puszta stringet. A meglévő
    // készlet csak az objektum-ágat mérte; ha a string-ág elromlik, a
    // megkerülés egyetlen alak-váltással újranyílik.
    const szivargo = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ waypoints: ['Budapest', 'Szeged, hívj: 06 30 123 4567'] }));
    expect(szivargo.status, 'string alakú megállóba írt telefonszám átment a szűrőn').toBe(400);
    expect(szivargo.body.code).toBe('CONTACT_LEAK');
    expect((await jaratSorok(szallito.id)).length, 'a szivárgó járat mégis létrejött').toBe(0);

    const tiszta = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ waypoints: ['Budapest', 'Szeged'] }));
    expect(tiszta.status, 'a tiszta, string alakú megállókat is elutasítja a szűrő').toBe(201);
  });

  it('ha az árak beszúrása elszáll, a JÁRAT SEM marad ott (tranzakció-visszagörgetés)', async () => {
    const szallito = await createUser({ role: 'carrier' });

    // 3 milliárd Ft: a validáción átmegy (> 0), de a `price_huf INTEGER`
    // oszlopba nem fér bele → a beszúrás a járat-sor UTÁN hasal el. Ha a
    // handler nem gördítené vissza a tranzakciót, ár nélküli járat maradna
    // a nyilvános listán, amire foglalni sem lehet (409 „nincs ár erre a
    // méretre"), törölni pedig a szállító nem tudja.
    const res = await request(app).post('/carrier-routes').set(auth(szallito.token))
      .send(jaratBody({ prices: [{ size: 'M', price_huf: 3000000000 }] }));

    expect(res.status, 'a túlcsorduló ár nem hibaválaszt adott').toBeGreaterThanOrEqual(400);
    expect((await jaratSorok(szallito.id)).length, 'a félbeszakadt létrehozás ÁR NÉLKÜLI járatot hagyott a listán').toBe(0);
    const { rows: arak } = await db.query(
      `SELECT * FROM carrier_route_prices WHERE route_id IN
         (SELECT id FROM carrier_routes WHERE carrier_id = $1)`, [szallito.id],
    );
    expect(arak.length, 'árva ár-sor maradt a tranzakcióból').toBe(0);
  });
});

// =====================================================================
//  3. RÉSZLETNÉZET: a SABLON is rejtett
// =====================================================================
describe('Járat részletnézet: a sablon nem böngészhető', () => {
  it('a SABLON járat idegennek 404, a tulajdonosának 200 — pedig a státusza „open"', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'shipper' });

    // A sablon a szállító MUNKAESZKÖZE (ebből klónoz új járatot), nem
    // hirdetés — a `waypoints`-ban viszont ugyanúgy ott a megállók pontos
    // koordinátája, jellemzően az otthoni indulóponttal. A státusz-kapu
    // önmagában kevés: a sablon lehet 'open' státuszú is.
    const { rows } = await db.query(
      `INSERT INTO carrier_routes (carrier_id, title, departure_at, waypoints, status, is_template)
       VALUES ($1, 'Sablon járat', NOW() + INTERVAL '2 days', $2::jsonb, 'open', TRUE)
       RETURNING *`,
      [szallito.id, JSON.stringify([
        { name: 'Budapest', lat: 47.4979, lng: 19.0402 },
        { name: 'Szeged', lat: 46.253, lng: 20.1414 },
      ])],
    );
    const sablon = rows[0];

    const kivul = await request(app).get(`/carrier-routes/${sablon.id}`).set(auth(idegen.token));
    expect(kivul.status, 'a SABLON járat részletei idegennek is kiadódnak').toBe(404);
    expect(JSON.stringify(kivul.body), 'a 404 mellé a megállók is kimentek').not.toMatch(/waypoints|19\.04/);

    const sajat = await request(app).get(`/carrier-routes/${sablon.id}`).set(auth(szallito.token));
    expect(sajat.status, 'a szállító nem éri el a SAJÁT sablonját').toBe(200);
    expect(sajat.body.is_template, 'a sablon-jelölés elveszett a válaszból').toBe(true);
  });
});

// =====================================================================
//  4. SZERKESZTÉS (PATCH) — időpont, megállók, jelzők, státusz
// =====================================================================
describe('Járat szerkesztés: az időpont-kapu szerkesztéssel sem kerülhető meg', () => {
  it('érvénytelen és múltbeli indulás 400 — a járat időpontja nem változik', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito);
    const eredeti = (await jaratSor(jarat.id)).departure_at;

    const rossz = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ departure_at: 'nem-egy-datum' });
    expect(rossz.status, 'értelmezhetetlen időpontot elfogad a szerkesztés').toBe(400);
    expect(rossz.body.error).toMatch(/érvénytelen/i);

    const mult = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ departure_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });
    expect(mult.status, 'a járat indulása szerkesztéssel a múltba tolható').toBe(400);
    expect(mult.body.code, 'a múltbeli indulásnak nincs saját hibakódja').toBe('DEPARTURE_IN_PAST');

    expect(
      (await jaratSor(jarat.id)).departure_at.toISOString(),
      'az elutasított szerkesztés MÉGIS átírta az indulás időpontját',
    ).toBe(eredeti.toISOString());

    const jo = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const ok = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ departure_at: jo.toISOString() });
    expect(ok.status, 'az érvényes, jövőbeli időpont sem menthető').toBe(200);
    expect(
      (await jaratSor(jarat.id)).departure_at.toISOString(),
      'az elfogadott időpont-módosítás nem került a DB-be',
    ).toBe(jo.toISOString());
  });

  it('a megállók és az „elviszlek is" jelző szerkeszthető, a többi mező érintetlen marad', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito, { title: 'Eredeti cím', description: 'Eredeti leírás' });
    expect(jarat.is_ride_along, 'a jelző alapból nem hamis').toBe(false);

    const ujMegallok = [
      { name: 'Debrecen', lat: 47.5316, lng: 21.6273, order: 0 },
      { name: 'Kecskemét', lat: 46.9062, lng: 19.6913, order: 1 },
      { name: 'Pécs', lat: 46.0727, lng: 18.2323, order: 2 },
    ];
    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ waypoints: ujMegallok, is_ride_along: true });

    expect(res.status).toBe(200);
    const sor = await jaratSor(jarat.id);
    expect(sor.waypoints.map((w) => w.name), 'az útvonal megállói nem frissültek').toEqual(['Debrecen', 'Kecskemét', 'Pécs']);
    expect(sor.is_ride_along, 'a személyszállítás-jelző nem állt át').toBe(true);
    expect(sor.title, 'a nem küldött cím felülíródott').toBe('Eredeti cím');
    expect(sor.description, 'a nem küldött leírás felülíródott').toBe('Eredeti leírás');
  });

  it('a teljes szerkesztésen a lemondás NEM megy — csak a /status végponton', async () => {
    // ⚠️ SZÁNDÉKOS VISELKEDÉS-VÁLTOZÁS (2026-08-16). Ez a teszt eredetileg
    // azt rögzítette, hogy a teljes PATCH-en is lemondható a járat. Csakhogy
    // a lemondáshoz azóta KÖVETKEZMÉNYEK tartoznak (a /status végponton): a
    // fizetett-foglalás guard és a függő foglalások lezárása + a feladók
    // értesítése. Ha a teljes PATCH-en is engednénk, a védelem megint csak
    // az egyik úton épülne meg. A teszt ezért ma az ELLENKEZŐJÉT őrzi.
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varos = egyediNev('Lemondasfalva');
    const jarat = await letrehozJarat(szallito, {
      waypoints: [
        { name: varos, lat: 47.4979, lng: 19.0402, order: 0 },
        { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
      ],
    });

    const res = await request(app).patch(`/carrier-routes/${jarat.id}`).set(auth(szallito.token))
      .send({ status: 'cancelled', title: 'Lemondott járat' });
    expect(
      res.status,
      'A teljes szerkesztő PATCH-en átment a lemondás — így megkerülhető a '
      + 'fizetett-foglalás guard és a foglalások rendezése (az a /status '
      + 'végponton él).',
    ).toBe(400);
    expect(res.body.error).toMatch(/Lemondás gombbal/i);

    // A járat állapota érintetlen — továbbra is nyitott.
    const lista = await request(app).get(`/carrier-routes?city=${encodeURIComponent(varos)}`)
      .set(auth(felado.token));
    expect(
      lista.body.map((r) => r.id),
      'a járat eltűnt a böngészőből, pedig a lemondásnak meg kellett hiúsulnia',
    ).toContain(jarat.id);
  });
});

// =====================================================================
//  5. A SZÁLLÍTÓ FOGLALÁS-LISTÁJA — a DÍJ-KAPU a végponton
// =====================================================================
describe('A szállító foglalás-listája (GET /carrier-routes/:id/bookings)', () => {
  it('a címzett elérhetősége CSAK a díj kifizetése után látszik — a kód és a követő-token soha', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });

    const { booking, routeId } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false,
    });

    // FIZETÉS ELŐTT: ha a szállító itt látná a címzett telefonszámát, a
    // kapcsolatfelvételi díj (a platform egyetlen bevétele) megkerülhető
    // lenne — a feladó saját magát adja meg címzettként, a szállító pedig a
    // megerősítés után kiolvassa a számot. A `scrubBookingForUser` unit-
    // szinten tesztelve volt, de a VÉGPONTON át senki nem mérte.
    const elotte = await request(app).get(`/carrier-routes/${routeId}/bookings`).set(auth(szallito.token));
    expect(elotte.status).toBe(200);
    const e = elotte.body.find((b) => b.id === booking.id);
    expect(e, 'a szállító nem látja a saját járatára érkezett foglalást').toBeTruthy();
    expect(e.recipient_phone, 'a címzett telefonszáma a DÍJ ELŐTT kiment a szállítónak').toBeUndefined();
    expect(e.recipient_name, 'a címzett neve a DÍJ ELŐTT kiment a szállítónak').toBeUndefined();
    expect(e.delivery_code, 'az átvételi kód kiment a szállítónak').toBeUndefined();
    expect(e.tracking_token, 'a követő-token kiment a szállítónak (→ publikus oldal → kód)').toBeUndefined();
    expect(e.pickup_address, 'a szállító a felvételi címet sem látja — így nem tud dönteni').toBeTruthy();

    await db.query('UPDATE route_bookings SET paid_at = NOW() WHERE id = $1', [booking.id]);

    const utana = await request(app).get(`/carrier-routes/${routeId}/bookings`).set(auth(szallito.token));
    const u = utana.body.find((b) => b.id === booking.id);
    expect(u.recipient_phone, 'fizetés UTÁN sem kapja meg a címzett számát — nem tudná kézbesíteni').toBe('+36301112233');
    expect(u.delivery_code, 'fizetés után az átvételi kód is kiment (a kód-védelem lényege veszne el)').toBeUndefined();
    expect(u.tracking_token, 'fizetés után a követő-token is kiment').toBeUndefined();

    const kivulallo = await request(app).get(`/carrier-routes/${routeId}/bookings`).set(auth(idegen.token));
    expect(kivulallo.status, 'idegen szállító is lekérheti egy másik járat foglalásait').toBe(403);
    expect(JSON.stringify(kivulallo.body), 'a 403 mellé foglalás-adat is ment').not.toMatch(/pickup_address|recipient/);

    const { scrubBookingForUser } = require('../src/routes/carrierRoutes');
    expect(
      scrubBookingForUser(null, { sub: szallito.id }),
      'üres sorra a scrub elszáll, ahelyett hogy továbbadná',
    ).toBeNull();
  });
});

// =====================================================================
//  6. A CÍMZETT ÉRTESÍTÉSE FOGLALÁSKOR (1-SMS modell)
// =====================================================================
describe('Foglalás: a címzett értesítése', () => {
  it('a megadott címzett e-mailben kapja a követő-linket, SMS viszont NEM megy ki', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const jarat = await letrehozJarat(szallito);
    const cimzettEmail = `cimzett-${egyediNev('x')}@teszt.gofuvar.hu`;

    // ÜZLETI SZABÁLY (2026-07-13 user-döntés): fuvaronként EGYETLEN SMS megy
    // ki, a csomag FELVÉTELEKOR. A foglalás leadásakor küldött SMS-t
    // szándékosan megszüntettük (~20-30 Ft/db; base-case volumenen több
    // tízezer Ft/hó). Ha valaki „hasznos értesítésként" visszatenné ide, az
    // némán megduplázná az SMS-költséget — ezért mérjük, hogy NINCS küldés.
    const smsKem = vi.spyOn(smsModul, 'sendSms').mockResolvedValue({ ok: true, stub: true });

    // Két levél indul: a szállítónak („új foglalás") és a címzettnek.
    const levelek = await elkapottLevelek(async () => {
      const res = await request(app).post(`/carrier-routes/${jarat.id}/bookings`)
        .set(auth(felado.token))
        .send({
          length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
          pickup_address: 'Budapest, Teszt utca 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
          dropoff_address: 'Szeged, Teszt tér 2.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
          recipient_name: 'Kovács Anna', recipient_phone: '+36301112233', recipient_email: cimzettEmail,
        });
      expect(res.status, `a foglalás nem jött létre: ${JSON.stringify(res.body)}`).toBe(201);
    }, { varjLevelekre: 2 });

    const cimzettLevel = levelek.find((l) => l.to?.[0] === cimzettEmail);
    expect(cimzettLevel, 'a címzett SEMMILYEN értesítést nem kap a rá váró csomagról').toBeTruthy();
    expect(
      cimzettLevel.html,
      'a levélből hiányzik a nyomon követő link — a címzett nem tudja, mikor érkezik',
    ).toMatch(/nyomon-kovetes\//);

    await varj(120);
    expect(
      smsKem.mock.calls.length,
      'SMS ment ki a foglalás leadásakor — a fuvaronként EGY SMS modellt sérti (felesleges költség)',
    ).toBe(0);
  });
});

// =====================================================================
//  7. HA A FIZETÉSSZOLGÁLTATÓ ELÉRHETETLEN
// =====================================================================
describe('Fizetésszolgáltató-hiba: a foglalás nem ragadhat félkész állapotban', () => {
  it('a megerősítés 502-t ad, és a foglalás FÜGGŐ marad (nem lesz fizetési munkamenet nélküli „megerősítve")', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });

    vi.spyOn(paymentProvider, 'startFeePayment').mockRejectedValue(new Error('A PSP nem elérhető'));

    const res = await request(app).post(`/route-bookings/${booking.id}/confirm`)
      .set(auth(szallito.token)).send({});

    expect(res.status, 'a fizetésszolgáltató kiesését nem jelezzük a hívónak').toBe(502);
    expect(res.body.error).toMatch(/díjfizetés indítása sikertelen/i);

    const sor = await foglalasSor(booking.id);
    expect(
      sor.status,
      'a foglalás MEGERŐSÍTETT lett fizetési munkamenet nélkül — a feladó sosem tudná kifizetni a díjat',
    ).toBe('pending');
    expect(sor.confirmed_at, 'a megerősítés időpontja rögzült, pedig nem történt megerősítés').toBeNull();
    expect(sor.barion_payment_id, 'fizetési azonosító került a sorba a sikertelen indítás után').toBeNull();
  });

  it('a lusta fizetés-indítás (/pay) is 502-t ad, és nem ír fél kész fizetési adatot', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed',
    });

    vi.spyOn(paymentProvider, 'startFeePayment').mockRejectedValue(new Error('A PSP nem elérhető'));

    const res = await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });

    expect(res.status, 'a /pay elnyeli a fizetésszolgáltató hibáját').toBe(502);
    const sor = await foglalasSor(booking.id);
    expect(sor.barion_gateway_url, 'fizetési link került a sorba, pedig a szolgáltató elszállt').toBeNull();
    expect(sor.paid_at, 'a sikertelen indítás fizetettre állította a foglalást').toBeNull();
  });
});

// =====================================================================
//  8. NEM LÉTEZŐ FOGLALÁS A PÉNZ-ÚTON
// =====================================================================
describe('A pénz-út végpontjai ismeretlen azonosítóra', () => {
  it('/pay és /confirm-payment nem létező foglalásra 404-et ad (nem 500-at)', async () => {
    const felado = await createUser({ role: 'shipper' });

    const pay = await request(app).post(`/route-bookings/${NEM_LETEZO}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(pay.status, 'ismeretlen foglalás fizetés-indítása szerverhibát ad').toBe(404);
    expect(pay.body.error).toMatch(/nem található/i);

    const confirm = await request(app).post(`/route-bookings/${NEM_LETEZO}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(confirm.status, 'ismeretlen foglalás nyugtázása szerverhibát ad').toBe(404);
  });
});

// =====================================================================
//  9. DÍJ-VISSZAIGAZOLÁS TARTÓS ADATHORDOZÓN (45/2014. 18. §)
// =====================================================================
describe('A kifizetett díj visszaigazolása', () => {
  it('a nyugtázás után a FELADÓ levelet kap a díjról és a készpénzes fuvardíjról', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', priceHuf: 60000,
    });
    // A díjat a /pay rögzíti a sorra (60 000 Ft fuvardíj → 1 000 Ft díjsáv) —
    // SZÁNDÉKOSAN nem írjuk be kézzel, mert akkor a levél akkor is helyes
    // összeget mutatna, ha a /pay elfelejtené rögzíteni.
    await request(app).post(`/route-bookings/${booking.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });

    // 45/2014. (II. 26.) Korm. r. 18. §: a fogyasztó a megkötött szerződésről
    // TARTÓS ADATHORDOZÓN kap visszaigazolást. Ez a levél az egyetlen ilyen
    // dokumentum a foglalási ágon — a fuvar-ágon meglévő párja mellől
    // korábban semmi nem őrizte, hogy itt is kimegy-e.
    const levelek = await elkapottLevelek(async () => {
      const res = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`)
        .set(auth(felado.token)).send({});
      expect(res.status, `a nyugtázás elhasalt: ${JSON.stringify(res.body)}`).toBe(200);
    }, { varjLevelekre: 2 });

    const feladoiLevel = levelek.find((l) => l.to?.[0] === felado.email);
    expect(feladoiLevel, 'a feladó semmilyen visszaigazolást nem kap a befizetett díjról').toBeTruthy();
    expect(feladoiLevel.html, 'a visszaigazolásból hiányzik a megfizetett díj összege').toMatch(/1\s*000|1\.000/);
    expect(
      feladoiLevel.html,
      'a visszaigazolás nem mondja meg, hogy a fuvardíj készpénzben jár a szállítónak',
    ).toMatch(/készpénz/i);
  });
});
