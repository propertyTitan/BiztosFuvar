// =====================================================================
//  KÖVETŐ-LINK LEJÁRAT — ÁLLAPOT-MÁTRIX (2026-08-12, 11. mérés A2)
//
//  ⚠️ A KÉZI LISTA MÁR KÉTSZER HIÁNYOS VOLT.
//
//  A `publicTracking.js` kézzel sorolta fel, mely státuszok számítanak
//  lezártnak. Előbb a `'rejected'` maradt ki (foglalási ág) — javítottuk,
//  kézzel bővítve a listát. Két körrel később kiderült, hogy a `'disputed'`
//  is hiányzik, és ez ÉLŐ rés volt:
//
//    * a vita nyitása a fuvart `status='disputed'`-re állítja,
//    * a 14 napos lejárat ezért SOSEM futott le rá,
//    * a `repairDisputedHold` a zárolással 5 évre tolta az anonimizálást is,
//    * addig BEJELENTKEZÉS NÉLKÜL elérhető maradt a címzett neve, a pontos
//      kézbesítési cím és a szállító neve/telefonszáma.
//
//  A javítás ezért nem egy státusz hozzáadása volt, hanem SZÁRMAZTATÁS a
//  retention.js igazságforrásából. Ez az őr pedig a MÁTRIXOT méri: minden
//  létező státuszra végigpróbálja, hogy egy régi link vagy lejár, vagy
//  írásos indoka van, hogy miért nem.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');
const { TRACKING_GRACE_DAYS } = require('../src/routes/publicTracking');

/**
 * Státuszok, amiknél a link SZÁNDÉKOSAN nem jár le — indoklás kötelező.
 * Ezek a fuvar ÉLŐ szakaszai: a követés épp ilyenkor szolgál valamit.
 */
const ELO_STATUSZOK = {
  pending: 'A fuvar még nem kelt el; a címzett nem is kapott linket.',
  bidding: 'Ugyanaz — ajánlatokat vár, nincs kit követni.',
  accepted: 'Elkelt, de még nem indult el. A címzett ekkor kapja a linket.',
  in_progress: 'A csomag ÚTON van — a követés pontosan ezt szolgálja.',
};

async function enumErtekek(tipus) {
  const { rows } = await db.query(
    `SELECT e.enumlabel AS ertek FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    [tipus],
  );
  return rows.map((r) => r.ertek);
}

describe('Követő-link lejárat: minden státuszra mérve', () => {
  it('MINDEN fuvar-státuszra vagy lejár a régi link, vagy írásos indoka van', async () => {
    const statuszok = await enumErtekek('job_status');
    expect(statuszok.length, 'nem sikerült kiolvasni a job_status enumot').toBeGreaterThan(4);

    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const gondok = [];

    for (const statusz of statuszok) {
      const job = await createJob({
        shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
      });
      // A link jóval a türelmi időn túl van.
      const napok = TRACKING_GRACE_DAYS + 30;
      const { rows } = await db.query(
        `UPDATE jobs
            SET status = $2::job_status,
                status_before_dispute = CASE WHEN $2 = 'disputed' THEN 'delivered'::job_status END,
                delivered_at = NOW() - ($3 || ' days')::interval,
                updated_at   = NOW() - ($3 || ' days')::interval,
                created_at   = NOW() - ($3 || ' days')::interval
          WHERE id = $1
        RETURNING tracking_token`,
        [job.id, statusz, napok],
      );
      const token = rows[0].tracking_token;
      expect(token, 'a fixture nem adott követő-tokent').toBeTruthy();

      const res = await request(app).get(`/tracking/${token}`);
      const lejart = res.status === 410;

      if (ELO_STATUSZOK[statusz]) {
        // Élő szakasz: NEM szabad lejárnia.
        if (lejart) gondok.push(`status='${statusz}': lejárt, pedig ÉLŐ szakasz (${ELO_STATUSZOK[statusz]})`);
      } else if (!lejart) {
        gondok.push(
          `status='${statusz}': a ${napok} napos link NEM járt le (HTTP ${res.status})`,
        );
      }
    }

    expect(
      gondok,
      `Követő-link lejárati hibák:\n  ${gondok.join('\n  ')}\n\n`
      + 'A követő-link BEJELENTKEZÉS NÉLKÜL elérhető, és a címzett nevét, a\n'
      + 'pontos kézbesítési címet és (fizetés után) a szállító telefonszámát\n'
      + 'adja. Ha egy státuszra nem jár le, az évekig nyitva marad.\n\n'
      + 'Ha egy státusznál SZÁNDÉKOS, hogy ne járjon le, vedd fel az\n'
      + 'ELO_STATUSZOK listába, írásos indoklással. A kézi felsorolás MÁR\n'
      + 'KÉTSZER volt hiányos (rejected, majd disputed) — ezért származtatjuk\n'
      + 'a retention.js igazságforrásából.',
    ).toEqual([]);
  }, 30_000);

  it('az ÉLŐ szakaszok indoklása érdemi', () => {
    for (const [k, v] of Object.entries(ELO_STATUSZOK)) {
      expect(v.length > 30, `A(z) "${k}" indoklása túl rövid.`).toBe(true);
    }
  });
});
