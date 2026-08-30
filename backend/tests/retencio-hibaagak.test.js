// =====================================================================
//  RETENCIÓ — AMI AKKOR TÖRTÉNIK, HA A KÖR ELROMLIK (2026-08-12)
//
//  A meglévő retenciós tesztek azt mérik, hogy a szabályok HELYESEK
//  (mit törlünk, mikor, mit hagyunk meg). Ami méretlen maradt: mi történik,
//  ha egy kör közben ELHASAL. Ez nem elméleti kérdés — a napi retenció egy
//  háttérfolyamat, amit senki nem néz:
//
//   1. Ha egy kör hibája továbbterjed, a NAPI RETENCIÓ EGÉSZE elakad, és
//      minden megőrzési határidő némán elcsúszik.
//   2. Ha viszont MINDEN kör lenyeli a hibáját, akkor egy elgépelt SQL
//      hónapokig futhat hatás nélkül, „sikeres" naplóval. Ezért az
//      `anonymizeOldJobs` SZÁNDÉKOSAN továbbdobja a hibát (a saját
//      kód-kommentje ezt részletesen indokolja) — ez a döntés eddig
//      őrizetlen volt, egy `try { } catch { return 0; }` visszatette volna
//      a némaságot, zöld build mellett.
//   3. A vita bizonyíték-fájljának BERAGADÁSA: ha a tároló-törlés elbukik,
//      a vita SORÁT meg kell tartani — az az egyetlen mutató a fájlra. A
//      fotó-ágon ezt már őrizzük (foto-retencio), a vita-ágon nem volt teszt.
//
//  ⚠️ A hiba-injekció CÉLZOTT és MÉRT: a `dbHibaMintara` számlálója
//  bizonyítja, hogy az injekció tényleg lefutott — enélkül a teszt csendben
//  elveszítené az értelmét (ez a klasszikus „hamis zöld").
// =====================================================================
import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import fs from 'fs';

const { db, createUser, createJob } = require('./helpers');
const retention = require('../src/services/retention');
const storage = require('../src/services/storage');
const dbModul = require('../src/db');

afterEach(() => { vi.restoreAllMocks(); });

