// =====================================================================
//  jobs.js — HIBAÁGAK ÉS HATÁRESETEK (2026-08-12)
//
//  Miért kell ez a fájl: a `src/routes/jobs.js` boldog ösvényét több suite
//  is végigjárja (teljes-ut, feketedoboz-ut, fizetes-es-lezaras), a
//  VISSZAUTASÍTÓ ágakat viszont alig valaki. Egy 403/409/400 elmaradása
//  némán jelentkezik: a rendszer „működik", csak épp többet enged, mint
//  szabadna — pont az a hibaosztály, ami a díj-kapun és a PII-kapun át
//  pénzt és személyes adatot visz.
//
//  MINDEN tesztnél a hibaüzenet mondja meg, mi a baj, ha elbukik.
//  Egyik teszt sem elégszik meg a „nem 500-azott" mércével.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const NINCS_ILYEN = '00000000-0000-0000-0000-0000000000ff';

beforeEach(() => __resetRateLimitsForTests());

/** Érvényes fuvar-feladás alap; a mezőit felül lehet írni. */
const ERVENYES = {
  title: 'Hibaág teszt fuvar',
  pickup_address: 'Budapest, Teszt u. 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
  dropoff_address: 'Szeged, Teszt ter 2.', dropoff_lat: 46.2530, dropoff_lng: 20.1414,
  weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
};
const fuvar = (o = {}) => ({ ...ERVENYES, ...o });

/** Rövid várakozás a fire-and-forget (setImmediate) mellékhatásokra. */
async function varjSort(lekerdezes, { proba = 40, kozben = 50 } = {}) {
  for (let i = 0; i < proba; i += 1) {
    const { rows } = await lekerdezes();
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, kozben));
  }
  return [];
}

// =====================================================================
//  1. POST /jobs — méret / súly / ár validációk
// =====================================================================
describe('POST /jobs — méret-, súly- és ár-határok', () => {
  it('tört centiméter elutasítva — a 12,5 cm NEM válhat csendben 125 cm-ré', async () => {
    const felado = await createUser({ role: 'shipper' });
    for (const mezo of ['length_cm', 'width_cm', 'height_cm']) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ [mezo]: 12.5 }));
      expect(res.status, `${mezo}=12,5 — a tört méretet el kell utasítani`).toBe(400);
      expect(res.body.error, `${mezo}: a hibaüzenet mondja meg, hogy egész cm kell`)
        .toMatch(/egész centiméter/i);
    }
    // Kontroll: az egész érték átmegy — a szabály nem lehet túl széles.
    __resetRateLimitsForTests();
    const ok = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar());
    expect(ok.status, 'az egész centiméteres feladást NEM szabad elutasítani').toBe(201);
  });

  it('2000 cm feletti oldal elutasítva — enélkül a volume_m3 túlcsordul és 500 lesz', async () => {
    const felado = await createUser({ role: 'shipper' });
    for (const mezo of ['length_cm', 'width_cm', 'height_cm']) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ [mezo]: 2001 }));
      expect(res.status, `${mezo}=2001 — 400-at kell adni, nem DB-túlcsordulást (500)`).toBe(400);
    }
    // A HATÁR pontosan: 2000 még jó (a mutáció `>=`-re cserélve itt bukna).
    __resetRateLimitsForTests();
    const hataron = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ length_cm: 2000, width_cm: 10, height_cm: 10 }));
    expect(hataron.status, 'a pontosan 2000 cm-es oldalt még el kell fogadni').toBe(201);
  });

  it('100 000 kg feletti súly elutasítva (a weight_kg NUMERIC(8,2) — efölött 500 lenne)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ weight_kg: 100001 }));
    expect(res.status, 'a 100 tonna feletti súlyt 400-zal kell elutasítani').toBe(400);
    expect(res.body.error).toMatch(/irreálisan nagy/i);
    __resetRateLimitsForTests();
    const hataron = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ weight_kg: 100000 }));
    expect(hataron.status, 'a pontosan 100 000 kg-ot még el kell fogadni').toBe(201);
  });

  it('a csomagérték felső korlátja és egész-forint szabálya érvényesül', async () => {
    const felado = await createUser({ role: 'shipper' });
    const tulNagy = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ declared_value_huf: 100000001 }));
    expect(tulNagy.status, '100 millió feletti csomagérték → 400 (INTEGER oszlop, különben 500)').toBe(400);

    __resetRateLimitsForTests();
    const tort = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ declared_value_huf: 1000.5 }));
    expect(tort.status, 'tört forintos csomagérték → 400').toBe(400);
    expect(tort.body.error).toMatch(/kerek forint/i);

    __resetRateLimitsForTests();
    const tortAr = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ suggested_price_huf: 15000.5 }));
    expect(tortAr.status, 'tört forintos fuvardíj → 400').toBe(400);
  });

  it('a 0 Ft-os csomagérték NULL-ként tárolódik (nem 0-ként) — a pozitív érték kerekítve', async () => {
    const felado = await createUser({ role: 'shipper' });
    const nulla = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ declared_value_huf: 0 }));
    expect(nulla.status).toBe(201);
    expect(nulla.body.declared_value_huf, 'a 0 Ft-os érték „nincs megadva" (NULL), nem 0').toBeNull();

    __resetRateLimitsForTests();
    const van = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ declared_value_huf: 250000 }));
    expect(van.body.declared_value_huf, 'a megadott csomagértéket meg kell őrizni').toBe(250000);
  });

  it('a szolgáltatási területen kívüli fuvar 403 OUTSIDE_COVERAGE (mindkét pont kívül)', async () => {
    const felado = await createUser({ role: 'shipper' });
    // New York — mindkét pont az európai bboxon kívül
    const res = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({
        pickup_lat: 40.7128, pickup_lng: -74.0060,
        dropoff_lat: 40.7300, dropoff_lng: -73.9350,
      }));
    expect(res.status, 'Európán kívüli fuvart nem szabad felvenni').toBe(403);
    expect(res.body.code).toBe('OUTSIDE_COVERAGE');

    // Elég, ha az EGYIK pont bent van (BP → New York legyen felvehető):
    __resetRateLimitsForTests();
    const felig = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ dropoff_lat: 40.7128, dropoff_lng: -74.0060 }));
    expect(felig.status, 'ha a felvételi pont a zónában van, a fuvar felvehető').toBe(201);
  });
});

