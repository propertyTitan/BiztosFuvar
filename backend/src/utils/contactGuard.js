// =====================================================================
//  Kapcsolat-szivárgás védelem (anti-bypass) — user-input validáció
//
//  Cél: a platform-megkerülés megakadályozása. Ha a user a publikus
//  Q&A-ban vagy chat-üzenetben telefonszámot ír le, akkor a platform
//  kívülről bonyolódik a fuvar → a Tiszta Hódnak nem keletkezik
//  jutalék-bevétel.
//
//  Mit blokkolunk:
//   - Magyar mobilszámok: 06-tal, +36-tal, 0036-tal vagy összevontan
//   - Külföldi szám amennyiben tisztán 9+ számjegy egymás után
//   - Email cím (ha rákerül a textbe, az is platform-megkerülés)
//
//  NEM blokkoljuk:
//   - Méret-/súly-számokat (pl. "30 cm", "50 kg", "200 Ft")
//   - 8 vagy kevesebb számjegyű sorozatokat (irányítószám OK, házszám OK)
// =====================================================================

const PHONE_PATTERNS = [
  // +36 vagy 0036 prefix + 7-9 számjegy (Magyarországon a mobil ~9 jegy)
  /(\+36|0036|0036)[\s\-./()]*\d{1,2}[\s\-./()]*\d{3}[\s\-./()]*\d{3,4}/i,
  // 06-tal indul + 1-2 körzetkód + 6-7 további szám
  /\b06[\s\-./()]*\d{1,2}[\s\-./()]*\d{3}[\s\-./()]*\d{3,4}\b/i,
  // Csupasz formátum: 9-12 számjegy whitespace nélkül egy szóban
  /\b\d{9,12}\b/,
  // Stripp utáni hosszú számjegy-sorozat (06301234567 stb.)
];

// ⚠️ AZ E-MAIL-KERESÉS NEM REGEXSZEL MEGY (2026-08-09, audit 2. kör).
//
// Történet: az eredeti minta
//   /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
// domain-része tartalmazta a pontot, amit egy `\.` követett — átfedő
// kvantorok, katasztrofális visszalépés: MÉRVE 100 KB → 16,5 másodperc
// teljes event-loop blokk, hitelesítés nélkül kiváltva.
// Az első javítás a mintát írta át, de a MÉRÉST egy 2000 karakteres vágás
// mögött végeztük — ami elfedte, hogy a futásidő továbbra is NÉGYZETES
// (20 000 karakter → 684 ms), és maga a vágás egy még rosszabb rést nyitott
// (2000 karakter töltelék után bármi átment a szűrőn).
//
// Tanulság: erre a feladatra a visszalépő regex rossz eszköz. A keresés
// mostantól string-műveletekkel megy: minden `@` körül egy RÖGZÍTETT
// hosszúságú ablakot vizsgálunk, így a futásidő a szöveg hosszában lineáris,
// és nincs mit „elfedni".
const EMAIL_LOCAL_END = /[a-zA-Z0-9._%+-]$/;               // a @ előtti karakter
// A domain végén VALÓDI, betűkből álló TLD kell — enélkül a „doboz@3.2kg"
// típusú, teljesen legitim csomag-leírás e-mailnek minősülne, és a feladás
// 400-zal elszállna egy értelmezhetetlen üzenettel.
const EMAIL_DOMAIN_START = /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/;

function containsEmail(text) {
  let at = text.indexOf('@');
  while (at !== -1) {
    // Rögzített ablakok: a helyi rész max 64, a domain max 255 karakter
    // (RFC-korlátok) — így egy-egy vizsgálat konstans költségű.
    const local = text.slice(Math.max(0, at - 64), at);
    const domain = text.slice(at + 1, at + 1 + 255);
    if (EMAIL_LOCAL_END.test(local) && EMAIL_DOMAIN_START.test(domain)) return true;
    at = text.indexOf('@', at + 1);
  }
  return false;
}

