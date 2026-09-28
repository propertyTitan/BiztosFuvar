// =====================================================================
//  Címzett-adatok közös validátora (2026-09-28, audit P1 — R2-3).
//
//  A címzett neve a DKIM-aláírt, noreply@gofuvar.hu-ról küldött levelekbe
//  (feladás, felvétel, érkezés, kézbesítés), a publikus követő-oldalra
//  („Szia {név}!") és a szállító fuvar-oldalára kerül. Eddig csak `trim()`-et
//  kapott: hossz- és kontakt-szűrés nélkül egy támadó által választott
//  címre küldött, márkázott levélben vitt linket/telefonszámot (a text/plain
//  részben a levelező kattinthatóvá teszi). A PR #147 ezt a `full_name`-re
//  zárta le, a címzett nevére nem — és a járat-foglalás ágon a címzett-mezők
//  semmilyen ellenőrzést nem kaptak. Mostantól MINDEN címzett-író út ezt hívja
//  (őr: tests/audit-20260928-cimzett-level.test.js, forrás-szinten is).
//
//  Szabályok (a regisztráció név-szabályával egyezően):
//   - típus: hiányzó/null = üres, egyébként csak string (különben 400);
//   - név ≤ 100 karakter, számjegy nélkül (NAME_HAS_DIGITS), rejtett
//     vezérlő-/irányváltó karakter nélkül, kontakt-szűrőn átmenve;
//   - ha bármelyik címzett-mező ki van töltve, név ÉS telefon kötelező;
//   - telefon 9–15 számjegy, betű nélkül; e-mail formátum-ellenőrzött.
// =====================================================================

const { firstContactLeak } = require('./contactGuard');
const { NEV_SZAMJEGY_HIBA, nevbenSzamjegy } = require('./nev');

const CIMZETT_NEV_MAX = 100;
// C0/C1 vezérlők (sortörés is — a text/plain levélben új „bekezdést" nyitna),
// zero-width és bidi-irányváltók (a „www" betűi közé tett láthatatlan jel
// átcsúszna a link-szűrőn, a U+202E pedig megfordítja a megjelenő szöveget).
const REJTETT_KARAKTER = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

const hiba = (error, code) => ({ ok: false, error, code });

/**
 * @returns {{ ok: true, recipientName: string, recipientPhone: string, recipientEmail: string }
 *   | { ok: false, error: string, code: string }}
 *   Az értékek trimmelt stringek; üres string = nincs megadva.
 */
function ellenorizCimzett({ recipient_name, recipient_phone, recipient_email } = {}) {
  const szoveg = (v) => (v === undefined || v === null ? '' : v);
  const nyersNev = szoveg(recipient_name);
  const nyersTelefon = szoveg(recipient_phone);
  const nyersEmail = szoveg(recipient_email);
  if (typeof nyersNev !== 'string') return hiba('A címzett neve szöveg legyen.', 'RECIPIENT_NAME_INVALID');
  if (typeof nyersTelefon !== 'string') {
    return hiba('A címzett telefonszáma érvénytelen (add meg körzetszámmal, pl. +36 30 123 4567).', 'RECIPIENT_PHONE_INVALID');
  }
  if (typeof nyersEmail !== 'string') {
    return hiba('A címzett e-mail címe érvénytelen (pl. nev@email.hu) — javítsd, vagy hagyd üresen.', 'RECIPIENT_EMAIL_INVALID');
  }
  const recipientName = nyersNev.trim();
  const recipientPhone = nyersTelefon.trim();
  const recipientEmail = nyersEmail.trim();

  // Címzett: ha MÁS veszi át (bármelyik címzett-mező ki van töltve), akkor a
  // NÉV és a TELEFONSZÁM együtt kötelező (tesztelői észrevétel, 2026-08-04).
  // Enélkül a szállító a címen áll egy névvel, akit nem tud felhívni — és a
  // felvételkori SMS (átvételi kód) sem tud kimenni.
  if ((recipientName || recipientPhone || recipientEmail) && (!recipientName || !recipientPhone)) {
    return hiba('Ha más veszi át a csomagot, a címzett neve ÉS telefonszáma is kötelező.', 'RECIPIENT_INCOMPLETE');
  }
  if (recipientName) {
    if (REJTETT_KARAKTER.test(recipientName)) {
      return hiba('A címzett neve nem tartalmazhat sortörést vagy rejtett vezérlőkaraktert.', 'RECIPIENT_NAME_INVALID');
    }
    if (recipientName.length > CIMZETT_NEV_MAX) {
      return hiba(`A címzett neve legfeljebb ${CIMZETT_NEV_MAX} karakter lehet.`, 'RECIPIENT_NAME_TOO_LONG');
    }
    if (nevbenSzamjegy(recipientName)) return hiba(NEV_SZAMJEGY_HIBA, 'NAME_HAS_DIGITS');
    const leak = firstContactLeak([recipientName]);
    if (leak) return hiba(leak, 'CONTACT_LEAK');
  }
  if (recipientPhone) {
    const digits = recipientPhone.replace(/\D/g, '');
    if (/[a-zA-Z]/.test(recipientPhone) || digits.length < 9 || digits.length > 15) {
      return hiba('A címzett telefonszáma érvénytelen (add meg körzetszámmal, pl. +36 30 123 4567).', 'RECIPIENT_PHONE_INVALID');
    }
  }
  // GF-005 (Manus, 2026-08-30): a címzett-e-mail opcionális, de ha meg van
  // adva, követési linket ígérünk rá — hibás címre a levél némán a semmibe
  // ment volna. Ugyanaz a minta, mint a regisztrációs e-mailnél (auth.js).
  if (recipientEmail && (recipientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipientEmail))) {
    return hiba('A címzett e-mail címe érvénytelen (pl. nev@email.hu) — javítsd, vagy hagyd üresen.', 'RECIPIENT_EMAIL_INVALID');
  }
  return { ok: true, recipientName, recipientPhone, recipientEmail };
}

module.exports = { ellenorizCimzett, CIMZETT_NEV_MAX };
