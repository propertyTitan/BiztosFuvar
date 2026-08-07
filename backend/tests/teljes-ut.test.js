// =====================================================================
//  TELJES ÚT — életciklus-mátrix
//
//  Cél (user-kérés): a teljes felhasználói utat fedjük le, és szűrjük ki
//  azokat a hibákat is, amik „amúgy elképzelhetetlenek". A futásidő nem
//  számít — a teljesség igen.
//
//  Amit a többi suite NEM fed:
//    - a hülyebiztos-matrix EGY kérést vizsgál (rossz input, rossz jog),
//    - a boldog utat az E2E járja végig,
//    - de azt EGYIK SEM nézi, hogy egy fuvar ÉLETÚTJÁNAK MINDEN PONTJÁN
//      ki mit tehet. Márpedig a valódi hibák itt laknak: „mi történik, ha
//      a szállító a lemondott fuvarra tölt fel felvételi fotót?", „ha a
//      feladó a kézbesítés után újra fizet?", „ha valaki egy MÁSIK fuvar
//      átvételi kódjával zárja le ezt?".
//
//  Felépítés:
//    1. A boldog ösvény végigjárása, minden állomáson invariáns-ellenőrzéssel
//    2. ÁLLAPOT × SZEREPLŐ × MŰVELET teljes mátrix (a tiltottak MIND buknak)
//    3. Kereszt-szennyeződés (másik fuvar kódja / azonosítója)
//    4. Megszakadt és újrakezdett utak
//
//  ⚠️ Minden mátrix-cella SAJÁT, FRISS fuvart kap. Így egyetlen sikeres
//  művelet sem hamisíthatja meg a következő cella kiindulási állapotát, és
//  a teszt sorrend-független.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, TINY_PNG } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

// ── Szereplők ─────────────────────────────────────────────────────────
//  felado        – a fuvar gazdája
//  szallito      – a kijelölt (vagy licitáló) szállító
//  masikSzallito – szintén licitált, de nem őt választották
//  idegen        – semmi köze a fuvarhoz
//  admin         – platform-adminisztrátor
const SZEREPLOK = ['felado', 'szallito', 'masikSzallito', 'idegen', 'admin'];

/**
 * Egy teljes forgatókönyv felépítése a kért állapotban.
 * Mindig ugyanaz a szereplő-készlet, csak a fuvar állapota más.
 */