// ⚠️ 2026-08-09 (audit 2. kör): itt KORÁBBAN egy 2000 karakteres CSENDES VÁGÁS
// állt „második védvonalként" a ReDoS ellen. Az a vágás viszont MAGÁT A SZŰRŐT
// kerülte meg: 2000 karakter töltelék UTÁN bármilyen telefonszám átment
// (mérve). Egyetlen `POST /jobs` leírással ki lehetett kerülni a platform
// egyetlen bevételét védő kaput — vagyis a védelem rosszabb lett, mint amilyen
// előtte volt.
//
// A helyes megoldás: a szűrő a TELJES szöveget vizsgálja. A ReDoS-t nem a
// hossz okozta, hanem az átfedő kvantorú e-mail-minta — az javítva van, a
// futásidő azóta lineáris (mérve: 100 KB → 7 ms, 1 MB → ~70 ms).
//
// A plafon megmarad, de VÉGSŐ határként és NEM némán: efölött a szűrő hibát
// ad vissza (a hívó elutasítja a mezőt), nem pedig „tisztának" nyilvánítja a
// szöveget. Ekkora szabad-szöveges mező semmilyen legitim használatban nincs.
const MAX_INPUT_LENGTH = 50000;

/**
 * @returns {string|null} null = OK, string = blokkolás-ok
 */
function detectContactLeak(text) {
  if (!text || typeof text !== 'string') return null;
  if (text.length > MAX_INPUT_LENGTH) {
    return 'A megadott szöveg túl hosszú. Kérjük, rövidítsd le.';
  }

  // ⚠️ NORMALIZÁLÁS a szűrés előtt (2026-08-09, audit 2. kör — mérve).
  // A szűrő korábban csak a szóközt és néhány írásjelet vette ki, ezért a
  // legegyszerűbb trükkök átvitték a telefonszámot:
  //   „O6 3O 123 45 67" (betű O a nulla helyett) → ÁTMENT
  //   „06|30|123|4567"  (a | nem volt a szeparátorok közt) → ÁTMENT
  // Ezek nem elméleti esetek: aki egyszer beleütközik a blokkolásba, másodszor
  // pontosan így próbálkozik. A normalizálás a betű-szám homoglifeket számra
  // hozza, és minden gyakori elválasztót kiszed.
  // A szeparátor-halmaz bővítve (a `|`, `*`, `#`, `:` eddig kimaradt).
  const stripped = text.replace(/[\s\-./()_*#:,;|]/g, '');

  // ⚠️ A homoglif-normalizálás CSAK akkor fut, ha a szövegben eleve van
  // legalább 6 VALÓDI számjegy. Enélkül egy sok „o/s/b/l" betűs magyar mondat
  // számsorrá alakulna, és ártatlan szöveget blokkolnánk — itt a hamis
  // riasztás drágább, mint egy kihagyott találat: a feladó nem tudná feladni a
  // fuvart, és nem értené, miért.
  const valodiSzamjegyek = (text.match(/\d/g) || []).length;
  const homoglif = valodiSzamjegyek >= 6
    ? stripped
      .replace(/[OoÓóÖöŐő]/g, '0')
      .replace(/[lIií!]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
    : stripped;

  // Hosszú számjegy-sorozat detektálása
  if (/\d{9,}/.test(stripped) || /\d{9,}/.test(homoglif)) {
    return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
  }

  // 06 / +36 / 0036 prefix
  if (/(\+36|0036|06)\d{6,}/i.test(stripped) || /(\+36|0036|06)\d{6,}/i.test(homoglif)) {
    return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
  }

  // Eredeti formátumokra is teszteljük (a stripp néha hamis-negatívot ad)
  for (const re of PHONE_PATTERNS) {
    if (re.test(text)) {
      return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
    }
  }

  // Email cím
  if (containsEmail(text)) {
    return 'E-mail cím nem írható le. A platform-on belüli chat-funkciót használd.';
  }

  return null;
}

/**
 * Több szövegmezőt ellenőriz egyszerre; az ELSŐ szivárgás üzenetét adja
 * vissza (vagy null-t, ha mind tiszta). A díj-megkerülés ellen a
 * fizetés-ELŐTTI, a másik félhez eljutó szabad-szövegeknél használjuk
 * (fuvar cím/leírás, ajánlat-üzenet, járat-leírás, foglalás-jegyzet,
 * profil-mezők). A nem-string mezőket (undefined/null) átugorja.
 * @param {Array<string|null|undefined>} texts
 * @returns {string|null}
 */
function firstContactLeak(texts) {
  for (const t of texts) {
    const leak = detectContactLeak(t);
    if (leak) return leak;
  }
  return null;
}

module.exports = { detectContactLeak, firstContactLeak, MAX_INPUT_LENGTH };
