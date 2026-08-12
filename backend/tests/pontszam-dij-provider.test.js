// =====================================================================
//  Trust Score · kapcsolatfelvételi díj · QVIK-provider · szállítói
//  statisztika — a fedetlenül maradt ágak viselkedés-alapú lefedése.
//
//  Miért egy fájlban: mind a négy modul ugyanazt a kérdést feszegeti —
//  „mit lát/kap a SZÁLLÍTÓ, és mit fizet a FELADÓ". A pontszám a
//  szállító megjelenítését vezérli, a díj a platform EGYETLEN bevétele,
//  a QVIK-stub pedig azt dönti el, beszedjük-e egyáltalán.
// =====================================================================

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const request = require('supertest');
const {
  db, app, createUser, createJob, createBooking,
} = require('./helpers');

const trustScore = require('../src/services/trustScore');
const connectionFee = require('../src/services/connectionFee');
const qvik = require('../src/services/qvik');

const { recalcTrustScore, getTrustBadge } = trustScore;
const { calculateConnectionFee } = connectionFee;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** A DB-be mentett pontszám (a visszatérési értéken túl ezt is mérjük). */
async function mentettPont(userId) {
  const { rows } = await db.query('SELECT trust_score FROM users WHERE id = $1', [userId]);
  return rows[0]?.trust_score ?? null;
}

