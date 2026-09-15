const { seenOffer } = require('./helpers');
// =====================================================================
//  BIDS — A MARADÉK FEDETLEN ÁGAK (2026-08-12)
//
//  A `bids-hibaagak.test.js` az alku állapotgépét és a jogosultsági
//  kapukat végigjárta. Ami maradt, két osztály — és mindkettő a pénz-út
//  legkényesebb pontján van:
//
//   (1) A DEVIZA-ÁG. A GoFuvar EU-szintű coverage-dzsel indul, tehát az
//       EUR-os fuvar / EUR-os ajánlat valós eset. Ezt az ágat eddig SEMMI
//       nem járta végig: sem a licit-előnézet átváltását, sem az
//       árfolyam „befagyasztását" az ajánlat sorára. ⚠️ Az árfolyam
//       külső (EKB) hívásból jön — a tesztben a `fetch` MOCKOLVA van,
//       hálózatra egyetlen kérés sem megy, és így determinisztikus is
//       (a szolgáltatás a 400-as tartalék árfolyamra esik vissza).
//
//   (2) A MEGSZAKADT ELFOGADÁS. Az ajánlat-elfogadás tranzakcióban fut:
//       előbb a fuvar átáll `accepted`-re, AZTÁN indul a díjfizetés. Ha a
//       fizetés-indítás elhasal (PSP-kiesés), a tranzakciónak VISSZA kell
//       gördülnie. Enélkül a fuvar „elfogadott" lenne fizetés nélkül: a
//       többi ajánlat elutasítva, a szállító kijelölve, a platform
//       egyetlen bevétele pedig elveszve — és a feladó nem is tudná
//       újraindítani, mert a fuvar már nem `bidding`.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const paymentProvider = require('../src/services/paymentProvider');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// A tartalék EUR/HUF árfolyam a services/exchange.js-ben (ha az EKB nem elérhető).
const TARTALEK_ARFOLYAM = 400;

/**
 * Az EKB árfolyam-API kiiktatása. ⚠️ KÖTELEZŐ minden deviza-teszthez:
 * enélkül a suite VALÓDI HTTP-kérést indítana a data-api.ecb.europa.eu-ra
 * (lassú, hálózatfüggő, és a teszt eredménye a napi árfolyamtól függne).
 */
function ekbKiiktatva() {
  vi.spyOn(global, 'fetch').mockRejectedValue(new Error('EKB nem elérhető (teszt)'));
}

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

beforeEach(() => __resetRateLimitsForTests());
afterEach(() => vi.restoreAllMocks());

// =====================================================================
//  1. DEVIZA — licit-előnézet átváltása
// =====================================================================
describe('GET /bids/preview — induláskor HUF', () => {
  it.each(['currency=EUR&job_currency=HUF', 'currency=HUF&job_currency=EUR', 'currency=EUR&job_currency=EUR'])
    ('nem ígér devizás megállapodást (%s)', async pair => {
      const fetch = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('EKB nem szükséges'));
      const user = await createUser({ role: 'carrier' });
      const res = await request(app).get(`/bids/preview?amount=200&${pair}`).set(auth(user.token));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_CURRENCY');
      expect(fetch).not.toHaveBeenCalled();
    });
});

// =====================================================================
//  2. DEVIZA — az árfolyam befagyasztása az ajánlat sorára
// =====================================================================
describe('POST /jobs/:jobId/bids — cross-currency ajánlat', () => {
  it('régi EUR-os fuvarra sem vesz fel HUF-nak álcázott ajánlatot', async () => {
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query("UPDATE jobs SET currency = 'EUR' WHERE id = $1", [job.id]);
    const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount: 50000, currency: 'HUF', return_policy: 'included' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UNSUPPORTED_CURRENCY');
    expect((await db.query('SELECT * FROM bids WHERE job_id = $1', [job.id])).rowCount).toBe(0);
  });

  it('AZONOS valutánál nincs árfolyam-mező (nem hívunk fölösleges külső szolgáltatást)', async () => {
    const halozat = vi.spyOn(global, 'fetch')
      .mockRejectedValue(new Error('nem szabadna hívni'));
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' }); // HUF

    const res = await request(app).post(`/jobs/${job.id}/bids`).set(auth(szallito.token))
      .send({ amount: 50000, currency: 'HUF', return_policy: 'included' });

    expect(res.status).toBe(201);
    const { rows } = await db.query(
      'SELECT exchange_rate, exchange_rate_frozen_at FROM bids WHERE id = $1', [res.body.id],
    );
    expect(rows[0].exchange_rate,
      'azonos valutánál nincs mit átváltani — ha mégis kitöltenénk, a felület '
      + 'árfolyam-kockázatot sugallna ott, ahol nincs')
      .toBeNull();
    expect(rows[0].exchange_rate_frozen_at).toBeNull();
    expect(halozat,
      'és a külső árfolyam-hívás sem indulhat el fölöslegesen (minden ajánlatnál '
      + 'egy EKB-kérés érdemi lassulás lenne a kínálati oldalon)')
      .not.toHaveBeenCalled();
  });
});

