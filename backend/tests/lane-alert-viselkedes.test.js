// =====================================================================
//  Útvonal-figyelő (lane alert) — VISELKEDÉS-tesztek.
//
//  Miért kellett ez a fájl: a `services/laneAlerts.js` két frissen javított
//  adatvédelmi garanciáját eddig KIZÁRÓLAG szöveg-illesztés őrizte
//  (`pii-csatorna-or.test.js`: „a forrásban szerepeljen az `email_verified`
//  string"). Egy szöveg-illesztő őrt ki lehet elégíteni úgy is, hogy a
//  védelem közben nem működik (pl. a feltétel a WHERE-ben marad, de a
//  `createNotification` hívás átkerül a szűrés elé) — ezért itt a TÉNYLEGES
//  kimenetet mérjük: mi kerül be a `notifications` táblába, és mi megy ki
//  e-mailben.
//
//  A két őrzött garancia:
//    (a) CSAK megerősített e-mailű fiók kaphat lane-alert értesítést — a
//        push-szerű értesítés különben megkerülné a piactér e-mail-kapuját;
//    (b) az útvonal-címke TELEPÜLÉS-szintű (`telepulesSzint`), nem a
//        házszámig pontos cím — az e-mail-példányra semmilyen retenció
//        nem vonatkozik, az örökre a postafiókban marad.
//
//  ⚠️ A KÜLSŐ HÁLÓZAT: az e-mail megfigyeléséhez a `RESEND_API_KEY`-t
//  ideiglenesen kitöltjük (különben a stub-ág csak logol, és a levél
//  TARTALMÁT nem lehetne megnézni), a `global.fetch`-et viszont MOCKOLJUK.
//  Így valódi hálózati hívás nem történhet, de a levél teljes HTML-je
//  mérhető. A kulcsot minden teszt után visszaállítjuk.
// =====================================================================

import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const crypto = require('crypto');
const { db, createUser } = require('./helpers');
const laneAlerts = require('../src/services/laneAlerts');
const { distanceMeters } = require('../src/utils/geo');

const { notifyMatchingAlerts, jobMatchesAlert } = laneAlerts;

// ── Földrajzi fixpontok ───────────────────────────────────────────────
const BP = { lat: 47.4979, lng: 19.0402 };
const SZEGED = { lat: 46.2530, lng: 20.1414 };
const DEBRECEN = { lat: 47.5316, lng: 21.6273 };
// ~22 km-re Budapesttől északra (1 fok szélesség ≈ 111,2 km)
const BP_KOZEL = { lat: 47.6979, lng: 19.0402 };

const RESEND_URL = 'https://api.resend.com/emails';

let levelek;
let eredetiResendKulcs;

beforeEach(() => {
  levelek = [];
  eredetiResendKulcs = process.env.RESEND_API_KEY;
  // Kilépünk a stub-ágból, hogy a levél TARTALMA is mérhető legyen…
  process.env.RESEND_API_KEY = 'teszt-hamis-resend-kulcs-nem-eles';
  // …de a hálózatot elvágjuk: minden fetch ide fut be.
  vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
    let body = {};
    try { body = JSON.parse(opts?.body || '{}'); } catch { /* nem JSON */ }
    levelek.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'teszt-level-id' }),
      text: async () => '',
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = eredetiResendKulcs;
});

// ── Segédek ───────────────────────────────────────────────────────────