async function forgatokonyv(allapot) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const masikSzallito = await createUser({ role: 'carrier' });
  const idegen = await createUser({ role: 'carrier' });
  const admin = await createUser({ role: 'admin' });

  const kijeloltSzallito = allapot === 'bidding' ? null : szallito.id;
  const fizetve = ['accepted_fizetett', 'in_progress', 'delivered', 'disputed'].includes(allapot);
  const jobStatus = {
    bidding: 'bidding',
    accepted_fizetetlen: 'accepted',
    accepted_fizetett: 'accepted',
    in_progress: 'in_progress',
    delivered: 'delivered',
    cancelled: 'cancelled',
    disputed: 'disputed',
  }[allapot];

  const job = await createJob({
    shipperId: felado.id,
    carrierId: kijeloltSzallito,
    status: jobStatus,
    paid: fizetve,
  });

  // Mindkét szállító licitált — így az „elfogad"/„ellenajánlat" művelet
  // minden állapotban értelmezhető (és tiltandó, ahol nem szabad).
  const { rows: bidRows } = await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
     VALUES ($1, $2, 14000, $4), ($1, $3, 15500, 'pending')
     RETURNING id, carrier_id`,
    [job.id, szallito.id, masikSzallito.id, allapot === 'bidding' ? 'pending' : 'accepted'],
  );
  const sajatBid = bidRows.find((b) => b.carrier_id === szallito.id);
  const masikBid = bidRows.find((b) => b.carrier_id === masikSzallito.id);

  // A 'disputed' állapothoz VALÓDI vita-sor is kell. Enélkül a forgatókönyv
  // hűtlen lenne: a duplázat-ellenőrzésnek nem lenne mit találnia, és a
  // teszt azt hinné, hogy második vitát is lehet nyitni.
  if (allapot === 'disputed') {
    await db.query(
      `INSERT INTO disputes (job_id, opened_by, against_user, description)
       VALUES ($1, $2, $3, 'Nyitott vita a teszthez')`,
      [job.id, felado.id, szallito.id],
    );
  }

  return {
    allapot, job, felado, szallito, masikSzallito, idegen, admin, sajatBid, masikBid,
    token: { felado: felado.token, szallito: szallito.token,
             masikSzallito: masikSzallito.token, idegen: idegen.token, admin: admin.token },
  };
}

// ── Műveletek ─────────────────────────────────────────────────────────
// Mindegyik EGY kérést küld az adott szereplő nevében.
const MUVELETEK = {
  'licitál': (c, t) => request(app).post(`/jobs/${c.job.id}/bids`)
    .set('Authorization', `Bearer ${t}`)
    .send({ amount_huf: 13000, return_policy: 'included' }),

  'ajánlatot elfogad': (c, t) => request(app).post(`/bids/${c.masikBid.id}/accept`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'ellenajánlatot tesz': (c, t) => request(app).post(`/bids/${c.masikBid.id}/counter`)
    .set('Authorization', `Bearer ${t}`).send({ amount: 12000 }),

  'díjat fizet': (c, t) => request(app).post(`/jobs/${c.job.id}/pay`)
    .set('Authorization', `Bearer ${t}`).send({ consent: true }),

  'lemond': (c, t) => request(app).post(`/jobs/${c.job.id}/cancel`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'szállítót cserél': (c, t) => request(app).post(`/jobs/${c.job.id}/reopen`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'felvételi fotót tölt': (c, t) => request(app).post(`/jobs/${c.job.id}/photos`)
    .set('Authorization', `Bearer ${t}`)
    .field('kind', 'pickup')
    .attach('file', TINY_PNG, 'pickup.png'),

  'kézbesít (kóddal)': (c, t) => request(app).post(`/jobs/${c.job.id}/photos`)
    .set('Authorization', `Bearer ${t}`)
    .field('kind', 'dropoff')
    .field('delivery_code', '111222')
    .attach('file', TINY_PNG, 'dropoff.png'),

  'értékel': (c, t) => request(app).post(`/jobs/${c.job.id}/reviews`)
    .set('Authorization', `Bearer ${t}`).send({ rating: 5, comment: 'rendben' }),

  'vitát nyit': (c, t) => request(app).post('/disputes')
    .set('Authorization', `Bearer ${t}`)
    .send({ job_id: c.job.id, reason: 'damaged', description: 'Sérült a csomag.' }),

  'üzenetet küld': (c, t) => request(app).post('/messages')
    .set('Authorization', `Bearer ${t}`).send({ job_id: c.job.id, body: 'Szia!' }),

  'pozíciót küld': (c, t) => request(app).post(`/jobs/${c.job.id}/location`)
    .set('Authorization', `Bearer ${t}`).send({ lat: 47.5, lng: 19.05 }),
};

/**
 * ELVÁRÁS-TÁBLA: állapotonként melyik művelet KINEK sikerülhet.
 * Aki nincs felsorolva, annak KÖTELEZŐEN el kell buknia (4xx).
 * Ez a tábla egyben a rendszer írott szabálykönyve is.
 */
const SZABALYOK = {
  bidding: {
    // A szerepkörök NEM kizárólagosak: bárki lehet feladó és szállító is,
    // az admin is. Ezért mindenki licitálhat, aki még nem tette meg.
    'licitál': ['idegen', 'admin'],
    'ajánlatot elfogad': ['felado'],
    // Vinted-stílusú alku: oda-vissza megy. A feladó ellenajánlatot tesz a
    // licitre, a licit GAZDÁJA pedig visszaajánlhat.
    'ellenajánlatot tesz': ['felado', 'masikSzallito'],
    'díjat fizet': [],                          // nincs elfogadott ajánlat
    'lemond': ['felado'],
    'szállítót cserél': [],                     // nincs kit cserélni
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],
    'értékel': [],
    'vitát nyit': ['felado'],
    'üzenetet küld': ['felado'],
    'pozíciót küld': [],
  },
  accepted_fizetetlen: {
    'licitál': [],                              // már van kijelölt szállító
    'ajánlatot elfogad': [],                    // már elfogadtak egyet
    'ellenajánlatot tesz': [],
    'díjat fizet': ['felado'],
    'lemond': ['felado', 'szallito'],
    'szállítót cserél': ['felado'],
    'felvételi fotót tölt': [],                 // fizetés előtt nem indulhat
    'kézbesít (kóddal)': [],
    'értékel': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
    'pozíciót küld': ['szallito'],
  },
  accepted_fizetett: {
    'licitál': [],
    'ajánlatot elfogad': [],
    'ellenajánlatot tesz': [],
    'díjat fizet': [],                          // már fizetve — nincs dupla terhelés
    'lemond': ['felado', 'szallito'],
    'szállítót cserél': ['felado'],
    'felvételi fotót tölt': ['szallito'],
    'kézbesít (kóddal)': [],                    // felvétel nélkül nincs kézbesítés
    'értékel': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
    'pozíciót küld': ['szallito'],
  },
  in_progress: {
    'licitál': [],
    'ajánlatot elfogad': [],
    'ellenajánlatot tesz': [],
    'díjat fizet': [],
    // Úton lévő fuvart SZÁNDÉKOSAN nem lehet lemondani — a rendszer vitára
    // irányít („Vitás esetben nyiss egy reklamációt").
    'lemond': [],
    'szállítót cserél': [],                     // már úton van
    'felvételi fotót tölt': ['szallito'],       // pótolható (több fotó)
    'kézbesít (kóddal)': ['szallito'],
    'értékel': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
    'pozíciót küld': ['szallito'],
  },
  delivered: {
    'licitál': [],
    'ajánlatot elfogad': [],
    'ellenajánlatot tesz': [],
    'díjat fizet': [],
    'lemond': [],                               // kézbesítettet nem lehet lemondani
    'szállítót cserél': [],
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],                    // nincs kétszeri kézbesítés
    'értékel': ['felado', 'szallito'],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
    'pozíciót küld': [],                        // lezárt fuvarhoz nincs helyadat
  },
  cancelled: {
    'licitál': [],
    'ajánlatot elfogad': [],
    'ellenajánlatot tesz': [],
    'díjat fizet': [],
    'lemond': [],                               // már lemondva
    'szállítót cserél': [],
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],
    'értékel': [],
    'vitát nyit': ['felado', 'szallito'],       // lemondás után is lehet vita
    'üzenetet küld': ['felado', 'szallito'],
    'pozíciót küld': [],
  },
  disputed: {
    'licitál': [],
    'ajánlatot elfogad': [],
    'ellenajánlatot tesz': [],
    'díjat fizet': [],
    // Vita alatt NEM lehet lemondással kimenteni a fuvart a vita alól —
    // előbb az ügyintézést kell lezárni. Ez a szigorítás azért biztonságos,
    // mert a vita már FELOLDHATÓ: a lezárása visszaállítja a korábbi
    // státuszt (053-as migráció).
    'lemond': [],
    'szállítót cserél': [],
    // Vita alatt fotót feltölteni SZÁNDÉKOSAN lehet: ez bizonyíték-gyűjtés.
    // A státuszt nem billenti el (a tranzíció csak 'accepted'-ből indul).
    'felvételi fotót tölt': ['szallito'],
    'kézbesít (kóddal)': [],                    // felvétel nélkül nem zárható
    'értékel': [],
    'vitát nyit': [],                           // nincs második nyitott vita
    'üzenetet küld': ['felado', 'szallito'],
    // A vita ÚT KÖZBEN is nyitható (in_progress → disputed), a szállító
    // pedig ilyenkor még megy — a helyadat jogos. A lezárt (delivered /
    // completed / cancelled) állapotoktól ez különbözik: azok végállapotok.
    'pozíciót küld': ['szallito'],
  },
};

// =====================================================================
//  1. A BOLDOG ÖSVÉNY — végig, minden állomáson invariáns-ellenőrzéssel
// =====================================================================
describe('1. A teljes út végigjárása', () => {
  it('feladás → ajánlat → elfogadás → díjfizetés → felvétel → kézbesítés → értékelés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    // — Feladás —
    const feladas = await request(app).post('/jobs/')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({
        title: 'Teljes út teszt',
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
        dropoff_address: 'Szeged, Kossuth L. sgt. 1.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
        weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
        suggested_price_huf: 15000,
        recipient_name: 'Kiss Anna', recipient_phone: '+36301112233',
      });
    expect(feladas.status, JSON.stringify(feladas.body)).toBe(201);
    const jobId = feladas.body.id;

    // INVARIÁNS: a feladó a CÍMZETT kódját sosem kapja meg
    expect(feladas.body.delivery_code).toBeUndefined();

    // — Ajánlat —
    const licit = await request(app).post(`/jobs/${jobId}/bids`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ amount_huf: 14000, return_policy: 'included' });
    expect(licit.status, JSON.stringify(licit.body)).toBe(201);

    // INVARIÁNS: fizetés előtt NINCS kontakt egyik félnek sem
    for (const [nev, tok] of [['feladó', felado.token], ['szállító', szallito.token]]) {
      const r = await request(app).get(`/jobs/${jobId}`).set('Authorization', `Bearer ${tok}`);
      expect(r.body.contact, `KONTAKT-SZIVÁRGÁS a díj kifizetése ELŐTT (${nev})`).toBeUndefined();
    }

    // — Elfogadás —
    const elfogad = await request(app).post(`/bids/${licit.body.id}/accept`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(elfogad.status, JSON.stringify(elfogad.body)).toBeLessThan(300);

    // INVARIÁNS: elfogadás UTÁN, fizetés ELŐTT sincs kontakt
    const elfogadasUtan = await request(app).get(`/jobs/${jobId}`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(
      elfogadasUtan.body.contact,
      'KONTAKT-SZIVÁRGÁS: elfogadás után, de fizetés előtt látszott az elérhetőség',
    ).toBeUndefined();

    // INVARIÁNS: felvétel nem indulhat fizetetlen fuvaron
    const koraiFelvetel = await request(app).post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'pickup').attach('file', TINY_PNG, 'p.png');
    expect(
      koraiFelvetel.status,
      'A szállító fizetetlen fuvaron elindíthatta a felvételt!',
    ).toBeGreaterThanOrEqual(400);

    // — Díjfizetés (teszt-módban a confirm-payment zárja le) —
    const fizetes = await request(app).post(`/jobs/${jobId}/pay`)
      .set('Authorization', `Bearer ${felado.token}`).send({ consent: true });
    expect(fizetes.status, JSON.stringify(fizetes.body)).toBeLessThan(300);
    await db.query('UPDATE jobs SET paid_at = NOW() WHERE id = $1', [jobId]);

    // INVARIÁNS: fizetés UTÁN mindkét fél látja a másik elérhetőségét
    for (const [nev, tok] of [['feladó', felado.token], ['szállító', szallito.token]]) {
      const r = await request(app).get(`/jobs/${jobId}`).set('Authorization', `Bearer ${tok}`);
      expect(r.body.contact, `A díj kifizetése UTÁN sem látszik a kontakt (${nev})`).toBeTruthy();
    }

    // — Felvétel —
    const felvetel = await request(app).post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'pickup').attach('file', TINY_PNG, 'p.png');
    expect(felvetel.status, JSON.stringify(felvetel.body)).toBeLessThan(300);
    const { rows: utanaRows } = await db.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
    expect(utanaRows[0].status).toBe('in_progress');

    // INVARIÁNS: rossz kóddal nem lehet lezárni
    const rosszKod = await request(app).post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'dropoff').field('delivery_code', '000000')
      .attach('file', TINY_PNG, 'd.png');
    expect(rosszKod.status, 'Rossz kóddal lezárult a fuvar!').toBeGreaterThanOrEqual(400);

    // — Kézbesítés a HELYES kóddal —
    const { rows: kodRows } = await db.query('SELECT delivery_code FROM jobs WHERE id = $1', [jobId]);
    const kezbesites = await request(app).post(`/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'dropoff').field('delivery_code', kodRows[0].delivery_code)
      .attach('file', TINY_PNG, 'd.png');
    expect(kezbesites.status, JSON.stringify(kezbesites.body)).toBeLessThan(300);

    const { rows: vegRows } = await db.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
    expect(vegRows[0].status).toBe('delivered');

    // — Értékelés —
    const ertekeles = await request(app).post(`/jobs/${jobId}/reviews`)
      .set('Authorization', `Bearer ${felado.token}`).send({ rating: 5, comment: 'Minden rendben' });
    expect(ertekeles.status, JSON.stringify(ertekeles.body)).toBeLessThan(300);

    // INVARIÁNS: a teljes úton PONTOSAN EGY díj-sor keletkezett
    const { rows: dijRows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM escrow_transactions WHERE job_id = $1', [jobId],
    );
    expect(dijRows[0].n, `${dijRows[0].n} díj-sor egy fuvarra — dupla terhelés!`).toBeLessThanOrEqual(1);
  });
});

