// =====================================================================
//  ÉRTÉKELÉS (reviews) — hibaágak és a reputáció-számítás
//
//  A src/routes/reviews.js elágazás-lefedettsége 56% volt: a boldog utat
//  (lezárt fuvar → 5 csillag) több suite is érinti, a KAPUKAT viszont
//  senki nem mérte. Márpedig az értékelés a platform reputációs rétege:
//  ha bárki értékelhet bárkit, ha kétszer lehet ugyanazt, vagy ha egy
//  nyilvános kommentbe telefonszám írható, az közvetlenül a bizalmi
//  rendszert és a kapcsolatfelvételi díjat (a platform egyetlen bevételét)
//  rombolja.
//
//  A fájl a KÉT belépési pontot külön méri: a mai `POST /reviews`-t és a
//  visszafelé kompatibilis `POST /jobs/:jobId/reviews`-t — utóbbi
//  DUPLIKÁLJA a logikát, ezért ugyanazokat a garanciákat külön kell őrizni
//  (2026-08-09-ben pont innen hiányzott a kapcsolat-szűrő).
//
//  ⚠️ AMIT SZÁNDÉKOSAN NEM MÉR EZ A FÁJL: a foglalásra (booking_id) adott
//  értékelés SIKERES útját. A `reviews.job_id` oszlop NOT NULL, ezért a
//  csak booking_id-vel küldött értékelés 500-zal elszáll — ez TERMÉKHIBA,
//  nem teszt-hiány (lásd a jelentést). A foglalási ág KAPUI (404/409/403)
//  viszont az INSERT előtt futnak le, azokat itt mérjük.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const NEM_LETEZIK = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { __resetRateLimitsForTests(); });

/** Feladó + szállító + egy KÉZBESÍTETT fuvar — az értékelés előfeltétele. */
async function lezartFuvar(status = 'delivered') {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status, paid: true,
  });
  return { felado, szallito, job };
}

async function ertekelesekSzama(jobId) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS c FROM reviews WHERE job_id = $1', [jobId]);
  return rows[0].c;
}

// =====================================================================
//  POST /reviews — bemenet-validáció
// =====================================================================
describe('POST /reviews — csillag és azonosító validáció', () => {
  it('a csillag csak 1 és 5 között fogadható el', async () => {
    const { felado, job } = await lezartFuvar();
    for (const stars of [undefined, null, 0, -3, 6, 100]) {
      const res = await request(app).post('/reviews').set(auth(felado.token))
        .send({ job_id: job.id, stars });
      expect(
        res.status,
        `a(z) ${JSON.stringify(stars)} csillagot elfogadta — az átlagszámítás és a `
        + 'reputációs rangsor tetszőlegesen elrontható lenne',
      ).toBe(400);
    }
    expect(await ertekelesekSzama(job.id), 'érvénytelen csillagra mégis keletkezett értékelés').toBe(0);
  });

  it('azonosító nélkül → 400 (nem néma no-op), üres kérés-testre sem 500', async () => {
    const { felado } = await lezartFuvar();
    const res = await request(app).post('/reviews').set(auth(felado.token)).send({ stars: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fuvar|foglalás/i);

    const ures = await request(app).post('/reviews').set(auth(felado.token)).send();
    expect(ures.status, 'a test nélküli kérés nem 400-at adott').toBe(400);
  });

  it('nem létező fuvar / foglalás → 404', async () => {
    const { felado } = await lezartFuvar();
    const fuvar = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: NEM_LETEZIK, stars: 5 });
    expect(fuvar.status).toBe(404);

    const foglalas = await request(app).post('/reviews').set(auth(felado.token))
      .send({ booking_id: NEM_LETEZIK, stars: 5 });
    expect(foglalas.status, 'nem létező foglalásra is elindult az értékelés').toBe(404);
  });

  it('telefonszám / e-mail a nyilvános kommentben → 400 CONTACT_LEAK', async () => {
    const { felado, job } = await lezartFuvar();
    for (const komment of [
      'Korrekt volt, legközelebb hívd közvetlenül: 06 30 111 2233',
      'Írj rá: sofor.karoly@gmail.com',
    ]) {
      const res = await request(app).post('/reviews').set(auth(felado.token))
        .send({ job_id: job.id, stars: 5, comment: komment });
      expect(
        res.status,
        'elérhetőség került a nyilvános értékelés-kommentbe — az a publikus profilon '
        + 'TARTÓSAN látszik, vagyis állandó „hívj a platformon kívül" hirdetés lenne',
      ).toBe(400);
      expect(res.body.code).toBe('CONTACT_LEAK');
    }
    expect(await ertekelesekSzama(job.id), 'a szűrt komment mégis mentődött').toBe(0);
  });
});

