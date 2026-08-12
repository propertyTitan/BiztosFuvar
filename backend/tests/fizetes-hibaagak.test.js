// =====================================================================
//  A PÉNZ-ÚT HIBAÁGAI — ami akkor történik, ha valami MÁS romlik el
//  (2026-08-12, lefedettségi kör)
//
//  A `fizetes-webhook.test.js` a BOLDOG utat és a hamisítás-védelmet őrzi.
//  Ami eddig méretlen maradt, az a KÖRNYEZET kiesése:
//
//   1. A SZÁMLÁZÁS elhasal → a fizetés attól még ÉRVÉNYES. Ha a webhook
//      ilyenkor 5xx-szel elszáll, a PSP újraküld, a feladó pénze levonva, a
//      kontakt viszont nem nyílik meg — a platform egyetlen bevétele mellett
//      a legfontosabb élmény törik el.
//   2. A NAPLÓZÁS elhasal → ugyanez.
//   3. A megszakadt fizetés FOGLALÁSI ága (a fuvar-ágnak volt tesztje, a
//      foglalásinak nem — pontosan az az aszimmetria, ami a 2026-08-09-i
//      „a díj helyett a fuvardíjat számláztuk" hibát is szülte).
//   4. Szállító NÉLKÜLI fuvar kifizetése (szállító-csere / lemondás után) —
//      itt korábban egy `d.carrier_id`-re épülő értesítés omolhatna össze.
//   5. Az escrow- és payout-végpontok IDOR-védelme és üres esetei.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const dbModul = require('../src/db');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const { calculateConnectionFee } = require('../src/services/connectionFee');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

const webhook = (body) => request(app).post('/payments/cib/callback').send(body);

/** Fizetésre váró FUVAR (elfogadott ajánlat, 'held' díj-sor). */
async function fizetesreVaroFuvar({ priceHuf = 15000, carrier = true } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = carrier ? await createUser({ role: 'carrier' }) : null;
  const job = await createJob({
    shipperId: felado.id,
    carrierId: szallito ? szallito.id : null,
    status: 'accepted',
    paid: false,
    priceHuf,
  });
  const paymentId = `cib-hibaag-${job.id}`;
  const dij = calculateConnectionFee(priceHuf);
  await db.query(
    `INSERT INTO escrow_transactions
       (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
     VALUES ($1, $2, 'held', $3, 0, $2)`,
    [job.id, dij, paymentId],
  );
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  return {
    felado, szallito, job, paymentId, dij,
  };
}

/** Fizetésre váró FOGLALÁS (a járat-ág). */
async function fizetesreVaroFoglalas({ priceHuf = 12000, feeHuf = 500 } = {}) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const { booking } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false, priceHuf,
  });
  const paymentId = `cib-hibaag-${booking.id}`;
  await db.query(
    `UPDATE route_bookings
        SET connection_fee_huf = $2, fee_consent_at = NOW(), barion_payment_id = $3
      WHERE id = $1`,
    [booking.id, feeHuf, paymentId],
  );
  return {
    felado, szallito, booking, paymentId, feeHuf, priceHuf,
  };
}

/**
 * Célzott DB-hiba: minden lekérdezés megy, KIVÉVE amelyik a mintára illik.
 * (Így egy konkrét mellék-művelet kiesését modellezzük, nem az egész DB-t.)
 * A visszaadott számláló bizonyítja, hogy az injekció TÉNYLEG lefutott —
 * enélkül a teszt csendben elvesztené az értelmét.
 */
function dbHibaMintara(minta) {
  const eredeti = dbModul.query.bind(dbModul);
  const allapot = { talalat: 0 };
  vi.spyOn(dbModul, 'query').mockImplementation(async (sql, params) => {
    if (typeof sql === 'string' && minta.test(sql)) {
      allapot.talalat += 1;
      throw new Error('szimulált DB-hiba a teszthez');
    }
    return eredeti(sql, params);
  });
  return allapot;
}

const dijEsemeny = async (paymentId, status = 'Succeeded') => (await db.query(
  'SELECT * FROM payment_events WHERE payment_id = $1 AND status = $2', [paymentId, status],
)).rows[0];