// =====================================================================
//  2. ÁLLAPOT × SZEREPLŐ × MŰVELET — a teljes mátrix
// =====================================================================
describe('2. Az út minden állomásán: ki mit tehet', () => {
  for (const allapot of Object.keys(SZABALYOK)) {
    describe(`állapot: ${allapot}`, () => {
      for (const muvelet of Object.keys(MUVELETEK)) {
        const engedettek = SZABALYOK[allapot][muvelet];

        it(`${muvelet} — csak [${engedettek.join(', ') || 'senki'}] csinálhatja`, async () => {
          const hibak = [];

          for (const szereplo of SZEREPLOK) {
            // Minden cellához FRISS fuvar: egy sikeres művelet ne
            // hamisítsa meg a következő szereplő kiindulási állapotát.
            const c = await forgatokonyv(allapot);
            __resetRateLimitsForTests();

            let res;
            try {
              res = await MUVELETEK[muvelet](c, c.token[szereplo]);
            } catch (err) {
              hibak.push(`${szereplo}: a kérés elszállt — ${err.message}`);
              continue;
            }

            // SOHA nem omolhat össze, akármit is próbál
            if (res.status >= 500) {
              hibak.push(
                `${szereplo}: ${res.status} SZERVERHIBA — ${JSON.stringify(res.body).slice(0, 160)}`,
              );
              continue;
            }

            const sikerult = res.status < 400;
            const szabade = engedettek.includes(szereplo);

            if (szabade && !sikerult) {
              hibak.push(
                `${szereplo}: NEM sikerült, pedig szabadna (${res.status} — ${JSON.stringify(res.body).slice(0, 140)})`,
              );
            }
            if (!szabade && sikerult) {
              hibak.push(
                `${szereplo}: SIKERÜLT (${res.status}), pedig TILOS lenne ebben az állapotban!`,
              );
            }
          }

          expect(
            hibak,
            `„${muvelet}" a(z) ${allapot} állapotban:\n  ${hibak.join('\n  ')}`,
          ).toEqual([]);
        });
      }
    });
  }
});