// =====================================================================
//  POST /reviews — jogosultsági kapuk
// =====================================================================
describe('POST /reviews — ki, mikor, kit értékelhet', () => {
  it('KÍVÜLÁLLÓ nem értékelhet (403), és nem is keletkezik sor', async () => {
    const { job } = await lezartFuvar();
    const idegen = await createUser({ role: 'carrier' });
    const res = await request(app).post('/reviews').set(auth(idegen.token))
      .send({ job_id: job.id, stars: 1, comment: 'Szörnyű volt.' });
    expect(
      res.status,
      'egy kívülálló értékelhette más ügyletét — a reputáció tetszőlegesen rontható/javítható lenne',
    ).toBe(403);
    expect(await ertekelesekSzama(job.id)).toBe(0);
  });

  it('NEM lezárt fuvart nem lehet értékelni (409) — sem a feladó, sem a szállító', async () => {
    for (const status of ['accepted', 'in_progress', 'cancelled']) {
      const { felado, szallito, job } = await lezartFuvar(status);
      const f = await request(app).post('/reviews').set(auth(felado.token))
        .send({ job_id: job.id, stars: 5 });
      expect(f.status, `${status} státuszú fuvart értékelni lehetett (feladóként)`).toBe(409);

      const sz = await request(app).post('/reviews').set(auth(szallito.token))
        .send({ job_id: job.id, stars: 5 });
      expect(sz.status, `${status} státuszú fuvart értékelni lehetett (szállítóként)`).toBe(409);
      expect(await ertekelesekSzama(job.id)).toBe(0);
    }
  });

  it('ugyanazt a fuvart KÉTSZER nem lehet értékelni (409)', async () => {
    const { felado, job } = await lezartFuvar();
    const elso = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Minden rendben.' });
    expect(elso.status, JSON.stringify(elso.body)).toBe(201);

    const masodik = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 1, comment: 'Mégis meggondoltam magam.' });
    expect(
      masodik.status,
      'ugyanaz a felhasználó többször értékelhette ugyanazt a fuvart — a másik fél '
      + 'értékelése korlátlanul lehúzható vagy felpumpálható lenne',
    ).toBe(409);
    expect(await ertekelesekSzama(job.id), 'két értékelés került ugyanarra a fuvarra').toBe(1);
  });

  it('MINDKÉT fél értékelhet, és mindig a MÁSIKAT (nem saját magát)', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    const f = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Pontos szállító.' });
    const sz = await request(app).post('/reviews').set(auth(szallito.token))
      .send({ job_id: job.id, stars: 4, comment: 'Korrekt feladó.' });

    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(sz.status, JSON.stringify(sz.body)).toBe(201);
    expect(f.body.reviewee_id, 'a feladó értékelése nem a szállítóra szólt').toBe(szallito.id);
    expect(sz.body.reviewee_id, 'a szállító értékelése nem a feladóra szólt').toBe(felado.id);
    expect(f.body.reviewer_id).not.toBe(f.body.reviewee_id);
    expect(sz.body.reviewer_id).not.toBe(sz.body.reviewee_id);
  });

  it('ha nincs másik fél (törölt szállító), 400 — nem 500 és nem ön-értékelés', async () => {
    // A jobs.carrier_id ON DELETE SET NULL: a szállító törlése után a lezárt
    // fuvar megmarad, de nincs kit értékelni.
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, carrierId: null, status: 'delivered', paid: true });

    const res = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5 });
    expect(
      res.status,
      'szállító nélküli fuvarra is elindult az értékelés — vagy 500-zal elszállt, '
      + 'vagy a feladó saját magát értékelte volna',
    ).toBe(400);
    expect(await ertekelesekSzama(job.id)).toBe(0);
  });
});

// =====================================================================
//  A FOGLALÁSI ÁG KAPUI
// =====================================================================
describe('POST /reviews — a foglalási (Járat) ág kapui', () => {
  it('NEM lezárt foglalásra 409', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    const res = await request(app).post('/reviews').set(auth(felado.token))
      .send({ booking_id: booking.id, stars: 5 });
    expect(res.status, 'folyamatban lévő foglalást értékelni lehetett').toBe(409);
  });

  it('KÍVÜLÁLLÓ nem értékelheti a foglalást (403)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'shipper' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const res = await request(app).post('/reviews').set(auth(idegen.token))
      .send({ booking_id: booking.id, stars: 1 });
    expect(
      res.status,
      'kívülálló értékelhette más járat-foglalását',
    ).toBe(403);
  });
});