/** Figyelő beszúrása. Alapból: Budapest, 25 km, cél/ár/súly szűrő nélkül. */
async function figyelo(carrierId, mezok = {}) {
  const a = {
    label: 'teszt figyelő',
    from_lat: BP.lat,
    from_lng: BP.lng,
    to_lat: null,
    to_lng: null,
    radius_km: 25,
    min_price_huf: null,
    max_weight_kg: null,
    active: true,
    ...mezok,
  };
  const { rows } = await db.query(
    `INSERT INTO carrier_alerts
       (carrier_id, label, from_lat, from_lng, to_lat, to_lng,
        radius_km, min_price_huf, max_weight_kg, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [carrierId, a.label, a.from_lat, a.from_lng, a.to_lat, a.to_lng,
      a.radius_km, a.min_price_huf, a.max_weight_kg, a.active],
  );
  return rows[0];
}

/**
 * A `notifyMatchingAlerts` bemenete a `jobs` sor. A függvény a fuvart NEM
 * kérdezi le újra a DB-ből (csak a figyelőket), ezért itt ugyanolyan alakú
 * objektumot adunk át, mint amit a `POST /jobs` ad tovább.
 */
function fuvar(mezok = {}) {
  return {
    id: crypto.randomUUID(),
    shipper_id: null,
    title: 'Kanapé szállítás',
    pickup_lat: BP.lat,
    pickup_lng: BP.lng,
    dropoff_lat: SZEGED.lat,
    dropoff_lng: SZEGED.lng,
    pickup_address: 'Budapest, Váci út 1, 1132',
    dropoff_address: 'Szeged, Kossuth Lajos sugárút 12, 6722',
    suggested_price_huf: 25000,
    weight_kg: null,
    ...mezok,
  };
}

async function laneErtesitesek(userId) {
  const { rows } = await db.query(
    `SELECT * FROM notifications
      WHERE user_id = $1 AND type = 'lane_alert'
      ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

/**
 * A kiment Resend-levelek, CÍMZETTRE szűrve.
 *
 * ⚠️ A címzettre szűrés nem kényelmi kérdés: az e-mail-ág `setImmediate`-tel
 * fut, tehát egy korábbi teszt levele átcsúszhat a következő teszt
 * megfigyelési ablakába. Minden teszt SAJÁT, egyedi e-mail-című usereket
 * gyárt, így a címzettre szűrt mérés sorrend-független.
 */
const resendLevelek = (cimzett = null) => levelek.filter(
  (l) => l.url === RESEND_URL
    && (cimzett === null || (Array.isArray(l.body.to) && l.body.to.includes(cimzett))),
);

/** A fire-and-forget e-mail-ág bevárása (setImmediate + await lánc). */
async function varakozzLevelre(cimzett, ms = 4000) {
  const vege = Date.now() + ms;
  for (;;) {
    const talalat = resendLevelek(cimzett);
    if (talalat.length > 0) return talalat;
    if (Date.now() > vege) return [];
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * A figyelő-lekérdezés PLATFORM-SZINTŰ: minden szállító minden aktív
 * figyelőjét visszaadja. Ahhoz, hogy a „senki nem figyel" / „senki sem
 * illeszkedik" állapotot mérni lehessen, a korábbi tesztek figyelőit
 * ideiglenesen ki kell kapcsolni. A visszaállítás PONTOS (csak azt kapcsolja
 * vissza, amit ez a hívás kapcsolt ki), és `finally`-ben fut.
 */
async function mindenFigyeloKikapcsol() {
  const { rows } = await db.query(
    'UPDATE carrier_alerts SET active = FALSE WHERE active = TRUE RETURNING id',
  );
  return rows.map((r) => r.id);
}

async function figyelokVisszakapcsol(idk) {
  if (!idk.length) return;
  await db.query('UPDATE carrier_alerts SET active = TRUE WHERE id = ANY($1::uuid[])', [idk]);
}

/** Minden függőben lévő setImmediate/microtask kifuttatása (negatív állításhoz). */
async function levelekKiürítése() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setTimeout(r, 120));
}

// =====================================================================
//  0) A mérőeszköz épsége
// =====================================================================
describe('lane-alert — a teszt tényleg a valós modult méri', () => {
  it('a modul pontosan a mért két függvényt exportálja', () => {
    // ⚠️ Ez a teszt a MÉRÉST védi: ha a modul átnevezné/eldobná valamelyik
    // exportot, az összes alábbi teszt némán „zöld" lenne (undefined-ot
    // hívnánk), ahelyett hogy hangosan elhasalna.
    expect(
      Object.keys(laneAlerts).sort(),
      'A laneAlerts.js exportjai megváltoztak — a teszt a régi neveket méri, '
      + 'tehát ettől a ponttól VAK lenne. Igazítsd a tesztet a valós exportokhoz.',
    ).toEqual(['jobMatchesAlert', 'notifyMatchingAlerts']);
    expect(typeof notifyMatchingAlerts).toBe('function');
    expect(typeof jobMatchesAlert).toBe('function');
  });

  it('a fetch-mock él: valódi hálózati hívás nem történhet', async () => {
    // Ha ez elbukik, a lenti e-mail-mérések ÉLES Resend-hívásokat
    // indítanának (a RESEND_API_KEY-t ugyanis kitöltjük).
    const valasz = await global.fetch('https://pelda.hu/x', { body: '{}' });
    expect(valasz.ok, 'a fetch-mock nem érvényesült — a tesztek hálózatra mennének').toBe(true);
    expect(levelek.some((l) => l.url === 'https://pelda.hu/x')).toBe(true);
  });
});

// =====================================================================
//  1) (a) garancia — e-mail-kapu
// =====================================================================
describe('lane-alert — csak MEGERŐSÍTETT e-mailű fiók kap értesítést', () => {
  it('a megerősítetlen szállító sem értesítést, sem e-mailt nem kap (a megerősített igen)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const megerositett = await createUser({ role: 'carrier', emailVerified: true });
    const megerositetlen = await createUser({ role: 'carrier', emailVerified: false });
    await figyelo(megerositett.id);
    await figyelo(megerositetlen.id);

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

    // POZITÍV KONTROLL: a megerősített fiók ténylegesen illeszkedik és kap.
    // Enélkül a „nem kapott" állítás akkor is igaz lenne, ha az egész
    // értesítés-ág elromlott (pl. a figyelő rosszul illeszkedik).
    expect(
      (await laneErtesitesek(megerositett.id)).length,
      'A megerősített e-mailű szállító NEM kapott lane-alert értesítést — '
      + 'ilyenkor a lenti negatív állítás semmit nem bizonyít (vak teszt).',
    ).toBe(1);

    expect(
      (await laneErtesitesek(megerositetlen.id)).length,
      'MEG NEM ERŐSÍTETT e-mailű fiók lane-alert értesítést kapott. A figyelő '
      + 'PUSH-szerű: lekérdezni sem kell hozzá, mégis kiadja az új fuvar '
      + 'útvonalát és árát — ezzel megkerülhető a piactér e-mail-kapuja. '
      + 'Az `AND u.email_verified = TRUE` feltétel hiányzik a lekérdezésből.',
    ).toBe(0);

    // Az e-mail-példányra SEMMILYEN retenció nem vonatkozik → ez a súlyosabb ág.
    const kiment = await varakozzLevelre(megerositett.email);
    expect(kiment.length, 'a pozitív kontroll e-mailje sem ment ki — a mérés vak').toBe(1);
    await levelekKiürítése();
    expect(
      resendLevelek(megerositetlen.email).length,
      'A lane-alert e-mail a MEG NEM ERŐSÍTETT fiók címére is kiment. Az '
      + 'e-mail-példány a postafiókban marad, retenció nem éri el — ez a '
      + 'súlyosabbik ág, mert a DB-értesítést legalább a retenciós job törli.',
    ).toBe(0);
  });
});

// =====================================================================
//  2) (b) garancia — település-szintű útvonal-címke
// =====================================================================
describe('lane-alert — az útvonal-címke TELEPÜLÉS-szintű, nem házszámig pontos', () => {
  it('magyar cím: az értesítés „Budapest → Szeged", utca/házszám nélkül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await figyelo(carrier.id);

    const job = fuvar({ shipper_id: felado.id });
    await notifyMatchingAlerts(job);

    const [ertesites] = await laneErtesitesek(carrier.id);
    expect(ertesites, 'nem jött létre lane-alert értesítés — a mérés vak').toBeTruthy();

    expect(
      ertesites.body,
      'Az értesítés törzsében nincs benne a település-szintű útvonal '
      + '(„Budapest → Szeged"). Vagy elmaradt a `telepulesSzint()` hívás, '
      + 'vagy megváltozott a címke formátuma.',
    ).toContain('Budapest → Szeged');

    for (const tiltott of ['Váci', '1132', 'Kossuth', 'sugárút', '6722']) {
      expect(
        ertesites.body,
        `A lane-alert értesítés a HÁZSZÁMIG PONTOS címet viszi ("${tiltott}" `
        + 'megjelent benne). A szállítónak a döntéshez a település elég; a '
        + 'pontos cím a fuvar oldalán van, ahol a scrub és a jogosultság is '
        + 'érvényesül. Hiányzik a `telepulesSzint()` a routeLabel-ből.',
      ).not.toContain(tiltott);
    }

    expect(
      ertesites.link,
      'Az értesítés linkje nem a szállítói fuvar-oldalra mutat — a felhasználó '
      + 'nem jut el oda, ahol a pontos cím jogosultsággal elérhető.',
    ).toBe(`/sofor/fuvar/${job.id}`);
    expect(ertesites.type).toBe('lane_alert');
  });

  it('NÉMET cím: „Hauptstraße 5" NEM mehet ki — ez volt az élő szivárgás', async () => {
    // ⚠️ Ez az az eset, ami a régi `split(',')[0]` megoldást megbuktatta: a
    // német/osztrák/román formátumban az UTCA áll elöl, tehát pont a pontos
    // utca+házszám maradt volna meg. A coverage Európa-szintű.
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await figyelo(carrier.id, { from_lat: 52.5200, from_lng: 13.4050, radius_km: 50 });

    await notifyMatchingAlerts(fuvar({
      shipper_id: felado.id,
      pickup_lat: 52.5200,
      pickup_lng: 13.4050,
      dropoff_lat: 48.2082,
      dropoff_lng: 16.3738,
      pickup_address: 'Hauptstraße 5, 10115 Berlin, Germany',
      dropoff_address: 'Stephansplatz 3, 1010 Wien, Austria',
    }));

    const [ertesites] = await laneErtesitesek(carrier.id);
    expect(ertesites, 'nem jött létre értesítés a német címes fuvarra — a mérés vak').toBeTruthy();
    expect(
      ertesites.body,
      'A német formátumú cím UTCA+HÁZSZÁM része („Hauptstraße 5") kiment az '
      + 'értesítésben. A címrövidítésnek TARTALOM-alapúnak kell lennie '
      + '(utils/address.js), nem az első vessző előtti szeletnek.',
    ).not.toContain('Hauptstraße 5');
    expect(ertesites.body).not.toContain('Stephansplatz 3');
    expect(
      ertesites.body,
      'A település-szintű rész sem maradt meg — a szállító így semmit nem tud '
      + 'kezdeni az értesítéssel.',
    ).toContain('10115 Berlin');
  });

  it('az E-MAIL törzse is település-szintű (nem csak a DB-értesítés)', async () => {
    // A javítás „csak az egyik csatornán" mintája ellen: az értesítés és az
    // e-mail KÉT külön példány, és az e-mailre nincs retenció.
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await figyelo(carrier.id);

    const job = fuvar({ shipper_id: felado.id });
    await notifyMatchingAlerts(job);

    const [level] = await varakozzLevelre(carrier.email);
    expect(level, 'nem ment ki lane-alert e-mail — a mérés vak').toBeTruthy();

    expect(
      level.body.subject,
      'Az e-mail tárgya nem a fuvar címét tartalmazza — a szállító nem tudja, miről szól.',
    ).toBe(`Új fuvar: ${job.title}`);
    expect(
      level.body.html,
      'Az e-mail HTML-jéből hiányzik a település-szintű útvonal.',
    ).toContain('Budapest → Szeged');

    for (const tiltott of ['Váci', '1132', 'Kossuth', '6722']) {
      expect(
        level.body.html,
        `A lane-alert E-MAIL a házszámig pontos címet viszi ("${tiltott}"). Ez a `
        + 'súlyosabb ág: az e-mail-példány a címzett postafiókjában marad, '
        + 'semmilyen retenciós job nem éri el.',
      ).not.toContain(tiltott);
    }
  });
});

