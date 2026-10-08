// =====================================================================
//  Cím településszintre rövidítése
//
//  ⚠️ 2026-08-09 (adatáramlási audit, ÉLŐ szivárgás). A korábbi megoldás az
//  első vessző előtti részt tartotta meg:
//
//      cim.split(',')[0]
//
//  Ez CSAK a magyar Google-címformátumon működik, ahol a település áll elöl:
//      „Budapest, Váci út 1, 1132"            → „Budapest"            ✅
//  A német/osztrák/román formátumban viszont az UTCA áll elöl:
//      „Hauptstraße 5, 10115 Berlin, Germany" → „Hauptstraße 5"       ❌
//      „Strada Mihai Viteazu 12, Arad"        → „Strada Mihai Viteazu 12" ❌
//
//  Vagyis pont a pontos utca + házszám maradt meg — miközben a koordinátát
//  mellette gondosan ~1 km-re kerekítjük. A két védelem kioltotta egymást,
//  a coverage pedig Európa-szintű.
//
//  AZ ÚJ SZABÁLY: nem pozíció alapján választunk, hanem TARTALOM alapján —
//  eldobjuk azt a szakaszt, amiben házszám (vagy utca-jelölő) van, és az
//  első „tiszta" szakaszt adjuk vissza. Az irányítószám megmaradhat: az
//  településszintű információ, nem azonosít lakást.
// =====================================================================

// Utca-jelölők a fő piacainkon. Nem ezen áll vagy bukik a védelem (a
// házszám-ellenőrzés az elsődleges), csak a számot NEM tartalmazó
// utcaneveket is kiszűri („Váci út", „Hauptstraße").
const UTCA_SZAVAK = /(utca|utcza|\bu\.|\bút\b|\butja\b|körút|krt\.?|\btér\b|tere|sétány|köz\b|sor\b|dűlő|\bstra(ss|ß)e\b|\bstr\.|\bstreet\b|\bst\.|\bavenue\b|\bave\.|\broad\b|\brd\.|\bstrada\b|\bstr\b|\bvia\b|\brue\b|\bulica\b|\bplatz\b)/i;

// Vezető irányítószám (HU 4 jegyű, DE/AT/RO 4-6 jegyű) — ez maradhat.
const VEZETO_IRSZ = /^\d{4,6}\s+/;

/**
 * Egy címből a településszintű részt adja vissza.
 *
 * @param {string} cim — teljes, formázott cím (Google `formatted_address`)
 * @returns {string} településszintű rész; ha egyik szakasz sem biztonságos,
 *          üres string (ilyenkor a ~1 km-re kerekített koordináta hordozza a
 *          piaci információt — inkább kevesebb, mint egy pontos lakcím)
 */
function telepulesSzint(cim) {
  if (!cim || typeof cim !== 'string') return cim;

  const szakaszok = cim.split(',').map((s) => s.trim()).filter(Boolean);
  if (szakaszok.length === 0) return '';

  for (const szakasz of szakaszok) {
    // Az irányítószámot leválasztjuk, mielőtt számot keresnénk — különben a
    // „10115 Berlin" is „házszámosnak" látszana.
    const irszNelkul = szakasz.replace(VEZETO_IRSZ, '');
    if (/\d/.test(irszNelkul)) continue;   // maradt szám → házszám gyanús
    if (UTCA_SZAVAK.test(irszNelkul)) continue; // utcanév házszám nélkül
    return szakasz.slice(0, 60);
  }

  // Nem találtunk biztonságos szakaszt (pl. vessző nélküli „Váci út 1").
  // Ilyenkor semmit nem adunk vissza: a hozzávetőleges helyet a kerekített
  // koordináta közvetíti.
  return '';
}

/**
 * Egy címből az UTCA-SZINTŰ változatot adja vissza: a házszám lekerül, az
 * utca, a település és az irányítószám marad (GF-008, user-döntés
 * 2026-08-30: „a fizetésig csak az utca látszódjon, a házszám ne").
 *
 * Ugyanaz az elv, mint a telepulesSzint-nél: TARTALOM alapján dolgozunk,
 * nem pozíció alapján, mert a coverage Európa-szintű és a formátumok
 * eltérnek. FAIL-CLOSED: ha egy szakaszban a házszám-eltávolítás után is
 * marad gyanús szám, az EGÉSZ szakaszt eldobjuk — inkább kevesebb
 * információ, mint egy kiszivárgott lakcím.
 *
 * @param {string} cim — teljes, formázott cím (Google `formatted_address`)
 * @returns {string} utca-szintű cím; ha semmi biztonságos nem maradt,
 *          a településszintű változat
 */
