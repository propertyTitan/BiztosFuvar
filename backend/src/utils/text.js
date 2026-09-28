// =====================================================================
//  Szöveges body-mezők biztonságos kezelése
//
//  2026-08-06, az adversarial-matrix találata: több végpont közvetlenül
//  hívta a `.trim()`-et egy body-mezőn, előzetes típus-ellenőrzés nélkül:
//
//      if (!description || !description.trim()) { ... }
//
//  Ez minden nem-string, de „truthy" értékre 500-zal szállt el
//  (`description.trim is not a function`) — szám, boolean, tömb, objektum.
//  A user ezt nem gépeli be, de egy elrontott kliens-verzió, egy régi
//  mobilapp vagy egy szkript simán küld ilyet, és a felhasználó csak egy
//  néma „Szerverhiba"-t lát.
//
//  Ezért NEM egyenként foltozzuk: minden szöveges mező ezen a kapun megy át.
// =====================================================================

/**
 * Egy body-mezőt biztonságosan szöveggé alakít.
 * Nem-string (szám, boolean, tömb, objektum, null) → üres string, vagyis
 * a hívó szokásos „kötelező mező hiányzik" ága fut le, 4xx-szel.
 *
 * SZÁNDÉKOSAN nem `String(value)`: a `String(12345)` „12345"-öt adna, azaz
 * elfogadnánk egy számot szövegnek. Egy rossz típus HIBA, nem konverziós
 * feladat — a kliens kapja meg a 400-at, hogy javíthassa.
 */
function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Kötelező szöveges mező ellenőrzése.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function requireText(value, { label, min = 1, max = 5000 }) {
  const text = asText(value);
  if (!text) {
    return { ok: false, error: `${label} megadása kötelező.` };
  }
  if (text.length < min) {
    return { ok: false, error: `${label} minimum ${min} karakter legyen.` };
  }
  if (text.length > max) {
    return { ok: false, error: `${label} maximum ${max} karakter lehet.` };
  }
  return { ok: true, value: text };
}

/**
 * Opcionális szöveges mezők típus-kapuja (2026-09-28, audit P1).
 *
 * A `mezo || null` minta a nem-stringet is továbbadta a pg-nek: a tömb
 * '{"…"}' literálként, az objektum JSON-ként, a szám szövegként került a
 * TEXT-oszlopba — és a kontakt-szűrő a nem-szöveget nem vizsgálta. Hiányzó
 * mező (undefined/null) rendben; bármi más nem-string → a hívó 400-at ad.
 * @returns {string|null} az ELSŐ megadott, de nem-string mező neve, vagy null
 */
function elsoNemSzovegMezo(obj, mezok) {
  for (const mezo of mezok) {
    const v = obj?.[mezo];
    if (v !== undefined && v !== null && typeof v !== 'string') return mezo;
  }
  return null;
}

/** Az `elsoNemSzovegMezo` találatának egységes 400-as válasz-törzse. */
function nemSzovegValasz(mezo) {
  return { error: `A(z) ${mezo} mezőbe csak szöveg írható.`, code: 'INVALID_TEXT_FIELD', field: mezo };
}

module.exports = { asText, requireText, elsoNemSzovegMezo, nemSzovegValasz };