/** A napi kör NÉV-listája a forrásból (a konstans a függvényen belül él). */
function korNevekAForrasbol() {
  const forras = fs.readFileSync(require.resolve('../src/services/retention.js'), 'utf8');
  const blokk = forras.match(/const KOR_NEVEK\s*=\s*\[([\s\S]*?)\];/);
  if (!blokk) throw new Error('A KOR_NEVEK lista nem található a retention.js-ben — az őr vak lenne.');
  return [...blokk[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
}

/** Teljes DB-kiesés modellezése. */
function dbTeljesenHalott() {
  vi.spyOn(dbModul, 'query').mockRejectedValue(new Error('szimulált DB-kiesés'));
}

/** Célzott hiba: csak a mintára illő lekérdezés hasal el. */
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

// =====================================================================
//  1) HIBATŰRÉS-MÁTRIX — melyik kör nyeli el a hibát, és melyik nem
// =====================================================================
// A besorolás SZÁNDÉK, nem leltár: mindegyik sorhoz tartozik indoklás.
const NYELI_A_HIBAT = [
  'purgeOldDeliveryPhotos', 'purgeOldChatMessages', 'purgeOldLocationPings',
  'purgeStaleLastKnownLocation', 'purgeOldNotifications', 'purgeOldAdminMessages',
  'purgeOldAdminAccessLog', 'expireAbandonedJobs', 'expireAbandonedBookings',
  'repairDisputedHold', 'anonymizeOldCarrierRoutes', 'purgeOldDisputes',
  'purgeOldInvoices', 'purgeEmergencyLocations', 'purgeOldDeletedAccounts',
  'purgeOldKycDocHistory', 'purgeOldPaymentEvents', 'purgeOldEscrowTransactions',
  'purgeOldTaxData',
];
// Ezek TOVÁBBDOBJÁK a hibát — a napi kör külön elkapja, naplózza (maszkolva)
// és Sentry-riasztást küld. Az `anonymizeOldJobs`-nál ez KIFEJEZETT döntés
// (2026-08-11): a néma nyelés miatt egy elrontott UPDATE hónapokig futhatott
// volna, miközben a napló „0 anonimizált sort" mutat, és a fuvarok PII-ja
// határidő nélkül bent marad.
// A `purgeExpiredSmsRetryQueue` is továbbdob (2026-08-30): a lejárt sor
// törlése PII-ígéret (telefonszám + átvételi kód legfeljebb ~72 óráig él) —
// ha a törlés csendben hasalna el, a sor határidő nélkül gyűjtené a PII-t.
const TOVABBDOBJA = ['anonymizeOldJobs', 'purgeDormantAccounts', 'purgeExpiredSmsRetryQueue'];

describe('Hibatűrés-mátrix: egy elszállt SQL nem üthet ki egy egész napot', () => {
  it('a besorolás LEFEDI a napi kör összes lépését (új kör nem csúszhat be osztályozatlanul)', () => {
    const korok = korNevekAForrasbol();
    const besorolt = new Set([...NYELI_A_HIBAT, ...TOVABBDOBJA]);

    const osztalyozatlan = korok.filter((k) => !besorolt.has(k));
    expect(
      osztalyozatlan,
      'ÚJ RETENCIÓS KÖR KERÜLT A NAPI FUTÁSBA, HIBA-VISELKEDÉS NÉLKÜL.\n\n'
      + `Osztályozatlan: ${osztalyozatlan.join(', ')}\n\n`
      + 'Sorold be a fenti két lista valamelyikébe. A kérdés, amit el kell '
      + 'dönteni: ha ez a kör elhasal, azt inkább CSENDBEN nyeljük el (a többi '
      + 'kör fusson tovább), vagy inkább HANGOSAN jelentse (riasztás + '
      + 'futás-napló)? A rossz alapértelmezés a csendes nyelés: attól hónapokig '
      + 'futhat egy hatástalan kör.',
    ).toEqual([]);

    const elavult = [...besorolt].filter((k) => !korok.includes(k));
    expect(
      elavult,
      `A besorolás elavult: ${elavult.join(', ')} már nincs a napi körben. `
      + 'A holt lista azt a látszatot kelti, hogy őrizzük — pedig nem.',
    ).toEqual([]);
  });

  for (const nev of NYELI_A_HIBAT) {
    it(`${nev}: DB-kiesésnél 0-t ad, nem dob`, async () => {
      dbTeljesenHalott();
      let eredmeny;
      await expect(
        (async () => { eredmeny = await retention[nev](); })(),
        `A(z) ${nev} továbbdobta a DB-hibát. A napi kör külön elkapja ugyan, `
        + 'de ez a kör azért van a "nyeli" osztályban, mert egy átmeneti '
        + 'DB-hiba nem érdemel riasztást — a besorolás megváltozott.',
      ).resolves.not.toThrow();
      expect(
        eredmeny,
        `A(z) ${nev} hiba után NEM-NULLA eredményt jelentett. A futás-napló `
        + 'így azt írná, hogy dolgozott, holott egyetlen sort sem érintett — '
        + 'pont az elszámoltathatóság (GDPR 5. cikk (2)) veszne el.',
      ).toBe(0);
    });
  }

  for (const nev of TOVABBDOBJA) {
    it(`${nev}: DB-kiesésnél TOVÁBBDOBJA a hibát (hangos kiesés)`, async () => {
      dbTeljesenHalott();
      await expect(
        retention[nev](),
        `A(z) ${nev} CSENDBEN elnyelte a DB-hibát. Ezzel a kör hónapokig `
        + 'futhat hatás nélkül: a napi napló „sikeres"-t ír és 0 érintett sort, '
        + 'ami egy üres adatbázisnál is pontosan ugyanígy néz ki. Az '
        + 'anonymizeOldJobs esetében ez a KÜLÖN INDOKOLT döntés (a fuvarok '
        + 'PII-ja maradna bent határidő nélkül).',
      ).rejects.toThrow();
    });
  }
});

// =====================================================================
//  2) A FUTÁS-NAPLÓ — az elszámoltathatóság nem buktathatja meg a takarítást
// =====================================================================
describe('runDailyRetention: a napló írása nem kritikus út', () => {
  it('ha a futás-napló INSERT-je elhasal, a kör akkor is végigmegy és visszatér', async () => {
    const injekcio = dbHibaMintara(/INSERT INTO retention_runs/i);

    let eredmeny;
    await expect(
      (async () => { eredmeny = await retention.runDailyRetention(); })(),
      'A FUTÁS-NAPLÓ HIBÁJA KIVÉTELKÉNT JÖTT VISSZA. Az ütemező '
      + '`.catch()`-e ezt lenyelné ugyan, de egy kezeletlen Promise-elutasítás '
      + 'a Node-ban a folyamatot is leállíthatja — egy KÉNYELMI naplósor miatt '
      + 'állna le a teljes háttér-takarítás.',
    ).resolves.not.toThrow();

    expect(injekcio.talalat, 'a napló-írás meg sem történt — a teszt nem mér semmit').toBeGreaterThan(0);
    expect(
      Object.keys(eredmeny.eredmeny).length,
      'a napló-hiba után üres eredmény jött vissza — a körök nem futottak le',
    ).toBeGreaterThan(15);
  });
});

describe('lastSuccessfulRetentionRun: mit mond, ha nincs mit mondania', () => {
  it('sikeres futás hiányában NULL-t ad (nem a legutóbbi HIBÁS futást)', async () => {
    await db.query('DELETE FROM retention_runs');
    await db.query(
      `INSERT INTO retention_runs (started_at, finished_at, ok, eredmeny, hibak)
       VALUES (NOW(), NOW(), FALSE, '{}'::jsonb, '{"purgeOldInvoices":"hiba"}'::jsonb)`,
    );

    expect(
      await retention.lastSuccessfulRetentionRun(),
      'EGY HIBÁS FUTÁST SIKERESKÉNT ADTUNK VISSZA. A watchdog erre épül: azt '
      + 'hinné, hogy a retenció rendben lefutott, és sosem riasztana — pedig '
      + 'épp minden kör elszállt.',
    ).toBeNull();

    await db.query(
      `INSERT INTO retention_runs (started_at, finished_at, ok, eredmeny, hibak)
       VALUES (NOW(), NOW(), TRUE, '{"purgeOldInvoices":0}'::jsonb, '{}'::jsonb)`,
    );
    const utolso = await retention.lastSuccessfulRetentionRun();
    expect(utolso, 'a sikeres futás beírása után sem találtuk meg').toBeTruthy();
    expect(utolso.eredmeny, 'a naplózott eredmény nem jött vissza a hívónak').toBeTruthy();
  });

  it('DB-hiba esetén NULL-t ad, nem dob (a watchdog nem omolhat össze)', async () => {
    dbTeljesenHalott();
    let ertek;
    await expect(
      (async () => { ertek = await retention.lastSuccessfulRetentionRun(); })(),
      'A watchdog lekérdezése kivételt dobott. Az ütemezett ellenőrzés így '
      + 'kezeletlen elutasítást hagyna maga után — épp az a funkció esne ki, '
      + 'aminek a néma kiesést kellene észrevennie.',
    ).resolves.not.toThrow();
    expect(ertek).toBeNull();
  });
});

// =====================================================================
//  3) VITA-PURGE: a bizonyíték-fájl BERAGADÁSA
// =====================================================================
describe('purgeOldDisputes: sikertelen tároló-törlésnél a sor MARAD', () => {
  async function regiLezartVita({ evidence }) {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'completed', paid: true });
    const { rows } = await db.query(
      `INSERT INTO disputes (job_id, opened_by, description, evidence_url, status, resolved_at)
       VALUES ($1, $2, 'Sérülten érkezett', $3, 'resolved_refund', NOW() - INTERVAL '6 years')
       RETURNING id`,
      [job.id, felado.id, evidence],
    );
    return rows[0].id;
  }
  const letezik = async (id) => (await db.query('SELECT 1 FROM disputes WHERE id = $1', [id])).rowCount > 0;

  it('a beragadt vita megmarad, a törölhető viszont elmegy — és riasztás megy', async () => {
    const beragadUrl = 'https://pub-teszt.r2.dev/beragadt-bizonyitek.jpg';
    const beragadt = await regiLezartVita({ evidence: beragadUrl });
    const rendben = await regiLezartVita({ evidence: 'https://pub-teszt.r2.dev/torolheto.jpg' });

    // Az R2 CSAK az egyik fájlnál esik ki (pl. jogosultsági hiba egy kulcsra).
    vi.spyOn(storage, 'deleteFile').mockImplementation(async (url) => url !== beragadUrl);
    const Sentry = require('@sentry/node');
    const riasztasok = [];
    vi.spyOn(Sentry, 'captureMessage').mockImplementation((m) => { riasztasok.push(String(m)); });

    await retention.purgeOldDisputes();

    expect(
      await letezik(beragadt),
      'A TÁROLÓ-TÖRLÉS ELBUKOTT, MI MÉGIS TÖRÖLTÜK A VITA SORÁT.\n\n'
      + 'Az `evidence_url` az EGYETLEN mutató a fájlra: a sorral együtt az '
      + 'utolsó nyom is elvész, és a bizonyítékfotó VÉGLEGESEN a bucketben '
      + 'marad — se retry, se riasztás, se sepregető. Ugyanez a hibaosztály a '
      + 'fotó-ágon már le van zárva; a vita-ág csúszott ki alóla.',
    ).toBe(true);
    expect(
      await letezik(rendben),
      'Egyetlen beragadt fájl megakasztotta a TÖBBI vita elévülését is — a '
      + 'hiba-elkülönítés hiányában egy rossz kulcs örökre életben tartaná az '
      + 'összes régi vitát.',
    ).toBe(false);
    expect(
      riasztasok.some((m) => /vita/i.test(m)),
      'A beragadt bizonyíték-fájlról nem ment riasztás. Némán, mérhetetlenül '
      + 'gyűlnének az árva objektumok a tárolóban.',
    ).toBe(true);
  });

  it('bizonyíték NÉLKÜLI régi vitánál nincs fölösleges tároló-hívás', async () => {
    const id = await regiLezartVita({ evidence: null });
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    await retention.purgeOldDisputes();

    expect(await letezik(id), 'a csatolmány nélküli lezárt vita 5 év után is megmaradt').toBe(false);
    expect(
      torles.mock.calls.filter(([u]) => !u).length,
      'ÜRES URL-lel hívtuk a tároló-törlést. A deleteFile ilyenkor `false`-t '
      + 'ad → a vitát „beragadtnak" könyvelnénk, és a csatolmány nélküli viták '
      + 'SOHA nem évülnének el.',
    ).toBe(0);
  });
});