// =====================================================================
//  2/b. A VITA ÉLETCIKLUSA — a 'disputed' nem egyirányú utca
// =====================================================================
describe('2/b. Vita: megnyitás, folytatás, lezárás', () => {
  /** Vita nyitása a fuvarra, majd lezárása adminként. */
  async function vitatLezar(jobId, admin) {
    const { rows } = await db.query('SELECT id FROM disputes WHERE job_id = $1', [jobId]);
    return request(app).patch(`/disputes/${rows[0].id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved_no_action', resolution_note: 'Nincs teendő.' });
  }

  it('a vita lezárása VISSZAÁLLÍTJA a fuvar korábbi státuszát', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, reason: 'damaged', description: 'Sérült.' });
    let { rows } = await db.query('SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('disputed');
    expect(rows[0].status_before_dispute, 'nem tettük el a vita előtti státuszt').toBe('in_progress');

    const lezaras = await vitatLezar(job.id, admin);
    expect(lezaras.status, JSON.stringify(lezaras.body)).toBeLessThan(400);

    ({ rows } = await db.query('SELECT status, status_before_dispute FROM jobs WHERE id = $1', [job.id]));
    expect(
      rows[0].status,
      'A vita lezárása után a fuvar BERAGADT „disputed"-ban — pedig vissza kellett volna állnia.',
    ).toBe('in_progress');
    expect(rows[0].status_before_dispute, 'a mentett státusz nem ürült ki').toBeNull();
  });

  it('kézbesített fuvarra nyitott vita lezárása után marad kézbesített', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, reason: 'damaged', description: 'Utólag derült ki.' });
    await vitatLezar(job.id, admin);

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('delivered');
  });

  it('vita alatt a szállító KÉZBESÍTHET — a vita nem ragasztja be a kapuban', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
      deliveryCode: '424242',
    });

    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, reason: 'late', description: 'Késik.' });

    const kezbesites = await request(app).post(`/jobs/${job.id}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'dropoff').field('delivery_code', '424242')
      .attach('file', TINY_PNG, 'd.png');
    expect(
      kezbesites.status,
      `A szállító nem tudott kézbesíteni nyitott vita mellett: ${JSON.stringify(kezbesites.body)}`,
    ).toBeLessThan(400);

    // A vita LÁTHATÓ marad — egy fotó nem tüntetheti el
    let { rows } = await db.query(
      'SELECT status, status_before_dispute, delivered_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'a kézbesítés némán eltüntette a vitát!').toBe('disputed');
    expect(rows[0].delivered_at).toBeTruthy();

    // …a lezárás után viszont a helyes végállapotba kerül
    await vitatLezar(job.id, admin);
    ({ rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]));
    expect(rows[0].status).toBe('delivered');
  });

  it('vita alatt nem lehet lemondással kimenekülni', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, reason: 'other', description: 'Valami baj van.' });

    const lemondas = await request(app).post(`/jobs/${job.id}/cancel`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(lemondas.status, 'Vita alatt le lehetett mondani a fuvart!').toBe(409);
    expect(lemondas.body.error).toMatch(/nyitott vita/i);
  });

  it('a foglalási ág ugyanígy viselkedik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const { booking } = await createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ booking_id: booking.id, reason: 'damaged', description: 'Sérült.' });
    let { rows } = await db.query(
      'SELECT status, status_before_dispute FROM route_bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('disputed');
    expect(rows[0].status_before_dispute).toBe('in_progress');

    const { rows: vita } = await db.query(
      'SELECT id FROM disputes WHERE booking_id = $1', [booking.id]);
    await request(app).patch(`/disputes/${vita[0].id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved_no_action', resolution_note: 'Rendezve.' });

    ({ rows } = await db.query('SELECT status FROM route_bookings WHERE id = $1', [booking.id]));
    expect(rows[0].status).toBe('in_progress');
  });

  it('a bizonyíték-zárolás a vita lezárása UTÁN is megmarad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    await request(app).post('/disputes').set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, reason: 'damaged', description: 'Sérült.' });
    await vitatLezar(job.id, admin);

    const { rows } = await db.query('SELECT photo_retention_hold FROM jobs WHERE id = $1', [job.id]);
    expect(
      rows[0].photo_retention_hold,
      'A vita lezárása feloldotta a bizonyíték-zárolást — a fotóknak 5 évig maradniuk kell.',
    ).toBe(true);
  });
});

// =====================================================================
//  3. KERESZT-SZENNYEZŐDÉS — a másik fuvar adatai
// =====================================================================
describe('3. Kereszt-szennyeződés: két fuvar nem folyhat egybe', () => {
  it('az EGYIK fuvar átvételi kódja nem zárja le a MÁSIKAT', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const jobA = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
      deliveryCode: '111111',
    });
    const jobB = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
      deliveryCode: '222222',
    });

    // A szállító mindkét fuvar kijelöltje — de A kódja B-t nem zárhatja le
    const res = await request(app).post(`/jobs/${jobB.id}/photos`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .field('kind', 'dropoff').field('delivery_code', '111111')
      .attach('file', TINY_PNG, 'd.png');

    expect(
      res.status,
      'A MÁSIK fuvar kódjával le lehetett zárni ezt a fuvart!',
    ).toBeGreaterThanOrEqual(400);

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [jobB.id]);
    expect(rows[0].status).toBe('in_progress');
  });

  it('nem lehet MÁSIK fuvarhoz tartozó ajánlatot elfogadni', async () => {
    const feladoA = await createUser({ role: 'shipper' });
    const feladoB = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const jobA = await createJob({ shipperId: feladoA.id, status: 'bidding' });
    const { rows } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf) VALUES ($1, $2, 14000) RETURNING id`,
      [jobA.id, szallito.id],
    );

    // B feladó megpróbálja elfogadni az A fuvarra érkezett ajánlatot
    const res = await request(app).post(`/bids/${rows[0].id}/accept`)
      .set('Authorization', `Bearer ${feladoB.token}`).send({});

    expect(res.status, 'Idegen feladó elfogadhatta más fuvarának ajánlatát!').toBeGreaterThanOrEqual(400);
  });

  it('a vita a saját fuvarhoz köt — idegen fuvarra nem nyitható', async () => {
    const felado = await createUser({ role: 'shipper' });
    const idegen = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered', paid: true });

    const res = await request(app).post('/disputes')
      .set('Authorization', `Bearer ${idegen.token}`)
      .send({ job_id: job.id, reason: 'damaged', description: 'Nem is az enyém.' });

    expect(res.status, 'Idegen vitát nyithatott más fuvarára!').toBeGreaterThanOrEqual(400);
  });
});

