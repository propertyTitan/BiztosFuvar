// =====================================================================
//  bids.js — HIBAÁGAK, ALKU-ÁLLAPOTOK ÉS DÍJ-INVARIÁNSOK (2026-08-12)
//
//  Az ajánlat-ág a pénz-út legelső fele: itt dől el, ki nyeri a fuvart,
//  mekkora a megállapodott ár, és ebből mekkora kapcsolatfelvételi díj
//  lesz. A boldog ösvényt több suite járja; a VISSZAUTASÍTÓ ágakat és az
//  alku állapotgépét (ki jön most lépésre) alig valaki.
//
//  Egy elrontott 409 itt nem „csúnya hibaüzenet": azt jelenti, hogy két
//  szállító is elindul ugyanazért a csomagért, vagy hogy a feladó a saját
//  ellenajánlatát fogadja el a szállító helyett.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const NINCS_ILYEN = '00000000-0000-0000-0000-0000000000ee';

beforeEach(() => __resetRateLimitsForTests());

/** Ajánlat közvetlenül a DB-be, a kívánt alku-állapotban. */
async function ajanlat({
  jobId, carrierId, amount = 12000, status = 'pending',
  counterBy = null, counterAmount = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy,
                       counter_by, counter_amount_huf, counter_at)
     VALUES ($1,$2,$3,$4,'included',$5::text,$6::int,
             CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() END)
     RETURNING *`,
    [jobId, carrierId, amount, status, counterBy, counterAmount],
  );
  return rows[0];
}

// =====================================================================
//  1. GET /bids/preview — a készpénzes modell alap-invariánsa
// =====================================================================
describe('GET /bids/preview', () => {
  it('érvénytelen összegre 400 (hiányzó / 0 / negatív / nem szám)', async () => {
    const user = await createUser({ role: 'carrier' });
    for (const q of ['', '?amount=0', '?amount=-5000', '?amount=abc']) {
      const res = await request(app).get(`/bids/preview${q}`).set(auth(user.token));
      expect(res.status, `"${q}" — érvénytelen összegre 400 jár`).toBe(400);
      expect(res.body.error).toMatch(/Érvénytelen összeg/i);
    }
  });

  it('a szállító a TELJES összeget kapja — a díj a feladóé, nem levonás', async () => {
    const user = await createUser({ role: 'carrier' });
    const res = await request(app).get('/bids/preview?amount=20000').set(auth(user.token));
    expect(res.status).toBe(200);
    expect(res.body.netPayout,
      'KÉSZPÉNZES MODELL: a fuvardíj 100%-a a szállítóé — ha innen bármi levonódik, '
      + 'az egész üzleti modell hazudik a szállítónak')
      .toBe(20000);
    expect(res.body.cashPayment, 'a kifizetés készpénzes').toBe(true);
    expect(res.body.platformFee,
      'a 20 000 Ft-os fuvardíj az alsó sávba esik → 500 Ft kapcsolatfelvételi díj (a FELADÓÉ)')
      .toBe(500);

    const felette = await request(app).get('/bids/preview?amount=60000').set(auth(user.token));
    expect(felette.body.platformFee, '50 000 Ft felett a díj 1000 Ft').toBe(1000);
    expect(felette.body.netPayout, 'a felső sávban is a teljes összeg a szállítóé').toBe(60000);
  });

  it('azonos valutánál nincs átváltás, és ismeretlen valutapárnál sem találgatunk', async () => {
    const user = await createUser({ role: 'carrier' });
    const azonos = await request(app)
      .get('/bids/preview?amount=20000&currency=HUF&job_currency=HUF').set(auth(user.token));
    expect(azonos.body.convertedAmount,
      'azonos valutánál nem szabad átváltott összeget mutatni (félrevezetné a szállítót)')
      .toBeUndefined();

    // Nem támogatott pár: nem szabad „valamilyen" árfolyamot kitalálni hozzá.
    const ismeretlen = await request(app)
      .get('/bids/preview?amount=20000&currency=USD&job_currency=HUF').set(auth(user.token));
    expect(ismeretlen.status, 'ismeretlen valutapár nem okozhat hibát').toBe(200);
    expect(ismeretlen.body.convertedAmount,
      'csak az EUR↔HUF párt tudjuk átváltani — máshoz NE adjunk kitalált átváltást')
      .toBeUndefined();
    expect(ismeretlen.body.exchangeRate).toBeUndefined();
  });
});

// =====================================================================
//  2. GET /bids/mine — a vesztes ajánlattevő címlátása
// =====================================================================
describe('GET /bids/mine', () => {
  it('elkelt fuvarnál a VESZTES csak településszintű címet kap, a NYERTES a pontosat', async () => {
    const felado = await createUser({ role: 'shipper' });
    const nyertes = await createUser({ role: 'carrier' });
    const vesztes = await createUser({ role: 'carrier' });

    const nyitott = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    // GF-008: a kijelölt szállítónak a pontos cím csak a díj UTÁN jár —
    // a „neki oda kell mennie" eset fizetett fuvart feltételez.
    const elkelt = await createJob({
      shipperId: felado.id, carrierId: nyertes.id, status: 'accepted', paid: true,
    });
    await ajanlat({ jobId: nyitott.id, carrierId: vesztes.id });
    await ajanlat({ jobId: elkelt.id, carrierId: vesztes.id, status: 'rejected' });
    await ajanlat({ jobId: elkelt.id, carrierId: nyertes.id, status: 'accepted' });

    const veszteseRes = await request(app).get('/bids/mine').set(auth(vesztes.token));
    const nyitottSor = veszteseRes.body.find((r) => r.job_id === nyitott.id);
    const elkeltSor = veszteseRes.body.find((r) => r.job_id === elkelt.id);

    // GF-008 (user-döntés, 2026-08-30) felülírta a korábbi elvárást: a
    // nyitott fuvarnál is UTCA-szint jár (házszám a díj után) — a teszt
    // korábban a pontos címet kodifikálta.
    expect(nyitottSor.pickup_address).toContain('Teszt u');
    expect(nyitottSor.pickup_address.includes('1'),
      'a nyitott fuvar címében fizetés előtt nem lehet házszám (GF-008)')
      .toBe(false);
    expect(elkeltSor.pickup_address,
      'az ELKELT fuvarnál a vesztes ajánlattevő nem tarthatja meg örökre a házszámig '
      + 'pontos lakcímet — településszintre kell rövidülnie')
      .toBe('Budapest');
    expect(elkeltSor.dropoff_address, 'a lerakodási cím is településszintre rövidül').toBe('Szeged');

    const nyertesRes = await request(app).get('/bids/mine').set(auth(nyertes.token));
    const nyertesSor = nyertesRes.body.find((r) => r.job_id === elkelt.id);
    expect(nyertesSor.pickup_address,
      'a KIJELÖLT szállítónak pontos cím jár — neki oda kell mennie')
      .toBe('Budapest, Teszt u. 1.');
  });
});

// =====================================================================
//  3. POST /jobs/:jobId/bids — ajánlattétel validációi
// =====================================================================
describe('POST /jobs/:jobId/bids', () => {
  it('a visszaszállítási nyilatkozat kötelező és zárt értékkészletű', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });

    for (const policy of [undefined, '', 'talan', 'INCLUDED', 123]) {
      __resetRateLimitsForTests();
      const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
        .send({ amount_huf: 12000, return_policy: policy });
      expect(res.status, `return_policy=${JSON.stringify(policy)} → 400`).toBe(400);
      expect(res.body.code, 'a hibakódnak azonosítania kell a hiányzó nyilatkozatot')
        .toBe('RETURN_POLICY_REQUIRED');
    }
  });

  it('„külön díjért" nyilatkozatnál a díj pozitív egész forint kell legyen', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });

    const rosszDijak = [undefined, 0, -500, 1500.5, 'sok', 100000001];
    for (const dij of rosszDijak) {
      __resetRateLimitsForTests();
      const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
        .send({ amount_huf: 12000, return_policy: 'extra_fee', return_fee_huf: dij });
      expect(res.status, `return_fee_huf=${JSON.stringify(dij)} → 400`).toBe(400);
      expect(res.body.code).toBe('RETURN_FEE_INVALID');
    }

    __resetRateLimitsForTests();
    const ok = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'extra_fee', return_fee_huf: 3000 });
    expect(ok.status, 'érvényes visszaszállítási díjjal az ajánlat mehet').toBe(201);
    expect(ok.body.return_fee_huf,
      'a visszaszállítási díjat el kell menteni — a feladó jelvényként ezt látja')
      .toBe(3000);
    expect(ok.body.return_policy).toBe('extra_fee');
  });

  it('az ajánlat összege pozitív egész, legfeljebb 100 millió Ft', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });

    const rosszak = [0, -1000, 100.99, 'ötezer', 100000001];
    for (const osszeg of rosszak) {
      __resetRateLimitsForTests();
      const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
        .send({ amount_huf: osszeg, return_policy: 'included' });
      expect(res.status,
        `amount_huf=${JSON.stringify(osszeg)} → 400 (a DB INTEGER oszlopa különben 500-at dobna, `
        + 'a hibaüzenetben a belső DB-hibával)')
        .toBe(400);
    }
    // A HATÁR: pontosan 100 000 000 még átmegy.
    __resetRateLimitsForTests();
    const hataron = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 100000000, return_policy: 'included' });
    expect(hataron.status, 'a pontosan 100 milliós ajánlatot még el kell fogadni').toBe(201);
  });

  it('nem létező fuvarra 404, ugyanarra a fuvarra kétszer 409', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/jobs/${NINCS_ILYEN}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(nincs.status, 'ismeretlen fuvarra 404 (nem 500)').toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    __resetRateLimitsForTests();
    const elso = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included' });
    expect(elso.status).toBe(201);

    __resetRateLimitsForTests();
    const masodik = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 11000, return_policy: 'included' });
    expect(masodik.status,
      'egy szállító EGY ajánlatot tehet fuvaronként — a duplikátumot 409-cel kell elutasítani, '
      + 'nem a DB egyediség-hibáját (500) kiszivárogtatni')
      .toBe(409);
    expect(masodik.body.error).toMatch(/Már tettél ajánlatot/i);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db, MIN(amount_huf) AS ar FROM bids WHERE job_id = $1`, [job.id],
    );
    expect(rows[0].db, 'a második próbálkozás nem hozhat létre sort').toBe(1);
    expect(rows[0].ar, 'és nem is írhatja felül az eredeti ajánlatot alacsonyabb árra').toBe(12000);
  });

  it('a régi `amount_huf` és az új `amount` mező is működik (visszafelé kompatibilitás)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount: 14000, currency: 'HUF', return_policy: 'included', eta_minutes: 90 });
    expect(res.status, 'az új `amount` mezővel is lehessen ajánlatot tenni').toBe(201);
    expect(res.body.amount_huf, 'az összegnek ugyanoda kell mentődnie').toBe(14000);
    expect(res.body.eta_minutes).toBe(90);
  });

  it('az ajánlat feladói értesítést hoz létre (a fuvar értéke a válaszidőn múlik)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount_huf: 12000, return_policy: 'included' });

    const { rows } = await db.query(
      `SELECT type, body FROM notifications WHERE user_id = $1 AND type = 'bid_received'`,
      [felado.id],
    );
    expect(rows.length, 'a feladónak értesülnie kell az új ajánlatról').toBe(1);
    expect(rows[0].body, 'az értesítés tartalmazza az ajánlott összeget').toMatch(/12\D?000/);
  });
});

