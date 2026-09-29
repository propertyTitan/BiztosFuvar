// =====================================================================
//  CIB EKI — A LEKÉRDEZŐ KÖR (2026-09-29, CIB PR-2/B, üzemeltetés: PR-2/C)
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
//  * Szívverés: a /pay csak friss szívverés mellett indít új
//    engedélyeztetést („ne engedélyeztessünk pénzt, ha nincs, ami lezárja").
//    ⚠️ 2026-09-29 (PR-2/C): a szívverés CSAK a SIKERES kiválasztás után
//    frissül (és soronként a feldolgozás alatt) — eddig a tick ELEJÉN, tehát
//    egy minden tickben DB-hibán elhasaló kör (pl. a 096-os migráció még nem
//    futott le a prodon) „élőnek" számított, és a /pay pénzt
//    engedélyeztetett, amit semmi nem tudott lezárni.
//  * Szívverés-figyelő: 3 perc csend (vagy az indulás óta egyetlen sikeres
//    tick sem) → Sentry + riasztó levél, 30 percenként legfeljebb egyszer.
//  * Értesítés-helyreállítás (a PR-1 folytatása): 5 percenként a körben
//    kimennek az elveszett díjfizetés utáni értesítések (összeomlás a
//    könyvelés és az értesítési claim között).
//  * Leállás: minden sor feldolgozása egy munkaegység (cibFizetes.munkaban),
//    a szabályos leállás a futó egységet megvárja.
// =====================================================================
const db = require('../db');
const p = require('./cibProtokoll');
const cibFizetes = require('./cibFizetes');
const { jelezSorHibak } = require('./utemezo');

const KOR_LIMIT = 25;
const SZIVVERES_RIASZTAS_MS = 3 * 60 * 1000;
const SZIVVERES_RIASZTAS_KOZ_MS = 30 * 60 * 1000;
// Az értesítés-helyreállítás ritmusa. Az első futás is csak ennyivel a
// folyamat indulása UTÁN jön: az újraindulás után a még futó könyvelések
// claimjét (másik példány) ne előzzük meg, és a 30 s-os tick ne kérdezze
// minden alkalommal a díjbizonylatokat.
const HELYREALLITAS_KOZ_MS = 5 * 60 * 1000;

const korAllapot = {
  indulas: Date.now(),
  utolsoSzivRiasztas: 0,
  kovHelyreallitas: Date.now() + HELYREALLITAS_KOZ_MS,
};

function sentry(uzenet) {
  if (!process.env.SENTRY_DSN) return;
  try {
    require('@sentry/node').captureMessage(uzenet, { level: 'error', tags: { csatorna: 'fizetes', hibamod: 'cib' } });
  } catch { /* a riasztás hibája nem érintheti a kört */ }
}

/**
 * Az elveszett díjfizetés utáni értesítések pótlása (5 percenként, nem
 * leállás közben). A hibája a kör soronkénti hibái közé kerül — nem
 * állítja meg a zárásokat.
 */
async function ertesitesHelyreallitas(b, hibak) {
  if (Date.now() < korAllapot.kovHelyreallitas || cibFizetes.leallasFolyamatban()) return;
  korAllapot.kovHelyreallitas = Date.now() + HELYREALLITAS_KOZ_MS;
  try {
    // A modul-objektumon át (nem destrukturálva): így a hívás pillanatában
    // érvényes megvalósítás fut.
    await require('./feeNotifications').runDijErtesitesHelyreallitas({ since: b.bevezetes });
  } catch (err) {
    console.error('[cib-lekerdezes] értesítés-helyreállítás hiba:', err && err.message);
    hibak.push(err);
  }
}

/**
 * Egy tick. Visszaadja a felvett (bérelt) sorok számát.
 */
async function runCibKor() {
  const paymentProvider = require('./paymentProvider');
  if (!paymentProvider.usesCibEki()) return 0;
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
  // A kör MŰKÖDIK (a DB elérhető, a séma a kódhoz illik): csak most él.
  cibFizetes.szivveres();
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
      // Egy sor feldolgozása + a bérlet elengedése EGY munkaegység: a
      // szabályos leállás a futót megvárja (a pool.end() előtt).
      // eslint-disable-next-line no-await-in-loop
      await cibFizetes.munkaban(async () => {
        try {
          if (!ctx.megszakitva && !cibFizetes.leallasFolyamatban()) {
            await cibFizetes.lepes(sor, berlo, 'kor', ctx);
          }
        } finally {
          await cibFizetes.berletFelszabadit(sor.payment_id, berlo).catch(() => {});
        }
      });
    } catch (err) {
      console.error(`[cib-lekerdezes] ${p.maszkoltTrid(sor.payment_id)} hiba:`, err && err.message);
      hibak.push(err);
    }
  }
  await ertesitesHelyreallitas(b, hibak);
  jelezSorHibak('cib-lekerdezes', hibak);
  return rows.length;
}

/**
 * Szívverés-figyelő (percenként, index.js). Ha a kör 3 perce nem futott le
 * sikeresen — vagy az indulás óta egyszer sem —, a /pay 503-at ad, és a
 * jóváhagyott tételek zárása is áll: ezt valakinek látnia kell. A Sentryt
 * nem nézi senki naponta, a leveleket igen → Sentry + riasztó levél,
 * 30 percenként legfeljebb egyszer. CIB-konfig nélkül és leállás közben
 * csendes.
 * @param {number} [most]
 * @returns {boolean} riasztott-e
 */
function szivveresFigyelo(most = Date.now()) {
  if (!require('./paymentProvider').usesCibEki()) return false;
  if (cibFizetes.leallasFolyamatban()) return false;
  const utolso = cibFizetes.utolsoSzivveres();
  const kor = most - (utolso || korAllapot.indulas);
  if (kor <= SZIVVERES_RIASZTAS_MS) return false;
  if (korAllapot.utolsoSzivRiasztas && most - korAllapot.utolsoSzivRiasztas < SZIVVERES_RIASZTAS_KOZ_MS) return false;
  korAllapot.utolsoSzivRiasztas = most;
  const uzenet = `[cib-lekerdezes] 🚨 ${Math.round(kor / 1000)} mp óta nincs sikeres tick`
    + (utolso ? '' : ' (az indulás óta egy sem)')
    + ' — a kártyás fizetés 503-at ad, a jóváhagyott tételek zárása áll';
  console.error(uzenet);
  sentry(uzenet);
  const b = p.cibBeallitasok();
  // A levelező modult a hívás pillanatában olvassuk (a teszt-üzemi csere is
  // ugyanazt a csatornát lássa). A levél hibája (akár szinkron) nem
  // akaszthatja a figyelőt, és nem szabadulhat el kezeletlenül.
  try {
    Promise.resolve(require('./email').sendCibRiasztasEmail({
      to: b.riasztasEmail || 'info@gofuvar.hu', trid: null, jobId: null, ok: 'szivveres',
    })).catch((err) => console.warn('[cib-lekerdezes] riasztó levél hiba:', err && err.message));
  } catch (err) {
    console.warn('[cib-lekerdezes] riasztó levél hiba:', err && err.message);
  }
  return true;
}

/** CSAK TESZTHEZ: a kör memóriabeli állapotának beállítása. */
function __korAllapotForTests(ertekek = {}) {
  Object.assign(korAllapot, ertekek);
}

module.exports = {
  runCibKor,
  szivveresFigyelo,
  __korAllapotForTests,
  KOR_LIMIT,
  SZIVVERES_RIASZTAS_MS,
  HELYREALLITAS_KOZ_MS,
};