// =====================================================================
//  REPUTÁCIÓ-SZÁMÍTÁS + ÉRTESÍTÉS
// =====================================================================
describe('Az értékelés hatásai (rating + értesítés)', () => {
  it('a rating_avg / rating_count a VALÓS értékelésekből számolódik újra', async () => {
    const szallito = await createUser({ role: 'carrier' });
    // Két külön feladó, két külön lezárt fuvar → 5 és 4 csillag → átlag 4.5
    for (const csillag of [5, 4]) {
      const felado = await createUser({ role: 'shipper' });
      const job = await createJob({
        shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
      });
      const res = await request(app).post('/reviews').set(auth(felado.token))
        .send({ job_id: job.id, stars: csillag });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    const { rows } = await db.query('SELECT rating_avg, rating_count FROM users WHERE id = $1', [szallito.id]);
    expect(Number(rows[0].rating_count), 'az értékelés-számláló nem követte a beérkezett értékeléseket').toBe(2);
    expect(
      Number(rows[0].rating_avg),
      'az átlagos értékelés nem a valós értékelésekből számolódott (5 és 4 → 4.5)',
    ).toBe(4.5);
  });

  it('az értékelt fél ÉRTESÍTÉST kap, a megfelelő csillagszámmal', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 3, comment: 'Kicsit késett.' });

    const { rows } = await db.query(
      `SELECT title, body FROM notifications
        WHERE user_id = $1 AND type = 'review_received' ORDER BY created_at DESC LIMIT 1`,
      [szallito.id],
    );
    expect(rows[0], 'az értékelt fél nem kapott értesítést az új értékelésről').toBeTruthy();
    expect(rows[0].body, 'az értesítés nem tartalmazza a kapott csillagszámot').toContain('3 csillag');
  });
});

// =====================================================================
//  GET /reviews
// =====================================================================
describe('GET /reviews — szűrők és e-mail-kapu', () => {
  it('meg NEM erősített e-mail-cím → 403 (mások értékelését olvasná)', async () => {
    const u = await createUser({ role: 'shipper', emailVerified: false });
    const res = await request(app).get('/reviews').set(auth(u.token));
    expect(
      res.status,
      'egy meg nem erősített (akár nem létező) e-maillel készült fiók olvashatta mások értékeléseit',
    ).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('?job_id= a fuvarhoz tartozó értékeléseket adja, ?user_id= a RÓLA szólókat', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Kiváló.' });

    // Egy MÁSIK fuvar értékelése ugyanahhoz a szállítóhoz — a szűrőnek ki kell hagynia.
    const masik = await lezartFuvar();
    await db.query('UPDATE jobs SET carrier_id = $2 WHERE id = $1', [masik.job.id, szallito.id]);
    await request(app).post('/reviews').set(auth(masik.felado.token))
      .send({ job_id: masik.job.id, stars: 2, comment: 'Nem az igazi.' });

    const fuvarra = await request(app).get(`/reviews?job_id=${job.id}`).set(auth(felado.token));
    expect(fuvarra.status, JSON.stringify(fuvarra.body)).toBe(200);
    expect(fuvarra.body.length, 'a fuvar-szűrő nem szűkített egyetlen fuvarra').toBe(1);
    expect(fuvarra.body[0].comment).toBe('Kiváló.');
    expect(fuvarra.body[0].reviewer_name, 'hiányzik az értékelő neve a listából').toBeTruthy();

    const userre = await request(app).get(`/reviews?user_id=${szallito.id}`).set(auth(felado.token));
    expect(
      userre.body.length,
      'a felhasználóra szűrt lista nem hozta mindkét róla szóló értékelést',
    ).toBe(2);
  });

  it('?booking_id= a FOGLALÁS értékeléseire szűkít (nem adja vissza a fuvarokét)', async () => {
    const { felado, job } = await lezartFuvar();
    await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Fuvar-értékelés.' });

    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const res = await request(app).get(`/reviews?booking_id=${booking.id}`).set(auth(felado.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.length,
      'a foglalás-szűrő NEM szűkített (a hiányzó WHERE minden értékelést visszaadna, '
      + 'idegen ügyletekét is)',
    ).toBe(0);
  });

  it('paraméter nélkül a SAJÁT (rólam szóló) értékeléseimet adja, nem az összeset', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 5, comment: 'Rendben.' });

    const sajat = await request(app).get('/reviews').set(auth(szallito.token));
    expect(sajat.status).toBe(200);
    expect(sajat.body.length, 'a szállító nem látja a róla szóló értékelést').toBe(1);

    const masike = await request(app).get('/reviews').set(auth(felado.token));
    expect(
      masike.body.every((r) => r.reviewee_id === felado.id),
      'a paraméter nélküli lekérés MÁSOK értékeléseit is visszaadta',
    ).toBe(true);
  });
});