// =====================================================================
//  4. GET /jobs/:jobId/bids — IDOR-védelem
// =====================================================================
describe('GET /jobs/:jobId/bids', () => {
  it('nem létező fuvarra 404', async () => {
    const user = await createUser({ role: 'carrier' });
    const res = await request(app).get(`/jobs/${NINCS_ILYEN}/bids`).set(auth(user.token));
    expect(res.status).toBe(404);
  });

  it('a szállító CSAK a saját ajánlatát látja; a feladó és az admin mindet', async () => {
    const felado = await createUser({ role: 'shipper' });
    const egy = await createUser({ role: 'carrier' });
    const ketto = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    await ajanlat({ jobId: job.id, carrierId: egy.id, amount: 12000 });
    await ajanlat({ jobId: job.id, carrierId: ketto.id, amount: 9000 });

    const egyRes = await request(app).get(`/jobs/${job.id}/bids`).set(auth(egy.token));
    expect(egyRes.status, 'a szállítói felület Promise.all-ban kéri: 200-at kell adni, nem 403-at').toBe(200);
    expect(egyRes.body.length,
      'egy szállító NEM olvashatja ki a versenytársa ajánlatát — abból alálicitálna')
      .toBe(1);
    expect(egyRes.body[0].carrier_id).toBe(egy.id);

    const feladoRes = await request(app).get(`/jobs/${job.id}/bids`).set(auth(felado.token));
    expect(feladoRes.body.length, 'a feladó minden ajánlatot lát — közülük választ').toBe(2);
    expect(feladoRes.body[0].amount_huf, 'ár szerint növekvő sorrend (a legolcsóbb elöl)').toBe(9000);
    expect(feladoRes.body[0].net_payout,
      'a feladó is látja, hogy a szállító a TELJES összeget kapja (nincs jutalék)')
      .toBe(9000);
    expect(feladoRes.body[0].platform_fee,
      'és hogy ehhez az ajánlathoz mekkora kapcsolatfelvételi díj tartozik')
      .toBe(500);

    const adminRes = await request(app).get(`/jobs/${job.id}/bids`).set(auth(admin.token));
    expect(adminRes.body.length, 'az admin (moderáció) mindet látja').toBe(2);
  });
});

