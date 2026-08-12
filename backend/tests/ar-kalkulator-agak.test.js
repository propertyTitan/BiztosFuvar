// =====================================================================
//  Ár-kalkulátor (GET /calculator/estimate) — a publikus becslő ágai.
//
//  Ez a végpont REGISZTRÁCIÓ NÉLKÜL elérhető, a főoldalról hívja bárki.
//  Két dolog miatt kényes:
//    (1) ez az ELSŐ szám, amit a látogató lát a GoFuvarról — a konverzió
//        ezen áll vagy bukik, tehát a képlet elmozdulása üzleti hatás;
//    (2) hitelesítetlen, tetszőleges query-paraméterekkel hívható, tehát
//        SEMMILYEN bemenetre nem adhat 500-at (a „SZ1: soha 500" szabály).
//
//  A várt összegek KÉZZEL kiszámoltak (nem a kódból generáltak), különben
//  a teszt csak megismételné az implementációt, és együtt csúszna el vele.
//  A képlet (routes/calculator.js):
//      (1500 alap + km×90 + kg×30) × méretszorzó + emelet-felár
//      → egészre kerekítve, majd 500-asra; a sáv ±20%, szintén 500-asra.
// =====================================================================

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const request = require('supertest');
const { app } = require('./helpers');

// Budapest → Szeged. A haversine-táv 161,76 km (2 tizedesre kerekítve) —
// ebből: 1500 + 161,76×90 + 5×30 = 16 208,4 → 16 208 → 500-asra: 16 000.
const BP_SZE = {
  pickup_lat: '47.4979', pickup_lng: '19.0402',
  dropoff_lat: '46.2530', dropoff_lng: '20.1414',
};
const TAV_KM = 161.76;

const becsles = (query) => request(app).get('/calculator/estimate').query(query);

describe('ár-kalkulátor — az alapképlet', () => {
  it('BP → Szeged, alapesetben: 161,76 km és 16 000 Ft körüli sáv', async () => {
    const res = await becsles(BP_SZE);
    expect(res.status).toBe(200);

    expect(
      res.body.distance_km,
      'A távolság nem a haversine-képlet szerinti érték (2 tizedesre kerekítve). '
      + 'Ez az egész becslés alapja: elcsúszása minden árat elvisz.',
    ).toBe(TAV_KM);

    expect(
      res.body.weight_kg,
      'Súly nélkül 5 kg az alapértelmezés — ez a válaszban is látszódjon, '
      + 'különben a látogató nem tudja, mire vonatkozik az ár.',
    ).toBe(5);

    expect(
      [res.body.estimate_huf, res.body.range_low_huf, res.body.range_high_huf],
      'Az alapképlet elmozdult (1500 alap + 90 Ft/km + 30 Ft/kg, ±20% sáv, '
      + '500-asra kerekítve). Ez a főoldal első száma — a kalibráció üzleti '
      + 'döntés (CLAUDE.md), nem szabad véletlenül elállítani.',
    ).toEqual([16000, 13000, 19500]);

    expect(res.body.note, 'hiányzik a „ez csak becslés" kitétel').toMatch(/becsült/i);
  });

  it('a sáv mindig körülöleli a becslést (alsó ≤ becslés ≤ felső)', async () => {
    for (const kg of ['1', '5', '50', '500']) {
      // eslint-disable-next-line no-await-in-loop
      const { body } = await becsles({ ...BP_SZE, weight_kg: kg });
      expect(
        body.range_low_huf <= body.estimate_huf && body.estimate_huf <= body.range_high_huf,
        `[${kg} kg] A megjelenített ársáv nem fogja közre a becsült árat `
        + `(${body.range_low_huf} … ${body.estimate_huf} … ${body.range_high_huf}). `
        + 'A látogató értelmezhetetlen sávot lát.',
      ).toBe(true);
    }
  });

  it('a súly drágít: 100 kg többe kerül, mint 5 kg (30 Ft/kg)', async () => {
    const konnyu = await becsles({ ...BP_SZE });
    const nehez = await becsles({ ...BP_SZE, weight_kg: '100' });
    expect(nehez.body.weight_kg).toBe(100);
    expect(
      nehez.body.estimate_huf,
      'A 100 kg-os csomag nem került többe az 5 kg-osnál — a súly-komponens '
      + '(30 Ft/kg) kiesett a képletből.',
    ).toBe(19000);
    expect(nehez.body.estimate_huf).toBeGreaterThan(konnyu.body.estimate_huf);
  });

  it('a hosszabb út drágább (a km-komponens érvényesül)', async () => {
    const rovid = await becsles({
      pickup_lat: '47.4979', pickup_lng: '19.0402',
      dropoff_lat: '47.5079', dropoff_lng: '19.0502',
    });
    const hosszu = await becsles(BP_SZE);
    expect(
      hosszu.body.estimate_huf,
      'Egy 160 km-es fuvar nem drágább egy 1 km-esnél — a 90 Ft/km komponens '
      + 'nem érvényesül.',
    ).toBeGreaterThan(rovid.body.estimate_huf);
    expect(rovid.body.distance_km).toBeLessThan(2);
  });
});