// =====================================================================
//  2. POST /jobs — címzett-mezők (a felvételkori SMS ezen múlik)
// =====================================================================
describe('POST /jobs — címzett-adatok', () => {
  it('csak a címzett e-mailjét megadva is kötelező a NÉV és a TELEFON', async () => {
    const felado = await createUser({ role: 'shipper' });
    // Az e-mail ÖNMAGÁBAN kiváltja a „más veszi át" ágat — ezt a mezőt a
    // korábbi tesztek nem járták be, pedig enélkül a szállító a címen áll
    // egy e-mail-címmel, amit nem tud felhívni.
    const res = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ recipient_email: 'cimzett@pelda.hu' }));
    expect(res.status, 'a címzett e-mailje önmagában nem elég — név+telefon kell').toBe(400);
    expect(res.body.code).toBe('RECIPIENT_INCOMPLETE');
  });

  it('a címzett telefonszáma formátum-ellenőrzött (betű / túl rövid / túl hosszú)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const rosszSzamok = [
      ['+36 harminc 123', 'betűt tartalmaz'],
      ['+36 30 12', 'kevesebb mint 9 számjegy'],
      ['+36 30 123 4567 8901 234', 'több mint 15 számjegy'],
    ];
    for (const [szam, miert] of rosszSzamok) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ recipient_name: 'Teszt Címzett', recipient_phone: szam }));
      expect(res.status, `"${szam}" (${miert}) — érvénytelen telefonszámot el kell utasítani`).toBe(400);
      expect(res.body.code).toBe('RECIPIENT_PHONE_INVALID');
    }
    // Kontroll: a valós formátum átmegy, és az e-mail-ág is lefut.
    __resetRateLimitsForTests();
    const ok = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({
        recipient_name: 'Teszt Címzett',
        recipient_phone: '+36 30 123 4567',
        recipient_email: 'cimzett@pelda.hu',
      }));
    expect(ok.status, 'a teljes, érvényes címzett-hármast el kell fogadni').toBe(201);
    expect(ok.body.recipient_email, 'a címzett e-mailjét el kell menteni (követő-link megy rá)')
      .toBe('cimzett@pelda.hu');
    expect(ok.body.tracking_token, 'a feladó megkapja a követő-tokent').toBeTruthy();
  });
});

// =====================================================================
//  3. POST /jobs — „Hozasd el": forrás-bolt és termékkép engedélylista
// =====================================================================
describe('POST /jobs — forrás-bolt és termékkép engedélylista', () => {
  it('csak az engedélyezett boltnév marad meg, minden más eldobódik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const ok = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ source_store: 'IKEA' }));
    expect(ok.body.source_store, 'az engedélyezett boltnevet meg kell tartani').toBe('IKEA');

    __resetRateLimitsForTests();
    const idegen = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ source_store: '<script>alert(1)</script>' }));
    expect(idegen.status).toBe(201);
    expect(idegen.body.source_store, 'ismeretlen boltnevet NEM szabad eltárolni (a szállító UI-ján jelenne meg)')
      .toBeNull();
  });

  it('a termékkép URL-je host-engedélylistás — a suffix-trükk és a http nem megy át', async () => {
    const felado = await createUser({ role: 'shipper' });
    // A kép a SZÁLLÍTÓ böngészőjében töltődik be: egy idegen host tracking-
    // pixelt vagy kártékony tartalmat tudna beinjektálni.
    const esetek = [
      ['https://ikea.com/kep.jpg', 'https://ikea.com/kep.jpg', 'pontos host-egyezés'],
      ['https://www.ikea.com/kep.jpg', 'https://www.ikea.com/kep.jpg', 'aldomain (.ikea.com)'],
      ['http://www.ikea.com/kep.jpg', null, 'http (nem https)'],
      ['https://gonosz.hu/kep.jpg', null, 'idegen host'],
      ['https://ikea.com.gonosz.hu/kep.jpg', null, 'SUFFIX-TRÜKK: az engedett név csak a hoszt eleje'],
      ['nem-is-url', null, 'értelmezhetetlen URL'],
      [12345, null, 'nem string'],
      [`https://www.ikea.com/${'a'.repeat(2100)}.jpg`, null, '2000 karakternél hosszabb'],
    ];
    for (const [bemenet, vart, miert] of esetek) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ source_image_url: bemenet }));
      expect(res.status, `${miert}: a feladás ne szálljon el`).toBe(201);
      expect(res.body.source_image_url, `${miert} — helytelen eredmény`).toBe(vart);
    }
  });
});

// =====================================================================
//  4. POST /jobs — azonnali fuvar (is_instant) paraméter-normalizálás
// =====================================================================
describe('POST /jobs — azonnali fuvar paraméterei', () => {
  it('azonnali fuvarhoz kötelező a pozitív fix ár (nincs licit, ez a VÉGSŐ ár)', async () => {
    const felado = await createUser({ role: 'shipper' });
    // Hiányzó és 0 ár: az azonnali-specifikus kapu fogja meg.
    for (const ar of [undefined, 0]) {
      __resetRateLimitsForTests();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ is_instant: true, suggested_price_huf: ar }));
      expect(res.status, `is_instant + ár=${ar} → 400 (különben 0 Ft-os azonnali fuvar kelne el)`).toBe(400);
      expect(res.body.error, 'az üzenet mondja meg, hogy a FIX ÁR hiányzik').toMatch(/fix ár/i);
    }
    // A negatív árat már az ÁLTALÁNOS ár-validáció elutasítja (az fut előbb) —
    // a lényeg, hogy negatív díjú azonnali fuvar SEMMILYEN úton ne jöhessen létre.
    __resetRateLimitsForTests();
    const negativ = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ is_instant: true, suggested_price_huf: -1 }));
    expect(negativ.status, 'negatív fix árral nem lehet azonnali fuvart feladni').toBe(400);

    // Kontroll: pozitív fix árral létrejön, és azonnaliként.
    __resetRateLimitsForTests();
    const ok = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ is_instant: true, suggested_price_huf: 9000 }));
    expect(ok.status, 'érvényes fix árral az azonnali fuvar felvehető').toBe(201);
    expect(ok.body.is_instant, 'az azonnali jelleget el kell menteni').toBe(true);
  });

  it('az élettartam 5–240 percre vágódik, a hatókör 1–100 km-re (alapérték 30 perc / 20 km)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const esetek = [
      [{ instant_duration_minutes: 1 }, 5, 20, 'az 1 perc alulról 5-re vágódik'],
      [{ instant_duration_minutes: 9999 }, 240, 20, 'a 9999 perc felülről 240-re vágódik'],
      [{ instant_duration_minutes: 'abc' }, 30, 20, 'a nem-szám az alapértelmezett 30 percre esik'],
      [{ instant_radius_km: 500 }, 30, 20, 'a 100 km feletti hatókör az alap 20 km-re esik'],
      [{ instant_radius_km: 0 }, 30, 20, 'a 0 km-es hatókör az alap 20 km-re esik'],
      [{ instant_radius_km: 7.6 }, 30, 8, 'a tört km egészre kerekítődik'],
    ];
    for (const [extra, vartPerc, vartKm, miert] of esetek) {
      __resetRateLimitsForTests();
      const elott = Date.now();
      const res = await request(app).post('/jobs').set(auth(felado.token))
        .send(fuvar({ is_instant: true, suggested_price_huf: 9000, ...extra }));
      expect(res.status, miert).toBe(201);
      expect(res.body.instant_radius_km, `${miert} (hatókör)`).toBe(vartKm);
      const percek = (new Date(res.body.instant_expires_at).getTime() - elott) / 60000;
      expect(percek, `${miert} (élettartam ~${vartPerc} perc, kapott ${percek.toFixed(1)})`)
        .toBeGreaterThan(vartPerc - 1);
      expect(percek, `${miert} (élettartam ~${vartPerc} perc, kapott ${percek.toFixed(1)})`)
        .toBeLessThan(vartPerc + 1);
    }
  });
});

