// =====================================================================
//  A LEFEDETTSÉGI KÖR TERMÉK-TALÁLATAI (2026-08-12)
//
//  Ez a három hiba NEM biztonsági rés — ezért nem is találta meg 11 kör
//  adatvédelmi és biztonsági audit. Mindhárom „egyszerű" számolás, amit a
//  FELHASZNÁLÓ LÁT, és amit soha semmi nem mért le. A lefedettségi munka
//  hozadéka pontosan ez volt: a nem-biztonsági termékkód is kapott szemet.
//
//  ⚠️ MINDHÁROM ŐR VISSZAMÉRVE: a javítás visszavonásával pirosra vált.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, createUser, createJob, db } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeAll(() => { __resetRateLimitsForTests(); });

// ---------------------------------------------------------------------
//  1) A SZÁLLÍTÓI BEVÉTEL — a hatályon kívüli jutalék visszhangja
// ---------------------------------------------------------------------
describe('Szállítói statisztika: a fuvardíj 100%-a a szállítóé', () => {
  it('a teljesített fuvar TELJES díját mutatja, jutalék-levonás nélkül', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });

    const arak = [30000, 50000];
    for (const ar of arak) {
      const job = await createJob({
        shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
      });
      await db.query(
        'UPDATE jobs SET accepted_price_huf = $1, delivered_at = NOW() WHERE id = $2',
        [ar, job.id],
      );
    }

    const res = await request(app)
      .get('/driver-stats')
      .set('Authorization', `Bearer ${szallito.token}`);

    expect(res.status).toBe(200);
    const osszes = res.body.totals || {};

    const vart = arak.reduce((a, b) => a + b, 0); // 80 000
    const regiKeplet = arak.reduce((a, b) => a + Math.round(b * 0.9 - 400), 0); // 71 200

    expect(
      osszes.total_net_earnings,
      'A szállítói dashboard nem a teljes fuvardíjat mutatja.\n\n'
      + `Várt: ${vart} Ft (a fuvardíj 100%-a) — kapott: ${osszes.total_net_earnings} Ft.\n`
      + `A 2026-07-03-án HATÁLYON KÍVÜL HELYEZETT escrow-modell képlete\n`
      + `(10% + 400 Ft/fuvar) ${regiKeplet} Ft-ot adna.\n\n`
      + 'A kápés modellben a platform a szállítótól SEMMIT nem von le, és a\n'
      + '/fuvarozoknak oldal ezt írásban ígéri. Ha itt kevesebb jelenik meg,\n'
      + 'azzal a saját ígéretünket cáfoljuk meg a kínálati oldal felé — épp\n'
      + 'annál a szereplőnél, akiből a launchkor a legkevesebb van.',
    ).toBe(vart);

    // A havi bontás ugyanazt a képletet használja — ne csússzon szét.
    const havi = (res.body.monthly || []).reduce((a, m) => a + (m.net || 0), 0);
    expect(
      havi,
      'A havi bontás összege eltér az összesítéstől — a két lekérdezés '
      + 'külön képletet használ, tehát némán szétcsúszhatnak.',
    ).toBe(vart);
  });
});