describe('ár-kalkulátor — méretszorzó (térfogat)', () => {
  // A szorzó-lépcsők: <0,05 m³ → 1,0 · 0,05–0,25 → 1,15 · 0,25–1,0 → 1,3 ·
  // 1,0 m³ fölött → 1,6. A HATÁROKAT mérjük, mert a lépcsős függvényeknél
  // épp ott szokott elcsúszni a `>=` / `>`.
  const esetek = [
    ['nincs megadva', undefined, 16000],
    ['0,04 m³ — a legkisebb lépcső alatt', '0.04', 16000],
    ['0,05 m³ — PONTOSAN a 2. lépcső alja', '0.05', 18500],
    ['0,24 m³ — még a 2. lépcsőben', '0.24', 18500],
    ['0,25 m³ — PONTOSAN a 3. lépcső alja', '0.25', 21000],
    ['0,99 m³ — még a 3. lépcsőben', '0.99', 21000],
    ['1,0 m³ — PONTOSAN a nagy bútor lépcső alja', '1', 26000],
    ['3 m³ — nagy bútor', '3', 26000],
  ];

  for (const [nev, volume, vart] of esetek) {
    it(`${nev} → ${vart} Ft`, async () => {
      const { body } = await becsles({ ...BP_SZE, ...(volume ? { volume_m3: volume } : {}) });
      expect(
        body.estimate_huf,
        `A(z) ${volume ?? 'hiányzó'} m³-hez tartozó méretszorzó elcsúszott. Egy `
        + 'szekrény több járműhelyet igényel, mint egy boríték azonos súlynál — '
        + 'ha a lépcső elmozdul, a nagy csomagok alulárazódnak (a szállító nem '
        + 'ad rájuk ajánlatot), a kicsik túl.',
      ).toBe(vart);
    });
  }

  it('értelmetlen térfogat (negatív / szemét / nulla) → szorzó nélkül számol', async () => {
    for (const rossz of ['-5', '0', 'abc', '']) {
      // eslint-disable-next-line no-await-in-loop
      const { status, body } = await becsles({ ...BP_SZE, volume_m3: rossz });
      expect(status, `a(z) "${rossz}" térfogat hibát okozott`).toBe(200);
      expect(
        body.estimate_huf,
        `A(z) "${rossz}" térfogat megváltoztatta az árat. Értelmetlen bemenetre `
        + 'a semleges 1,0-es szorzó jár — negatív térfogat semmiképp nem adhat '
        + 'kedvezményt.',
      ).toBe(16000);
    }
  });
});

