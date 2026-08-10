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
const UTCA_SZAVAK = /(utca|utcza|\bút\b|\butja\b|körút|krt\.?|\btér\b|tere|sétány|köz\b|sor\b|dűlő|\bstra(ss|ß)e\b|\bstr\.|\bstreet\b|\bst\.|\bavenue\b|\bave\.|\broad\b|\brd\.|\bstrada\b|\bstr\b|\bvia\b|\brue\b|\bulica\b|\bplatz\b)/i;

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

module.exports = { telepulesSzint };