// =====================================================================
//  1) A MELLÉK-MŰVELETEK KIESÉSE NEM AKASZTHATJA MEG A FIZETÉST
// =====================================================================
describe('A fizetés akkor is rögzül, ha a körülötte lévő lépés elhasal', () => {
  it('a SZÁMLA-kiállítás hibája nem buktatja el a webhookot', async () => {
    const { job, paymentId } = await fizetesreVaroFuvar();
    const injekcio = dbHibaMintara(/INSERT INTO invoices/i);

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    expect(
      injekcio.talalat,
      'A számlázási lépés meg sem próbált futni — a teszt így semmit nem mér. '
      + '(Ha a hívás helye megváltozott, a mintát is frissíteni kell.)',
    ).toBeGreaterThan(0);
    expect(
      res.status,
      'A SZÁMLÁZÁS ELBUKÁSA MEGBUKTATTA A FIZETÉST. A PSP 5xx-re újraküld, '
      + 'a feladó pénze viszont már levonva — közben a kontakt nem nyílik meg, '
      + 'holott azt vette meg. A számla utólag kézzel pótolható, a fizetés nem.',
    ).toBeLessThan(400);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a fizetés nem rögzült, pedig csak a számla bukott el').toBeTruthy();
    const { rows: sorok } = await db.query(
      "SELECT status FROM escrow_transactions WHERE job_id = $1", [job.id],
    );
    expect(sorok[0].status, 'a díj-sor nem szabadult fel').toBe('released');
    const esemeny = await dijEsemeny(paymentId);
    expect(
      esemeny && esemeny.processed,
      'a fizetési napló nem jelölte feldolgozottnak — a következő webhook '
      + 'újra végigfutna az egész könyvelésen',
    ).toBe(true);
  });

  it('a fizetési NAPLÓ írásának hibája sem buktatja el a webhookot', async () => {
    const { job, paymentId } = await fizetesreVaroFuvar();
    const injekcio = dbHibaMintara(/INSERT INTO payment_events/i);

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    expect(injekcio.talalat, 'a napló-írás meg sem történt — a teszt nem mér semmit').toBeGreaterThan(0);
    expect(
      res.status,
      'A NAPLÓZÁS HIBÁJA 5xx-et okozott. A napló admin-kényelmi funkció; a '
      + 'fizetés maga a pénz. Fordított fontossági sorrend lenne, ha a napló '
      + 'megbuktatná a könyvelést.',
    ).toBeLessThan(400);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a fizetés nem rögzült, pedig csak a naplózás bukott el').toBeTruthy();
  });

  it('az ÉRTESÍTÉS-küldés hibája sem buktatja el a webhookot', async () => {
    // ⚠️ MÉLYSÉGI VÉDELEM: két réteg őrzi (a `createNotification` saját
    // try/catch-e és az itteni `.catch(() => {})`). Lemérve: bármelyik
    // egyedüli eltávolítása mellett a teszt HELYESEN zöld marad, mert a
    // viselkedés nem romlik el — mindkettőé mellett pirosra vált.
    const { job, paymentId } = await fizetesreVaroFuvar();
    const injekcio = dbHibaMintara(/INSERT INTO notifications/i);

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    expect(injekcio.talalat, 'értesítés-írás meg sem történt — a teszt nem mér semmit').toBeGreaterThan(0);
    expect(
      res.status,
      'Az „Indulhat a fuvar!" értesítés elbukása 5xx-et okozott. A PSP erre '
      + 'újraküld, a fizetés viszont már könyvelve — a dupla feldolgozás '
      + 'kockázata egy in-app buborék miatt.',
    ).toBeLessThan(400);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a fizetés nem rögzült, pedig csak az értesítés bukott el').toBeTruthy();
  });

  it('a díj-visszaigazoló E-MAIL hibája nem hagy kezeletlen Promise-elutasítást', async () => {
    // ⚠️ SZÁNDÉKOSAN NEM `vi.spyOn(...).mockRejectedValue(...)`: a vitest-spy
    // maga IS feliratkozik a visszaadott ígéretre (`mock.settledResults`), és
    // ezzel „kezeltté" teszi az elutasítást. Egy spy-jal írt változat tehát
    // AKKOR IS ZÖLD MARAD, ha a termékkódból kiveszik a `.catch()`-et —
    // lemérve. Ezért nyers, kézi cserét használunk.
    const emailSzolg = require('../src/services/email');
    const eredetiKuldes = emailSzolg.sendFeeConfirmationEmail;
    let hivasok = 0;
    emailSzolg.sendFeeConfirmationEmail = () => {
      hivasok += 1;
      return Promise.reject(new Error('Resend 500'));
    };

    const elutasitasok = [];
    const figyelo = (ok) => elutasitasok.push(String(ok && ok.message));
    process.on('unhandledRejection', figyelo);

    const { job, paymentId } = await fizetesreVaroFuvar();
    try {
      const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
      expect(res.status).toBeLessThan(400);
      // A levél `setImmediate`-ben megy — meg kell várni a mikro/makrotaszkot.
      await new Promise((r) => { setTimeout(r, 80); });
    } finally {
      process.off('unhandledRejection', figyelo);
      emailSzolg.sendFeeConfirmationEmail = eredetiKuldes;
    }

    expect(
      hivasok,
      'A 45/2014. 18. § szerinti díj-visszaigazoló levél EL SEM INDULT — '
      + 'tartós adathordozós visszaigazolás nélkül a fizetés jogilag hiányos.',
    ).toBeGreaterThan(0);
    expect(
      elutasitasok,
      'A LEVÉLKÜLDÉS HIBÁJA KEZELETLEN PROMISE-ELUTASÍTÁS LETT. A Node ezt '
      + 'alapértelmezetten a FOLYAMAT LEÁLLÍTÁSÁVAL bünteti — egy Resend-kiesés '
      + 'így az egész backendet újraindítaná, méghozzá közvetlenül a '
      + 'díj-könyvelés után. (A hívás `setImmediate`-ben fut, tehát a '
      + 'kérés-kezelő try/catch-e NEM fogja meg.)',
    ).toEqual([]);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a fizetés nem rögzült, pedig csak a levél bukott el').toBeTruthy();
  });
});