describe('ár-kalkulátor — emelet és lift', () => {
  it('lift NÉLKÜL 500 Ft/emelet, LIFTTEL 200 Ft/emelet', async () => {
    const alap = await becsles(BP_SZE);
    const liftNelkul = await becsles({ ...BP_SZE, pickup_floor: '3' });
    const lifttel = await becsles({ ...BP_SZE, pickup_floor: '3', pickup_has_elevator: 'true' });

    expect(
      liftNelkul.body.estimate_huf,
      'A lift nélküli 3. emeleti cipelés felára (3 × 500 Ft) nem jelenik meg. '
      + 'Ez a szállító tényleges munkája — enélkül alulárazzuk a fuvart.',
    ).toBe(17500);
    expect(
      lifttel.body.estimate_huf,
      'A liftes 3. emelet felára (3 × 200 Ft) nem jelenik meg.',
    ).toBe(17000);

    expect(
      lifttel.body.estimate_huf,
      'A LIFT nem olcsóbb a lépcsőzésnél — a két felár összekeveredett.',
    ).toBeLessThan(liftNelkul.body.estimate_huf);
    expect(alap.body.estimate_huf).toBeLessThan(lifttel.body.estimate_huf);
  });

  it('a lerakodási emelet ugyanúgy számít, és a kettő összeadódik', async () => {
    const csakLerak = await becsles({ ...BP_SZE, dropoff_floor: '2' });
    expect(
      csakLerak.body.estimate_huf,
      'A LERAKODÁSI emelet felára kimaradt — csak a felvételi oldalt vettük '
      + 'figyelembe. A cipelés mindkét végén munka.',
    ).toBe(17000);

    const mindketto = await becsles({ ...BP_SZE, pickup_floor: '3', dropoff_floor: '2' });
    expect(
      mindketto.body.estimate_huf,
      'A két oldal emelet-felára nem adódik össze (3×500 + 2×500 = 2500 Ft).',
    ).toBe(18500);
  });

  it('a LERAKODÁSI liftet is figyelembe veszi (nem csak a felvételit)', async () => {
    // Ez a „csak az egyik oldalon javítottuk" minta elleni teszt: a lift-
    // kedvezmény a felvételi ágon már mérve van, itt a lerakodási ág.
    const lifttel = await becsles({ ...BP_SZE, dropoff_floor: '3', dropoff_has_elevator: 'true' });
    const liftNelkul = await becsles({ ...BP_SZE, dropoff_floor: '3' });
    expect(
      lifttel.body.estimate_huf,
      'A LERAKODÁSI oldal liftje nem számít (3 × 200 Ft-nak kellene lennie). '
      + 'A felvételi oldalon működik — a kettő szétcsúszott.',
    ).toBe(17000);
    expect(liftNelkul.body.estimate_huf).toBe(17500);
    expect(lifttel.body.estimate_huf).toBeLessThan(liftNelkul.body.estimate_huf);
  });

  it('a 10. emelet a plafon: a 99. emelet sem kerülhet többe', async () => {
    const tizedik = await becsles({ ...BP_SZE, pickup_floor: '10' });
    const kilencvenkilenc = await becsles({ ...BP_SZE, pickup_floor: '99' });
    expect(
      kilencvenkilenc.body.estimate_huf,
      'A 99. emelet nincs 10-re vágva — egy elgépeléssel (vagy szándékos '
      + 'bemenettel) abszurd ár jelenne meg a főoldalon.',
    ).toBe(21000);
    expect(kilencvenkilenc.body.estimate_huf).toBe(tizedik.body.estimate_huf);
  });

  it('a negatív / értelmetlen emelet nem ad KEDVEZMÉNYT', async () => {
    const alap = await becsles(BP_SZE);
    for (const rossz of ['-5', 'abc', '', '0']) {
      // eslint-disable-next-line no-await-in-loop
      const { status, body } = await becsles({ ...BP_SZE, pickup_floor: rossz });
      expect(status, `a(z) "${rossz}" emelet hibát okozott`).toBe(200);
      expect(
        body.estimate_huf,
        `A(z) "${rossz}" emelet-érték megváltoztatta az árat. A negatív emelet `
        + 'levonásként érvényesülne — ingyen fuvart lehetne „becsültetni".',
      ).toBe(alap.body.estimate_huf);
    }
  });

  it('a lift-kapcsoló CSAK a "true" szövegre kapcsol (a többi = nincs lift)', async () => {
    // A frontend a 'true' stringet küldi. Bármi más (1, 'yes', 'igen') NEM
    // adhat liftes kedvezményt — a kétes bemenetnél a drágább, biztonságos
    // irány a helyes (a szállító nem árazza alá a cipelést).
    const liftNelkul = 17500;
    for (const ketes of ['1', 'yes', 'igen', 'TRUE', 'on']) {
      // eslint-disable-next-line no-await-in-loop
      const { body } = await becsles({ ...BP_SZE, pickup_floor: '3', pickup_has_elevator: ketes });
      expect(
        body.estimate_huf,
        `A(z) "${ketes}" érték liftes (olcsóbb) felárat kapott, pedig a `
        + 'megállapodott jelzés a "true". Egy kliens-oldali változás így némán '
        + 'alulárazná a lépcsőzést.',
      ).toBe(liftNelkul);
    }
  });
});