// =====================================================================
//  4. MEGSZAKADT ÉS ÚJRAKEZDETT UTAK
// =====================================================================
describe('4. Félbehagyott utak: a user nem ragad be', () => {
  it('a fizetés elindítása után otthagyott fuvar még lemondható', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    // Elindítja a fizetést, de sosem tér vissza a bankból
    const inditas = await request(app).post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${felado.token}`).send({ consent: true });
    expect(inditas.status).toBeLessThan(300);

    // …majd meggondolja magát
    __resetRateLimitsForTests();
    const lemondas = await request(app).post(`/jobs/${job.id}/cancel`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(
      lemondas.status,
      'A félbehagyott fizetés után a feladó BERAGADT — nem tudott lemondani.',
    ).toBeLessThan(400);
  });

  it('szállító-visszalépés után a fuvar újra ajánlható, és a régi ajánlatok élnek', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const masik = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status)
       VALUES ($1, $2, 14000, 'accepted'), ($1, $3, 15000, 'rejected')`,
      [job.id, szallito.id, masik.id],
    );

    const reopen = await request(app).post(`/jobs/${job.id}/reopen`)
      .set('Authorization', `Bearer ${felado.token}`).send({});
    expect(reopen.status, JSON.stringify(reopen.body)).toBeLessThan(400);

    const { rows } = await db.query('SELECT status, carrier_id FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('bidding');
    expect(rows[0].carrier_id).toBeNull();

    // A díjat NEM kell újra fizetni (a feladó egyszer már fizetett)
    const { rows: dij } = await db.query(
      'SELECT COUNT(*)::int AS n FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(dij[0].n, 'Szállító-csere után ÚJABB díj-sor keletkezett!').toBeLessThanOrEqual(1);
  });

  it('a lemondott fuvarra utólag nem lehet fizetni', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'cancelled', paid: false,
    });

    const res = await request(app).post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${felado.token}`).send({ consent: true });
    expect(res.status, 'Lemondott fuvarra be lehetett fizetni a díjat!').toBeGreaterThanOrEqual(400);

    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(rows[0].n, 'Lemondott fuvarra díj-sor keletkezett!').toBe(0);
  });

  it('kétszer egyszerre indított fizetésből is csak EGY terhelés lesz', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    await Promise.all([
      request(app).post(`/jobs/${job.id}/pay`)
        .set('Authorization', `Bearer ${felado.token}`).send({ consent: true }),
      request(app).post(`/jobs/${job.id}/pay`)
        .set('Authorization', `Bearer ${felado.token}`).send({ consent: true }),
    ]);

    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM escrow_transactions WHERE job_id = $1', [job.id],
    );
    expect(rows[0].n, `${rows[0].n} díj-sor — a türelmetlen dupla kattintás duplán terhelt!`)
      .toBeLessThanOrEqual(1);
  });
});

// =====================================================================
//  5. A MÁSIK TELJES ÚT: járat-foglalás életciklusa
//
//  A fix áras járatra foglalás önálló állapotgép, saját szabályokkal.
//  Eddig egyetlen E2E fedte (a boldog utat) — itt ugyanúgy végigmegyünk
//  MINDEN állapoton, MINDEN szereplővel, MINDEN művelettel.
// =====================================================================

const FOGLALAS_SZEREPLOK = ['felado', 'szallito', 'masikFelado', 'idegen', 'admin'];

async function foglalasForgatokonyv(allapot) {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const masikFelado = await createUser({ role: 'shipper' });
  const idegen = await createUser({ role: 'carrier' });
  const admin = await createUser({ role: 'admin' });

  const fizetve = ['confirmed_fizetett', 'in_progress', 'delivered', 'disputed'].includes(allapot);
  const status = {
    pending: 'pending',
    confirmed_fizetetlen: 'confirmed',
    confirmed_fizetett: 'confirmed',
    in_progress: 'in_progress',
    delivered: 'delivered',
    cancelled: 'cancelled',
    rejected: 'rejected',
    disputed: 'disputed',
  }[allapot];

  const { booking } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status, paid: fizetve,
  });

  if (allapot === 'disputed') {
    await db.query(
      `INSERT INTO disputes (booking_id, opened_by, against_user, description)
       VALUES ($1, $2, $3, 'Nyitott vita a teszthez')`,
      [booking.id, felado.id, szallito.id],
    );
  }

  return {
    allapot, booking, felado, szallito, masikFelado, idegen, admin,
    token: { felado: felado.token, szallito: szallito.token,
             masikFelado: masikFelado.token, idegen: idegen.token, admin: admin.token },
  };
}

const FOGLALAS_MUVELETEK = {
  'megerősít': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/confirm`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'elutasít': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/reject`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'díjat fizet': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/pay`)
    .set('Authorization', `Bearer ${t}`).send({ consent: true }),

  'lemond': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/cancel`)
    .set('Authorization', `Bearer ${t}`).send({}),

  'felvételi fotót tölt': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/photos`)
    .set('Authorization', `Bearer ${t}`)
    .field('kind', 'pickup').attach('file', TINY_PNG, 'p.png'),

  'kézbesít (kóddal)': (c, t) => request(app).post(`/route-bookings/${c.booking.id}/photos`)
    .set('Authorization', `Bearer ${t}`)
    .field('kind', 'dropoff').field('delivery_code', '111222')
    .attach('file', TINY_PNG, 'd.png'),

  'vitát nyit': (c, t) => request(app).post('/disputes')
    .set('Authorization', `Bearer ${t}`)
    .send({ booking_id: c.booking.id, reason: 'damaged', description: 'Sérült a csomag.' }),

  'üzenetet küld': (c, t) => request(app).post('/messages')
    .set('Authorization', `Bearer ${t}`).send({ booking_id: c.booking.id, body: 'Szia!' }),
};