// =====================================================================
//  5. POST /bids/:id/accept — a feladó elfogadja az ajánlatot
// =====================================================================
describe('POST /bids/:id/accept', () => {
  it('404 / 403 / 409 — az elfogadás állapot- és jogosultsági kapui', async () => {
    const felado = await createUser({ role: 'shipper' });
    const idegen = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/bids/${NINCS_ILYEN}/accept`).set(auth(felado.token)).send({});
    expect(nincs.status, 'ismeretlen ajánlatra 404').toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({ jobId: job.id, carrierId: szallito.id });

    const masenak = await request(app).post(`/bids/${b.id}/accept`).set(auth(idegen.token)).send({});
    expect(masenak.status,
      'IDEGEN nem fogadhat el ajánlatot MÁS fuvarján — így magához rendelne egy szállítót')
      .toBe(403);
    const szallitoSajat = await request(app).post(`/bids/${b.id}/accept`)
      .set(auth(szallito.token)).send({});
    expect(szallitoSajat.status, 'a szállító sem fogadhatja el a SAJÁT ajánlatát').toBe(403);

    // Már lezárult fuvar
    const lezart = await createJob({ shipperId: felado.id, status: 'completed', carrierId: szallito.id });
    const lezartBid = await ajanlat({ jobId: lezart.id, carrierId: szallito.id });
    const lezartRes = await request(app).post(`/bids/${lezartBid.id}/accept`)
      .set(auth(felado.token)).send({});
    expect(lezartRes.status, 'lezárt fuvaron nincs mit elfogadni').toBe(409);

    // Már nem aktív (visszavont/elutasított) ajánlat
    const inaktiv = await ajanlat({ jobId: job.id, carrierId: idegen.id, status: 'rejected' });
    const inaktivRes = await request(app).post(`/bids/${inaktiv.id}/accept`)
      .set(auth(felado.token)).send({});
    expect(inaktivRes.status, 'már elutasított ajánlatot nem lehet „visszaéleszteni"').toBe(409);
    expect(inaktivRes.body.error).toMatch(/már nem aktív/i);
  });

  it('a feladó nem fogadhatja el a SAJÁT, még megválaszolatlan ellenajánlatát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({
      jobId: job.id, carrierId: szallito.id, amount: 20000,
      counterBy: 'shipper', counterAmount: 15000,
    });

    const res = await request(app).post(`/bids/${b.id}/accept`).set(auth(felado.token)).send({});
    expect(res.status,
      'ha a feladónál nincs a labda, nem zárhatja le az alkut — különben a saját, '
      + 'lealkudott árán rögzítené a fuvart a szállító beleegyezése nélkül')
      .toBe(409);
    expect(res.body.error).toMatch(/még nem reagált/i);

    const { rows } = await db.query(`SELECT status, carrier_id FROM jobs WHERE id = $1`, [job.id]);
    expect(rows[0].status, 'a fuvar nem kerülhet elfogadott állapotba').toBe('bidding');
    expect(rows[0].carrier_id).toBeNull();
  });

  it('a SZÁLLÍTÓI ellenajánlat elfogadásakor a megállapodott ár az ellenajánlat, nem az eredeti', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({
      jobId: job.id, carrierId: szallito.id, amount: 20000,
      counterBy: 'carrier', counterAmount: 55000,
    });

    const res = await request(app).post(`/bids/${b.id}/accept`).set(auth(felado.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.amount_huf,
      'a szállító ellenajánlata a megállapodott ár — az eredeti 20 000-et elfogadni '
      + 'azt jelentené, hogy a szállító 35 000 Ft-tal kevesebbet kap, mint amiben megegyeztek')
      .toBe(55000);
    expect(res.body.connection_fee_huf,
      'a díj-sáv a MEGÁLLAPODOTT árhoz igazodik: 55 000 Ft → felső sáv, 1000 Ft')
      .toBe(1000);

    const { rows } = await db.query(
      `SELECT accepted_price_huf, connection_fee_huf, carrier_id FROM jobs WHERE id = $1`, [job.id],
    );
    expect(rows[0].accepted_price_huf).toBe(55000);
    expect(rows[0].connection_fee_huf).toBe(1000);
    expect(rows[0].carrier_id).toBe(szallito.id);
  });

  it('újraválasztásnál a MÁR KIFIZETETT díj marad érvényben — nincs második fizetés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const regi = await createUser({ role: 'carrier' });
    const uj = await createUser({ role: 'carrier' });
    // Fizetett fuvar a felső díjsávban (60 000 Ft → 1000 Ft díj), majd
    // újranyitva: a feladó egy OLCSÓBB (alsó sávos) ajánlatot választ.
    const job = await createJob({
      shipperId: felado.id, carrierId: regi.id, status: 'accepted', paid: true, priceHuf: 60000,
    });
    await db.query(
      `UPDATE jobs SET status = 'bidding', carrier_id = NULL, accepted_price_huf = NULL,
              reopened_count = 1 WHERE id = $1`, [job.id],
    );
    const ujAjanlat = await ajanlat({ jobId: job.id, carrierId: uj.id, amount: 10000 });

    const res = await request(app).post(`/bids/${ujAjanlat.id}/accept`)
      .set(auth(felado.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.fee_already_paid,
      'a kapcsolatfelvételi díj a FUVARRA szól — újraválasztásnál nem szabad újra beszedni')
      .toBe(true);
    expect(res.body.connection_fee_huf,
      'a díj a fuvarra EGYSZER rögzül: marad az eredeti 1000 Ft, nem esik vissza 500-ra '
      + 'az olcsóbb új ajánlat miatt')
      .toBe(1000);
    expect(res.body.barion.gateway_url,
      'már fizetett fuvarnál nem indul új fizetés — nem lehet fizetőoldalra küldeni a feladót')
      .toBeNull();

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db FROM escrow_transactions WHERE job_id = $1`, [job.id],
    );
    expect(rows[0].db, 'nem keletkezhet második díj-sor ugyanahhoz a fuvarhoz').toBe(1);
  });

  it('az elfogadás a TÖBBI ajánlatot elutasítja, és a fuvar egyetlen szállítót kap', async () => {
    const felado = await createUser({ role: 'shipper' });
    const nyertes = await createUser({ role: 'carrier' });
    const vesztes = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const nyertesBid = await ajanlat({ jobId: job.id, carrierId: nyertes.id, amount: 12000 });
    const vesztesBid = await ajanlat({ jobId: job.id, carrierId: vesztes.id, amount: 13000 });

    const res = await request(app).post(`/bids/${nyertesBid.id}/accept`)
      .set(auth(felado.token)).send({});
    expect(res.status).toBe(200);

    const { rows } = await db.query(`SELECT id, status FROM bids WHERE job_id = $1`, [job.id]);
    const ny = rows.find((r) => r.id === nyertesBid.id);
    const ve = rows.find((r) => r.id === vesztesBid.id);
    expect(ny.status).toBe('accepted');
    expect(ve.status,
      'a többi ajánlatot le kell zárni — különben a feladó másodszor is elfogadhatna egyet')
      .toBe('rejected');

    // A már elutasított ajánlat elfogadása 409.
    const ujra = await request(app).post(`/bids/${vesztesBid.id}/accept`)
      .set(auth(felado.token)).send({});
    expect(ujra.status, 'elfogadott fuvaron nincs második elfogadás').toBe(409);
  });
});