// ---------------------------------------------------------------------
//  2) AZ ÁRKALKULÁTOR — a publikus, auth nélküli konverziós felület
// ---------------------------------------------------------------------
describe('Árkalkulátor: a súly-mező tartomány-ellenőrzése', () => {
  const ALAP = 'pickup_lat=47.4979&pickup_lng=19.0402'
    + '&dropoff_lat=46.253&dropoff_lng=20.1414';
  const becsles = (extra) => request(app).get(`/calculator/estimate?${ALAP}&${extra}`);

  it('a VÉGTELEN súly nem szül ábrázolhatatlan („null Ft") becslést', async () => {
    const res = await becsles('weight_kg=Infinity');

    expect(res.status).toBeLessThan(500);

    // ⚠️ A `typeof x === 'number'` szűrő ITT VAKON ZÖLD LENNE: a JSON a
    // végtelent NULL-ként szerializálja, tehát a hibás érték már NEM szám,
    // amikor ideér — pont a bizonyítandó eset esne ki a mérésből. (Lemérve:
    // a javítás visszavonásával a szűrős változat végig zöld maradt.)
    // Ezért NÉVSZERINT követeljük meg a mezőket, és véges számot várunk.
    for (const kulcs of ['estimate_huf', 'range_low_huf', 'range_high_huf', 'weight_kg']) {
      const ertek = res.body?.[kulcs];
      expect(
        typeof ertek === 'number' && Number.isFinite(ertek),
        `A(z) "${kulcs}" mező nem véges szám: ${JSON.stringify(ertek)}.\n\n`
        + 'A JSON a végtelent NULL-ként adja tovább, tehát a látogató a\n'
        + 'főoldalon „null Ft" árbecslést lát — a publikus, auth nélküli\n'
        + 'konverziós felületen, ami a feladói tölcsér első lépése.',
      ).toBe(true);
    }
  });

  it('a NEGATÍV súly nem fordítja meg az ársávot és nem ad negatív árat', async () => {
    const res = await becsles('weight_kg=-100000');

    expect(res.status).toBeLessThan(500);
    const { range_low_huf: also, range_high_huf: felso } = res.body || {};

    expect(also, `Negatív alsó ársáv: ${also} Ft.`).toBeGreaterThan(0);
    expect(
      felso,
      `Az ársáv MEGFORDULT: alsó ${also} Ft > felső ${felso} Ft. A felületen\n`
      + 'ez „25 000 – 12 000 Ft" alakban jelenne meg. Az emelet-mezők ugyanebben\n'
      + 'a kezelőben már kaptak határellenőrzést; a súly kimaradt.',
    ).toBeGreaterThanOrEqual(also);
  });

  it('az ÉRVÉNYES súly viszont továbbra is számít (a védelem nem túl széles)', async () => {
    const konnyu = await becsles('weight_kg=5');
    const nehez = await becsles('weight_kg=400');

    expect(nehez.body.estimate_huf).toBeGreaterThan(konnyu.body.estimate_huf);
  });
});

// ---------------------------------------------------------------------
//  3) A SEGÉLYKÉRÉS — a `Number(null)` nulla, és az véges
// ---------------------------------------------------------------------
describe('Segélykérés: a hiányzó koordináta nem lehet (0,0)', () => {
  // A funkció alapból KIKAPCSOLT; a tesztkörnyezet engedélyezi.
  const HAMIS = [
    ['null', null],
    ['üres string', ''],
    ['üres tömb', []],
    ['false', false],
    ['szélességen kívüli', 999],
  ];

  for (const [cimke, ertek] of HAMIS) {
    it(`elutasítja a(z) ${cimke} szélességi fokot`, async () => {
      const user = await createUser({ role: 'shipper' });
      __resetRateLimitsForTests();
      const res = await request(app)
        .post('/towing/request')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          problem_type: 'defekt',
          requester_phone: '+36301234567',
          lat: ertek,
          lng: 19.04,
        });

      expect(
        res.status,
        `A(z) ${cimke} szélességi fok ÁTMENT a kapun (${res.status}).\n\n`
        + 'A `Number(null)` NULLA, és az véges — ezért a puszta `isFinite`\n'
        + 'ellenőrzés az üres/hiányzó értéket ELFOGADTA, és a segélykérés a\n'
        + '(0,0) koordinátára, a Guineai-öbölbe került, 201-es válasszal.\n\n'
        + 'Épp ez a VALÓS eset: a frontend `null`-t küld, ha a látogató\n'
        + 'letiltotta a helymeghatározást. A bajba jutott sikeres beküldést\n'
        + 'lát és vár, miközben a téglalapos közelség-lekérdezés nulla\n'
        + 'mentőst talál — a rendszer némán nem szól senkinek.',
      ).toBe(400);
    });
  }

  it('az ÉRVÉNYES koordinátát viszont elfogadja (a védelem nem túl széles)', async () => {
    const user = await createUser({ role: 'shipper' });
    __resetRateLimitsForTests();
    const res = await request(app)
      .post('/towing/request')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        problem_type: 'defekt',
        requester_phone: '+36301234567',
        lat: 47.4979,
        lng: 19.0402,
      });

    expect(
      res.status,
      'Az érvényes koordinátát is elutasítja — a szigorítás túl széles lett, '
      + 'és a valódi segélykérést is kizárja.',
    ).toBeLessThan(400);
  });
});