describe('ár-kalkulátor — hibás és rosszhiszemű bemenet (SOHA nem 500)', () => {
  it('hiányzó koordináták → 400, magyar üzenettel', async () => {
    const res = await becsles({});
    expect(
      res.status,
      'Koordináták nélkül nem 400 jött. Ha 500 lenne, minden üres űrlap-'
      + 'betöltés hamis Sentry-riasztást generálna a főoldalról.',
    ).toBe(400);
    expect(res.body.error).toMatch(/koordin/i);
  });

  it('MINDEGYIK koordináta külön-külön kötelező', async () => {
    for (const hianyzo of ['pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng']) {
      const q = { ...BP_SZE };
      delete q[hianyzo];
      // eslint-disable-next-line no-await-in-loop
      const res = await becsles(q);
      expect(
        res.status,
        `A(z) "${hianyzo}" hiányát nem vettük észre. Egy hiányzó koordinátából `
        + 'NaN-távolság lesz, és „NaN Ft" jelenne meg a főoldalon.',
      ).toBe(400);
    }
  });

  it('szemét és szélsőérték a koordinátákban → 400 vagy értelmes 200, de SOHA nem 500', async () => {
    const szemet = [
      'abc', '', ' ', 'null', 'undefined', 'NaN', 'Infinity', '-Infinity',
      '1e400', '99999999999999999999', '{"a":1}', '<script>', "' OR 1=1--",
      '../../etc/passwd', '\u0000', '47,4979', '0x2F',
    ];
    for (const rossz of szemet) {
      // eslint-disable-next-line no-await-in-loop
      const res = await becsles({ ...BP_SZE, pickup_lat: rossz });
      expect(
        res.status,
        `A "${JSON.stringify(rossz)}" koordináta ${res.status}-as választ adott. `
        + 'A publikus kalkulátor semmilyen bemenetre nem adhat 5xx-et '
        + '(SZ1 szabály): hitelesítés nélkül hívható, tehát ez ingyen '
        + 'hibalog-generátor és hamis riasztás-forrás.',
      ).toBeLessThan(500);
      if (res.status === 200) {
        expect(
          Number.isFinite(res.body.estimate_huf),
          `A "${rossz}" bemenetre NaN/null ár került a válaszba.`,
        ).toBe(true);
      }
    }
  });

  it('tömbként megadott paraméter sem borítja fel (query-tömb trükk)', async () => {
    const res = await request(app)
      .get('/calculator/estimate')
      .query('pickup_lat=47.5&pickup_lat=48.5&pickup_lng=19&dropoff_lat=46.2&dropoff_lng=20.1');
    expect(
      res.status,
      'Ismételt query-kulcs (tömbbé alakul) 5xx-et okozott — ez a legolcsóbb '
      + 'módja lenne a hibalog-elárasztásnak egy publikus végponton.',
    ).toBeLessThan(500);
  });

  it('minden numerikus mezőbe szemetet szórva sem lesz 5xx', async () => {
    const mezok = ['weight_kg', 'volume_m3', 'pickup_floor', 'dropoff_floor',
      'pickup_has_elevator', 'dropoff_has_elevator'];
    const szemet = ['abc', '', 'null', 'NaN', 'Infinity', '-1', '1e400', '<x>', '\u0000'];
    for (const mezo of mezok) {
      for (const rossz of szemet) {
        // eslint-disable-next-line no-await-in-loop
        const res = await becsles({ ...BP_SZE, [mezo]: rossz });
        expect(
          res.status,
          `A(z) ${mezo}="${rossz}" bemenet ${res.status}-as választ adott. A `
          + 'publikus kalkulátor semmilyen paraméter-kombinációra nem adhat 5xx-et '
          + '(SZ1 szabály) — auth nélkül hívható, tehát ingyen hibalog-generátor lenne.',
        ).toBeLessThan(500);
      }
    }
  });

  it('NUL-bájt bármelyik paraméterben → 400 (a központi szűrő), NEM 500', async () => {
    // A NUL-bájt a Postgresben UTF8-hibát okoz, ami korábban 500-at adott; az
    // `index.js` központi szűrője zárta le ezt a hibaosztályt. Itt azt mérjük,
    // hogy a szűrő a KALKULÁTORRA is érvényes — ez a legolcsóbb célpont, mert
    // hitelesítés nélkül hívható.
    const NUL = String.fromCharCode(0);
    for (const mezo of ['weight_kg', 'volume_m3', 'pickup_floor', 'pickup_lat']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await becsles({ ...BP_SZE, [mezo]: NUL });
      expect(
        res.status,
        `NUL-bájt a(z) ${mezo} paraméterben ${res.status}-as választ adott. A `
        + 'központi NUL-szűrőnek 400-zal kell elutasítania.',
      ).toBe(400);
    }
  });

  it('a válasz értelmezhető, POZITÍV szám a reális bemeneteken', async () => {
    // A „reális" itt szó szerint azt jelenti, amit egy böngésző-űrlap
    // előállíthat. A két ismert kivételt (végtelen és negatív súly) a lenti
    // két teszt fedi — azok 2026-08-12-ig TERMÉKHIBÁK voltak, azóta javítva.
    const kombinaciok = [
      {}, { weight_kg: '0' }, { weight_kg: '1' }, { weight_kg: '2500' },
      { weight_kg: 'abc' }, { weight_kg: '' }, { weight_kg: 'NaN' }, { weight_kg: 'null' },
      { volume_m3: '2.5' }, { volume_m3: 'abc' },
      { pickup_floor: '4', pickup_has_elevator: 'true' },
      { dropoff_floor: '99' }, { pickup_floor: '-3' },
    ];
    for (const extra of kombinaciok) {
      // eslint-disable-next-line no-await-in-loop
      const { body } = await becsles({ ...BP_SZE, ...extra });
      for (const mezo of ['estimate_huf', 'range_low_huf', 'range_high_huf', 'weight_kg']) {
        expect(
          Number.isFinite(body[mezo]),
          `A(z) ${JSON.stringify(extra)} bemenetre a ${mezo} nem szám lett `
          + `(${JSON.stringify(body[mezo])}). A főoldalon „null Ft" jelenne meg.`,
        ).toBe(true);
      }
      expect(
        body.estimate_huf,
        `A(z) ${JSON.stringify(extra)} bemenetre NEM POZITÍV ár jött ki.`,
      ).toBeGreaterThan(0);
    }
  });

  // ── ✅ JAVÍTOTT TERMÉKHIBÁK (2026-08-12) ─────────────────────────────
  // ⚠️ MEGJEGYZENDŐ MÓDSZER: ez a két teszt eredetileg `it.fails` volt — a
  // vitest akkor fogadja el, ha az állítás ELBUKIK. Amíg a hiba élt, a build
  // zöld maradt; a javítás pillanatában viszont PIROSRA VÁLTOTT, és
  // rákényszerített a sima `it()`-té alakításra. Pontosan így is történt.
  // Az ügynök így tudta a talált hibát jelenteni anélkül, hogy (a) piros
  // buildet hagyjon maga után, vagy (b) a hibás viselkedést „helyesként"
  // kodifikálja. Érdemes újra használni.
  //   Gyökér-ok mindkettőnél: `const kg = parseFloat(weight_kg) || 5;`
  //   (routes/calculator.js:60) — az emelet-mezők KAPNAK határellenőrzést
  //   (`Math.max(0, Math.min(10, …))`, 74-75. sor), a súly viszont nem.
  //   Ugyanabban a kezelőben, tizennégy sorral lejjebb.
  //
  //  ✅ JAVÍTVA (2026-08-12): a súly ugyanolyan tartomány-ellenőrzést kapott,
  //  mint az emelet-mezők. A két `it.fails` ezért sima `it()`-té alakult — épp
  //  ezt a lépést kényszerítette ki a szerkezet, ahogy az ügynök tervezte.

  it('a végtelen súly nem ad NULL árakat', async () => {
    const { body } = await becsles({ ...BP_SZE, weight_kg: 'Infinity' });
    expect(
      Number.isFinite(body.estimate_huf),
      'A `weight_kg=Infinity` (és az `1e400`) Infinity-vé válik, amit a JSON '
      + 'nem tud ábrázolni → a válasz MINDEN ár-mezője `null` lesz, 200-as '
      + 'státusszal. A látogató „null Ft" becslést lát a főoldalon.',
    ).toBe(true);
  });

  it('a negatív súly nem ad negatív és FORDÍTOTT ársávot', async () => {
    const { body } = await becsles({ ...BP_SZE, weight_kg: '-1000' });
    expect(
      body.estimate_huf > 0 && body.range_low_huf <= body.range_high_huf,
      'A negatív súly nincs levágva: a -1000 kg-ból -14 000 Ft becslés lesz, '
      + 'ráadásul a sáv MEGFORDUL (alsó -11 000 > felső -16 500), mert a '
      + 'negatív számot 0,8-cal szorozva nagyobb értéket kapunk.',
    ).toBe(true);
  });

  it('a becslés hitelesítés NÉLKÜL is elérhető (ez a konverziós belépő)', async () => {
    // Ha valaki véletlenül auth-kaput tenne rá, a főoldali kalkulátor
    // némán elhalna — a látogató árat sem látna, mielőtt regisztrálna.
    const res = await becsles(BP_SZE);
    expect(
      res.status,
      'Az ár-kalkulátor nem érhető el token nélkül. A teljes „aki árat lát, '
      + 'az regisztrál" konverziós logika erre épül.',
    ).toBe(200);
  });
});