// =====================================================================
//  4) CÍM-RÖVIDÍTÉS: önjavító, de nem dolgozik feleslegesen
// =====================================================================
describe('shortenAnonymizedAddresses: idempotens', () => {
  it('a második futás már nem ír a DB-be (nem pörög üresben minden nap)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({
      shipperId: felado.id,
      status: 'completed',
      paid: true,
      pickupAddress: 'Hauptstraße 5, 10115 Berlin',
      dropoffAddress: 'Budapest, Váci út 12.',
    });
    await db.query('UPDATE jobs SET anonymized_at = NOW() WHERE id = $1', [job.id]);

    const elso = await retention.shortenAnonymizedAddresses();
    expect(elso, 'az első kör nem rövidítette le a friss anonimizált címet').toBeGreaterThan(0);

    const { rows } = await db.query(
      'SELECT pickup_address, dropoff_address FROM jobs WHERE id = $1', [job.id],
    );
    expect(
      rows[0].pickup_address,
      'A NÉMET CÍMBŐL a házszámos utca maradt meg. A `split(",")[0]` csak a '
      + 'magyar formátumon működik — Európa-szintű coverage mellett ez élő '
      + 'cím-szivárgás lenne.',
    ).not.toMatch(/Hauptstra/i);
    expect(rows[0].dropoff_address, 'a magyar címből eltűnt a település').toContain('Budapest');

    // A DB-írásokat számoljuk: a második körnek NEM szabad UPDATE-elnie.
    const irasok = [];
    const eredeti = dbModul.query.bind(dbModul);
    vi.spyOn(dbModul, 'query').mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && /^\s*UPDATE (jobs|route_bookings) SET pickup_address/i.test(sql)) {
        irasok.push(params && params[0]);
      }
      return eredeti(sql, params);
    });

    const masodik = await retention.shortenAnonymizedAddresses();
    expect(
      irasok,
      'A MÁSODIK kör újra átírta a MÁR rövidített címeket. A kör naponta fut, '
      + 'és minden anonimizált soron végigmegy: egy nem-idempotens változat '
      + 'minden nap újraírná a teljes archívumot (fölösleges DB-terhelés és '
      + 'zajos updated_at).',
    ).toEqual([]);
    expect(masodik).toBe(0);
  });

  it('a cím-rövidítés hibája nem buktathatja a FŐ anonimizálást', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({
      shipperId: felado.id, status: 'completed', paid: true,
      pickupAddress: 'Budapest, Kossuth utca 7.', dropoffAddress: 'Szeged, Fő tér 1.',
    });
    await db.query(
      `UPDATE jobs SET updated_at = NOW() - ($2 || ' years')::interval,
                       photo_retention_hold = FALSE
        WHERE id = $1`,
      [job.id, retention.JOB_PII_RETENTION_YEARS + 1],
    );

    // A cím-rövidítés a fő UPDATE UTÁN, ugyanabban a try-blokkban fut. Ha
    // dobna, az `anonymizeOldJobs` továbbdobná — és a napi napló azt írná,
    // hogy az anonimizálás ELSZÁLLT, holott a PII-törlés már megtörtént.
    const injekcio = dbHibaMintara(/SELECT id, pickup_address, dropoff_address FROM/i);

    let db_count;
    await expect(
      (async () => { db_count = await retention.anonymizeOldJobs(); })(),
      'A CÍM-RÖVIDÍTÉS HIBÁJA MEGBUKTATTA A TELJES ANONIMIZÁLÁST. Az '
      + '`anonymizeOldJobs` szándékosan továbbdobja a saját hibáját — ha ebbe '
      + 'egy MELLÉKLÉPÉS hibája is beleszámít, minden nap hamis riasztás megy, '
      + 'és a valódi hibák elvesznek a zajban.',
    ).resolves.not.toThrow();

    expect(injekcio.talalat, 'a cím-rövidítés meg sem indult — a teszt nem mér semmit').toBeGreaterThan(0);
    expect(db_count, 'a fuvar nem anonimizálódott').toBeGreaterThan(0);

    const { rows } = await db.query(
      'SELECT recipient_phone, delivery_code, tracking_token, anonymized_at FROM jobs WHERE id = $1',
      [job.id],
    );
    expect(
      rows[0].recipient_phone,
      'A FŐ PII-TÖRLÉS NEM TÖRTÉNT MEG, pedig csak a cím-rövidítés bukott el. '
      + 'A címzett telefonszáma, az átvételi kód és az élő követő-token '
      + 'határidő nélkül bent maradna.',
    ).toBeNull();
    expect(rows[0].delivery_code).toBeNull();
    expect(rows[0].tracking_token).toBeNull();
    expect(rows[0].anonymized_at, 'az anonimizálás ténye nem rögzült').toBeTruthy();
  });
});