// =====================================================================
//  3) Illeszkedés / nem-illeszkedés a lekérdezés szintjén
// =====================================================================
describe('lane-alert — kinek szól és kinek nem', () => {
  it('a SAJÁT fuvarára a feladó nem kap értesítést (akkor sem, ha van figyelője)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const masik = await createUser({ role: 'carrier' });
    await figyelo(felado.id);   // a feladó egyben szállító is lehet
    await figyelo(masik.id);

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

    expect(
      (await laneErtesitesek(masik.id)).length,
      'a másik szállító sem kapott — a negatív állítás így vak lenne',
    ).toBe(1);
    expect(
      (await laneErtesitesek(felado.id)).length,
      'A feladó a SAJÁT fuvaráról kapott lane-alert értesítést. Az '
      + '`a.carrier_id <> $1` feltétel hiányzik: minden feladó ön-értesítést '
      + 'kapna, ami zaj és fölösleges e-mail-költség.',
    ).toBe(0);
  });

  it('az INAKTÍV (kikapcsolt) figyelő nem szólal meg', async () => {
    const felado = await createUser({ role: 'shipper' });
    const kikapcsolt = await createUser({ role: 'carrier' });
    const aktiv = await createUser({ role: 'carrier' });
    await figyelo(kikapcsolt.id, { active: false });
    await figyelo(aktiv.id, { active: true });

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

    expect((await laneErtesitesek(aktiv.id)).length, 'a pozitív kontroll sem kapott').toBe(1);
    expect(
      (await laneErtesitesek(kikapcsolt.id)).length,
      'KIKAPCSOLT (active = FALSE) útvonal-figyelő is értesítést kapott. A '
      + 'kikapcsolás a felhasználó kifejezett kérése — figyelmen kívül hagyni '
      + 'kéretlen e-mailt jelent.',
    ).toBe(0);
  });

  it('egy szállító TÖBB illeszkedő figyelője is csak EGY értesítést ad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await figyelo(carrier.id, { label: 'BP tág', radius_km: 100 });
    await figyelo(carrier.id, { label: 'BP szűk', radius_km: 30 });
    await figyelo(carrier.id, { label: 'BP → Szeged', to_lat: SZEGED.lat, to_lng: SZEGED.lng, radius_km: 60 });

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

    expect(
      (await laneErtesitesek(carrier.id)).length,
      'Egy szállító HÁROM illeszkedő figyelője HÁROM értesítést adott. A '
      + '`notifiedCarriers` deduplikáció kiesett: aki gondosan több figyelőt '
      + 'állít be, azt spammeljük — épp a legaktívabb szállítókat.',
    ).toBe(1);

    // Az e-mail is csak egyszer megy ki (ez a pénzbe kerülő ág).
    const kiment = await varakozzLevelre(carrier.email);
    expect(kiment.length, 'nem ment ki e-mail — a mérés vak').toBeGreaterThan(0);
    await levelekKiürítése(); // hagyunk időt egy esetleges 2./3. levélre
    expect(
      resendLevelek(carrier.email).length,
      'Több e-mail ment ki ugyanannak a szállítónak ugyanarról a fuvarról — '
      + 'a deduplikáció az e-mail-ágon nem érvényesült (közvetlen költség).',
    ).toBe(1);
  });

  it('a sugáron KÍVÜLI felvételi pont nem illeszkedik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const tavoli = await createUser({ role: 'carrier' });
    const kozeli = await createUser({ role: 'carrier' });
    await figyelo(tavoli.id, { from_lat: DEBRECEN.lat, from_lng: DEBRECEN.lng, radius_km: 25 });
    await figyelo(kozeli.id, { from_lat: BP.lat, from_lng: BP.lng, radius_km: 25 });

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

    expect((await laneErtesitesek(kozeli.id)).length, 'a pozitív kontroll sem kapott').toBe(1);
    expect(
      (await laneErtesitesek(tavoli.id)).length,
      'Egy ~190 km-re lévő figyelő (Debrecen, 25 km sugár) is értesítést kapott '
      + 'egy budapesti felvételű fuvarról. A sugár-szűrés nem működik: minden '
      + 'szállító minden fuvarról értesítést kapna.',
    ).toBe(0);
  });

  it('a CÉLTERÜLET is szűr: a rossz irányba tartó fuvar nem illeszkedik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const rosszIrany = await createUser({ role: 'carrier' });
    const joIrany = await createUser({ role: 'carrier' });
    // Mindkettő Budapestről indul, de más célterületre figyel.
    await figyelo(rosszIrany.id, { to_lat: DEBRECEN.lat, to_lng: DEBRECEN.lng, radius_km: 40 });
    await figyelo(joIrany.id, { to_lat: SZEGED.lat, to_lng: SZEGED.lng, radius_km: 40 });

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id })); // BP → Szeged

    expect(
      (await laneErtesitesek(joIrany.id)).length,
      'A Szegedre figyelő szállító NEM kapott értesítést egy BP→Szeged fuvarról '
      + '— a célterület-illesztés túl szigorú (vagy elromlott).',
    ).toBe(1);
    expect(
      (await laneErtesitesek(rosszIrany.id)).length,
      'A DEBRECENRE figyelő szállító értesítést kapott egy BP→SZEGED fuvarról. '
      + 'A célterület-szűrés kiesett — a figyelő értelmét veszti, mert a '
      + 'szállító nem az ő irányába menő fuvarokat kapja.',
    ).toBe(0);
  });

  it('EGYETLEN aktív figyelő sincs a platformon (launch 1. nap) → nem dob, nem levelez', async () => {
    // A figyelő-lekérdezés PLATFORM-SZINTŰ (minden szállító minden aktív
    // figyelője), ezért ehhez az állapothoz a meglévőket ideiglenesen ki kell
    // kapcsolni — a `finally` pontosan visszaállítja.
    const kikapcsolva = await mindenFigyeloKikapcsol();
    try {
      const felado = await createUser({ role: 'shipper' });
      const carrier = await createUser({ role: 'carrier' });   // figyelő NÉLKÜL

      await expect(
        notifyMatchingAlerts(fuvar({ shipper_id: felado.id })),
        'Nulla figyelő mellett (ez a launch 1. napjának állapota, és minden '
        + 'olyan fuvarnál előfordul, ahol senki nem figyel) a függvény hibát '
        + 'dobott. A `jobs.js` fire-and-forget hívja, tehát ez minden '
        + 'fuvarfeladásnál kezeletlen rejection lenne.',
      ).resolves.toBeUndefined();

      await levelekKiürítése();
      expect((await laneErtesitesek(carrier.id)).length).toBe(0);
      expect(
        resendLevelek(carrier.email).length,
        'E-mail ment ki egy olyan szállítónak, akinek EGYETLEN útvonal-figyelője '
        + 'sincs — kéretlen levél és fölösleges költség.',
      ).toBe(0);
    } finally {
      await figyelokVisszakapcsol(kikapcsolva);
    }
  });

  it('vannak figyelők, de EGYIK SEM illeszkedik → nincs értesítés és nincs levél', async () => {
    const kikapcsolva = await mindenFigyeloKikapcsol();
    try {
      const felado = await createUser({ role: 'shipper' });
      const carrier = await createUser({ role: 'carrier' });
      // Debrecen, 5 km sugár — a BP → Szeged fuvar ettől ~190 km-re van.
      await figyelo(carrier.id, { from_lat: DEBRECEN.lat, from_lng: DEBRECEN.lng, radius_km: 5 });

      await notifyMatchingAlerts(fuvar({ shipper_id: felado.id }));

      await levelekKiürítése();
      expect(
        (await laneErtesitesek(carrier.id)).length,
        'Nem illeszkedő figyelő is értesítést kapott — a szűrés teljesen kiesett.',
      ).toBe(0);
      expect(
        resendLevelek(carrier.email).length,
        'Nem illeszkedő figyelőnek is kiment az e-mail. A pénzbe kerülő ág '
        + 'nincs a szűrés MÖGÖTT.',
      ).toBe(0);
    } finally {
      await figyelokVisszakapcsol(kikapcsolva);
    }
  });
});

