// Teszt-környezet kényszerítése — MINDEN worker-ben, MINDEN import előtt fut.
//
// A DATABASE_URL-t feltétel nélkül a lokális teszt-Postgresre állítjuk:
// hiába van a backend/.env-ben a prod Neon connstring (a dotenv nem ír
// felül meglévő env-t), és hiába örökölne a shell bármit — teszt alatt
// kizárólag az embedded-postgres példányt érhetjük el.
process.env.DATABASE_URL = 'postgres://gofuvar:gofuvar@127.0.0.1:54331/gofuvar_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'teszt-jwt-titok-nem-eles';
process.env.PORT = '0';

// ─────────────────────────────────────────────────────────────────────────
// Külső szolgáltatások: minden kulcsot SEMLEGESÍTÜNK, hogy a stub-módok
// éljenek (SMS/email/fizetés/Sentry/Gemini/R2 csak logol, semmi nem megy ki).
//
// ⚠️ ÜRES STRING, NEM `delete` (2026-08-09, audit 3. kör). A `delete` HATÁSTALAN
// volt: az `src/index.js` első sora `require('dotenv').config()`, ami a
// backend/.env-ből VISSZATÖLTI mindazt, ami épp NEM létezik — a törlés után
// tehát pontosan visszakerültek az ÉLES kulcsok. Lemérve: a teszt-futás alatt
// az R2- és a Gemini-kulcs ÉLT, vagyis a fájl-feltöltő tesztek valódi
// objektumokat írtak az ÉLES bucketekbe (köztük a privát KYC-bucketbe), a
// KYC-tesztek pedig valódi, fizetős Gemini-hívásokat indíthattak.
// A dotenv a MEGLÉVŐ (akár üres) értéket nem írja felül, így ez a forma tart.
// Az összes stub-ellenőrzés falsy-t néz, tehát az üres string = „nincs kulcs".
for (const kulcs of [
  'SEEME_API_KEY', 'RESEND_API_KEY', 'SENTRY_DSN',
  'GEMINI_API_KEY', 'GOOGLE_MAPS_API_KEY',
  // Tárolás — enélkül a teszt-feltöltések az éles bucketbe mennek
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'R2_PRIVATE_BUCKET_NAME',
  // Fizetés + számlázás + NAV: teszt alatt SOHA nem éles
  'CIB_API_KEY', 'CIB_MERCHANT_ID', 'CIB_BASE_URL',
  'QVIK_API_KEY', 'QVIK_MERCHANT_ID', 'QVIK_BASE_URL',
  'SZAMLAZZ_AGENT_KEY', 'INVOICE_PROVIDER',
  'NAV_ONLINE_LOGIN', 'NAV_ONLINE_PASSWORD', 'NAV_ONLINE_SIGNKEY', 'NAV_ONLINE_TAXNUMBER',
  // A fizetési stub élesben tiltott — teszt alatt viszont pont ez kell
  'ALLOW_STUB_PAYMENTS', 'PAYMENT_PROVIDER',
]) {
  process.env[kulcs] = '';
}

// A segélyszolgálat (towing) élesben KI van kapcsolva (a díj-kérdés
// megoldásáig — lásd routes/towing.js). Teszt alatt viszont BE, hogy a
// biztonsági tesztjei (KYC-kapu, lista-scrub, közelítő hely) továbbra is
// fussanak, és a védelem ne rohadjon el holt kódként.
process.env.TOWING_ENABLED = 'true';