// =====================================================================
//  5. POST /jobs — cipelés / emelet / lift normalizálás
//     (ÁRAZÁSI tényezők: a szállító ezek alapján licitál)
// =====================================================================
describe('POST /jobs — cipelés-adatok normalizálása', () => {
  it('a 10 feletti emelet 10-re vágódik, a szemét 0-ra, cipelés nélkül minden nullázódik', async () => {
    const felado = await createUser({ role: 'shipper' });

    const vagott = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({
      pickup_needs_carrying: true, pickup_floor: 99, pickup_has_elevator: true,
      dropoff_needs_carrying: true, dropoff_floor: 'nem szám', dropoff_has_elevator: false,
    }));
    expect(vagott.status).toBe(201);
    expect(vagott.body.pickup_floor, 'a 99. emelet 10-re vágódik (nincs ilyen ház)').toBe(10);
    expect(vagott.body.pickup_has_elevator, 'a megadott liftet meg kell őrizni').toBe(true);
    expect(vagott.body.dropoff_floor, 'az értelmezhetetlen emelet 0 (földszint)').toBe(0);

    __resetRateLimitsForTests();
    // Cipelés NÉLKÜL a megadott emelet/lift NEM számít — különben a szállító
    // egy 5. emeletet látna ott, ahol nincs cipelés-igény, és túlárazna.
    const nincsCipeles = await request(app).post('/jobs').set(auth(felado.token)).send(fuvar({
      pickup_needs_carrying: false, pickup_floor: 5, pickup_has_elevator: true,
      dropoff_needs_carrying: false, dropoff_floor: 7, dropoff_has_elevator: true,
    }));
    expect(nincsCipeles.body.pickup_floor, 'cipelés nélkül az emelet 0').toBe(0);
    expect(nincsCipeles.body.pickup_has_elevator, 'cipelés nélkül a lift false').toBe(false);
    expect(nincsCipeles.body.dropoff_floor, 'cipelés nélkül a lerakodási emelet is 0').toBe(0);
    expect(nincsCipeles.body.dropoff_has_elevator, 'cipelés nélkül a lerakodási lift is false').toBe(false);
  });
});

// =====================================================================
//  6. POST /jobs — visszafuvar-push (a fire-and-forget ág)
// =====================================================================
describe('POST /jobs — visszafuvar-értesítés a passzoló szállítóknak', () => {
  it('a visszaúton lévő szállító EGYSZER kap értesítést, a nem megerősített e-mailű SOHA', async () => {
    // A szállítónak Szeged→Budapest aktív fuvarja van; az új fuvar
    // Budapest→Szeged, vagyis pont az ő visszaútja.
    const felado = await createUser({ role: 'shipper' });
    const szallitoOk = await createUser({ role: 'carrier' });
    const szallitoNemErositett = await createUser({ role: 'carrier', emailVerified: false });

    // KÉT aktív fuvar UGYANANNAK a szállítónak — a `notified` halmaz miatt
    // csak EGY értesítést kaphat (különben minden aktív fuvarjára kapna egyet).
    for (let i = 0; i < 2; i += 1) {
      await createJob({
        shipperId: felado.id, carrierId: szallitoOk.id, status: 'in_progress',
        pickupAddress: 'Szeged, Teszt ter 2.', dropoffAddress: 'Budapest, Teszt u. 1.',
      });
    }
    await db.query(
      `UPDATE jobs SET pickup_lat = 46.2530, pickup_lng = 20.1414,
                       dropoff_lat = 47.4979, dropoff_lng = 19.0402
        WHERE carrier_id = $1`, [szallitoOk.id],
    );
    const nemErositettFuvar = await createJob({
      shipperId: felado.id, carrierId: szallitoNemErositett.id, status: 'in_progress',
    });
    await db.query(
      `UPDATE jobs SET pickup_lat = 46.2530, pickup_lng = 20.1414,
                       dropoff_lat = 47.4979, dropoff_lng = 19.0402
        WHERE id = $1`, [nemErositettFuvar.id],
    );

    const res = await request(app).post('/jobs').set(auth(felado.token))
      .send(fuvar({ title: 'Visszafuvar-passzoló fuvar' }));
    expect(res.status).toBe(201);

    const ertesitesek = await varjSort(() => db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'backhaul_match'`,
      [szallitoOk.id],
    ));
    expect(ertesitesek.length,
      'a visszaútján lévő szállítót értesíteni kell — ez a visszafuvar-funkció lényege')
      .toBe(1);

    const { rows: tiltott } = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'backhaul_match'`,
      [szallitoNemErositett.id],
    );
    expect(tiltott.length,
      'a MEG NEM ERŐSÍTETT e-mailű fiók nem kaphat push-t: az értesítés a fuvar '
      + 'felhasználó-írta CÍMÉT viszi ki, lekérdezés nélkül')
      .toBe(0);
  });
});

