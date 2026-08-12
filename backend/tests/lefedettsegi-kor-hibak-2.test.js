// =====================================================================
//  A LEFEDETTSÉGI KÖR TOVÁBBI TERMÉKKÓD-HIBÁI (2026-08-12)
//
//  A szolgáltatás-lencse nyolc hibát talált. Az itt mértek a felhasználónak
//  látszó vagy adatot rontó tételek. Mind az elágazás-lefedettség hajszolása
//  során derült ki — ez a legjobb érv amellett, hogy a fedetlen ágak
//  többsége nem „üres kód", hanem őrizetlen hibaág.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');
const { wrapHtml } = require('../src/services/email');

describe('P1: a címzett levelének címsora', () => {
  it('a wrapHtml heading NÉLKÜL sem ír „undefined"-ot', () => {
    const html = wrapHtml({ bodyHtml: '<p>törzs</p>' });
    expect(
      html.includes('undefined'),
      'A wrapHtml `<h1>${heading}</h1>`-et renderel. Heading nélkül hívva a\n'
      + 'levél címsora szó szerint „undefined" lett — méghozzá a CÍMZETTNEK\n'
      + 'küldött levelekben (tracking.js), akinek nincs is fiókja nálunk.\n'
      + 'Heading hiányában a H1-nek el kell maradnia.',
    ).toBe(false);
  });

  it('headinggel viszont megjelenik a címsor', () => {
    const html = wrapHtml({ heading: 'Teszt címsor', bodyHtml: '<p>x</p>' });
    expect(html, 'a megadott címsor eltűnt — a védelem túl széles').toContain('Teszt címsor');
  });
});

describe('P2: GPS-koordináta tartomány', () => {
  async function fuvarSzallitoval() {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    return { job, szallito };
  }

  it('tartományon kívüli koordináta → 400, és NEM tárolódik', async () => {
    const { job, szallito } = await fuvarSzallitoval();
    for (const [lat, lng] of [[999, 19], [47, -9999], [91, 0], [0, 181]]) {
      const res = await request(app)
        .post(`/jobs/${job.id}/location`)
        .set('Authorization', `Bearer ${szallito.token}`)
        .send({ lat, lng });
      expect(
        res.status,
        `lat=${lat}, lng=${lng} → ${res.status}. A tartományon kívüli koordináta `
        + 'eltárolva elrontja a users.last_known_* mezőt, amire a visszafuvar-'
        + 'ajánlás és az azonnali fuvar közelség-párosítása épül.',
      ).toBe(400);
    }
    const { rows } = await db.query(
      'SELECT count(*)::int AS db FROM location_pings WHERE job_id = $1', [job.id],
    );
    expect(rows[0].db, 'a hibás koordináta mégis eltárolódott').toBe(0);
  });

  it('ÉRVÉNYES koordináta viszont átmegy (a védelem nem túl széles)', async () => {
    const { job, szallito } = await fuvarSzallitoval();
    const res = await request(app)
      .post(`/jobs/${job.id}/location`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ lat: 47.4979, lng: 19.0402 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('a 0,0 koordináta ÉRVÉNYES (Greenwich — nem falsy-hiba)', async () => {
    const { job, szallito } = await fuvarSzallitoval();
    const res = await request(app)
      .post(`/jobs/${job.id}/location`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ lat: 0, lng: 0 });
    expect(
      res.status,
      'A 0,0 koordinátát elutasítottuk. A 0 falsy — de a 0. hosszúsági fok '
      + '(Greenwich) az európai coverage-en belül van (UK/FR/ES).',
    ).toBe(200);
  });
});

describe('P3: az AI bizalmi értéke típusos', () => {
  it('szöveges vagy tartományon kívüli confidence NEM hitelesít', async () => {
    const gemini = require('../src/services/gemini');
    // A modul belső parse-ágát a nyilvános felületen át mérjük: a KYC-válasz
    // `valid` mezője csak akkor lehet igaz, ha a bizalom SZÁM és 0.6–1 közötti.
    const forras = require('fs').readFileSync(`${__dirname}/../src/services/gemini.js`, 'utf8');
    expect(
      forras.includes("typeof parsed.confidence === 'number'"),
      'A bizalmi küszöb `(parsed.confidence || 0) >= 0.6` alakban string-'
      + 'összehasonlítást is elfogadott: a "0.99" >= 0.6 igaz, miközben a\n'
      + 'visszaadott confidence 0 lett — a DÖNTÉS és a NAPLÓZOTT bizalom\n'
      + 'szétcsúszott. Felső korlát sem volt: a confidence 999 átment a 0,6-os\n'
      + 'ÉS a kézi ellenőrzés 0,85-ös küszöbén is, tehát AUTO-JÓVÁHAGYÁS lett.',
    ).toBe(true);
    expect(forras.includes('parsed.confidence <= 1'), 'nincs felső korlát a bizalmi értéken').toBe(true);
    expect(typeof gemini.verifyKycDocument).toBe('function');
  });
});

// =====================================================================
//  P1 (🔴): A JÁRAT-FOGLALÁS ÉRTÉKELÉSE SOHA NEM MŰKÖDÖTT (078-as migráció)
//
//  A `reviews.job_id` a kezdetektől NOT NULL volt; a 012-es migráció
//  hozzáadta a `booking_id`-t, de a NOT NULL-t sosem oldotta fel. A web
//  ténylegesen hívja ezt az utat (Bookings.tsx → ReviewBox
//  entityKey="booking_id"), tehát a foglalási ág TELJES értékelés-funkciója
//  halott volt — minden próbálkozás 500 „Szerverhiba" + Sentry-riasztás.
//
//  Miért nem derült ki: a meglévő tesztek a FUVAR-ágat mérték. A hibát az
//  elágazás-lefedettségi kör hozta elő.
// =====================================================================
describe('P1: a foglalás értékelhető', () => {
  it('lezárt foglalásra adott értékelés SIKERES (nem 500)', async () => {
    const { createBooking } = require('./helpers');
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ booking_id: booking.id, stars: 5, comment: 'Minden rendben' });

    expect(
      res.status,
      `A foglalás értékelése ${res.status}-at adott: ${JSON.stringify(res.body)}\n\n`
      + 'A reviews.job_id NOT NULL volt, miközben a foglalási ág null-t ad át.\n'
      + 'A web hívja ezt az utat — vagyis a fix áras Járat teljes értékelés-\n'
      + 'funkciója halott volt, és minden próbálkozás Sentry-riasztást generált.',
    ).toBe(201);

    const { rows } = await db.query(
      'SELECT job_id, booking_id, stars FROM reviews WHERE booking_id = $1', [booking.id],
    );
    expect(rows.length, 'az értékelés nem mentődött el').toBe(1);
    expect(rows[0].job_id, 'a foglalás-értékeléshez fuvar-azonosító is került').toBeNull();
  });

  it('MINDKÉT azonosítóval 400 (nem néma felülírás)', async () => {
    const { createBooking } = require('./helpers');
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, booking_id: booking.id, stars: 5 });

    expect(
      res.status,
      'Mindkét azonosítóval korábban MINDKÉT ág lefutott, a foglalási ág '
      + 'felülírta az értékelt személyt, és a sor mindkét azonosítóval mentődött.',
    ).toBe(400);
  });
});

