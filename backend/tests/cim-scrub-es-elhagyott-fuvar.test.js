// =====================================================================
//  CÍM-ELREJTÉS NEM-MAGYAR FORMÁTUMON + ELHAGYOTT FUVAROK (2026-08-09)
//
//  1) A kívülállónak mutatott „közelítő hely" az első vessző előtti részt
//     tartotta meg. Ez CSAK a magyar címformátumon működik:
//        „Budapest, Váci út 1"             → „Budapest"        ✅
//        „Hauptstraße 5, 10115 Berlin"     → „Hauptstraße 5"   ❌
//     Vagyis pont az utca + HÁZSZÁM maradt meg, miközben a koordinátát
//     mellette ~1 km-re kerekítjük — a két védelem kioltotta egymást.
//     A coverage Európa-szintű, tehát ez ÉLŐ szivárgás volt.
//
//  2) Az anonimizálás és a fotó-purge is CSAK terminális fuvarra futott.
//     Egy `bidding` állapotban otthagyott fuvar tehát ÖRÖKRE őrizte a pontos
//     címeket, a címzett elérhetőségét és az átvételi kódot — ráadásul a
//     `bidding` NYITOTT státusz, tehát a scrub nem is kerekítette: bármely
//     bejelentkezett felhasználó évek múlva is látta a pontos otthoni címet.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db, createUser, createJob } = require('./helpers');
const { telepulesSzint } = require('../src/utils/address');
const {
  expireAbandonedJobs, shortenAnonymizedAddresses, ABANDONED_JOB_YEARS,
} = require('../src/services/retention');

describe('Cím településszintre rövidítése — minden piacunkon', () => {
  const esetek = [
    ['Budapest, Váci út 1, 1132', 'Budapest', 'magyar (település elöl)'],
    ['6800 Hódmezővásárhely, Szántó Kovács János utca 144', '6800 Hódmezővásárhely', 'magyar irányítószámmal'],
    ['Hauptstraße 5, 10115 Berlin, Germany', '10115 Berlin', 'német (UTCA elöl)'],
    ['Wiener Straße 8, 1020 Wien, Austria', '1020 Wien', 'osztrák (UTCA elöl)'],
    ['Strada Mihai Viteazu 12, Arad, Romania', 'Arad', 'román (UTCA elöl)'],
    ['Szeged', 'Szeged', 'vessző nélküli település'],
    ['Váci út 1', '', 'vessző nélküli UTCA+házszám — inkább semmi, mint lakcím'],
  ];

  for (const [be, vart, mit] of esetek) {
    it(`${mit}: ${JSON.stringify(be)}`, () => {
      expect(
        telepulesSzint(be),
        `a HÁZSZÁMIG pontos cím maradt volna a kívülállónak (${mit})`,
      ).toBe(vart);
    });
  }

  it('egyetlen esetben sem marad házszám a kimenetben', () => {
    for (const [be] of esetek) {
      const ki = telepulesSzint(be);
      // Irányítószám maradhat (településszintű), házszám nem: ezért csak a
      // NEM vezető pozícióban álló számot tiltjuk.
      const irszNelkul = ki.replace(/^\d{4,6}\s+/, '');
      expect(irszNelkul, `házszám maradt: ${JSON.stringify(ki)} (${be})`).not.toMatch(/\d/);
    }
  });
});

describe('A retenció is a tartalom-alapú rövidítést használja', () => {
  it('az anonimizált NÉMET cím is településszintre rövidül (önjavítóan)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'completed', paid: true });
    // Egy korábban, a HIBÁS szabállyal anonimizált sor állapota:
    await db.query(
      `UPDATE jobs SET anonymized_at = NOW(),
              pickup_address = 'Hauptstraße 5', dropoff_address = 'Budapest'
        WHERE id = $1`,
      [job.id],
    );

    await shortenAnonymizedAddresses();

    const { rows } = await db.query('SELECT pickup_address, dropoff_address FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].pickup_address, 'a német utca+házszám bennmaradt az anonimizált soron').toBe('');
    expect(rows[0].dropoff_address, 'a magyar települést fölöslegesen elvette').toBe('Budapest');
  });
});

