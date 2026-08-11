// =====================================================================
//  RETENCIÓS ÁLLAPOT-MÁTRIX (2026-08-11, 9. mérés)
//
//  ⚠️ MIÉRT EZ A LEGFONTOSABB ŐR EBBEN A KÖRBEN:
//
//  A 8. mérés megtalálta, hogy a `disputed` fuvar sosem anonimizálódik. Én azt
//  KIJAVÍTOTTAM — de csak a felfedezett ágon: a `hold=TRUE` esetre. A 9. mérés
//  erre azonnal talált egy másik utat: `disputed` + `hold=FALSE` MINDKÉT ágból
//  kiesik, és nincs kód-út, ami kihozná (az `expireAbandonedJobs` szándékosan
//  kihagyja a vitást, a `purgeOldDisputes` a `disputes` táblát nézi, amiben
//  ilyenkor nincs sor). Egyetlen admin-kattintás volt hozzá.
//
//  Vagyis MÁSODSZOR javítottam ugyanazt a hibaosztályt tünet-szinten.
//
//  A tanulság: a meglévő őrök ENTITÁS-listákat kényszerítenek ki (minden
//  tábla, minden végpont, minden Sentry-hook) — de ÁLLAPOT-KOMBINÁCIÓT egyet
//  sem. Márpetig a rendszer kétszer egymás után pont ott lyukadt ki.
//
//  Ez a teszt ezért nem egy állapotot néz, hanem a TELJES MÁTRIXOT:
//  minden státusz × zárolva/nem zárolva. Az invariáns, amit véd:
//
//      MINDEN régi fuvar/foglalás előbb-utóbb valamelyik szabály hatálya
//      alá kerül — nincs olyan állapot, amiben határidő nélkül megőrizzük
//      a személyes adatot.
//
//  Egy jövőbeli új státusz (enum-bővítés) automatikusan bekerül a mátrixba,
//  és ha kiesik minden szabály alól, ez a teszt pirosra vált.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db, createUser, createJob, createBooking } = require('./helpers');
const {
  runDailyRetention, HOLD_RETENTION_YEARS,
} = require('../src/services/retention');