// =====================================================================
//  6. POST /bids/:id/accept-counter — a szállító zárja le az alkut
// =====================================================================
describe('POST /bids/:id/accept-counter', () => {
  it('404 / 403 / 409 — csak a SZÁLLÍTÓ, csak élő ajánlaton, csak feladói ellenajánlatra', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });

    const nincs = await request(app).post(`/bids/${NINCS_ILYEN}/accept-counter`)
      .set(auth(szallito.token)).send({});
    expect(nincs.status).toBe(404);

    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({
      jobId: job.id, carrierId: szallito.id, amount: 20000,
      counterBy: 'shipper', counterAmount: 15000,
    });

    const idegenRes = await request(app).post(`/bids/${b.id}/accept-counter`)
      .set(auth(idegen.token)).send({});
    expect(idegenRes.status, 'csak az ajánlat szállítója fogadhatja el a neki szóló ellenajánlatot')
      .toBe(403);
    const feladoRes = await request(app).post(`/bids/${b.id}/accept-counter`)
      .set(auth(felado.token)).send({});
    expect(feladoRes.status,
      'a feladó a SAJÁT ellenajánlatát nem fogadtathatja el magával — az alku két félé')
      .toBe(403);

    // Nincs feladói ellenajánlat → nincs mit elfogadni
    const ellenajanlatNelkul = await ajanlat({ jobId: job.id, carrierId: idegen.id });
    const nincsCounter = await request(app).post(`/bids/${ellenajanlatNelkul.id}/accept-counter`)
      .set(auth(idegen.token)).send({});
    expect(nincsCounter.status, 'feladói ellenajánlat nélkül 409').toBe(409);
    expect(nincsCounter.body.error).toMatch(/Nincs elfogadható feladói ellenajánlat/i);

    // A szállító SAJÁT ellenajánlatát sem fogadhatja el önmagával („accept-counter"
    // kizárólag a FELADÓI ellenajánlatra való) — különben egyoldalúan rögzítené
    // a saját, magasabb árát a feladó válasza nélkül.
    const sajatSzallito = await createUser({ role: 'carrier' });
    const sajatCounter = await ajanlat({
      jobId: job.id, carrierId: sajatSzallito.id, amount: 20000,
      counterBy: 'carrier', counterAmount: 30000,
    });
    const sajatRes = await request(app).post(`/bids/${sajatCounter.id}/accept-counter`)
      .set(auth(sajatSzallito.token)).send({});
    expect(sajatRes.status,
      'a szállító a saját ellenajánlatát nem fogadhatja el — a labda a feladónál van')
      .toBe(409);
    expect(sajatRes.body.error).toMatch(/Nincs elfogadható feladói ellenajánlat/i);

    // Lezárt (lemondott) fuvaron nincs alku-lezárás
    const lezart = await createJob({ shipperId: felado.id, status: 'cancelled', carrierId: null });
    const lezartBid = await ajanlat({
      jobId: lezart.id, carrierId: szallito.id, counterBy: 'shipper', counterAmount: 15000,
    });
    const lezartRes = await request(app).post(`/bids/${lezartBid.id}/accept-counter`)
      .set(auth(szallito.token)).send({});
    expect(lezartRes.status, 'lemondott fuvaron nem lehet alkut lezárni').toBe(409);

    // Már lezárult (elutasított) ajánlat — a feladó közben mást választott
    const masikSzallito = await createUser({ role: 'carrier' });
    const inaktiv = await ajanlat({
      jobId: job.id, carrierId: masikSzallito.id, status: 'rejected',
      counterBy: 'shipper', counterAmount: 15000,
    });
    const inaktivRes = await request(app).post(`/bids/${inaktiv.id}/accept-counter`)
      .set(auth(masikSzallito.token)).send({});
    expect(inaktivRes.status,
      'egy MÁR ELUTASÍTOTT ajánlatot nem lehet utólag elfogadva „visszaéleszteni" — '
      + 'így két szállító indulna el ugyanazért a csomagért')
      .toBe(409);
    expect(inaktivRes.body.error).toMatch(/már nem aktív/i);
  });

  it('sikeres elfogadás: a feladó ellenajánlata lesz a megállapodott ár', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({
      jobId: job.id, carrierId: szallito.id, amount: 80000,
      counterBy: 'shipper', counterAmount: 45000,
    });

    const res = await request(app).post(`/bids/${b.id}/accept-counter`)
      .set(auth(szallito.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.amount_huf,
      'a lealkudott 45 000 Ft a megállapodott ár, nem az eredeti 80 000')
      .toBe(45000);

    const { rows } = await db.query(
      `SELECT status, carrier_id, accepted_price_huf, connection_fee_huf FROM jobs WHERE id = $1`,
      [job.id],
    );
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].carrier_id).toBe(szallito.id);
    expect(rows[0].accepted_price_huf).toBe(45000);
    expect(rows[0].connection_fee_huf,
      '45 000 Ft ≤ 50 000 → alsó sáv, 500 Ft díj (az eredeti 80 000-es ajánlat 1000-et adna)')
      .toBe(500);

    // A fizetési link a FIZETŐNEK szól — a szállító válaszába nem kerülhet.
    expect(JSON.stringify(res.body),
      'a szállító válaszába nem kerülhet a feladó fizetőoldalának URL-je')
      .not.toMatch(/stub:cib/);
  });
});

