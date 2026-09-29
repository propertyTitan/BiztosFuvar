// =====================================================================
//  CIB EKI — A LEKÉRDEZŐ KÖR (2026-09-29, CIB PR-2/B)
//
//  Nincs banki webhook: a jóváhagyott tranzakciót a GoFuvarnak kell a
//  10–15 perces banki ablakon belül lezárnia (MSGT32), különben a bank
//  reverzál. A visszatérés (a böngésző) megbízhatatlan — bezárt fül,
//  PWA → Safari, alkalmazásváltás 3DS közben —, ezért ez a DB-alapú kör
//  30 s-onként felveszi az esedékes kísérleteket, és ugyanazt a
//  `feldolgoz` motort futtatja, mint a visszatérés.
//
//  * Kiválasztás + bérlet EGY autocommit utasításban, FOR UPDATE SKIP
//    LOCKED-dal: két példány (deploy-átfedés) és két párhuzamos tick sem
//    dolgozik ugyanazon a TRID-en.
//  * A bevezetés-dátum küszöb (CIB_BEVEZETES) kötelező projektszabály: a kör
//    csak az utána keletkezett sorokhoz nyúl.
//  * Rátavédelem: tickenként legfeljebb CIB_KOR_MAX_KERES MSGT33; D04 után
//    globális visszalépés (a MSGT32 ez alatt is mehet — ablakhoz kötött);
//    a bank S-hibájára a tick megszakad.
//  * Szívverés: minden tick (és minden sor) frissíti — a /pay csak friss
//    szívverés mellett indít új engedélyeztetést („ne engedélyeztessünk
//    pénzt, ha nincs, ami lezárja").
// =====================================================================
const db = require('../db');
const p = require('./cibProtokoll');
const cibFizetes = require('./cibFizetes');
const { jelezSorHibak } = require('./utemezo');

const KOR_LIMIT = 25;

/**
 * Egy tick. Visszaadja a felvett (bérelt) sorok számát.
 */
async function runCibKor() {
  const paymentProvider = require('./paymentProvider');
  if (!paymentProvider.usesCibEki()) return 0;
  cibFizetes.szivveres();
  if (cibFizetes.leallasFolyamatban()) return 0;
  const b = p.cibBeallitasok();
  const berlo = cibFizetes.ujBerlo();
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_lease_until = NOW() + make_interval(mins => $3::int), cib_lease_owner = $1
      WHERE payment_id IN (
        SELECT payment_id FROM payment_sessions
         WHERE provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL
           AND created_at >= $2::date
           AND cib_next_action_at <= NOW()
           AND (cib_lease_until IS NULL OR cib_lease_until < NOW())
         ORDER BY CASE cib_state WHEN 'authorized' THEN 0 WHEN 'closed_ok' THEN 1 WHEN 'closing' THEN 2 ELSE 3 END,
                  cib_next_action_at
         LIMIT $4
         FOR UPDATE SKIP LOCKED)
      RETURNING *, NOW() AS db_most`,
    [berlo, b.bevezetes, cibFizetes.BERLET_PERC, KOR_LIMIT],
  );
  // A RETURNING sorrendje NEM a részlekérdezés ORDER BY-a (a Postgres a
  // frissítés sorrendjében adja vissza) — a prioritást itt is érvényesítjük:
  // előbb a jóváhagyott (zárandó, ablakhoz kötött), aztán a könyvelendő.
  const PRIORITAS = { authorized: 0, closed_ok: 1, closing: 2 };
  rows.sort((x, y) => ((PRIORITAS[x.cib_state] ?? 3) - (PRIORITAS[y.cib_state] ?? 3))
    || (new Date(x.cib_next_action_at) - new Date(y.cib_next_action_at)));
  const ctx = { maradekKeres: b.hangolok.korMaxKeres, megszakitva: false };
  const hibak = [];
  for (const sor of rows) {
    cibFizetes.szivveres();
    try {
      // Leállás vagy megszakított tick: a maradék sorok bérletét elengedjük.
      if (!ctx.megszakitva && !cibFizetes.leallasFolyamatban()) {
        // eslint-disable-next-line no-await-in-loop
        await cibFizetes.lepes(sor, berlo, 'kor', ctx);
      }
    } catch (err) {
      console.error(`[cib-lekerdezes] ${p.maszkoltTrid(sor.payment_id)} hiba:`, err && err.message);
      hibak.push(err);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await cibFizetes.berletFelszabadit(sor.payment_id, berlo).catch(() => {});
    }
  }
  jelezSorHibak('cib-lekerdezes', hibak);
  return rows.length;
}

module.exports = { runCibKor, KOR_LIMIT };