// =====================================================================
//  6/b. scrubJobForUser — védekező viselkedés hiányzó soron
//     (a modul kifejezetten EZÉRT exportálja a helpert)
// =====================================================================
describe('scrubJobForUser — üres bemenet', () => {
  const { scrubJobForUser } = require('../src/routes/jobs');

  it('null/undefined soron nem hasal el (a lista-map minden sorra meghívja)', () => {
    // A `GET /jobs` és a `mine/list` a teljes találati listát ezen a helperen
    // engedi át. Ha egy sor bármiért hiányzik, a scrub NEM dobhat kivételt —
    // különben EGY hibás sor az egész piactér-lekérdezést 500-zal ütné ki.
    expect(scrubJobForUser(null, { sub: 'x', role: 'shipper' }),
      'null sorra null a válasz, nem kivétel').toBeNull();
    expect(scrubJobForUser(undefined, null),
      'undefined sorra undefined a válasz, nem kivétel').toBeUndefined();
  });
});

// =====================================================================
//  7. GET /jobs — piactér-szűrők
// =====================================================================
describe('GET /jobs — szűrők', () => {
  it('ismeretlen státuszra 400 (enélkül a Postgres enum-hibája 500 lenne)', async () => {
    const user = await createUser({ role: 'carrier' });
    const res = await request(app).get('/jobs?status=open').set(auth(user.token));
    expect(res.status, 'a nem létező enum-értéket 400-zal kell elutasítani, nem 500-zal').toBe(400);
    expect(res.body.error).toMatch(/Érvénytelen státusz/i);
  });

  it('ár- és súly-szűrők a megadott sávot adják vissza', async () => {
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const olcso = await createJob({ shipperId: felado.id, status: 'bidding', priceHuf: 3000 });
    const draga = await createJob({ shipperId: felado.id, status: 'bidding', priceHuf: 900000 });
    await db.query(`UPDATE jobs SET weight_kg = 2 WHERE id = $1`, [olcso.id]);
    await db.query(`UPDATE jobs SET weight_kg = 900 WHERE id = $1`, [draga.id]);

    const min = await request(app).get('/jobs?min_price=800000').set(auth(bongeszo.token));
    const minIdk = min.body.map((j) => j.id);
    expect(minIdk, 'a min_price alatti fuvart ki kell szűrni').not.toContain(olcso.id);
    expect(minIdk, 'a min_price feletti fuvarnak benne kell lennie').toContain(draga.id);

    const max = await request(app).get('/jobs?max_price=5000').set(auth(bongeszo.token));
    const maxIdk = max.body.map((j) => j.id);
    expect(maxIdk, 'a max_price feletti fuvart ki kell szűrni').not.toContain(draga.id);
    expect(maxIdk, 'a max_price alatti fuvarnak benne kell lennie').toContain(olcso.id);

    const suly = await request(app).get('/jobs?max_weight_kg=10').set(auth(bongeszo.token));
    const sulyIdk = suly.body.map((j) => j.id);
    expect(sulyIdk, 'a járműbe nem férő (900 kg) fuvart a súly-szűrő kizárja').not.toContain(draga.id);
    expect(sulyIdk, 'a könnyű fuvarnak benne kell lennie').toContain(olcso.id);
  });

  it('a város-szűrő részszövegre illeszt, de a LIKE-jokert (% és _) NEM engedi át', async () => {
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const cel = await createJob({
      shipperId: felado.id, status: 'bidding',
      pickupAddress: 'Kisvakondfalva, Fo ter', dropoffAddress: 'Nagybaromfalva, Also sor',
    });
    const masikFalva = await createJob({
      shipperId: felado.id, status: 'bidding',
      pickupAddress: 'Kisberekfalva, Fo ter', dropoffAddress: 'Szeged, Teszt ter 2.',
    });
    const masik = await createJob({ shipperId: felado.id, status: 'bidding' });

    const kis = await request(app).get('/jobs?pickup_city=kisvakond').set(auth(bongeszo.token));
    expect(kis.body.map((j) => j.id), 'kis/nagybetűtől függetlenül találnia kell (ILIKE)')
      .toContain(cel.id);
    expect(kis.body.map((j) => j.id), 'a más városban lévő fuvar nem jöhet vissza')
      .not.toContain(masik.id);

    const cimzett = await request(app).get('/jobs?dropoff_city=Nagybarom').set(auth(bongeszo.token));
    expect(cimzett.body.map((j) => j.id), 'a lerakodási város-szűrőnek is működnie kell')
      .toContain(cel.id);

    // ── A LIKE-jokerek KISZEDÉSE (nem escape-elése) ──
    // A „Kis%falva" beírva a szűrőnek a SZÓ SZERINTI szöveget kell keresnie.
    // Ha a `%` jokerként érvényesülne, a minta `%Kis%falva%` lenne, ami MINDKÉT
    // falut megtalálná — vagyis a beírt szöveg többet hozna, mint amit a user
    // kért, és a szűrő tetszőleges mintaillesztő eszközzé válna.
    const joker = await request(app).get('/jobs?pickup_city=Kis%25falva').set(auth(bongeszo.token));
    const jokerIdk = joker.body.map((j) => j.id);
    expect(jokerIdk, 'a „%" nem lehet joker — „Kisfalva" nevű település nincs a listában')
      .not.toContain(cel.id);
    expect(jokerIdk, 'a „%" jokerként MINDKÉT falut megtalálná — pont ezt kell megakadályozni')
      .not.toContain(masikFalva.id);

    const alahuzas = await request(app).get('/jobs?pickup_city=Kisvakond_alva').set(auth(bongeszo.token));
    expect(alahuzas.body.map((j) => j.id),
      'az „_" sem lehet joker (egy tetszőleges karakter) — jokerként megtalálná a „Kisvakondfalvá"-t')
      .not.toContain(cel.id);
  });

  it('az ?instant szűrő szétválasztja az azonnali és a licites fuvarokat', async () => {
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const licites = await createJob({ shipperId: felado.id, status: 'bidding' });
    const azonnali = await createJob({ shipperId: felado.id, status: 'bidding' });
    const lejart = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [azonnali.id],
    );
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, instant_expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [lejart.id],
    );

    const igen = await request(app).get('/jobs?instant=true').set(auth(bongeszo.token));
    const igenIdk = igen.body.map((j) => j.id);
    expect(igenIdk, 'az élő azonnali fuvarnak benne kell lennie').toContain(azonnali.id);
    expect(igenIdk, 'a LEJÁRT azonnali fuvar nem kínálható fel — a szállító hiába indulna el')
      .not.toContain(lejart.id);
    expect(igenIdk, 'a licites fuvar nem azonnali').not.toContain(licites.id);

    const nem = await request(app).get('/jobs?instant=false').set(auth(bongeszo.token));
    const nemIdk = nem.body.map((j) => j.id);
    expect(nemIdk, 'a licites fuvarnak benne kell lennie').toContain(licites.id);
    expect(nemIdk, 'azonnali fuvar nem kerülhet a licites listába').not.toContain(azonnali.id);
  });

  it('a lat/lng + radius_km sugár-szűrő távolságot számol és a sugáron kívülit kizárja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const bongeszo = await createUser({ role: 'carrier' });
    const kozeli = await createJob({ shipperId: felado.id, status: 'bidding' }); // BP felvétel
    const tavoli = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `UPDATE jobs SET pickup_lat = 46.2530, pickup_lng = 20.1414 WHERE id = $1`, [tavoli.id],
    );

    const sugar = await request(app).get('/jobs?lat=47.4979&lng=19.0402&radius_km=25')
      .set(auth(bongeszo.token));
    const idk = sugar.body.map((j) => j.id);
    expect(idk, 'a budapesti felvételi pont a 25 km-es sugáron belül van').toContain(kozeli.id);
    expect(idk, 'a ~160 km-re lévő szegedi fuvar NEM eshet a 25 km-es sugárba').not.toContain(tavoli.id);
    const talalat = sugar.body.find((j) => j.id === kozeli.id);
    expect(talalat.distance_to_pickup_km, 'a távolságot ki kell számolni és visszaadni')
      .toBeLessThan(1);

    // Sugár nélkül minden benne van, de a távolság akkor is számolódik.
    const sugarNelkul = await request(app).get('/jobs?lat=47.4979&lng=19.0402')
      .set(auth(bongeszo.token));
    const tavoliTalalat = sugarNelkul.body.find((j) => j.id === tavoli.id);
    expect(tavoliTalalat, 'radius_km nélkül nem szabad szűrni').toBeTruthy();
    expect(tavoliTalalat.distance_to_pickup_km, 'a szegedi táv ~160 km').toBeGreaterThan(100);
  });
});