describe('Elhagyott fuvarok lezárása', () => {
  it('az egy évnél régebbi, ajánlat nélküli fuvar lezárul (így elérik a retenciós körök)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    // ⚠️ MINDKÉT IDŐBÉLYEG RÉGI (2026-08-11). A lejáratás órája `updated_at`-ra
    // váltott, mert a díjmentes újraválasztás a fuvart visszaállítja
    // 'bidding'-re — ott a `created_at` már nem mond semmit arról, mikor
    // mozdult utoljára. Egy VALÓDI két éves, érintetlen fuvarnak amúgy is
    // mindkét bélyege régi; a régi fixtúra (csak created_at) irreális volt.
    await db.query(
      `UPDATE jobs SET created_at = NOW() - ($2 || ' years')::interval,
                       updated_at = NOW() - ($2 || ' years')::interval
        WHERE id = $1`,
      [job.id, ABANDONED_JOB_YEARS + 1],
    );

    await expireAbandonedJobs();

    const { rows } = await db.query('SELECT status, cancelled_at FROM jobs WHERE id = $1', [job.id]);
    expect(
      rows[0].status,
      'az elhagyott fuvar örökre őrizte a pontos címet, a címzett elérhetőségét és az átvételi kódot',
    ).toBe('cancelled');
    expect(rows[0].cancelled_at).toBeTruthy();
  });

  it('a FRISS nyitott fuvart nem bántja', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    await expireAbandonedJobs();

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'egy FRISS, futó fuvart zárt le!').toBe('bidding');
  });

  it('a KIFIZETETT fuvart soha nem zárja le automatikusan', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'bidding', paid: true });
    await db.query(
      `UPDATE jobs SET created_at = NOW() - ($2 || ' years')::interval WHERE id = $1`,
      [job.id, ABANDONED_JOB_YEARS + 5],
    );

    await expireAbandonedJobs();

    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'egy KIFIZETETT fuvart zárt le automatikusan').toBe('bidding');
  });
});

// =====================================================================
//  A FIZETETT, MAJD ÚJRANYITOTT FUVAR (2026-08-11, 9. mérés — az
//  állapot-mátrix őr saját találata)
//
//  ⚠️ A díjmentes újraválasztás (`reopenJobForNewDriver`) a fuvart
//  VISSZAÁLLÍTJA 'bidding'-re, de a `paid_at`-ot MEGTARTJA — tehát a
//  „fizetett, mégis nyitott" fuvar teljesen normális állapot. A lejáratás
//  viszont `paid_at IS NULL`-t követelt, így ezek a fuvarok kiestek minden
//  retenciós ág alól: a címzett adatai, az átvételi kód és az ÉLŐ követő-token
//  határidő nélkül megmaradt.
// =====================================================================
describe('Fizetett, majd újranyitott fuvar sem ragadhat be', () => {
  it('az egy éve mozdulatlan, KIFIZETETT nyitott fuvar is lezárul', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding', paid: true });
    await db.query(
      `UPDATE jobs SET created_at = NOW() - ($2 || ' years')::interval,
                       updated_at = NOW() - ($2 || ' years')::interval
        WHERE id = $1`,
      [job.id, ABANDONED_JOB_YEARS + 1],
    );

    await expireAbandonedJobs();

    const { rows } = await db.query('SELECT status, paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'a fixture nem fizetett fuvart hozott létre').toBeTruthy();
    expect(
      rows[0].status,
      'A KIFIZETETT, majd újranyitott és soha el nem vállalt fuvar nem zárult le.\n'
      + 'Ez a díjmentes újraválasztás normál végállapota — és eddig kiesett\n'
      + 'minden retenciós ág alól, tehát a címzett elérhetősége, az átvételi kód\n'
      + 'és az élő követő-token HATÁRIDŐ NÉLKÜL megmaradt.',
    ).toBe('cancelled');
  });
});