// =====================================================================
//  2) A FOGLALÁSI ÁG megszakadt/egyéb státuszai (a hiányzó szimmetria)
// =====================================================================
describe('Megszakadt fizetés a FOGLALÁSI ágon', () => {
  for (const statusz of ['Canceled', 'Expired']) {
    it(`„${statusz}" → a foglalás fizetetlen marad, a feladó értesítést kap`, async () => {
      const { felado, booking, paymentId } = await fizetesreVaroFoglalas();

      const res = await webhook({ PaymentId: paymentId, Status: statusz });
      expect(res.status).toBeLessThan(400);

      const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [booking.id]);
      expect(
        rows[0].paid_at,
        `A(z) „${statusz}" (tehát SIKERTELEN) fizetés fizetetté tette a `
        + 'foglalást — a kontakt díj nélkül felfedődne.',
      ).toBeNull();

      const { rows: ert } = await db.query(
        `SELECT body FROM notifications
          WHERE user_id = $1 AND type = 'payment_failed' ORDER BY created_at DESC LIMIT 1`,
        [felado.id],
      );
      expect(
        ert[0],
        'A feladó SEMMILYEN visszajelzést nem kapott a megszakadt fizetésről. '
        + 'A járat-foglalás így némán elakad: azt hiszi, fizetett.',
      ).toBeTruthy();

      const esemeny = await dijEsemeny(paymentId, statusz);
      expect(esemeny, 'a sikertelen fizetés nyom nélkül maradt a naplóban').toBeTruthy();
      expect(
        esemeny.summary,
        'A napló összefoglalója a FUVAR CÍMÉT tartalmazza. Az felhasználó által '
        + 'írt szabad szöveg — a fuvar anonimizálásakor épp ezért ürítjük ki, '
        + 'itt viszont túlélné a saját retencióját.',
      ).not.toContain('Teszt útvonal');
    });
  }

  it('köztes státusz („Prepared") a foglalási ágon is csak naplózódik', async () => {
    const { booking, paymentId } = await fizetesreVaroFoglalas();

    const res = await webhook({ PaymentId: paymentId, Status: 'Prepared' });
    expect(res.status).toBeLessThan(400);

    const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].paid_at, 'egy KÖZTES fizetési állapot már fizetettnek könyvelte a foglalást').toBeNull();
    const esemeny = await dijEsemeny(paymentId, 'Prepared');
    expect(
      esemeny && esemeny.booking_id,
      'a köztes állapot naplósora nem kötődik a foglaláshoz — az admin nem '
      + 'tudná visszakeresni, melyik ügyletnél akadt el a fizetés',
    ).toBe(booking.id);
  });
});