// =====================================================================
//  8. GET /jobs/:id — 404, lusta kód-generálás, kontakt-felfedés
// =====================================================================
describe('GET /jobs/:id', () => {
  it('nem létező fuvarra 404', async () => {
    const user = await createUser({ role: 'shipper' });
    const res = await request(app).get(`/jobs/${NINCS_ILYEN}`).set(auth(user.token));
    expect(res.status, 'ismeretlen azonosítóra 404 jár, nem 500 és nem üres 200').toBe(404);
  });

  it('kód nélküli elfogadott fuvarnál lustán generál kódot — de a feladónak NEM adja ki', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', deliveryCode: null,
    });

    const res = await request(app).get(`/jobs/${job.id}`).set(auth(felado.token));
    expect(res.status).toBe(200);
    expect(res.body.delivery_code,
      'a CÍMZETT kódja a feladónak sosem jár — különben továbbadhatná a szállítónak, '
      + 'aki a címzett nélkül zárná le a fuvart')
      .toBeUndefined();

    const { rows } = await db.query(`SELECT delivery_code FROM jobs WHERE id = $1`, [job.id]);
    expect(rows[0].delivery_code,
      'az elfogadott fuvarnak MINDIG kell legyen 6 jegyű átvételi kódja (lusta generálás)')
      .toMatch(/^\d{6}$/);
  });

  it('a kontakt CSAK a díj kifizetése után, és CSAK a két félnek jelenik meg', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });

    const fizetetlen = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });
    const fizetetlenRes = await request(app).get(`/jobs/${fizetetlen.id}`).set(auth(felado.token));
    expect(fizetetlenRes.body.contact,
      'fizetés ELŐTT nincs kontakt — ezt adja el a kapcsolatfelvételi díj')
      .toBeUndefined();

    const fizetett = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    const feladoRes = await request(app).get(`/jobs/${fizetett.id}`).set(auth(felado.token));
    expect(feladoRes.body.contact?.role, 'a feladó a SZÁLLÍTÓ elérhetőségét kapja').toBe('carrier');
    expect(feladoRes.body.contact?.email, 'a kontaktban a másik fél e-mailje van')
      .toBe(szallito.email);

    const szallitoRes = await request(app).get(`/jobs/${fizetett.id}`).set(auth(szallito.token));
    expect(szallitoRes.body.contact?.role, 'a szállító a FELADÓ elérhetőségét kapja').toBe('shipper');
    expect(szallitoRes.body.contact?.email).toBe(felado.email);

    // Az admin teljes sort lát (moderáció), de a `contact` blokk kifejezetten
    // a két félnek szól — nem szabad harmadik félhez csatolni.
    const adminRes = await request(app).get(`/jobs/${fizetett.id}`).set(auth(admin.token));
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.contact,
      'a kontakt-blokk csak a fuvar két felének jár, kívülállónak (adminnak sem) nem')
      .toBeUndefined();
  });
});