// =====================================================================
//  7. POST /bids/:id/counter — ellenajánlat (Vinted-stílusú alku)
// =====================================================================
describe('POST /bids/:id/counter', () => {
  it('érvénytelen összeget nem fogad el', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({ jobId: job.id, carrierId: szallito.id });

    for (const osszeg of [undefined, 0, -1000, 12.5, 'sok', 100000001]) {
      __resetRateLimitsForTests();
      const res = await request(app).post(`/bids/${b.id}/counter`)
        .set(auth(felado.token)).send({ amount: osszeg });
      expect(res.status, `amount=${JSON.stringify(osszeg)} → 400`).toBe(400);
    }
    const { rows } = await db.query(`SELECT counter_amount_huf FROM bids WHERE id = $1`, [b.id]);
    expect(rows[0].counter_amount_huf, 'egyik hibás próbálkozás sem írhat az ajánlatra').toBeNull();
  });

  it('404 az ismeretlen ajánlatra, 403 a kívülállónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const kivulallo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({ jobId: job.id, carrierId: szallito.id });

    const nincs = await request(app).post(`/bids/${NINCS_ILYEN}/counter`)
      .set(auth(felado.token)).send({ amount: 15000 });
    expect(nincs.status).toBe(404);

    const idegen = await request(app).post(`/bids/${b.id}/counter`)
      .set(auth(kivulallo.token)).send({ amount: 15000 });
    expect(idegen.status,
      'az alku KÉT fél ügye — egy harmadik szállító nem avatkozhat bele')
      .toBe(403);
  });

  it('mindkét fél tehet ellenajánlatot, és a legutóbbi felülírja az előzőt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const b = await ajanlat({ jobId: job.id, carrierId: szallito.id, amount: 20000 });

    const feladoi = await request(app).post(`/bids/${b.id}/counter`)
      .set(auth(felado.token)).send({ amount: 15000 });
    expect(feladoi.status).toBe(200);
    expect(feladoi.body.counter_by, 'a feladó ellenajánlata „shipper" jelöléssel rögzül').toBe('shipper');

    const szallitoi = await request(app).post(`/bids/${b.id}/counter`)
      .set(auth(szallito.token)).send({ amount: 18000 });
    expect(szallitoi.status).toBe(200);
    expect(szallitoi.body.counter_by, 'a válasz-ellenajánlat „carrier"').toBe('carrier');

    const { rows } = await db.query(
      `SELECT counter_amount_huf, counter_by FROM bids WHERE id = $1`, [b.id],
    );
    expect(rows[0].counter_amount_huf,
      'a legutóbbi ellenajánlat az érvényes — különben egy régi, kedvezőbb ár rögzülne')
      .toBe(18000);
    expect(rows[0].counter_by).toBe('carrier');

    // A másik fél kap értesítést — enélkül az alku a levegőben lóg.
    const { rows: ert } = await db.query(
      `SELECT user_id FROM notifications WHERE type = 'counter_offer' AND user_id = ANY($1::uuid[])`,
      [[felado.id, szallito.id]],
    );
    expect(ert.map((r) => r.user_id).sort(),
      'mindkét irányban értesítenünk kell a MÁSIK felet')
      .toEqual([felado.id, szallito.id].sort());
  });

  it('lezárt fuvaron és lezárt ajánlaton nincs alku', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const lezartJob = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered',
    });
    const lezartBid = await ajanlat({ jobId: lezartJob.id, carrierId: szallito.id });
    const jobRes = await request(app).post(`/bids/${lezartBid.id}/counter`)
      .set(auth(felado.token)).send({ amount: 15000 });
    expect(jobRes.status, 'kézbesített fuvar árán nem lehet utólag alkudni').toBe(409);
    expect(jobRes.body.error).toMatch(/nem alkudható/i);

    const eloJob = await createJob({ shipperId: felado.id, status: 'bidding', carrierId: null });
    const elfogadottBid = await ajanlat({
      jobId: eloJob.id, carrierId: szallito.id, status: 'accepted',
    });
    const bidRes = await request(app).post(`/bids/${elfogadottBid.id}/counter`)
      .set(auth(felado.token)).send({ amount: 15000 });
    expect(bidRes.status, 'már elfogadott ajánlatra nem lehet ellenajánlatot tenni').toBe(409);
  });
});