// =====================================================================
//  3. MEGSZAKADT ELFOGADÁS — a tranzakció visszagördül
// =====================================================================
describe('Az elfogadás visszagördül, ha a díjfizetés indítása elhasal', () => {
  /** Fuvar + rá adott ajánlat. */
  async function fuvarAjanlattal(extra = {}) {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const masikSzallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await ajanlat({ jobId: job.id, carrierId: szallito.id, amount: 20000, ...extra });
    const masikBid = await ajanlat({ jobId: job.id, carrierId: masikSzallito.id, amount: 25000 });
    return {
      felado, szallito, job, bid, masikBid,
    };
  }

  it('POST /bids/:id/accept → 502, és a fuvar MARAD „bidding" (nincs félkész elfogadás)', async () => {
    const {
      felado, job, bid, masikBid,
    } = await fuvarAjanlattal();
    vi.spyOn(paymentProvider, 'startFeePayment')
      .mockRejectedValue(new Error('PSP időtúllépés'));

    const res = await request(app).post(`/bids/${bid.id}/accept`).send(await seenOffer(bid.id)).set(auth(felado.token));

    expect(res.status,
      'a fizetés-indítás hibája a fizetési szolgáltató hibája — 502, nem 500 és nem néma 200')
      .toBe(502);
    expect(res.body.error).toMatch(/díjfizetés indítása sikertelen/i);
    expect(res.body.detail,
      'a részletet visszaadjuk, hogy a hibakeresés ne a semmiből induljon')
      .toBeTruthy();

    const { rows: jobRows } = await db.query(
      'SELECT status, carrier_id, accepted_price_huf, connection_fee_huf FROM jobs WHERE id = $1',
      [job.id],
    );
    expect(jobRows[0].status,
      '⚠️ EZ A LÉNYEG: a tranzakció a fuvart MÁR átállította „accepted"-re, mielőtt a '
      + 'fizetés indult. ROLLBACK nélkül a fuvar elfogadott maradna fizetés nélkül — a '
      + 'feladó nem tudná újraindítani (már nem „bidding"), a többi ajánlat elutasítva, '
      + 'a platform egyetlen bevétele pedig elveszne.')
      .toBe('bidding');
    expect(jobRows[0].carrier_id, 'szállító sem jelölhető ki fizetés nélkül').toBeNull();
    expect(Number(jobRows[0].accepted_price_huf),
      'a megállapodott ár sem íródhat át az ajánlat összegére (20 000) — a sor a '
      + 'ROLLBACK után pontosan az elfogadás ELŐTTI értéket (15 000) viseli')
      .toBe(15000);

    const { rows: bidRows } = await db.query(
      'SELECT id, status FROM bids WHERE job_id = $1 ORDER BY amount_huf', [job.id],
    );
    expect(bidRows.map((b) => b.status),
      'a többi ajánlat elutasítása is a visszagördült tranzakció része volt — '
      + 'ha bennragadna, a feladó választás nélkül maradna')
      .toEqual(['pending', 'pending']);
    expect(bidRows.find((b) => b.id === masikBid.id).status).toBe('pending');

    const { rows: escrow } = await db.query(
      'SELECT COUNT(*)::int AS c FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(escrow[0].c, 'sikertelen fizetés-indításból nem keletkezhet díj-sor').toBe(0);
  });

  it('POST /bids/:id/accept-counter → ugyanaz a védelem a SZÁLLÍTÓI ágon is', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await ajanlat({
      jobId: job.id,
      carrierId: szallito.id,
      amount: 20000,
      counterBy: 'shipper',
      counterAmount: 17000,
    });
    vi.spyOn(paymentProvider, 'startFeePayment')
      .mockRejectedValue(new Error('PSP időtúllépés'));

    const res = await request(app).post(`/bids/${bid.id}/accept-counter`).send(await seenOffer(bid.id))
      .set(auth(szallito.token));

    expect(res.status,
      'a két elfogadási út (feladói / szállítói) ugyanazt a magot használja — '
      + 'a védelemnek MINDKETTŐN érvényesülnie kell. Ez a projekt visszatérő hibamintája: '
      + '„a javítás azon az úton épül meg, ahol felfedezték".')
      .toBe(502);

    const { rows } = await db.query(
      'SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id],
    );
    expect(rows[0].status).toBe('bidding');
    expect(rows[0].carrier_id).toBeNull();

    const { rows: bidRows } = await db.query('SELECT status FROM bids WHERE id = $1', [bid.id]);
    expect(bidRows[0].status,
      'az ajánlat is „pending" marad, tehát újra elfogadható, ha a PSP magához tér')
      .toBe('pending');
  });

  it('a PSP helyreállása után az elfogadás normálisan lemegy (a hiba nem ragad be)', async () => {
    const { felado, job, bid } = await fuvarAjanlattal();
    const kem = vi.spyOn(paymentProvider, 'startFeePayment')
      .mockRejectedValueOnce(new Error('PSP időtúllépés'))
      .mockResolvedValue({ paymentId: 'teszt-fizetes-1', gatewayUrl: 'https://psp.teszt/fizetes' });

    const elso = await request(app).post(`/bids/${bid.id}/accept`).send(await seenOffer(bid.id)).set(auth(felado.token));
    expect(elso.status).toBe(502);

    const masodik = await request(app).post(`/bids/${bid.id}/accept`).send(await seenOffer(bid.id)).set(auth(felado.token));
    expect(masodik.status,
      'az első kudarc nem hagyhat maga után olyan állapotot, ami a MÁSODIK, sikeres '
      + 'próbálkozást is megakadályozná (különben a feladó véglegesen elakadna)')
      .toBe(200);
    expect(masodik.body.barion.gateway_url).toBe('https://psp.teszt/fizetes');
    expect(kem).toHaveBeenCalledTimes(2);

    const { rows } = await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].carrier_id).toBe(bid.carrier_id);
  });
});