function utcaSzint(cim) {
  if (!cim || typeof cim !== 'string') return cim;

  const szakaszok = cim.split(',').map((s) => s.trim()).filter(Boolean);
  const megtartott = [];

  for (const szakasz of szakaszok) {
    // Tiszta irányítószám-szakasz (magyar formátum: „…, 1132") → marad,
    // az területi információ, nem lakást azonosít.
    if (/^\d{4,6}$/.test(szakasz)) {
      megtartott.push(szakasz);
      continue;
    }

    let s = szakasz;
    // Vezető házszám (pl. „12 Main Street") — a vezető irányítószámot
    // („10115 Berlin") nem bántjuk.
    if (!VEZETO_IRSZ.test(s)) {
      s = s.replace(/^\d+[A-Za-z]?[\s.]+(?=\D)/, '');
    }
    // Záró házszám-tokenek: „Váci út 12.", „12/B", „60-62", „5".
    // ⚠️ A szám ELŐTTI pontot NEM esszük meg (UX-review A27, 2026-10-08):
    // az a rövidítésé („Piac u. 4" → „Piac u.", nem „Piac u").
    s = s
      .replace(/\s*\b\d+\s*[A-Za-z]?(?:\s*[/\-–.]\s*\d*\s*[A-Za-z]?)*\.?$/, '')
      .trim()
      .replace(/[,;]+$/, '')
      .trim();

    // FAIL-CLOSED: ha az (esetleges vezető irányítószám utáni) részben még
    // mindig van szám, nem tudjuk biztosan, mi az — a szakasz kimarad.
    const irszNelkul = s.replace(VEZETO_IRSZ, '');
    if (/\d/.test(irszNelkul)) continue;
    if (s) megtartott.push(s.slice(0, 80));
  }

  const eredmeny = magyarSorrend(megtartott).join(', ');
  return eredmeny || telepulesSzint(cim);
}

// A magyar Google-formátum („Debrecen, Piac u. 4, 4026") házszám nélkül
// „Debrecen, Piac u., 4026" lett — a VÉGÉRE került irányítószámot az olvasó
// HÁZSZÁMNAK értette, pedig a maszkolás épp azt ígéri, hogy házszám nem
// látszik (UX-review A27, 2026-10-08). Magyar címnél ezért a megszokott
// sorrendet adjuk: „4026 Debrecen, Piac u.". Csak akkor rendezünk át, ha a
// cím bizonyosan magyar szerkezetű (önálló, 4 jegyű irányítószám-szakasz,
// legfeljebb a magyar országnévvel); minden más formátum változatlan marad.
const HU_IRSZ_SZAKASZ = /^(\d{4})(?:\s+(?:Magyarország|Hungary))?$/i;
const HU_ORSZAG = /^(?:Magyarország|Hungary)$/i;

function magyarSorrend(szakaszok) {
  const irszIdx = szakaszok.findIndex((s) => HU_IRSZ_SZAKASZ.test(s));
  if (irszIdx === -1) return szakaszok;
  const telepulesIdx = szakaszok.findIndex((s, i) => i !== irszIdx
    && !/\d/.test(s) && !UTCA_SZAVAK.test(s) && !HU_ORSZAG.test(s));
  if (telepulesIdx === -1) return szakaszok;
  const irsz = szakaszok[irszIdx].match(HU_IRSZ_SZAKASZ)[1];
  const tobbi = szakaszok.filter((s, i) => i !== irszIdx && i !== telepulesIdx && !HU_ORSZAG.test(s));
  return [`${irsz} ${szakaszok[telepulesIdx]}`, ...tobbi];
}

/**
 * A település NEVE irányítószám nélkül — statisztikához, csoportosításhoz
 * („Budapest → Pécs"). Házszámot soha nem ad vissza (a telepulesSzint-re
 * épül, ami a házszámos szakaszt eldobja).
 *
 * @param {string} cim
 * @returns {string} pl. „Budapest"; ha nincs biztonságos szakasz: ''
 */
function telepulesNev(cim) {
  const t = telepulesSzint(cim);
  if (!t || typeof t !== 'string') return '';
  return t.replace(VEZETO_IRSZ, '').trim();
}

module.exports = { telepulesSzint, utcaSzint, telepulesNev };
