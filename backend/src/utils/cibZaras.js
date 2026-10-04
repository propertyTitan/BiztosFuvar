// =====================================================================
//  CIB FAGYASZTÁSI ŐR (2026-09-29, CIB PR-2/B)
//
//  Amíg egy fuvar kártyás díjfizetése a BANKNÁL lezárul (a vásárló már
//  jóváhagyta, a MSGT32 fut vagy kétes a kimenete, vagy a könyvelés még nem
//  futott le), az ügylet nem változhat: egy közben elfogadott lemondás,
//  szállítócsere, kupon vagy díjsáv-váltás után a bank terhelne egy olyan
//  ügyletre, amit a platform már nem tud teljesíteni (árva terhelés, kézi
//  visszatérítés). Ezért MINDEN ügyletmódosító út ezt az őrt futtatja:
//  lemondás (feladó és szállító), újranyitás, ajánlat-visszavonás, PATCH
//  /jobs, elfogadás / újraelfogadás, azonnali elfogadás, kuponbeváltás,
//  admin státuszváltás, kézi nyugtázás — a napi körök (lejáratás,
//  emlékeztető, elhagyott fuvar) pedig kihagyják a fuvart.
//
//  ⚠️ HASZNÁLAT: a hívó MINDIG a fuvarsor zárolása (`SELECT … FOR UPDATE`
//  vagy maga a módosító UPDATE) UTÁN, ugyanabban a tranzakcióban, ÚJ
//  utasításként futtatja, és fagyasztott ügyletnél ROLLBACK-kel (READ
//  COMMITTED: az új utasítás látja a közben commitolt `closing` sort). A
//  `NOT EXISTS` NEM kerülhet a módosító UPDATE-be: az EPQ-újraellenőrzés a
//  részlekérdezést a régi pillanatképből olvasná, és átengedné a párhuzamos
//  zárást.
//
//  A zárási claim (services/cibFizetes.js) UGYANAZT a fuvarsort zárolja, így
//  a kettő közül mindig pontosan egy nyer: vagy a módosítás (és a zárás
//  `not_closed` lesz, MSGT32 nélkül — a bank magától feloldja a zárolást),
//  vagy a zárás (és a módosítás 409 CIB_PAYMENT_FINISHING).
// =====================================================================

/** A fagyasztó CIB-alállapotok (a session még `pending`). */
const FAGYASZTO_ALLAPOTOK = Object.freeze(['authorized', 'closing', 'close_unknown', 'closed_ok']);

const FAGYASZTVA_KOD = 'CIB_PAYMENT_FINISHING';
const FAGYASZTVA_UZENET = 'A kártyás fizetésed épp lezárul — próbáld újra egy perc múlva.';
// 2026-10-03 (PR-5/B): a kétes (close_unknown) zárás egyeztetése nem „egy
// perc": az automatikus egyeztetés a MSGT10 után ~20 perccel indul, a kézi
// rendezés legkésőbb 1 munkanap. Eddig ugyanaz a „próbáld újra egy perc
// múlva" ment rá, napokig — és a szállítónak, az adminnak is „a kártyás
// fizetésed"-et mondtuk, holott a feladó fizetéséről van szó.
const EGYEZTETES_KOD = 'CIB_PAYMENT_REVIEW';
const FAGYASZTVA_SZOVEG = Object.freeze({
  zarul: Object.freeze({
    felado: FAGYASZTVA_UZENET,
    szallito: 'A feladó kártyás díjfizetése épp lezárul — próbáld újra egy perc múlva.',
    admin: 'A fuvar kártyás díjfizetése épp lezárul (a banki zárás fut) — próbáld újra egy perc múlva.',
  }),
  egyeztetes: Object.freeze({
    felado: 'A kártyás fizetésed eredményét a bankkal egyeztetjük — addig a fuvar nem módosítható. Ne fizess újra: '
      + 'legkésőbb 1 munkanapon belül rendezzük, az eredményről e-mailben értesítünk.',
    szallito: 'A feladó kártyás díjfizetésének eredményét a bankkal egyeztetjük — addig a fuvar nem módosítható '
      + '(legkésőbb 1 munkanap). Ha segítség kell, írj az info@gofuvar.hu címre.',
    admin: 'A fuvar kártyás díjfizetése egyeztetésre vár (kétes zárás vagy felülvizsgálat) — előbb az Admin → '
      + 'Kártyás fizetések blokkban rendezd.',
  }),
});

/**
 * Van-e a fuvarnak éppen lezáruló CIB-kísérlete? A fuvarsor zárolása UTÁN,
 * ugyanazon a kliensen hívandó.
 * @param {{query: Function}} client — a hívó tranzakciójának kliense
 * @param {string} jobId
 * @returns {Promise<{payment_id:string, cib_state:string}|null>}
 */
async function cibZarasFolyamatban(client, jobId) {
  if (!jobId) return null;
  const { rows } = await client.query(
    `SELECT payment_id, cib_state FROM payment_sessions
      WHERE job_id = $1 AND provider = 'cib' AND state = 'pending'
        AND cib_state = ANY($2::text[])
      LIMIT 1`,
    [jobId, FAGYASZTO_ALLAPOTOK],
  );
  return rows[0] || null;
}

/**
 * A fagyasztott ügylet 409-es válasza (banki szöveg nélkül) — a hívó
 * szerepéhez és a kísérlet állapotához igazítva (2026-10-03, PR-5/B).
 * @param {{cib_state?:string, state?:string}|null} [fagy] — a cibZarasFolyamatban
 *   eredménye (vagy egy session-sor)
 * @param {'felado'|'szallito'|'admin'} [szerep]
 */
function fagyasztvaValasz(fagy = null, szerep = 'felado') {
  const egyeztetes = !!fagy && (fagy.cib_state === 'close_unknown' || fagy.state === 'needs_review');
  const ki = ['felado', 'szallito', 'admin'].includes(szerep) ? szerep : 'felado';
  return {
    error: FAGYASZTVA_SZOVEG[egyeztetes ? 'egyeztetes' : 'zarul'][ki],
    code: egyeztetes ? EGYEZTETES_KOD : FAGYASZTVA_KOD,
  };
}

/**
 * SQL-feltétel a napi körökhöz: a fuvarnak NINCS nem végállapotú (vagy
 * egyeztetésre váró) CIB-kísérlete. A lejáratás, az emlékeztető és az
 * elhagyott-fuvar kör ezzel hagyja ki a fuvart — nem csak a zárás alatt,
 * hanem amíg a vásárló a bank oldalán jár is (egy közben lezárt fuvarra a
 * jóváhagyás `not_closed` lenne, a vásárló fölöslegesen fizetne újra).
 * @param {string} jobAlias — a jobs tábla aliasa a hívó lekérdezésében
 */
function nincsFuggoCibKiserlet(jobAlias) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(jobAlias)) throw new Error('Érvénytelen alias.');
  return `NOT EXISTS (SELECT 1 FROM payment_sessions cibps
     WHERE cibps.job_id = ${jobAlias}.id AND cibps.cib_state IS NOT NULL
       AND cibps.state IN ('pending', 'needs_review'))`;
}

module.exports = {
  FAGYASZTO_ALLAPOTOK,
  FAGYASZTVA_KOD,
  FAGYASZTVA_UZENET,
  EGYEZTETES_KOD,
  cibZarasFolyamatban,
  fagyasztvaValasz,
  nincsFuggoCibKiserlet,
};