// =====================================================================
//  4. ELLENAJÁNLAT — verseny az elfogadással
// =====================================================================
describe('POST /bids/:id/counter — az időközbeni elfogadás kizárja az alkut', () => {
  it('ha az ajánlatot az ellenőrzés és az írás KÖZÖTT elfogadják, az ellenajánlat nem íródik rá', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    const bid = await ajanlat({ jobId: job.id, carrierId: szallito.id, amount: 20000 });

    // Verseny szimulálása: közvetlenül az ellenajánlat-írás ELŐTT elfogadottá
    // válik az ajánlat (ezt csinálja a valóságban a másik fül / a másik fél).
    const eredetiQuery = db.query.bind(db);
    vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('counter_amount_huf = $1')) {
        await eredetiQuery(`UPDATE bids SET status = 'accepted' WHERE id = $1`, [bid.id]);
      }
      return eredetiQuery(sql, params);
    });

    const res = await request(app).post(`/bids/${bid.id}/counter`)
      .set(auth(felado.token)).send({ amount: 15000 });

    expect(res.status,
      '⚠️ Az `AND status = \'pending\'` feltétel az ATOMI védelem: enélkül a feladó '
      + 'ellenajánlata RÁÍRÓDNA egy MÁR ELFOGADOTT ajánlatra — a megállapodott ár utólag '
      + 'megváltozna, és a két fél két különböző összegre emlékezne.')
      .toBe(409);
    expect(res.body.error).toMatch(/már nem lehet ellenajánlatot tenni/i);

    vi.restoreAllMocks();
    const { rows } = await db.query(
      'SELECT counter_amount_huf, counter_by, amount_huf FROM bids WHERE id = $1', [bid.id],
    );
    expect(rows[0].counter_amount_huf,
      'a megállapodott árat semmi nem írhatta felül').toBeNull();
    expect(rows[0].counter_by).toBeNull();
    expect(Number(rows[0].amount_huf)).toBe(20000);
  });
});