// =====================================================================
//  4) Az értesítés törzsének ár-része
// =====================================================================
describe('lane-alert — ár az értesítésben', () => {
  it('ha van javasolt ár, az formázva megjelenik; ha nincs, nem lóg ki „undefined"', async () => {
    const felado = await createUser({ role: 'shipper' });
    const arral = await createUser({ role: 'carrier' });
    const arNelkul = await createUser({ role: 'carrier' });
    await figyelo(arral.id);
    await figyelo(arNelkul.id);

    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id, suggested_price_huf: 25000 }));
    const [a] = await laneErtesitesek(arral.id);
    expect(
      a.body,
      'A javasolt ár nem jelenik meg az értesítésben — pedig a szállító ez '
      + 'alapján dönt, hogy megnyitja-e egyáltalán a fuvart.',
    ).toMatch(/25[\s  ]?000\s*Ft/);

    // Külön fuvar ár nélkül (a `job.suggested_price_huf ? … : ''` másik ága)
    await db.query('DELETE FROM notifications WHERE user_id = $1', [arNelkul.id]);
    await notifyMatchingAlerts(fuvar({ shipper_id: felado.id, suggested_price_huf: null }));
    const arNelkulErtesitesek = await laneErtesitesek(arNelkul.id);
    const utolso = arNelkulErtesitesek[arNelkulErtesitesek.length - 1];
    expect(utolso, 'ár nélküli fuvarra nem jött értesítés — a mérés vak').toBeTruthy();
    expect(
      utolso.body,
      'Ár nélküli fuvarnál „undefined"/„null" került az értesítés szövegébe — '
      + 'a felhasználó technikai szemetet lát.',
    ).not.toMatch(/undefined|null|NaN/);
    expect(utolso.body).toContain('Budapest → Szeged');
  });
});