// =====================================================================
//  3) SZÁLLÍTÓ NÉLKÜLI FUVAR kifizetése
// =====================================================================
describe('Szállító nélküli fuvar díja', () => {
  it('a szállító-mező üressége nem akasztja meg a fizetést, és nincs kinek szóló értesítés', async () => {
    const { job, paymentId, felado } = await fizetesreVaroFuvar({ carrier: false });

    const elotte = await db.query('SELECT COUNT(*)::int AS n FROM notifications');
    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });

    expect(
      res.status,
      'Egy szállító NÉLKÜLI fuvar díj-fizetése elszállt. Ez valós állapot: a '
      + 'szállító lemondása után a `carrier_id` kiürül (SET NULL), a fizetés '
      + 'viszont befuthat közben.',
    ).toBeLessThan(400);

    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).toBeTruthy();

    // ⚠️ CSAK EZ A FUVAR — a globális darabszám a fájl korábbi tesztjeinek
    // értesítéseit is beszámítaná, és a teszt hamisan zöld/piros lenne.
    const { rows: ujak } = await db.query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE type = 'job_paid' AND link LIKE '%' || $1 || '%'`,
      [job.id],
    );
    expect(
      ujak[0].n,
      'Szállító nélkül is kiment „Indulhat a fuvar!" értesítés — gazdátlan '
      + '(vagy rossz címzettnek szóló) sor keletkezett a notifications táblában.',
    ).toBe(0);

    // A feladó viszont megkapja a díj-visszaigazolást (45/2014. 18. §).
    const { rows: szamlaSor } = await db.query(
      'SELECT gross_amount FROM invoices WHERE job_id = $1', [job.id],
    );
    expect(
      szamlaSor[0],
      'szállító nélkül a számla is elmaradt — a díjat a FELADÓ fizeti, a '
      + 'számlázási kötelezettség tőle független',
    ).toBeTruthy();
    void elotte; void felado;
  });
});

// =====================================================================
//  4) ESCROW + PAYOUT végpontok — IDOR és üres esetek
// =====================================================================
describe('GET /jobs/:id/escrow', () => {
  it('nem létező fuvarra 404, kívülállónak 403, a félnek 200', async () => {
    const { felado, szallito, job } = await fizetesreVaroFuvar();
    const kivulallo = await createUser({ role: 'shipper' });

    const nincs = await request(app).get(`/jobs/${crypto.randomUUID()}/escrow`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(nincs.status, 'ismeretlen fuvar-azonosítóra nem 404 jött').toBe(404);

    const idegen = await request(app).get(`/jobs/${job.id}/escrow`)
      .set('Authorization', `Bearer ${kivulallo.token}`);
    expect(
      idegen.status,
      'EGY KÍVÜLÁLLÓ LEKÉRDEZHETTE A FUVAR PÉNZÜGYI SORÁT (összeg, '
      + 'fizetés-azonosító, a PSP átirányító URL-je). Az utóbbival a fizetési '
      + 'oldal is elérhető lenne.',
    ).toBe(403);

    for (const [nev, tok] of [['feladó', felado.token], ['szállító', szallito.token]]) {
      const jo = await request(app).get(`/jobs/${job.id}/escrow`)
        .set('Authorization', `Bearer ${tok}`);
      expect(jo.status, `a(z) ${nev} nem érte el a saját fuvarja pénzügyi sorát`).toBe(200);
      expect(jo.body.status).toBe('held');
    }
  });

  it('díj-sor nélküli fuvarnál null-t ad (nem 404-et és nem összeomlást)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', paid: false });

    const res = await request(app).get(`/jobs/${job.id}/escrow`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(res.status).toBe(200);
    expect(
      res.body,
      'A még ki nem fizetett fuvar pénzügyi lekérdezése nem üres választ adott '
      + '— a felület hibát mutatna minden friss fuvarnál.',
    ).toBeNull();
  });
});

describe('GET /payments/payout-status/:jobId', () => {
  it('díj-sor nélkül null, lezáratlan fuvarnál blokkolt, kézbesítés után kifizethető', async () => {
    const uresFelado = await createUser({ role: 'shipper' });
    const uresJob = await createJob({ shipperId: uresFelado.id, status: 'bidding' });
    const ures = await request(app).get(`/payments/payout-status/${uresJob.id}`)
      .set('Authorization', `Bearer ${uresFelado.token}`);
    expect(ures.status).toBe(200);
    expect(ures.body, 'díj-sor nélküli fuvarnál nem null jött vissza').toBeNull();

    const { felado, job } = await fizetesreVaroFuvar();
    const fut = await request(app).get(`/payments/payout-status/${job.id}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(fut.body.payout_ready, 'egy még FUTÓ fuvart kifizethetőnek jelöltünk').toBe(false);
    expect(
      fut.body.payout_blocked_reason,
      'a blokkolás oka üres — a felhasználó nem tudja, mire vár',
    ).toBeTruthy();
    expect(fut.body.cash_payment, 'a készpénzes modell jelzése hiányzik a válaszból').toBe(true);

    await db.query("UPDATE jobs SET status = 'delivered', delivered_at = NOW() WHERE id = $1", [job.id]);
    const kesz = await request(app).get(`/payments/payout-status/${job.id}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(kesz.body.payout_ready, 'a KÉZBESÍTETT fuvar sem lett kifizethető').toBe(true);
    expect(kesz.body.payout_blocked_reason).toBeNull();
  });

  it('nem létező fuvarra 404, kívülállónak 403', async () => {
    const { job } = await fizetesreVaroFuvar();
    const kivulallo = await createUser({ role: 'shipper' });

    const nincs = await request(app).get(`/payments/payout-status/${crypto.randomUUID()}`)
      .set('Authorization', `Bearer ${kivulallo.token}`);
    expect(nincs.status).toBe(404);

    const idegen = await request(app).get(`/payments/payout-status/${job.id}`)
      .set('Authorization', `Bearer ${kivulallo.token}`);
    expect(
      idegen.status,
      'Kívülálló látta MÁS fuvarjának pénzügyi állapotát (összeg, felszabadítás '
      + 'ideje, kézbesítés ténye).',
    ).toBe(403);
  });
});

// =====================================================================
//  5) ADMIN FIZETÉSI NAPLÓ — jogosultság és lapozás
// =====================================================================
describe('GET /payments/admin/log', () => {
  it('nem-admin nem láthatja a teljes pénzügyi naplót', async () => {
    const felado = await createUser({ role: 'shipper' });
    const res = await request(app).get('/payments/admin/log')
      .set('Authorization', `Bearer ${felado.token}`);
    expect(
      res.status,
      'EGY SIMA FELHASZNÁLÓ LEKÉRTE A TELJES FIZETÉSI NAPLÓT — benne MINDEN '
      + 'ügylet összegével, a feladó- és szállító-azonosítókkal, a fuvarok '
      + 'felhasználó által írt címeivel.',
    ).toBe(403);
  });

  it('adminnak megy, és a lapozási paramétereket betartja (szemétre alapértéket ad)', async () => {
    const admin = await createUser({ role: 'admin' });
    // Három napló-sor gyártása három külön fizetésből
    const azonositok = [];
    for (let i = 0; i < 3; i += 1) {
      const { paymentId } = await fizetesreVaroFuvar();
      await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
      azonositok.push(paymentId);
    }

    const egy = await request(app).get('/payments/admin/log?limit=1')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(egy.status).toBe(200);
    expect(egy.body, 'a limit paramétert figyelmen kívül hagytuk').toHaveLength(1);

    const masodik = await request(app).get('/payments/admin/log?limit=1&offset=1')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(
      masodik.body[0].id,
      'az offset nem lapozott — az admin felület a második oldalon ugyanazt '
      + 'a sort mutatná',
    ).not.toBe(egy.body[0].id);

    // ⚠️⚠️ TERMÉKKÓD-HIBA, SZÁNDÉKOSAN NEM JAVÍTVA (2026-08-12, jelentve):
    // a `?offset=-5` (és a `?limit=-5`) 500 „Szerverhiba"-t ad, mert a
    // `Number(offset) || 0` a NEGATÍV számot truthy-ként átengedi, a Postgres
    // pedig „OFFSET must not be negative" hibát dob (payments.js:351). Ez
    // sérti a rendszer SZ1 szabályát („egyetlen végpont sem adhat 500-at
    // rossz inputra"), és a hülyebiztos-mátrix nem fogja meg, mert az csak a
    // path-paramétereket és a törzset mutálja, a QUERY-t nem.
    // Amit itt őrzünk: a NEM-SZÁM szemét legalább alapértékre esik vissza.
    for (const q of ['limit=abc', 'limit=&offset=', 'offset=abc', 'limit=0']) {
      const szemet = await request(app).get(`/payments/admin/log?${q}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(
        szemet.status,
        `A(z) „?${q}" lapozó-paraméter 500-at okozott — a Postgres a NaN-t `
        + 'nem érti, tehát egy elgépelt URL összeomlasztaná az admin naplót.',
      ).toBe(200);
      expect(
        szemet.body.length,
        `A(z) „?${q}" paraméternél ÜRES lista jött vissza az alapértelmezett `
        + '50 helyett — az admin azt hinné, nincs egyetlen fizetés sem.',
      ).toBeGreaterThan(0);
    }

    const plafon = await request(app).get('/payments/admin/log?limit=99999')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(
      plafon.body.length,
      'A 200-as lekérdezési plafon nem él: egy `?limit=99999` kéréssel a teljes '
      + 'pénzügyi napló egyben letölthető lenne.',
    ).toBeLessThanOrEqual(200);
    void azonositok;
  });
});