/** Az enum ÖSSZES értéke a valós sémából — nem kézi lista. */
async function enumErtekek(tipus) {
  const { rows } = await db.query(
    `SELECT e.enumlabel AS ertek
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    [tipus],
  );
  return rows.map((r) => r.ertek);
}

const EVEK = HOLD_RETENTION_YEARS + 5; // jóval minden határidőn túl

describe('Retenciós állapot-mátrix: nincs határidő nélkül őrzött PII', () => {
  it('MINDEN fuvar-státusz × zárolás kombináció kikerül a PII-megőrzésből', async () => {
    const statuszok = await enumErtekek('job_status');
    expect(statuszok.length, 'nem sikerült kiolvasni a job_status enumot — az őr vak').toBeGreaterThan(4);

    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    // Minden cella SAJÁT, friss fuvart kap → sorrend-független.
    const cellak = [];
    for (const statusz of statuszok) {
      for (const hold of [false, true]) {
        const job = await createJob({
          shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
        });
        await db.query(
          `UPDATE jobs
              SET status = $2::job_status,
                  photo_retention_hold = $3,
                  updated_at = NOW() - ($4 || ' years')::interval,
                  created_at = NOW() - ($4 || ' years')::interval
            WHERE id = $1`,
          [job.id, statusz, hold, EVEK],
        );
        cellak.push({ id: job.id, statusz, hold });
      }
    }

    await runDailyRetention();

    const beragadt = [];
    for (const c of cellak) {
      const { rows } = await db.query(
        `SELECT status::text AS status, anonymized_at, recipient_phone, tracking_token,
                delivery_code, pickup_address
           FROM jobs WHERE id = $1`,
        [c.id],
      );
      const j = rows[0];
      if (!j) continue; // törölve is elfogadható végállapot
      const marPII = j.recipient_phone || j.tracking_token || j.delivery_code;
      // Elfogadható: anonimizálva VAGY a státusz megváltozott (lejáratás →
      // egy következő kör anonimizálja) VAGY már nincs benne PII.
      const rendben = j.anonymized_at !== null || j.status !== c.statusz || !marPII;
      if (!rendben) {
        beragadt.push(`status='${c.statusz}', hold=${c.hold}`);
      }
    }

    expect(
      beragadt,
      'EZEK AZ ÁLLAPOTOK MINDEN RETENCIÓS SZABÁLY ALÓL KIESNEK:\n  '
      + `${beragadt.join('\n  ')}\n\n`
      + `Egy ${EVEK} éves fuvar ezekben az állapotokban HATÁRIDŐ NÉLKÜL megőrzi a\n`
      + 'címzett nevét/telefonját/e-mailjét, az átvételi kódot, az ÉLŐ követő-\n'
      + 'tokent és a házszámig pontos címet — miközben a tájékoztató 3, zárolt\n'
      + 'ügyletnél 5 évet ígér.\n\n'
      + 'Ez a hiba KÉTSZER fordult elő ugyanabban az osztályban (2026-08-10 és\n'
      + '-11), mindkétszer azért, mert a javítás csak a felfedezett ágra került.\n'
      + 'Vagy vedd fel az állapotot valamelyik retenciós ágba, vagy gondoskodj\n'
      + 'róla, hogy a fuvar ne ragadhasson bele (életciklus-lejáratás).',
    ).toEqual([]);
  });

  it('MINDEN foglalás-státusz × zárolás kombináció kikerül a PII-megőrzésből', async () => {
    const statuszok = await enumErtekek('route_booking_status');
    expect(statuszok.length, 'nem sikerült kiolvasni a route_booking_status enumot').toBeGreaterThan(3);

    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });

    const cellak = [];
    for (const statusz of statuszok) {
      for (const hold of [false, true]) {
        const { booking: bk } = await createBooking({
          shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
        });
        await db.query(
          `UPDATE route_bookings
              SET status = $2::route_booking_status,
                  photo_retention_hold = $3,
                  created_at = NOW() - ($4 || ' years')::interval,
                  delivered_at = NOW() - ($4 || ' years')::interval
            WHERE id = $1`,
          [bk.id, statusz, hold, EVEK],
        );
        cellak.push({ id: bk.id, statusz, hold });
      }
    }

    await runDailyRetention();

    const beragadt = [];
    for (const c of cellak) {
      const { rows } = await db.query(
        `SELECT status::text AS status, anonymized_at, recipient_phone, tracking_token, delivery_code
           FROM route_bookings WHERE id = $1`,
        [c.id],
      );
      const b = rows[0];
      // ⚠️ NEM `continue`: a hiányzó sor korábban VAK ZÖLDET adott. A
      // createBooking `{ booking, routeId }`-t ad vissza, nem a sort — az
      // elgépelt azonosítóval a SELECT üresen tért vissza, és a teszt boldogan
      // átment anélkül, hogy bármit is mért volna.
      expect(b, `a foglalás nem jött létre (statusz=${c.statusz}) — az őr vakon zöldelne`).toBeTruthy();
      const marPII = b.recipient_phone || b.tracking_token || b.delivery_code;
      if (!(b.anonymized_at !== null || b.status !== c.statusz || !marPII)) {
        beragadt.push(`status='${c.statusz}', hold=${c.hold}`);
      }
    }

    expect(
      beragadt,
      `EZEK A FOGLALÁS-ÁLLAPOTOK KIESNEK MINDEN SZABÁLY ALÓL:\n  ${beragadt.join('\n  ')}\n\n`
      + 'Ugyanaz az invariáns, mint a fuvar-ágon: nincs olyan állapot, amiben\n'
      + 'határidő nélkül megőrizzük a személyes adatot.',
    ).toEqual([]);
  });
});