// =====================================================================
//  9. POST /jobs/:id/pay — díj-sáv, idempotencia, kapuk
// =====================================================================
describe('POST /jobs/:id/pay', () => {
  it('nem létező fuvarra 404, idegen fuvarra 403, rossz státuszra 409', async () => {
    const felado = await createUser({ role: 'shipper' });
    const idegen = await createUser({ role: 'shipper' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(nincs.status, 'ismeretlen fuvarra 404').toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'accepted' });
    const masenak = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(idegen.token)).send({ consent: true });
    expect(masenak.status, 'MÁS fuvarjára nem lehet fizetést indítani (IDOR)').toBe(403);

    const bidding = await createJob({ shipperId: felado.id, status: 'bidding' });
    const koran = await request(app).post(`/jobs/${bidding.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(koran.status, 'elfogadott ajánlat NÉLKÜL nincs mit fizetni').toBe(409);

    const fizetett = await createJob({ shipperId: felado.id, status: 'accepted', paid: true });
    const ujra = await request(app).post(`/jobs/${fizetett.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(ujra.status, 'a már kifizetett díjat nem szabad újra beszedni').toBe(409);
  });

  it('a díj sávja a megállapodott árból jön; accepted ár híján a javasolt árra esik vissza', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', priceHuf: 60000,
    });
    // A díj még nincs rögzítve, és megállapodott ár sincs — csak javasolt ár.
    await db.query(
      `UPDATE jobs SET connection_fee_huf = NULL, accepted_price_huf = NULL,
                       suggested_price_huf = 60000 WHERE id = $1`, [job.id],
    );
    const res = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(res.status).toBe(200);
    expect(res.body.fee_huf,
      '50 000 Ft feletti fuvardíjnál a díj 1000 Ft — ha a visszaesési lánc elszakad, '
      + 'némán 500 Ft-ot szednénk be (bevétel-kiesés)')
      .toBe(1000);

    const { rows } = await db.query(`SELECT connection_fee_huf FROM jobs WHERE id = $1`, [job.id]);
    expect(rows[0].connection_fee_huf, 'a kiszámolt díjat el kell menteni a fuvarra').toBe(1000);
  });

  it('idempotens: a második /pay UGYANAZT a fizetést adja vissza, nem indít újat', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', priceHuf: 20000,
    });
    await db.query(`UPDATE jobs SET connection_fee_huf = NULL WHERE id = $1`, [job.id]);

    const elso = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(elso.status).toBe(200);
    expect(elso.body.reused, 'az első hívás új fizetést indít').toBe(false);

    const masodik = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(masodik.body.reused, 'a második hívásnak a MEGLÉVŐ fizetést kell visszaadnia').toBe(true);
    expect(masodik.body.gateway_url, 'ugyanaz a fizetőoldal, nem egy második tranzakció')
      .toBe(elso.body.gateway_url);
    expect(masodik.body.payment_id).toBe(elso.body.payment_id);
    expect(masodik.body.is_stub, 'a stub-jelzésnek a második válaszban is látszania kell').toBe(true);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db FROM escrow_transactions WHERE job_id = $1`, [job.id],
    );
    expect(rows[0].db, 'egy fuvarhoz PONTOSAN EGY díj-sor tartozhat').toBe(1);
  });

  it('a fogyasztóvédelmi nyilatkozat nélkül nincs fizetés, de EGYSZER elég megtenni', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', priceHuf: 20000,
    });
    await db.query(`UPDATE jobs SET fee_consent_at = NULL WHERE id = $1`, [job.id]);

    const nyilatkozatNelkul = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(felado.token)).send({});
    expect(nyilatkozatNelkul.status, '45/2014. 29.§ (1) a) — nyilatkozat nélkül nincs fizetés').toBe(400);
    expect(nyilatkozatNelkul.body.code).toBe('CONSENT_REQUIRED');

    const jo = await request(app).post(`/jobs/${job.id}/pay`)
      .set(auth(felado.token)).send({ consent: true });
    expect(jo.status).toBe(200);
    const { rows } = await db.query(`SELECT fee_consent_at FROM jobs WHERE id = $1`, [job.id]);
    expect(rows[0].fee_consent_at, 'a nyilatkozat idejét rögzíteni kell (tartós adathordozó)')
      .toBeTruthy();
  });
});

// =====================================================================
// 10. POST /jobs/:id/confirm-payment — kapuk
// =====================================================================
describe('POST /jobs/:id/confirm-payment', () => {
  it('404 / 403 / 409 a nem odaillő hívásokra', async () => {
    const felado = await createUser({ role: 'shipper' });
    const idegen = await createUser({ role: 'shipper' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(nincs.status, 'ismeretlen fuvarra 404').toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'accepted' });
    const masenak = await request(app).post(`/jobs/${job.id}/confirm-payment`)
      .set(auth(idegen.token)).send({});
    expect(masenak.status,
      'IDEGEN nem nyugtázhatja más fuvarjának fizetését — enélkül bárki felfedhetné a kontaktot')
      .toBe(403);

    const bidding = await createJob({ shipperId: felado.id, status: 'bidding' });
    const koran = await request(app).post(`/jobs/${bidding.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(koran.status, 'elfogadás előtt nincs mit nyugtázni').toBe(409);
  });

  it('a nyilatkozat itt is kapu, és a nyugtázás idempotens', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', priceHuf: 20000,
    });
    await db.query(`UPDATE jobs SET fee_consent_at = NULL WHERE id = $1`, [job.id]);

    const nyilatkozatNelkul = await request(app).post(`/jobs/${job.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(nyilatkozatNelkul.status,
      'nyilatkozat nélkül a nyugtázás sem mehet — különben a /pay kapuja megkerülhető')
      .toBe(400);
    expect(nyilatkozatNelkul.body.code).toBe('CONSENT_REQUIRED');

    await db.query(`UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1`, [job.id]);
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, carrier_share_huf, platform_share_huf)
       VALUES ($1, 500, 'held', 0, 500)`, [job.id],
    );

    const elso = await request(app).post(`/jobs/${job.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(elso.status).toBe(200);
    expect(elso.body.paid_at, 'a nyugtázásnak be kell állítania a paid_at-ot').toBeTruthy();

    const masodik = await request(app).post(`/jobs/${job.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(masodik.body.already_paid,
      'a második nyugtázás nem fizet újra, csak jelzi, hogy már rendben van').toBe(true);
    expect(new Date(masodik.body.paid_at).getTime(),
      'a fizetés időpontja nem tolódhat el az ismételt hívástól')
      .toBe(new Date(elso.body.paid_at).getTime());

    const { rows } = await db.query(
      `SELECT status FROM escrow_transactions WHERE job_id = $1`, [job.id],
    );
    expect(rows[0].status,
      'a díj-sor a fizetés után „released" — a főkönyvben ne maradjon nyitott tétel')
      .toBe('released');
  });

  it('szállító nélküli elfogadott fuvarnál is végigmegy (nincs kinek szólni)', async () => {
    // Élesben ritka (a status accepted általában carriert is jelent), de a
    // kód `if (j.carrier_id)` ága enélkül sosem futna le a hamis irányba.
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, carrierId: null, status: 'accepted' });
    await db.query(`UPDATE jobs SET fee_consent_at = NOW(), paid_at = NULL WHERE id = $1`, [job.id]);

    const res = await request(app).post(`/jobs/${job.id}/confirm-payment`)
      .set(auth(felado.token)).send({});
    expect(res.status, 'a szállító hiánya nem okozhat hibát a nyugtázásban').toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// =====================================================================
