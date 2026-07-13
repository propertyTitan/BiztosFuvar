// Egyszeri, kézi SMS-teszt a SeeMe gateway-en át — a SEEME_API_KEY
// élesítésének ellenőrzésére (2026-07-13, 1 SMS-es modell).
//
// Használat (a kulcsot env-ben add át, NE írd fájlba/kódba!):
//   cd backend && SEEME_API_KEY='<kulcs>' node scripts/sms-teszt.js +36301234567
// Egyéni üzenettel (idézőjelben, 2. paraméterként):
//   ... node scripts/sms-teszt.js +36301234567 "Saját üzenet szövege"
//
// Kimenet: a SeeMe válasza — "OK <id>" = elment; "ERR <kód>" = SeeMe-hiba
// (tipikusan: egyenleg még nem aktív, rossz kulcs, tiltott feladó).
// A szkript a valódi services/sms.js-t használja (normalizálás +
// ékezettelenítés is ugyanúgy fut, mint élesben).
const { sendSms, isStub } = require('../src/services/sms');

(async () => {
  const to = process.argv[2];
  if (!to) {
    console.error('Használat: SEEME_API_KEY=... node scripts/sms-teszt.js +36301234567');
    process.exit(1);
  }
  if (isStub()) {
    console.error('Nincs SEEME_API_KEY az env-ben — stub módban nincs valódi küldés.');
    process.exit(1);
  }
  const r = await sendSms(
    to,
    process.argv[3] || 'GoFuvar teszt: az SMS-küldés él! Átvételi kód minta: 123456. Üdv, GoFuvar',
  );
  console.log('Eredmény:', JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
})();