// =====================================================================
//  4/b) A RETENCIÓ TÉNYLEGESEN ELTÜNTETI A BÁJTOKAT
//
//  ⚠️ A meglévő fotó-retenciós tesztek `data:` URL-lel dolgoznak (a saját
//  kommentjük mondja: „a deleteFile-nak nincs tároló-dolga vele, a sor-törlés
//  a lényeg"). Vagyis a DB-sor eltűnését mérik, a FÁJLÉT nem. A tájékoztató
//  viszont a FÉNYKÉP törlését ígéri — ha a tároló-hívás elcsúszna (rossz
//  URL-alak, kihagyott ág), a kép a lemezen/bucketben maradna, és minden
//  teszt zöld lenne.
// =====================================================================
describe('purgeOldDeliveryPhotos: a fájl is elmegy, nem csak a DB-sor', () => {
  it('a lezárt fuvar lejárt fotója a TÁROLÓBÓL is eltűnik', async () => {
    const fs2 = require('fs');
    const pathModul = require('path');
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });

    // VALÓDI fájl a valódi tároló-modulon keresztül (teszt-környezetben ez a
    // disk-mód — ugyanaz az út, amit a retenció élesben is hív).
    const url = await storage.saveFile(Buffer.from('bizonyitek-foto'), 'kezbesites.jpg', 'image/jpeg');
    const fajl = pathModul.join(__dirname, '..', 'uploads', pathModul.basename(url));
    expect(fs2.existsSync(fajl), 'a teszt-fájl létre sem jött — nincs mit mérni').toBe(true);

    await db.query(
      `INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1, $2, 'dropoff', $3)`,
      [job.id, szallito.id, url],
    );
    await db.query(
      `UPDATE jobs SET updated_at = NOW() - INTERVAL '400 days',
                       photo_retention_hold = FALSE
        WHERE id = $1`,
      [job.id],
    );

    await retention.purgeOldDeliveryPhotos();

    const { rowCount } = await db.query('SELECT 1 FROM photos WHERE url = $1', [url]);
    expect(rowCount, 'a lejárt fotó DB-sora megmaradt').toBe(0);
    expect(
      fs2.existsSync(fajl),
      'A DB-SOR ELTŰNT, A FÁJL VISZONT A TÁROLÓBAN MARADT. Az adatkezelési '
      + 'tájékoztató a FÉNYKÉP 30 napos törlését ígéri; a mutató törlésével a '
      + 'kép nemhogy eltűnne, hanem VISSZAKERESHETETLEN árvává válik — se '
      + 'retry, se riasztás, se sepregető.',
    ).toBe(false);
  });
});