// 11. POST /jobs/:id/cancel — jogosultság és állapot-kapuk
// =====================================================================
describe('POST /jobs/:id/cancel', () => {
  it('404 az ismeretlenre, 403 a kívülállónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const kivulallo = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/cancel`)
      .set(auth(felado.token)).send({});
    expect(nincs.status).toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'accepted' });
    const idegen = await request(app).post(`/jobs/${job.id}/cancel`)
      .set(auth(kivulallo.token)).send({});
    expect(idegen.status,
      'aki se nem feladó, se nem a kijelölt szállító, az nem mondhat le MÁS fuvarját')
      .toBe(403);
  });

  it('a lezárt / vitás / már lemondott fuvar nem mondható le — indoklással', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const lemondott = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'cancelled',
    });
    const ujra = await request(app).post(`/jobs/${lemondott.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(ujra.status).toBe(409);
    expect(ujra.body.error, 'a már lemondott fuvarra a saját üzenete jár').toMatch(/már le van mondva/i);

    const vitas = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'disputed',
    });
    const vita = await request(app).post(`/jobs/${vitas.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(vita.status,
      'NYITOTT vita alól nem lehet lemondással kimenekülni — előbb a vitát kell rendezni')
      .toBe(409);
    expect(vita.body.error).toMatch(/vita/i);

    const uton = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress',
    });
    const keson = await request(app).post(`/jobs/${uton.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(keson.status, 'a már elindult fuvart nem lehet lemondani (vitarendezés a helyes út)')
      .toBe(409);
  });

  it('feladói lemondás fizetett fuvaron: a díj NEM jár vissza, a függő fizetés lezárul', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    const res = await request(app).post(`/jobs/${job.id}/cancel`)
      .set(auth(felado.token)).send({ reason: 'Meggondoltam magam' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.refund_huf, 'a kapcsolatfelvételi díj nem visszatérítendő (ÁSZF)').toBe(0);
    expect(res.body.cancellation_fee_huf, 'lemondási díj NINCS (üzleti döntés)').toBe(0);
    expect(res.body.fee_kept,
      'a feladónak őszintén jelezni kell, hogy a befizetett díja nála marad').toBe(true);

    const { rows } = await db.query(
      `SELECT status, cancelled_by FROM jobs WHERE id = $1`, [job.id],
    );
    expect(rows[0].status).toBe('cancelled');
    expect(rows[0].cancelled_by, 'a lemondót rögzíteni kell').toBe(felado.id);
  });

  it('szállító nélküli fuvar lemondása nem hasal el (nincs kit értesíteni)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, carrierId: null, status: 'bidding' });
    const res = await request(app).post(`/jobs/${job.id}/cancel`)
      .set(auth(felado.token)).send({});
    expect(res.status, 'a még el nem kelt fuvar lemondása is működjön').toBe(200);
    expect(res.body.fee_kept, 'fizetetlen fuvarnál nincs mit megtartani').toBe(false);
  });

  it('a szállító lemondása a FIZETETT fuvart díjmentesen újranyitja (nem vész el a díj)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    const res = await request(app).post(`/jobs/${job.id}/cancel`)
      .set(auth(szallito.token)).send({ reason: 'Elromlott az autóm' });
    expect(res.status).toBe(200);
    expect(res.body.reopened, 'a szállító visszalépése nem semmisítheti meg a fuvart').toBe(true);

    const { rows } = await db.query(
      `SELECT status, carrier_id, paid_at, reopened_count FROM jobs WHERE id = $1`, [job.id],
    );
    expect(rows[0].status, 'a fuvar visszakerül a piactérre').toBe('bidding');
    expect(rows[0].carrier_id, 'a meghiúsult szállítót le kell kapcsolni a fuvarról').toBeNull();
    expect(rows[0].paid_at,
      'a befizetett díj a FUVARRA szól — újraválasztáskor nem kell újra fizetni')
      .toBeTruthy();
    expect(rows[0].reopened_count, 'az újranyitást számolni kell (plafon a kontakt-aratás ellen)').toBe(1);
  });
});

// =====================================================================
// 12. POST /jobs/:id/reopen — szállító-csere
// =====================================================================
describe('POST /jobs/:id/reopen', () => {
  it('404 / 403 / 409 — és az „úton van" külön üzenetet kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/reopen`)
      .set(auth(felado.token)).send({});
    expect(nincs.status).toBe(404);

    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted',
    });
    const nemFelado = await request(app).post(`/jobs/${job.id}/reopen`)
      .set(auth(szallito.token)).send({});
    expect(nemFelado.status,
      'szállítót cserélni CSAK a feladó tud — a szállító magát nem cserélheti le')
      .toBe(403);

    const uton = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress',
    });
    const utonRes = await request(app).post(`/jobs/${uton.id}/reopen`)
      .set(auth(felado.token)).send({});
    expect(utonRes.status).toBe(409);
    expect(utonRes.body.error,
      'a már úton lévő fuvarnál a vitarendezés a helyes út — ezt mondja is meg')
      .toMatch(/vitás esetet/i);

    const lezart = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'completed',
    });
    const lezartRes = await request(app).post(`/jobs/${lezart.id}/reopen`)
      .set(auth(felado.token)).send({});
    expect(lezartRes.status, 'lezárt fuvaron nincs szállító-csere').toBe(409);
  });

  it('az 5 újranyitás után zár a plafon — enélkül egy díjból az összes kontakt learatható', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await db.query(`UPDATE jobs SET reopened_count = 4 WHERE id = $1`, [job.id]);

    const otodik = await request(app).post(`/jobs/${job.id}/reopen`)
      .set(auth(felado.token)).send({});
    expect(otodik.status, 'az 5. újranyitás még belefér').toBe(200);

    await db.query(
      `UPDATE jobs SET status = 'accepted', carrier_id = $2 WHERE id = $1`, [job.id, szallito.id],
    );
    const hatodik = await request(app).post(`/jobs/${job.id}/reopen`)
      .set(auth(felado.token)).send({});
    expect(hatodik.status, 'a 6. újranyitást el kell utasítani').toBe(409);
    expect(hatodik.body.code).toBe('REOPEN_LIMIT_REACHED');
  });

  it('szállító nélküli elfogadott fuvar újranyitása is működik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, carrierId: null, status: 'accepted' });
    const res = await request(app).post(`/jobs/${job.id}/reopen`)
      .set(auth(felado.token)).send({});
    expect(res.status, 'hiányzó szállító mellett sem szabad elszállni').toBe(200);
    const { rows } = await db.query(`SELECT status FROM jobs WHERE id = $1`, [job.id]);
    expect(rows[0].status).toBe('bidding');
  });

  it('az újranyitás a KORÁBBI ajánlatokat visszaadja, a meghiúsultat elutasítja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const nyertes = await createUser({ role: 'carrier' });
    const vesztes = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: nyertes.id, status: 'accepted', paid: true,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy)
       VALUES ($1, $2, 12000, 'accepted', 'included'), ($1, $3, 13000, 'rejected', 'included')`,
      [job.id, nyertes.id, vesztes.id],
    );

    const res = await request(app).post(`/jobs/${job.id}/reopen`)
      .set(auth(felado.token)).send({ reason: 'Nem veszi fel a telefont' });
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      `SELECT carrier_id, status FROM bids WHERE job_id = $1`, [job.id],
    );
    const nyertesAjanlat = rows.find((r) => r.carrier_id === nyertes.id);
    const vesztesAjanlat = rows.find((r) => r.carrier_id === vesztes.id);
    expect(nyertesAjanlat.status, 'a meghiúsult szállító ajánlata lezárul').toBe('rejected');
    expect(vesztesAjanlat.status,
      'a korábban elutasított ajánlatoknak vissza kell kerülniük választhatóra — '
      + 'enélkül a feladó fizetett, de nem tud kit választani')
      .toBe('pending');
  });
});

// =====================================================================
// 13. POST /jobs/:id/instant-accept — azonnali fuvar
// =====================================================================
describe('POST /jobs/:id/instant-accept', () => {
  /** Azonnali, élő fuvar gyártása. */
  async function azonnaliFuvar(shipperId, { lejart = false, ar = 9000 } = {}) {
    const job = await createJob({ shipperId, status: 'bidding', priceHuf: ar });
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, carrier_id = NULL, accepted_price_huf = NULL,
              connection_fee_huf = NULL, suggested_price_huf = $2,
              instant_expires_at = NOW() + ($3 || ' minutes')::interval
        WHERE id = $1`,
      [job.id, ar, lejart ? '-10' : '60'],
    );
    return job;
  }

  it('a hibás elfogadási kísérletek a megfelelő státusszal térnek vissza', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const masikSzallito = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(nincs.status, 'ismeretlen fuvarra 404').toBe(404);

    const licites = await createJob({ shipperId: felado.id, status: 'bidding' });
    const nemAzonnali = await request(app).post(`/jobs/${licites.id}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(nemAzonnali.status, 'licites fuvart nem lehet „azonnaliként" elkapni').toBe(409);
    expect(nemAzonnali.body.error).toMatch(/nem azonnali/i);

    const sajat = await azonnaliFuvar(felado.id);
    const sajatRes = await request(app).post(`/jobs/${sajat.id}/instant-accept`)
      .set(auth(felado.token)).send({});
    expect(sajatRes.status, 'a saját fuvarodat nem vállalhatod el (ön-ügylet)').toBe(403);

    const elkelt = await azonnaliFuvar(felado.id);
    await db.query(
      `UPDATE jobs SET carrier_id = $2, status = 'accepted' WHERE id = $1`,
      [elkelt.id, masikSzallito.id],
    );
    const elkeltRes = await request(app).post(`/jobs/${elkelt.id}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(elkeltRes.status, 'a már elkelt azonnali fuvarra 409').toBe(409);
    expect(elkeltRes.body.error).toMatch(/elkelt/i);

    const lejart = await azonnaliFuvar(felado.id, { lejart: true });
    const lejartRes = await request(app).post(`/jobs/${lejart.id}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(lejartRes.status,
      'a LEJÁRT azonnali fuvarra 410 (Gone) jár — a feladó már nem várja')
      .toBe(410);

    const lemondott = await azonnaliFuvar(felado.id);
    await db.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [lemondott.id]);
    const lemondottRes = await request(app).post(`/jobs/${lemondott.id}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(lemondottRes.status, 'lemondott fuvart nem lehet elvállalni').toBe(409);
  });

  it('sikeres elfogadás: fix ár, díj-sáv — és a fizetési link NEM megy a szállítónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await azonnaliFuvar(felado.id, { ar: 60000 });

    const res = await request(app).post(`/jobs/${job.id}/instant-accept`)
      .set(auth(szallito.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.amount_huf, 'azonnali fuvarnál a fix ár a végleges ár').toBe(60000);
    expect(res.body.connection_fee_huf, '50 000 Ft felett a díj 1000 Ft').toBe(1000);

    // ⚠️ Ezt a végpontot a SZÁLLÍTÓ hívja, a fizető viszont a FELADÓ.
    expect(res.body.gateway_url,
      'a fizetőoldal URL-je a FELADÓ banki munkamenete — a szállítóhoz nem kerülhet')
      .toBeUndefined();
    expect(res.body.barion_gateway_url, 'régi néven sem szivároghat ki a fizetési link')
      .toBeUndefined();
    expect(JSON.stringify(res.body), 'semmilyen néven nem mehet ki fizetőoldal-hivatkozás')
      .not.toMatch(/stub:cib/);

    const { rows } = await db.query(
      `SELECT j.carrier_id, j.status, j.accepted_price_huf, j.connection_fee_huf,
              e.status AS dij_statusz, e.amount_huf AS dij
         FROM jobs j LEFT JOIN escrow_transactions e ON e.job_id = j.id
        WHERE j.id = $1`, [job.id],
    );
    expect(rows[0].carrier_id, 'az elfogadó szállítót rá kell írni a fuvarra').toBe(szallito.id);
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].accepted_price_huf, 'a megállapodott ár a fix ár').toBe(60000);
    expect(rows[0].dij, 'a díj-sornak a kiszámolt díjjal kell nyílnia').toBe(1000);
    expect(rows[0].dij_statusz).toBe('held');
  });

  it('két szállító egyszerre: PONTOSAN EGY nyer (first-wins), a másik 409-et kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const egy = await createUser({ role: 'carrier' });
    const ketto = await createUser({ role: 'carrier' });
    const job = await azonnaliFuvar(felado.id);

    const [a, b] = await Promise.all([
      request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(egy.token)).send({}),
      request(app).post(`/jobs/${job.id}/instant-accept`).set(auth(ketto.token)).send({}),
    ]);
    const sikeres = [a, b].filter((r) => r.status === 200);
    expect(sikeres.length,
      'egy azonnali fuvart PONTOSAN EGY szállító vállalhat el — különben ketten indulnának el érte')
      .toBe(1);
    const bukott = [a, b].find((r) => r.status !== 200);
    expect(bukott.status, 'a vesztes 409-et kap, nem 500-at').toBe(409);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db FROM escrow_transactions WHERE job_id = $1`, [job.id],
    );
    expect(rows[0].db, 'párhuzamos elfogadásból sem keletkezhet két díj-sor').toBe(1);
  });
});