// =====================================================================
//  A SABLON-JÁRAT NEM BÖNGÉSZHETŐ (2026-08-12)
//
//  ⚠️ A SAJÁT 11. KÖRI JAVÍTÁSOM HIÁNYOSSÁGA. A járat RÉSZLETNÉZETÉT
//  kapuztam (`status==='open' && !is_template`), a LISTÁT viszont nem —
//  vagyis a sablon-járat továbbra is megjelent a feladói böngészőben, a
//  teljes waypoints-szal (a szállító megállói + PONTOS koordináta,
//  jellemzően az OTTHONI indulóponttal), miközben a részletnézete 404-et
//  adott. A két kapu ellentmondott egymásnak.
//
//  Pontosan az a minta, amit a projekt magáról írt: „a védelem azon az úton
//  épül meg, ahol felfedezték."
// =====================================================================
describe('Sablon-járat: se listában, se részletben', () => {
  it('a sablon NEM jelenik meg a böngészhető listában', async () => {
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });

    const { rows } = await db.query(
      `INSERT INTO carrier_routes
         (carrier_id, title, waypoints, departure_at, status, is_template)
       VALUES ($1, 'Kovács János visszatérő járata',
               '[{"name":"Budapest, Váci út 12.","lat":47.49,"lng":19.04}]'::jsonb,
               NOW() + INTERVAL '2 days', 'open', TRUE)
       RETURNING id`,
      [szallito.id],
    );
    const sablonId = rows[0].id;

    const lista = await request(app)
      .get('/carrier-routes')
      .set('Authorization', `Bearer ${felado.token}`);
    expect(lista.status).toBe(200);

    const talalt = (lista.body.routes || lista.body || [])
      .some((r) => r.id === sablonId);
    expect(
      talalt,
      'A SABLON-JÁRAT megjelent a feladói böngészőben, a teljes waypoints-szal '
      + '(a szállító megállói + pontos koordináta, jellemzően az OTTHONI '
      + 'indulóponttal) — miközben a részletnézete 404-et ad. A sablon a '
      + 'szállító visszatérő járat-mintája, nem hirdetés.',
    ).toBe(false);

    // …és a részletnézet továbbra is 404 (a két kapu egyetért)
    const detail = await request(app)
      .get(`/carrier-routes/${sablonId}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(detail.status, 'a sablon részletnézete elérhető lett').toBe(404);
  });

  it('a NORMÁL nyitott járat viszont látszik (a szűrő nem túl széles)', async () => {
    // ⚠️ EGYEDI VÁROSNÉVRE SZŰRÜNK (2026-08-12). Az első változat a TELJES
    // listát kérte le, és abban kereste a saját járatát — a lista viszont
    // limitált, tehát a többi tesztfájl járatai kiszoríthatták. Önmagában
    // zöld volt, a teljes suite-ban FLAKY. Az egyedi megállónév
    // determinisztikussá teszi, és közben a város-szűrőt is méri.
    const szallito = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const varos = `Tesztfalva${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const { rows } = await db.query(
      `INSERT INTO carrier_routes
         (carrier_id, title, waypoints, departure_at, status, is_template)
       VALUES ($1, 'Normál járat',
               $2::jsonb,
               NOW() + INTERVAL '2 days', 'open', FALSE)
       RETURNING id`,
      [szallito.id, JSON.stringify([{ name: varos, lat: 46.25, lng: 20.14 }])],
    );
    const lista = await request(app)
      .get(`/carrier-routes?city=${encodeURIComponent(varos)}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(lista.status).toBe(200);
    const talalt = (lista.body.routes || lista.body || []).some((r) => r.id === rows[0].id);
    expect(
      talalt,
      'A normál, nyitott, jövőbeli indulású járat sem jelenik meg a böngészőben '
      + '— a sablon-szűrő túl széles lett, és az élő hirdetéseket is elvitte.',
    ).toBe(true);
  });
});
