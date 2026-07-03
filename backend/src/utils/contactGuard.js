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

const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

/**
 * @returns {string|null} null = OK, string = blokkolás-ok
 */
function detectContactLeak(text) {
  if (!text || typeof text !== 'string') return null;

  // Stripp whitespace + szeparátorok, így a 06 30 123 4567 = 06301234567
  const stripped = text.replace(/[\s\-./()_]/g, '');

  // Hosszú számjegy-sorozat detektálása
  if (/\d{9,}/.test(stripped)) {
    return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
  }

  // 06 / +36 / 0036 prefix
  if (/(\+36|0036|06)\d{6,}/i.test(stripped)) {
    return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
  }

  // Eredeti formátumokra is teszteljük (a stripp néha hamis-negatívot ad)
  for (const re of PHONE_PATTERNS) {
    if (re.test(text)) {
      return 'Telefonszám nem írható le. A kapcsolatfelvételi díj megfizetése után automatikusan megkapjátok egymás elérhetőségét.';
    }
  }

  // Email cím
  if (EMAIL_PATTERN.test(text)) {
    return 'E-mail cím nem írható le. A platform-on belüli chat-funkciót használd.';
  }

  return null;
}

module.exports = { detectContactLeak };