/** N darab lezárt fuvar a szállítóhoz. */
async function lezartFuvarok(shipperId, carrierId, n, priceHuf = 20000) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const job = await createJob({
      shipperId, carrierId, status: 'delivered', paid: true, priceHuf,
    });
    ids.push(job.id);
  }
  if (ids.length) {
    await db.query(
      `UPDATE jobs SET delivered_at = NOW(), distance_km = 100
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }
  return ids;
}

// =====================================================================
//  0) A mérőeszköz épsége
// =====================================================================
describe('a tesztelt modulok tényleg ezeket exportálják', () => {
  it('trustScore / connectionFee / qvik export-lista', () => {
    expect(Object.keys(trustScore).sort()).toEqual(['getTrustBadge', 'recalcTrustScore']);
    expect(Object.keys(connectionFee).sort()).toEqual(['CONNECTION_FEE_TIERS', 'calculateConnectionFee']);
    expect(Object.keys(qvik).sort()).toEqual(['QVIK_BASE_URL', 'getPaymentState', 'isStub', 'startFeePayment']);
    for (const fn of [recalcTrustScore, getTrustBadge, calculateConnectionFee,
      qvik.isStub, qvik.startFeePayment, qvik.getPaymentState]) {
      expect(typeof fn, 'a mért név nem függvény — a teszt vak lenne').toBe('function');
    }
  });
});

// =====================================================================
//  1) Trust Score — pontszám-összetevők
// =====================================================================
describe('Trust Score — az összetevők tételesen', () => {
  it('friss fiók: csak a név + telefon pontja jár (4), és MENTVE is lesz', async () => {
    const u = await createUser({ role: 'carrier' });
    const pont = await recalcTrustScore(u.id);
    expect(
      pont,
      'A friss (fuvar és értékelés nélküli) fiók nem a profil-pontokat kapja. '
      + 'A név + telefon 2-2 pont; minden más komponensnek nullának kell lennie.',
    ).toBe(4);
    expect(
      await mentettPont(u.id),
      'A kiszámolt pontszám NEM került be a users.trust_score oszlopba. A '
      + 'visszatérési érték önmagában semmit nem ér: a profil és az admin-panel '
      + 'az OSZLOPBÓL olvas.',
    ).toBe(4);
  });

  it('nem létező felhasználóra 0-t ad, és nem dob', async () => {
    // Fuvar-lezáráskor hívjuk; egy időközben törölt fiók nem boríthatja fel
    // a lezárási tranzakciót.
    const pont = await recalcTrustScore('00000000-0000-0000-0000-000000000000');
    expect(
      pont,
      'Nem létező felhasználóra nem 0 jött vissza (vagy kivétel szabadult el). '
      + 'A hívó a fuvar-lezárás — egy törölt fiók nem akaszthatja meg.',
    ).toBe(0);
  });

  it('minden lezárt fuvar 3 pont, de 10 fuvarnál (30 pont) a plafon', async () => {
    const felado = await createUser({ role: 'shipper' });
    const harom = await createUser({ role: 'carrier' });
    const tizenketto = await createUser({ role: 'carrier' });

    await lezartFuvarok(felado.id, harom.id, 3);
    expect(
      await recalcTrustScore(harom.id),
      '3 lezárt fuvar = 9 pont (+4 profil). A fuvar-komponens (3 pont/fuvar) elcsúszott.',
    ).toBe(13);

    await lezartFuvarok(felado.id, tizenketto.id, 12);
    expect(
      await recalcTrustScore(tizenketto.id),
      '12 lezárt fuvarnál a fuvar-komponens nincs 30 pontra vágva. Plafon '
      + 'nélkül egy nagy forgalmú szállító mindenki mást kiszorítana, és a '
      + 'pontszám 100 fölé futna.',
    ).toBe(34);
  });

  it('a JÁRAT-foglalások is beleszámítanak (nem csak a licites fuvarok)', async () => {
    // A platformnak két teljesítési ága van; ha csak az egyiket számolnánk,
    // a kizárólag járatot hirdető szállító örökre „Kezdő" maradna.
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });

    await lezartFuvarok(felado.id, carrier.id, 2);
    await createBooking({ shipperId: felado.id, carrierId: carrier.id, status: 'delivered' });
    await createBooking({ shipperId: felado.id, carrierId: carrier.id, status: 'delivered' });
    // Egy NEM lezárt foglalás nem érhet pontot:
    await createBooking({ shipperId: felado.id, carrierId: carrier.id, status: 'confirmed' });

    expect(
      await recalcTrustScore(carrier.id),
      '2 fuvar + 2 kézbesített foglalás = 4 teljesítés = 12 pont (+4 profil). '
      + 'Vagy a foglalási ág hiányzik a számításból, vagy a még FOLYAMATBAN '
      + 'lévő foglalás is pontot kapott.',
    ).toBe(16);
  });

  it('értékelés: az átlag ötszöröse + darabszámonként 3 pont (15-ös plafonnal)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      'UPDATE users SET rating_avg = 4.60, rating_count = 3 WHERE id = $1',
      [carrier.id],
    );
    expect(
      await recalcTrustScore(carrier.id),
      '4,6-os átlag 3 értékelésből: 23 pont (átlag×5) + 9 pont (3×3) + 4 profil = 36.',
    ).toBe(36);

    await db.query('UPDATE users SET rating_count = 9 WHERE id = $1', [carrier.id]);
    expect(
      await recalcTrustScore(carrier.id),
      '9 értékelésnél a darabszám-komponens nincs 15 pontra vágva.',
    ).toBe(42);
  });

  it('árva átlag (rating_avg > 0, de 0 értékelés) NEM ér pontot', async () => {
    // Ez a védelem a bizalmi jelzés hitelessége miatt fontos: egy beragadt
    // vagy migrációval bekerült átlag 25 pontot adna nulla visszajelzésből.
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      'UPDATE users SET rating_avg = 5.00, rating_count = 0 WHERE id = $1',
      [carrier.id],
    );
    expect(
      await recalcTrustScore(carrier.id),
      'Egy 5,00-s átlag NULLA értékelés mellett pontot ért. Így egy adathiba '
      + 'vagy egy kézi DB-írás „Megbízható" jelvényt adna valós visszajelzés '
      + 'nélkül — pont azt a bizalmat hamisítva, amit a pontszám jelezni hivatott.',
    ).toBe(4);
  });

  it('a profil-mezők egyenként 2 pontot érnek', async () => {
    const carrier = await createUser({ role: 'carrier' });
    expect(await recalcTrustScore(carrier.id)).toBe(4);

    await db.query('UPDATE users SET bio = $2 WHERE id = $1', [carrier.id, 'Megbízható szállító vagyok.']);
    expect(await recalcTrustScore(carrier.id), 'a bio kitöltése nem ért pontot').toBe(6);

    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [carrier.id, 'https://pelda.hu/a.jpg']);
    expect(await recalcTrustScore(carrier.id), 'az avatar nem ért pontot').toBe(8);

    await db.query('UPDATE users SET vehicle_type = $2 WHERE id = $1', [carrier.id, 'Furgon']);
    expect(await recalcTrustScore(carrier.id), 'a jármű típusa nem ért pontot').toBe(10);
  });

  it('a hiányzó telefon/név elveszi a maga 2 pontját', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET phone = NULL WHERE id = $1', [carrier.id]);
    expect(
      await recalcTrustScore(carrier.id),
      'A telefonszám nélküli profil ugyanannyi pontot kapott, mint a kitöltött '
      + '— a profil-kitöltöttség komponens nem működik.',
    ).toBe(2);
  });

  it('a „Verified EU Carrier" 20 pontot ér', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query('UPDATE users SET is_verified_carrier = TRUE WHERE id = $1', [carrier.id]);
    expect(await recalcTrustScore(carrier.id), 'a verifikált státusz 20 pontja elmaradt').toBe(24);
  });

  it('a pontszám SOSEM megy 100 fölé', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await lezartFuvarok(felado.id, carrier.id, 10);
    await db.query(
      `UPDATE users SET rating_avg = 5.00, rating_count = 5, bio = 'x',
              avatar_url = 'https://pelda.hu/a.jpg', vehicle_type = 'Furgon',
              is_verified_carrier = TRUE
        WHERE id = $1`,
      [carrier.id],
    );
    expect(
      await recalcTrustScore(carrier.id),
      'A tökéletes szállító nem PONTOSAN 100 pontot kapott (30+25+15+10+20).',
    ).toBe(100);

    // A `rating_avg` oszlop NUMERIC(3,2), tehát 5-nél nagyobb átlag fizikailag
    // tárolható (adathiba / jövőbeli skálaváltás). A plafonnak ezt is fognia kell.
    await db.query('UPDATE users SET rating_avg = 9.99 WHERE id = $1', [carrier.id]);
    expect(
      await recalcTrustScore(carrier.id),
      'A 100-as plafon nem érvényesült: egy tartományon kívüli átlagból 125 '
      + 'pont lett. A pontszámot 0-100 skálaként hirdetjük, és a felület is '
      + 'annak megfelelően rajzolja ki.',
    ).toBe(100);
    expect(await mentettPont(carrier.id)).toBe(100);
  });
});

// =====================================================================
//  2) Trust badge — a küszöbök
// =====================================================================
describe('getTrustBadge — a jelvény-küszöbök', () => {
  it('a verifikált státusz MINDENT felülír (0 pontnál is)', () => {
    expect(
      getTrustBadge(0, true).label,
      'A „Verified EU Carrier" nem előzi meg a pontszám-alapú jelvényt. Ez a '
      + 'legerősebb bizalmi jel — nem takarhatja el egy „Kezdő" címke.',
    ).toBe('Verified EU Carrier');
    expect(getTrustBadge(100, true).label).toBe('Verified EU Carrier');
  });

  const kuszobok = [
    [100, 'Megbízható'],
    [80, 'Megbízható'],   // PONTOSAN a küszöb
    [79, 'Aktív'],
    [50, 'Aktív'],        // PONTOSAN a küszöb
    [49, 'Új tag'],
    [20, 'Új tag'],       // PONTOSAN a küszöb
    [19, 'Kezdő'],
    [0, 'Kezdő'],
  ];
  for (const [pont, cimke] of kuszobok) {
    it(`${pont} pont → "${cimke}"`, () => {
      expect(
        getTrustBadge(pont, false).label,
        `A ${pont} pontos szállító nem "${cimke}" jelvényt kapott. A küszöbök `
        + '(80 / 50 / 20) befogadóak: a határérték a MAGASABB kategóriába esik. '
        + 'Egy `>` helyett `>=` (vagy fordítva) itt csendben lefokozná a '
        + 'szállítókat a feladó szemében.',
      ).toBe(cimke);
    });
  }

  it('minden jelvény ad színt és ikont is (a UI mindkettőt kirajzolja)', () => {
    for (const [pont, verified] of [[0, true], [90, false], [60, false], [30, false], [5, false]]) {
      const b = getTrustBadge(pont, verified);
      expect(b.label, `hiányzó felirat (${pont}/${verified})`).toBeTruthy();
      expect(b.color, `hiányzó szín (${pont}/${verified})`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.icon, `hiányzó ikon (${pont}/${verified})`).toBeTruthy();
    }
  });
});

// =====================================================================
//  3) Kapcsolatfelvételi díj — a hiányzó/szemét bemenet ága
// =====================================================================
describe('kapcsolatfelvételi díj — hiányzó és szemét bemenet', () => {
  it('ismeretlen fuvardíjnál az ALSÓ sáv (500 Ft) jár, nem hiba', () => {
    // A platform EGYETLEN bevétele. Ha itt undefined/NaN jönne vissza, a
    // fizetés-indítás egy `NaN Ft`-os terheléssel próbálkozna.
    for (const ures of [null, undefined, '', 'abc', NaN, {}, []]) {
      expect(
        calculateConnectionFee(ures),
        `A(z) ${JSON.stringify(ures)} fuvardíjra nem az alsó sáv díja jött ki. `
        + 'Ismeretlen érték esetén 0-nak kell tekinteni (→ 500 Ft), nem '
        + 'NaN-nak: a NaN egyik sávra sem illeszkedne.',
      ).toBe(500);
    }
  });

  it('a NEGATÍV fuvardíj sem eshet ki a sávokból', () => {
    expect(
      calculateConnectionFee(-1),
      'Negatív fuvardíjra nem jött ki díj. Bármilyen szám a két sáv '
      + 'valamelyikébe kell essen (a felső sáv `Infinity`-ig ér).',
    ).toBe(500);
  });

  it('a szám-alakú SZÖVEG is helyes sávba esik (a DB NUMERIC-et stringként adja)', () => {
    // A `jobs.accepted_price_huf` INTEGER, de a foglalási ág NUMERIC-eket is
    // mozgat, amiket a pg stringként ad vissza — a sztring-összehasonlítás
    // ('60000' <= 50000) itt némán rossz sávot adna.
    expect(calculateConnectionFee('60000'), 'a "60000" szöveg nem a felső sávba esett').toBe(1000);
    expect(calculateConnectionFee('50000')).toBe(500);
    expect(calculateConnectionFee('50000.50'), 'az 50 000,50 Ft már a felső sávba tartozik').toBe(1000);
  });

  it('a sávhatár PONTOSAN 50 000 Ft-nál van (a határ még az alsó sávba tartozik)', () => {
    expect(calculateConnectionFee(49999)).toBe(500);
    expect(calculateConnectionFee(50000), 'az ÁSZF 4.1 szerint az 50 000 Ft még 500 Ft-os díjú').toBe(500);
    expect(calculateConnectionFee(50001)).toBe(1000);
  });
});

// =====================================================================
//  4) QVIK-provider — a stub és az élesített ág
// =====================================================================
describe('QVIK-provider — stub és fail-loud', () => {
  let eredetiKulcs;
  beforeEach(() => { eredetiKulcs = process.env.QVIK_API_KEY; });
  afterEach(() => { process.env.QVIK_API_KEY = eredetiKulcs; });

  it('kulcs nélkül STUB módban van', () => {
    process.env.QVIK_API_KEY = '';
    expect(
      qvik.isStub(),
      'A QVIK kulcs nélkül nem stubnak jelenti magát — a boot-ellenőrzés és a '
      + '„kézi nyugtázás tiltva" védelem erre a jelzésre épül.',
    ).toBe(true);
  });

  it('kulccsal MÁR NEM stub (a kapcsoló a kulcs meglétén áll)', () => {
    process.env.QVIK_API_KEY = 'teszt-kulcs';
    expect(
      qvik.isStub(),
      'Beállított API-kulccsal is stubnak vallja magát. Így élesben is nyitva '
      + 'maradna a kézi „fizetettnek jelölés", és nulla díj folyna be.',
    ).toBe(false);
  });

  it('stub módban a díj-indítás a várt alakot adja vissza (a /pay erre épül)', async () => {
    process.env.QVIK_API_KEY = '';
    const r = await qvik.startFeePayment({
      jobId: 'fuvar-123', feeHuf: 500, shipperEmail: 'a@b.hu', redirectPath: '/x',
    });
    expect(r.stub, 'a stub-jelzés hiányzik a válaszból').toBe(true);
    expect(r.paymentId, 'nincs paymentId — a webhook nem tudná visszakeresni a fuvart').toBe('qvik-stub-fuvar-123');
    expect(r.gatewayUrl, 'nincs gatewayUrl — a /pay nem tudna hova irányítani').toBeTruthy();
    expect(r.currency).toBe('HUF');
    expect(r.message, 'a stub-üzenetben nincs benne a díj összege').toContain('500');
  });

  it('ÉLESÍTETT kulccsal HANGOSAN hibázik, nem tesz úgy, mintha fizetett volna', async () => {
    // Ez a legfontosabb ág: a QVIK-integráció TODO. Ha a kitöltetlen
    // implementáció csendben „sikeres" választ adna, a launch fizetés nélkül
    // fedné fel a kontaktot — a platform egyetlen bevétele elveszne.
    process.env.QVIK_API_KEY = 'teszt-kulcs';
    await expect(
      qvik.startFeePayment({ jobId: 'fuvar-123', feeHuf: 500, shipperEmail: 'a@b.hu' }),
      'Beállított kulccsal a kitöltetlen QVIK-integráció NEM dobott hibát. A '
      + 'néma sikerválasz azt jelentené, hogy a fizetési lépés átugorható.',
    ).rejects.toThrow(/QVIK/i);
  });

  it('a fizetés-állapot lekérdezése stubban null, élesítve HANGOSAN hibázik', async () => {
    process.env.QVIK_API_KEY = '';
    expect(
      await qvik.getPaymentState('barmi'),
      'Stub módban nem null jött vissza. A hívó ebből tudja, hogy nincs '
      + 'hiteles PSP-állapot, amihez igazodhatna.',
    ).toBeNull();

    process.env.QVIK_API_KEY = 'teszt-kulcs';
    await expect(
      qvik.getPaymentState('barmi'),
      'Élesített kulccsal a kitöltetlen állapot-lekérdezés némán tért vissza. '
      + 'A webhook a PSP-től olvassa vissza a hiteles státuszt — ha ez '
      + 'undefined-ot adna, a body-nak hinnénk.',
    ).rejects.toThrow(/QVIK/i);
  });

  it('a bázis-URL nem mutathat véletlenül éles rendszerre', () => {
    expect(
      qvik.QVIK_BASE_URL,
      'A QVIK bázis-URL alapértéke nem a sandbox. Kulcs nélkül ez nem okoz '
      + 'kárt, de a beállítás elfelejtésekor éles PSP-re menne a forgalom.',
    ).toMatch(/sandbox/);
  });
});

// =====================================================================
//  5) Szállítói statisztika (GET /driver-stats)
// =====================================================================
describe('GET /driver-stats — szállítói dashboard', () => {
  it('token nélkül 401 (a bevételi adat nem publikus)', async () => {
    const res = await request(app).get('/driver-stats');
    expect(
      res.status,
      'A szállítói bevétel-statisztika hitelesítés nélkül elérhető. Ez üzleti '
      + 'adat: forgalom, átlagár, útvonalak.',
    ).toBe(401);
  });

  it('friss szállító: nullák és üres listák, nem hiba', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app).get('/driver-stats').set(auth(carrier.token));
    expect(res.status).toBe(200);
    expect(
      res.body.totals,
      'Fuvar nélküli szállítónál nem nullák jöttek vissza. NULL esetén a '
      + 'dashboard „NaN Ft"-ot írna ki az első belépéskor — pont a legrosszabb '
      + 'első benyomás a kínálati oldalnak.',
    ).toMatchObject({
      total_deliveries: 0, total_gross_earnings: 0, avg_price: 0,
    });
    expect(res.body.monthly).toEqual([]);
    expect(res.body.top_routes).toEqual([]);
    expect(res.body.recent_jobs).toEqual([]);
    expect(res.body.profile).toMatchObject({ rating_count: 0, trust_score: 0 });
  });

  it('a lezárt fuvarok összesítése és a legutóbbi fuvarok listája', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await lezartFuvarok(felado.id, carrier.id, 3, 20000);

    const res = await request(app).get('/driver-stats').set(auth(carrier.token));
    expect(res.status).toBe(200);
    expect(
      res.body.totals.total_deliveries,
      'A lezárt fuvarok darabszáma nem stimmel.',
    ).toBe(3);
    expect(
      res.body.totals.total_gross_earnings,
      'A bruttó bevétel nem a megállapodott fuvardíjak összege (3 × 20 000 Ft). '
      + 'A készpénzes modellben ez a szállító tényleges bevétele.',
    ).toBe(60000);
    expect(res.body.totals.avg_price, 'az átlagár nem a fuvardíjak átlaga').toBe(20000);
    expect(Number(res.body.totals.total_km), 'a megtett km összege nem stimmel').toBe(300);

    expect(res.body.recent_jobs.length, 'a legutóbbi fuvarok listája üres').toBe(3);
    expect(res.body.monthly.length, 'a havi trend üres, pedig van lezárt fuvar').toBe(1);
    expect(res.body.monthly[0].deliveries).toBe(3);
    expect(res.body.top_routes.length, 'a top útvonalak listája üres').toBeGreaterThan(0);
    expect(res.body.top_routes[0].count).toBe(3);
  });

  it('CSAK a saját fuvarait látja (más szállító forgalma nem szivárog be)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const enyem = await createUser({ role: 'carrier' });
    const masike = await createUser({ role: 'carrier' });
    await lezartFuvarok(felado.id, enyem.id, 2, 10000);
    await lezartFuvarok(felado.id, masike.id, 5, 90000);

    const res = await request(app).get('/driver-stats').set(auth(enyem.token));
    expect(
      res.body.totals.total_deliveries,
      'MÁS szállító fuvarjai is beleszámítottak a statisztikámba — a lekérdezés '
      + 'nem a bejelentkezett felhasználóra szűr (IDOR az üzleti adatokon).',
    ).toBe(2);
    expect(res.body.totals.total_gross_earnings).toBe(20000);
  });

  it('a NEM lezárt fuvar nem számít bevételnek', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await lezartFuvarok(felado.id, carrier.id, 1, 10000);
    await createJob({
      shipperId: felado.id, carrierId: carrier.id, status: 'in_progress', paid: true, priceHuf: 999999,
    });

    const res = await request(app).get('/driver-stats').set(auth(carrier.token));
    expect(
      res.body.totals.total_gross_earnings,
      'Egy FOLYAMATBAN lévő fuvar is beleszámított a bevételbe. A szállító '
      + 'olyan pénzt látna a dashboardon, amit még nem keresett meg.',
    ).toBe(10000);
  });

  // ── ✅ JAVÍTVA (2026-08-12) ───────────────────────────────────────────
  // Eredetileg `it.fails` volt: amíg a hiba élt, a build zöld maradt, a
  // javítás pillanatában viszont pirosra váltott, és rákényszerített erre az
  // átalakításra. Pontosan így is történt — a szerkezet működött.
  it('a „Nettó bevétel" a TELJES fuvardíjat mutatja (kápés modell: 100% a szállítóé)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const carrier = await createUser({ role: 'carrier' });
    await lezartFuvarok(felado.id, carrier.id, 2, 20000);

    const res = await request(app).get('/driver-stats').set(auth(carrier.token));
    expect(
      res.body.totals.total_net_earnings,
      'A `total_net_earnings` az `accepted_price_huf * 0.9 - 400` képlettel '
      + 'számol (driverStats.js:28 és :42) — ez a 2026-07-03-án HATÁLYON KÍVÜL '
      + 'HELYEZETT escrow-modell 10%+400 Ft-os jutaléka. A készpénzes modellben '
      + 'a szállító a fuvardíj 100%-át kapja kézhez, a platform tőle semmit nem '
      + 'von le. A szállítói dashboard („Nettó bevétel (össz)", '
      + 'web/app/sofor/dashboard/page.tsx:67) így fuvaronként 10% + 400 Ft-tal '
      + 'KEVESEBBET mutat a valósnál — miközben a /fuvarozoknak oldal azt '
      + 'ígéri, hogy „a fuvardíj 100%-a a tiéd".',
    ).toBe(res.body.totals.total_gross_earnings);
  });
});