// =====================================================================
//  5) ALVÓ FIÓK: a FIGYELMEZTETÉSI fázis is védett
// =====================================================================
describe('purgeDormantAccounts: a figyelmeztetés sem indulhat el vakon', () => {
  it('aktív + kifizetett ügyletnél FIGYELMEZTETÉST sem küldünk', async () => {
    const email = require('../src/services/email');
    const kuldes = vi.spyOn(email, 'sendDormantAccountWarningEmail').mockResolvedValue({ ok: true });

    const alvo = await createUser({ role: 'shipper' });
    await db.query(
      `UPDATE users SET last_login_at = NOW() - ($2 || ' years')::interval,
                        created_at = NOW() - ($2 || ' years')::interval,
                        dormant_warned_at = NULL
        WHERE id = $1`,
      [alvo.id, retention.DORMANT_WARN_YEARS + 1],
    );
    const szallito = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: alvo.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    await retention.purgeDormantAccounts();

    const { rows } = await db.query('SELECT dormant_warned_at FROM users WHERE id = $1', [alvo.id]);
    expect(
      rows[0].dormant_warned_at,
      'ELINDULT A 30 NAPOS TÖRLÉSI ÓRA egy olyan felhasználón, akinek épp '
      + 'FOLYAMATBAN LÉVŐ, KIFIZETETT ügylete van. A törlést a második fázis '
      + 'ugyan megállítja, de addig a felhasználó egy valótlan „töröljük a '
      + 'fiókodat" levelet kapott a futó fuvarja közben — és ha a védelem '
      + 'valaha csak az egyik fázisban él, az a rosszabbik.',
    ).toBeNull();
    expect(
      kuldes.mock.calls.some(([arg]) => arg && arg.to === alvo.email),
      'a figyelmeztető levél kiment az aktív ügyletű felhasználónak',
    ).toBe(false);
  });
});