const FOGLALAS_SZABALYOK = {
  pending: {
    'megerősít': ['szallito'],
    'elutasít': ['szallito'],
    'díjat fizet': [],                       // csak megerősített foglalás fizethető
    'lemond': ['felado', 'szallito'],
    'felvételi fotót tölt': [],              // fizetés előtt nincs munka
    'kézbesít (kóddal)': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  confirmed_fizetetlen: {
    'megerősít': [],                         // már megerősítve
    'elutasít': [],
    'díjat fizet': ['felado'],
    'lemond': ['felado', 'szallito'],
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  confirmed_fizetett: {
    'megerősít': [],
    'elutasít': [],
    'díjat fizet': [],                       // nincs dupla terhelés
    'lemond': ['felado', 'szallito'],
    'felvételi fotót tölt': ['szallito'],
    'kézbesít (kóddal)': [],                 // felvétel nélkül nem zárható
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  in_progress: {
    'megerősít': [],
    'elutasít': [],
    'díjat fizet': [],
    'lemond': [],                            // úton lévőt nem lehet lemondani
    'felvételi fotót tölt': ['szallito'],
    'kézbesít (kóddal)': ['szallito'],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  delivered: {
    'megerősít': [],
    'elutasít': [],
    'díjat fizet': [],
    'lemond': [],
    'felvételi fotót tölt': [],              // lezárt foglaláshoz nincs fotó
    'kézbesít (kóddal)': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  cancelled: {
    'megerősít': [],
    'elutasít': [],
    'díjat fizet': [],
    'lemond': [],
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  rejected: {
    'megerősít': [],                         // az elutasítás végleges
    'elutasít': [],
    'díjat fizet': [],
    'lemond': [],
    'felvételi fotót tölt': [],
    'kézbesít (kóddal)': [],
    'vitát nyit': ['felado', 'szallito'],
    'üzenetet küld': ['felado', 'szallito'],
  },
  disputed: {
    'megerősít': [],
    'elutasít': [],
    'díjat fizet': [],
    'lemond': ['felado', 'szallito'],
    'felvételi fotót tölt': ['szallito'],    // bizonyíték-gyűjtés vita alatt
    'kézbesít (kóddal)': [],
    'vitát nyit': [],                        // nincs második nyitott vita
    'üzenetet küld': ['felado', 'szallito'],
  },
};

describe('5. Járat-foglalás: minden állomáson ki mit tehet', () => {
  for (const allapot of Object.keys(FOGLALAS_SZABALYOK)) {
    describe(`foglalás állapota: ${allapot}`, () => {
      for (const muvelet of Object.keys(FOGLALAS_MUVELETEK)) {
        const engedettek = FOGLALAS_SZABALYOK[allapot][muvelet];

        it(`${muvelet} — csak [${engedettek.join(', ') || 'senki'}] csinálhatja`, async () => {
          const hibak = [];
          for (const szereplo of FOGLALAS_SZEREPLOK) {
            const c = await foglalasForgatokonyv(allapot);
            __resetRateLimitsForTests();

            let res;
            try {
              res = await FOGLALAS_MUVELETEK[muvelet](c, c.token[szereplo]);
            } catch (err) {
              hibak.push(`${szereplo}: a kérés elszállt — ${err.message}`);
              continue;
            }

            if (res.status >= 500) {
              hibak.push(`${szereplo}: ${res.status} SZERVERHIBA — ${JSON.stringify(res.body).slice(0, 160)}`);
              continue;
            }

            const sikerult = res.status < 400;
            const szabade = engedettek.includes(szereplo);
            if (szabade && !sikerult) {
              hibak.push(`${szereplo}: NEM sikerült, pedig szabadna (${res.status} — ${JSON.stringify(res.body).slice(0, 140)})`);
            }
            if (!szabade && sikerult) {
              hibak.push(`${szereplo}: SIKERÜLT (${res.status}), pedig TILOS lenne ebben az állapotban!`);
            }
          }
          expect(
            hibak,
            `„${muvelet}" a(z) ${allapot} foglalás-állapotban:\n  ${hibak.join('\n  ')}`,
          ).toEqual([]);
        });
      }
    });
  }
});