// =====================================================================
//  6) ÁFA-KEZELÉS: EU-s céges feladó → fordított adózás a naplóban
// =====================================================================
describe('EU-s céges feladó díja', () => {
  it('érvényes közösségi adószámnál a napló FORDÍTOTT ADÓZÁST könyvel', async () => {
    const { job, felado, paymentId } = await fizetesreVaroFuvar();
    await db.query(
      `UPDATE users SET billing_country = 'DE', tax_id = 'DE123456789',
              company_name = 'Teszt Spedition GmbH'
        WHERE id = $1`,
      [felado.id],
    );

    // A VIES-ellenőrzés HÁLÓZATI hívás — mockoljuk. A mock szándékosan
    // ELHASAL minden nem-VIES URL-en, hogy egy elcsúszott implementáció ne
    // tudjon észrevétlenül valódi kérést kiküldeni a teszt alól.
    const viesHivasok = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const cim = String(url);
      if (!cim.includes('ec.europa.eu')) throw new Error(`tiltott hálózati hívás a tesztben: ${cim}`);
      viesHivasok.push(cim);
      return { ok: true, json: async () => ({ isValid: true, name: 'Teszt Spedition GmbH' }) };
    });

    const res = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(res.status).toBeLessThan(400);
    expect(viesHivasok.length, 'a közösségi adószámot meg sem próbáltuk ellenőrizni').toBeGreaterThan(0);

    const esemeny = await dijEsemeny(paymentId);
    expect(
      esemeny.is_reverse_charge,
      'AZ EU-S CÉGES ÜGYLETET BELFÖLDI ÁFÁS TÉTELKÉNT KÖNYVELTÜK. A NAV-nak '
      + 'küldött számlaadat és a bevallás is hibás lenne (2006/112/EK 196. cikk).',
    ).toBe(true);
    expect(Number(esemeny.vat_rate), 'fordított adózásnál nem nulla ÁFA-kulcs került a naplóba').toBe(0);
    expect(
      esemeny.summary,
      'a napló összefoglalója százalékos ÁFÁ-t ír fordított adózás helyett — '
      + 'az admin téves adatot lát a bevételi kimutatásban',
    ).toContain('ford. adózás');
    void job;
  });
});