// =====================================================================
//  LEGACY ÁG: POST /jobs/:jobId/reviews
// =====================================================================
//  A visszafelé kompatibilis végpont DUPLIKÁLJA a fő handler logikáját.
//  Épp ezért kell külön mérni: 2026-08-09-ig innen hiányzott a
//  kapcsolat-szűrő, pedig ugyanaz a publikus komment készül belőle.
// =====================================================================
describe('POST /jobs/:jobId/reviews (visszafelé kompatibilis ág)', () => {
  it('a régi `rating` mezőt is elfogadja (ez a kompatibilitás lényege)', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    const res = await request(app).post(`/jobs/${job.id}/reviews`).set(auth(felado.token))
      .send({ rating: 5, comment: 'Gyors és pontos.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.reviewee_id).toBe(szallito.id);
    expect(Number(res.body.stars), 'a rating→stars leképezés elromlott').toBe(5);
  });

  it('tartományon kívüli pontszám → 400', async () => {
    const { felado, job } = await lezartFuvar();
    for (const rating of [0, 6, undefined]) {
      const res = await request(app).post(`/jobs/${job.id}/reviews`).set(auth(felado.token))
        .send({ rating });
      expect(res.status, `a(z) ${rating} pontszámot elfogadta a legacy ág`).toBe(400);
    }
    expect(await ertekelesekSzama(job.id)).toBe(0);
  });

  it('a KAPCSOLAT-SZŰRŐ itt is fut (2026-08-09 javítás — a duplikált ágból hiányzott)', async () => {
    const { felado, job } = await lezartFuvar();
    const res = await request(app).post(`/jobs/${job.id}/reviews`).set(auth(felado.token))
      .send({ rating: 5, comment: 'Hívj közvetlenül: +36 30 111 2233' });
    expect(
      res.status,
      'a visszafelé kompatibilis ágon telefonszám írható a publikus értékelésbe — '
      + 'a fő végponton lévő szűrő így egyetlen régi URL-lel megkerülhető',
    ).toBe(400);
    expect(res.body.code).toBe('CONTACT_LEAK');
    expect(await ertekelesekSzama(job.id), 'a szűrt komment mégis mentődött').toBe(0);
  });

  it('nem létező fuvar → 404, kívülálló → 403, nem lezárt fuvar → 409', async () => {
    const { felado, job } = await lezartFuvar();
    const idegen = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/jobs/${NEM_LETEZIK}/reviews`)
      .set(auth(felado.token)).send({ rating: 5 });
    expect(nincs.status).toBe(404);

    const kivul = await request(app).post(`/jobs/${job.id}/reviews`)
      .set(auth(idegen.token)).send({ rating: 1 });
    expect(kivul.status, 'kívülálló értékelhetett a legacy végponton').toBe(403);

    const futo = await lezartFuvar('in_progress');
    const korai = await request(app).post(`/jobs/${futo.job.id}/reviews`)
      .set(auth(futo.felado.token)).send({ rating: 5 });
    expect(korai.status, 'folyamatban lévő fuvart értékelni lehetett a legacy végponton').toBe(409);
    expect(await ertekelesekSzama(futo.job.id)).toBe(0);
  });

  it('a duplikáció itt is 409, és a KÉT végpont EGYMÁSSAL szemben is véd', async () => {
    const { felado, job } = await lezartFuvar();
    const elso = await request(app).post(`/jobs/${job.id}/reviews`)
      .set(auth(felado.token)).send({ rating: 5 });
    expect(elso.status, JSON.stringify(elso.body)).toBe(201);

    const ugyanaz = await request(app).post(`/jobs/${job.id}/reviews`)
      .set(auth(felado.token)).send({ rating: 1 });
    expect(ugyanaz.status).toBe(409);

    // A MÁSIK végponton sem lehet megkerülni a duplikáció-védelmet.
    const masikVegponton = await request(app).post('/reviews').set(auth(felado.token))
      .send({ job_id: job.id, stars: 1 });
    expect(
      masikVegponton.status,
      'a régi végponton már leadott értékelés után az ÚJ végponton is lehetett még egyet — '
      + 'a duplikáció-védelem végpontonként külön állna, nem az adaton',
    ).toBe(409);
    expect(await ertekelesekSzama(job.id)).toBe(1);
  });

  it('a legacy ág is újraszámolja a reputációt', async () => {
    const { felado, szallito, job } = await lezartFuvar();
    await request(app).post(`/jobs/${job.id}/reviews`).set(auth(felado.token)).send({ rating: 2 });
    const { rows } = await db.query('SELECT rating_avg, rating_count FROM users WHERE id = $1', [szallito.id]);
    expect(
      Number(rows[0].rating_count),
      'a legacy végponton adott értékelés nem frissítette a reputációt — a két úton '
      + 'eltérő adat keletkezne',
    ).toBe(1);
    expect(Number(rows[0].rating_avg)).toBe(2);
  });
});