// =====================================================================
//  5) Fire-and-forget: soha nem dobhat
// =====================================================================
describe('lane-alert — a hívó soha nem sérülhet (fire-and-forget)', () => {
  it('DB-hiba esetén sem dob: a fuvarfeladás nem borulhat meg tőle', async () => {
    // Érvénytelen UUID a shipper_id-ben → a Postgres a lekérdezésnél dob.
    // A `jobs.js` a választ MÁR elküldte, mire ez fut: ha itt kivétel
    // szabadulna el, az kezeletlen rejection lenne az éles folyamatban.
    const hibasHivas = notifyMatchingAlerts(fuvar({ shipper_id: 'nem-egy-uuid' }));
    await expect(
      hibasHivas,
      'A `notifyMatchingAlerts` DB-hiba esetén DOBOTT. Ez fire-and-forget '
      + 'hívás a `POST /jobs`-ból (setImmediate), tehát a kivétel kezeletlen '
      + 'rejectionként csapódna ki az éles process-ben.',
    ).resolves.toBeUndefined();
  });
});

// =====================================================================
//  6) `jobMatchesAlert` — a tiszta illeszkedés-logika határértékei
// =====================================================================
describe('jobMatchesAlert — határértékek', () => {
  const alapFigyelo = {
    from_lat: BP.lat, from_lng: BP.lng,
    to_lat: null, to_lng: null,
    radius_km: 25, min_price_huf: null, max_weight_kg: null,
  };

  it('PONTOSAN a sugáron: illeszkedik; egy hajszállal kívül: nem', () => {
    const job = fuvar({ pickup_lat: BP_KOZEL.lat, pickup_lng: BP_KOZEL.lng });
    const tavKm = distanceMeters(job.pickup_lat, job.pickup_lng, BP.lat, BP.lng) / 1000;

    expect(
      jobMatchesAlert(job, { ...alapFigyelo, radius_km: tavKm }),
      'A PONTOSAN a sugár szélén lévő fuvar kiesett. A feltétel `>` kell '
      + 'legyen, nem `>=` — a felhasználó által beállított „25 km"-be a 25 km '
      + 'beletartozik.',
    ).toBe(true);

    expect(
      jobMatchesAlert(job, { ...alapFigyelo, radius_km: tavKm - 0.001 }),
      'A sugáron KÍVÜLI fuvar is illeszkedett — a távolság-ellenőrzés nem szűr.',
    ).toBe(false);
  });

  it('célterület: csak akkor szűr, ha MINDKÉT koordináta megvan', () => {
    const job = fuvar(); // BP → Szeged
    // Fél-kitöltött célterület (to_lat megvan, to_lng nincs) → NEM szabad
    // szűrni, különben a `distanceMeters(..., null)` NaN-t adna, és a
    // `NaN > radius` false-a miatt VÉLETLENÜL engedne át mindent.
    expect(
      jobMatchesAlert(job, { ...alapFigyelo, to_lat: DEBRECEN.lat, to_lng: null }),
      'Hiányos célterületnél (csak to_lat) a fuvar kiesett. A DB mindkét '
      + 'oszlopot nullable-ként engedi, tehát ez előálló állapot.',
    ).toBe(true);

    expect(
      jobMatchesAlert(job, { ...alapFigyelo, to_lat: SZEGED.lat, to_lng: SZEGED.lng, radius_km: 40 }),
      'A célterületre PONTOSAN illeszkedő fuvar kiesett.',
    ).toBe(true);

    expect(
      jobMatchesAlert(job, { ...alapFigyelo, to_lat: DEBRECEN.lat, to_lng: DEBRECEN.lng, radius_km: 40 }),
      'Rossz irányba tartó fuvar (BP→Szeged, Debrecenre figyelve) illeszkedett.',
    ).toBe(false);
  });

  it('ár-szűrő: csak akkor szűr, ha MINDKÉT oldal ismert', () => {
    expect(
      jobMatchesAlert(fuvar({ suggested_price_huf: 9999 }), { ...alapFigyelo, min_price_huf: 10000 }),
      'A minimum ár alatti fuvar átment a szűrőn.',
    ).toBe(false);

    expect(
      jobMatchesAlert(fuvar({ suggested_price_huf: 10000 }), { ...alapFigyelo, min_price_huf: 10000 }),
      'A minimummal PONTOSAN egyező ár kiesett — a feltétel `<`, nem `<=`.',
    ).toBe(true);

    expect(
      jobMatchesAlert(fuvar({ suggested_price_huf: null }), { ...alapFigyelo, min_price_huf: 10000 }),
      'Az ár NÉLKÜLI fuvart az ár-szűrő eldobta. Az ár opcionális mező: így a '
      + 'szállító sosem értesülne az ár nélkül feladott fuvarokról.',
    ).toBe(true);

    expect(
      jobMatchesAlert(fuvar({ suggested_price_huf: 1 }), { ...alapFigyelo, min_price_huf: null }),
      'Beállítatlan ár-szűrő mellett is kiesett a fuvar.',
    ).toBe(true);
  });

  it('súly-szűrő: csak akkor szűr, ha MINDKÉT oldal ismert (a súly NUMERIC → string)', () => {
    // ⚠️ A `jobs.weight_kg` NUMERIC(8,2), amit a pg STRINGKÉNT ad vissza
    // ('50.00') — a bemenet tehát szöveg, a figyelő oldala (INTEGER) viszont
    // szám. MÉRÉSI MEGJEGYZÉS: a kódban álló `Number(job.weight_kg)` ezen a
    // ponton EGYENÉRTÉKŰ mutáns — a `>` operátor szám-operandus mellett úgyis
    // numerikusan konvertál, tehát az eltávolítása nem változtat a
    // viselkedésen (lemérve). Nem is próbáljuk „megölni": a lenti állítások
    // a VALÓDI szabályt rögzítik (plafon, határérték, hiányzó adat).
    expect(
      jobMatchesAlert(fuvar({ weight_kg: '50.00' }), { ...alapFigyelo, max_weight_kg: 10 }),
      'A maximum feletti súlyú fuvar átment a súly-szűrőn — a szállító olyan '
      + 'fuvarról kap értesítést, ami a járművébe sem fér be.',
    ).toBe(false);

    expect(
      jobMatchesAlert(fuvar({ weight_kg: '10.00' }), { ...alapFigyelo, max_weight_kg: 10 }),
      'A maximummal PONTOSAN egyező súly kiesett — a feltétel `>`, nem `>=`.',
    ).toBe(true);

    expect(
      jobMatchesAlert(fuvar({ weight_kg: null }), { ...alapFigyelo, max_weight_kg: 10 }),
      'A súly NÉLKÜLI fuvart a súly-szűrő eldobta — a súly opcionális mező.',
    ).toBe(true);

    expect(
      jobMatchesAlert(fuvar({ weight_kg: '900.00' }), { ...alapFigyelo, max_weight_kg: null }),
      'Beállítatlan súly-szűrő mellett is kiesett a fuvar.',
    ).toBe(true);
  });
});
