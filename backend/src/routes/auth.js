// Egyszerű auth (regisztráció + bejelentkezés).
// Megjegyzés: a jelszót `crypto.scrypt`-tel hash-eljük – nincs külön bcrypt függőség.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { loginRateLimit, registerRateLimit, writeRateLimit, createRateLimit } = require('../middleware/rateLimit');
const navTaxpayer = require('../services/navTaxpayer');
const { getDriverGameStats, grantMonthlyVouchers } = require('../services/gamification');
const { getOrCreateReferralCode, resolveReferrerId } = require('../services/referral');
const { saveFile, savePrivateFile, getSignedPrivateUrl } = require('../services/storage');
// Modul-objektumként is, hogy a törlés tesztből megfigyelhető legyen.
const storage = require('../services/storage');
const {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/email');
const { firstContactLeak } = require('../utils/contactGuard');
const { userHasBlockingDealings } = require('../utils/activePaid');
const { purgeUserFiles, collectUserFileKeys } = require('../utils/userFiles');

// ---------- Helper a verifikációs / reset tokenekhez ----------
// Egyszer használatos, kriptografikailag random token. A nyers token
// CSAK a kimenő e-mailbe kerül. A DB-ben SHA-256 hash van. A user a
// linkkel jön vissza, mi újra hash-eljük és így keressük.
function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashAuthToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function getWebBase() {
  return process.env.WEB_BASE_URL || 'http://localhost:3000';
}

// ---------- Mező-validációk (BUG-011) ----------
// A regisztráció és a profil-szerkesztés közös szabályai. Eddig a "8 szóköz
// mint jelszó" és a csupa-szóköz név is átment, a telefonszám/rendszám pedig
// bármit elfogadott — ezek itt szűrődnek ki, egy helyen.

/** Név: trim után 2–100 karakter, legalább egy nem-szóköz. null = hibás. */
function cleanFullName(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < 2 || t.length > 100) return null;
  return t;
}

/** Jelszó: 8–128 karakter, és trim után is legalább 8 érdemi karakter
 *  (a csupa/szinte-csupa szóköz jelszó nem jelszó). */
function validPassword(v) {
  return typeof v === 'string' && v.length <= 128 && v.trim().length >= 8;
}

/** Telefonszám: nemzetközi formátumokat engedünk (szóköz/kötőjel/zárójel
 *  szeparátorral), de a számjegy-tartalom 6–15 kell legyen (E.164). */
function cleanPhone(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 30) return null;
  const t = v.trim();
  const digits = t.replace(/\D/g, '');
  if (!/^\+?[\d\s\-/().]+$/.test(t) || digits.length < 6 || digits.length > 15) return null;
  return t;
}

/** Rendszám: 2–12 karakter, betű/szám/kötőjel/szóköz. Üres = törlés. */
function cleanPlate(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  if (t.length < 2 || t.length > 12) return null;
  if (!/^[A-ZÁÉÍÓÖŐÚÜŰ0-9\- ]+$/.test(t)) return null;
  return t;
}

// A telefonos fotók (iPhone / nagy MP-s Android) gyakran 6-12 MB-osak, ezért
// a limit 15 MB. Régen 5 MB volt, és a túllépés egy nyers MulterError-t dobott,
// amiből a központi hibakezelő ijesztő 500 "Szerverhiba"-t csinált — emiatt a
// tesztelők KYC-feltöltése elszállt.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// Wrapper a multer köré: a feltöltési hibákat (pl. túl nagy fájl) itt, helyben
// kezeljük le barátságos üzenettel, hogy ne a központi hibakezelőhöz jussanak
// és ne 500-as "Szerverhiba" legyen belőlük.
function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'A kép túl nagy. Maximum 15 MB tölthető fel — készíts kisebb felbontású fotót, vagy tömörítsd a képet.',
        });
      }
      return res.status(400).json({ error: 'Fájl feltöltési hiba', detail: err.message });
    });
  };
}

const router = express.Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}
function verifyPassword(password, stored) {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(derived, 'hex'));
}

function signToken(user) {
  return jwt.sign(
    // `tv` = token_version: session-invalidációhoz. A middleware minden
    // kérésnél a DB-beli users.token_version-höz hasonlítja. Friss/register
    // usernél ez 0; jelszó-reset után a DB értéke nő, így a régi tokenek
    // (kisebb tv-vel) elbuknak.
    { sub: user.id, role: user.role, email: user.email, tv: user.token_version ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

// POST /auth/register — óránként max 5 új fiók IP-nként
router.post('/register', registerRateLimit, async (req, res) => {
  const {
    email, password, full_name, phone, vehicle_type, vehicle_plate,
    account_type: rawAccountType, company_name, tax_id, company_reg_number,
    eu_vat_number, billing_address, ref,
  } = req.body || {};
  // A role mező már opcionális — minden user lehet egyszerre feladó és szállító is.
  // A DB-ben még tároljuk a legacy role mezőt, de a logika nem használja.
  // SECURITY: az 'admin' szerepet SOHA nem fogadjuk el a body-ból — különben
  // bárki adminná regisztrálhatná magát (a JWT a user.role-lal íródik alá, és
  // minden admin-végpont ezt ellenőrzi). Admin jogot csak DB-ből / meglévő
  // admin által védett úton lehet adni.
  const role = req.body?.role === 'carrier' ? 'carrier' : 'shipper';
  // Email kanonikus formában (kisbetű + trim), hogy a login kis/nagybetűtől
  // függetlenül megtalálja — a telefon-billentyűzet gyakran nagybetűsít.
  const normEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }

  // Mező-validációk (BUG-011): csupa-szóköz név/jelszó, formátumtalan
  // telefonszám/rendszám és túl hosszú értékek kiszűrése
  const cleanName = cleanFullName(full_name);
  if (!cleanName) {
    return res.status(400).json({ error: 'Érvénytelen név — 2–100 karakter, nem állhat csak szóközből.' });
  }
  if (typeof normEmail !== 'string' || normEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail)) {
    return res.status(400).json({ error: 'Érvénytelen e-mail cím formátum.' });
  }
  const cleanedPhone = cleanPhone(phone);
  if (cleanedPhone === null) {
    return res.status(400).json({ error: 'Érvénytelen telefonszám — 6–15 számjegy, pl. +36 20 123 4567.' });
  }
  const cleanedPlate = cleanPlate(vehicle_plate);
  if (cleanedPlate === null) {
    return res.status(400).json({ error: 'Érvénytelen rendszám — 2–12 karakter, betű/szám/kötőjel.' });
  }

  // Kapcsolat-szivárgás védelem már a regisztrációnál: a cégnév és a
  // jármű-leírás a profilba kerül, amit a másik fél a díjfizetés előtt lát
  // (ajánlat-kártya, publikus profil) — enélkül a PATCH /me-kapu megkerülhető
  // lenne azzal, hogy a kontaktot rögtön a regisztrációkor írja be.
  // ⚠️ A full_name IS szűrendő (2026-08-09, 2. audit-kör F1): a NÉV a
  // legláthatóbb mező — ott van minden ajánlaton, kérdésen, értékelésen és a
  // publikus profilon, MÁR a díjfizetés előtt. Egy „Hívj 0630 123 456" nevű
  // szállító minden feladónak kiadja a számát → a díj (a platform egyetlen
  // bevétele) egyetlen profil-beállítással, örökre megkerülhető lenne.
  const regLeak = firstContactLeak([cleanName, company_name, vehicle_type]);
  if (regLeak) return res.status(400).json({ error: regLeak, code: 'CONTACT_LEAK' });

  const accountType = rawAccountType === 'company' ? 'company' : 'individual';
  if (accountType === 'company') {
    if (!company_name) {
      return res.status(400).json({ error: 'Cégnév megadása kötelező céges fiók esetén' });
    }
    if (!tax_id) {
      return res.status(400).json({ error: 'Adószám megadása kötelező céges fiók esetén' });
    }
    if (!/^\d{8}-\d{1,2}-\d{2}$/.test(tax_id)) {
      return res.status(400).json({ error: 'Érvénytelen adószám formátum (pl. 12345678-1-42)' });
    }
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: 'A jelszó minimum 8 érdemi karakter legyen (legfeljebb 128) — nem állhat csupa szóközből.',
    });
  }

  try {
    // Email verifikációs token előállítása már regisztrációkor —
    // azonnal megy egy welcome+verify mail. A user be tud lépni
    // verifikálatlanul is, csak banner figyelmezteti.
    const verifyToken = generateAuthToken();
    const verifyHash = hashAuthToken(verifyToken);

    // Ajánlói attribúció: ha ?ref=KÓD-dal jött, megkeressük az ajánlót.
    // (Az önmagára-ajánlás itt nem lehetséges — új user, még nincs id-ja.)
    const referrerId = ref ? await resolveReferrerId(ref) : null;

    const { rows } = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone, vehicle_type, vehicle_plate,
                          account_type, company_name, tax_id, company_reg_number, eu_vat_number, billing_address,
                          referred_by,
                          email_verification_token_hash, email_verification_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       RETURNING id, role, email, full_name, account_type, email_verified, token_version`,
      [role, normEmail, hashPassword(password), cleanName, cleanedPhone || null, vehicle_type || null, cleanedPlate || null,
       accountType, company_name || null, tax_id || null, company_reg_number || null, eu_vat_number || null, billing_address || null,
       referrerId,
       verifyHash],
    );
    const user = rows[0];

    // Saját ajánlói kód generálása (a válasz előtt, hogy azonnal megosztható).
    await getOrCreateReferralCode(user.id).catch((e) => console.warn('[referral] kód-gen hiba:', e.message));

    // Céges fióknál NAV adószám-ellenőrzés a háttérben ("Ellenőrzött cég"
    // jelvény) — best-effort, a regisztrációt sosem akasztja meg; ha a
    // NAV-integráció nincs konfigurálva, csendben kimarad.
    if (accountType === 'company' && navTaxpayer.isConfigured()) {
      navTaxpayer.verifyCompanyUser(user.id).catch(() => {});
    }

    // Email küldés — best-effort, soha nem akasztjuk meg vele a registert
    sendEmailVerificationEmail({
      to: normEmail,
      fullName: cleanName,
      verifyUrl: `${getWebBase()}/email-megerositese?token=${verifyToken}`,
    }).catch((e) => console.warn('[auth] verify mail küldés hiba:', e.message));

    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Foglalt email' });
    console.error(err);
    res.status(500).json({ error: 'Szerverhiba' });
  }
});

// POST /auth/forgot-password — jelszó-reset link küldése
//
// SECURITY: a válasz mindig 200 OK + ugyanaz az üzenet, akár létezik az
// email akár nem. Így nem szivárogtatjuk ki, hogy melyik email-cím van
// regisztrálva nálunk (enumeration védelem).
router.post('/forgot-password', loginRateLimit, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email kötelező' });
  const generic = {
    ok: true,
    message: 'Ha létezik fiók ezzel az e-mail címmel, küldtünk egy linket a jelszó visszaállításához. Nézd meg a postaládád (és a spam-mappát is).',
  };
  try {
    const { rows } = await db.query(
      `SELECT id, full_name FROM users WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    const user = rows[0];
    if (user) {
      const token = generateAuthToken();
      const tokenHash = hashAuthToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await db.query(
        `UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3`,
        [tokenHash, expiresAt, user.id],
      );
      sendPasswordResetEmail({
        to: email,
        fullName: user.full_name,
        resetUrl: `${getWebBase()}/jelszo-reset?token=${token}`,
      }).catch((e) => console.warn('[auth] reset mail hiba:', e.message));
    }
  } catch (err) {
    // SECURITY: DB hibát is generic módon kezelünk.
    console.error('[auth] forgot-password hiba:', err.message);
  }
  res.json(generic);
});

// POST /auth/reset-password — új jelszó beállítása a tokennel
router.post('/reset-password', loginRateLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Hiányzó adatok' });
  if (password.length < 8) return res.status(400).json({ error: 'A jelszó minimum 8 karakter legyen' });
  try {
    const tokenHash = hashAuthToken(token);
    const { rows } = await db.query(
      `SELECT id FROM users
        WHERE password_reset_token_hash = $1
          AND password_reset_expires_at > NOW()`,
      [tokenHash],
    );
    const user = rows[0];
    if (!user) {
      return res.status(400).json({
        error: 'A link érvénytelen vagy lejárt. Kérj újat a "Elfelejtett jelszó" gombbal.',
      });
    }
    await db.query(
      `UPDATE users
          SET password_hash = $1,
              password_reset_token_hash = NULL,
              password_reset_expires_at = NULL,
              -- Session-invalidáció: a korábban kiadott (kisebb tv-jű) tokenek
              -- azonnal érvénytelenné válnak. Ez a reset lényege: ha valaki a
              -- tokenünkkel visszaélt, a jelszó-csere kizárja.
              token_version = token_version + 1,
              updated_at = NOW()
        WHERE id = $2`,
      [hashPassword(password), user.id],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] reset-password hiba:', err.message);
    res.status(500).json({ error: 'Szerverhiba — próbáld újra később.' });
  }
});

// GET /auth/verify-email?token=... — email-megerősítés
router.get('/verify-email', async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Hiányzó token' });
  try {
    const tokenHash = hashAuthToken(String(token));
    const { rows } = await db.query(
      `UPDATE users
          SET email_verified = true,
              email_verification_token_hash = NULL,
              updated_at = NOW()
        WHERE email_verification_token_hash = $1
        RETURNING id, email`,
      [tokenHash],
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Érvénytelen vagy már felhasznált link.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] verify-email hiba:', err.message);
    res.status(500).json({ error: 'Szerverhiba' });
  }
});

// POST /auth/resend-verification — bejelentkezett user új verifikációs link
router.post('/resend-verification', authRequired, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, full_name, email_verified, email_verification_sent_at FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Nincs ilyen user' });
    if (user.email_verified) return res.json({ ok: true, already_verified: true });
    if (user.email_verification_sent_at) {
      const ago = Date.now() - new Date(user.email_verification_sent_at).getTime();
      if (ago < 60 * 1000) {
        return res.status(429).json({
          error: 'Pár másodpercet várj — frissen küldtünk egyet. Nézd meg a postaládád + spam mappát.',
        });
      }
    }
    const verifyToken = generateAuthToken();
    const verifyHash = hashAuthToken(verifyToken);
    await db.query(
      `UPDATE users SET email_verification_token_hash = $1, email_verification_sent_at = NOW() WHERE id = $2`,
      [verifyHash, user.id],
    );
    sendEmailVerificationEmail({
      to: user.email,
      fullName: user.full_name,
      verifyUrl: `${getWebBase()}/email-megerositese?token=${verifyToken}`,
    }).catch((e) => console.warn('[auth] resend mail hiba:', e.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] resend-verification hiba:', err.message);
    res.status(500).json({ error: 'Szerverhiba' });
  }
});

// POST /auth/login — percenként max 10 próbálkozás IP-nként (brute force védelem)
router.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Hiányzó mezők' });
  // Email-egyezés kis/nagybetűtől függetlenül: a regisztráció normalizál, de a
  // régi sorokban vegyes írásmód lehet, ezért itt is LOWER-rel hasonlítunk —
  // különben a "Tester@…" fiók nem tudna "tester@…"-ként belépni.
  const { rows } = await db.query(
    'SELECT id, role, email, full_name, password_hash, token_version FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()],
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Hibás email vagy jelszó' });
  }
  delete user.password_hash;
  // Aktivitás-napló: utolsó belépés + belépés-számláló. Fire-and-forget,
  // hogy egy esetleges DB-hiba ne blokkolja a bejelentkezést.
  db.query(
    `UPDATE users SET last_login_at = NOW(), last_seen_at = NOW(),
            login_count = login_count + 1 WHERE id = $1`,
    [user.id],
  ).catch((e) => console.warn('[login] aktivitás-frissítés hiba:', e.message));
  res.json({ user, token: signToken(user) });
});

// GET /auth/me — a bejelentkezett user teljes profilja
router.get('/me', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, role, email, full_name, phone, vehicle_type, vehicle_plate,
            avatar_url, bio, rating_avg, rating_count, created_at,
            account_type, identity_kyc_status, driver_kyc_status, company_verification_status,
            company_name, tax_id, company_reg_number, eu_vat_number, billing_address,
            nav_taxpayer_checked_at, nav_taxpayer_name, nav_taxpayer_valid,
            driver_terms_accepted_at,
            personal_tax_id, birth_date,
            tax_data_requested_at, tax_data_reminder_count,
            email_verified
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  // company_nav_available: a profil-oldal ebből tudja, mutasson-e
  // "NAV-ellenőrzés indítása" gombot (amíg a NAV-integráció nincs élesítve,
  // a gomb rejtve marad). tax_data: a DAC7-kártya állapota (kell-e még
  // adóazonosító, blokkolt-e már az ajánlattétel, mi a határidő).
  const { computeTaxDataState } = require('../services/dac7');
  res.json({
    ...rows[0],
    company_nav_available: navTaxpayer.isConfigured(),
    tax_data: computeTaxDataState(rows[0]),
  });
});

// POST /auth/accept-driver-terms — a szállítói egyszeri nyilatkozat elfogadása:
// a felhasználó kijelenti, hogy minden vonatkozó jogszabályt és a KRESZ-t
// betartja. Ezt a szállító-mód első használatakor kell elfogadni; enélkül a
// requireDriverKYC nem enged licitálni / útvonalat hirdetni. Idempotens.
router.post('/accept-driver-terms', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE users SET driver_terms_accepted_at = COALESCE(driver_terms_accepted_at, NOW())
      WHERE id = $1 RETURNING driver_terms_accepted_at`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json({ ok: true, driver_terms_accepted_at: rows[0].driver_terms_accepted_at });
});

// PATCH /auth/me — profil szerkesztés
// Engedélyezett mezők: full_name, phone, vehicle_type, vehicle_plate, bio, avatar_url
router.patch('/me', authRequired, async (req, res) => {
  const allowed = ['full_name', 'phone', 'vehicle_type', 'vehicle_plate', 'bio', 'avatar_url', 'company_name', 'tax_id', 'company_reg_number', 'eu_vat_number', 'billing_address'];
  // Adószám formátum-ellenőrzés (ugyanaz mint a regisztrációnál), hogy ne
  // kerüljön szemét érték a számlázási mezőbe (a Barion VAT-számítás ezt olvassa).
  if (req.body.tax_id !== undefined && req.body.tax_id && !/^\d{8}-\d{1,2}-\d{2}$/.test(req.body.tax_id)) {
    return res.status(400).json({ error: 'Érvénytelen adószám formátum (pl. 12345678-1-42)' });
  }
  // Mező-validációk (BUG-011) — ugyanazok a szabályok, mint a regisztrációnál
  if (req.body.full_name !== undefined) {
    const cleaned = cleanFullName(req.body.full_name);
    if (!cleaned) {
      return res.status(400).json({ error: 'Érvénytelen név — 2–100 karakter, nem állhat csak szóközből.' });
    }
    req.body.full_name = cleaned;
  }
  if (req.body.phone !== undefined) {
    const cleaned = cleanPhone(req.body.phone);
    if (cleaned === null) {
      return res.status(400).json({ error: 'Érvénytelen telefonszám — 6–15 számjegy, pl. +36 20 123 4567.' });
    }
    req.body.phone = cleaned;
  }
  if (req.body.vehicle_plate !== undefined) {
    const cleaned = cleanPlate(req.body.vehicle_plate);
    if (cleaned === null) {
      return res.status(400).json({ error: 'Érvénytelen rendszám — 2–12 karakter, betű/szám/kötőjel.' });
    }
    req.body.vehicle_plate = cleaned;
  }
  if (req.body.bio !== undefined && typeof req.body.bio === 'string' && req.body.bio.length > 1000) {
    return res.status(400).json({ error: 'A bemutatkozás legfeljebb 1000 karakter lehet.' });
  }
  // Kapcsolat-szivárgás védelem: a bio / jármű-leírás / cégnév megjelenik az
  // ajánlat-kártyán és a publikus profilon — a másik fél a díjfizetés ELŐTT
  // látja, tehát a díj megkerülésének csatornája lenne telefonszámot/emailt
  // beleírni. (A phone/vehicle_plate legitim mezők, azokat nem szűrjük.)
  // A full_name IS szűrendő — lásd a regisztrációnál (2. audit-kör F1):
  // a név a legláthatóbb, fizetés előtt is megjelenő mező.
  const profileLeak = firstContactLeak([
    req.body.full_name, req.body.bio, req.body.vehicle_type, req.body.company_name,
  ]);
  if (profileLeak) return res.status(400).json({ error: profileLeak, code: 'CONTACT_LEAK' });
  const updates = [];
  const values = [];
  let idx = 1;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx}`);
      values.push(req.body[field] || null);
      idx++;
    }
  }

  // Ha bármelyik számlázási/cég mező változik, a cég-ellenőrzés visszaáll
  // 'pending'-re — így valós formátumú, de hamis adószámmal sem lehet
  // 'verified' céggé válni (a middleware a 'verified'-et követeli meg a
  // céges/fordított-ÁFA kezeléshez). A NAV-ellenőrzés (lent) automatikusan
  // újrafuttatja; ha az nem elérhető / nem egyértelmű, admin hagyja jóvá.
  const COMPANY_FIELDS = ['company_name', 'tax_id', 'company_reg_number', 'eu_vat_number', 'billing_address'];
  const companyFieldsChanged = COMPANY_FIELDS.some((f) => req.body[f] !== undefined);
  if (companyFieldsChanged) {
    updates.push(`company_verification_status = 'pending'`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nincs módosítandó mező' });
  }

  values.push(req.user.sub);
  const { rows } = await db.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${idx}
    RETURNING id, role, email, full_name, phone, vehicle_type, vehicle_plate,
              avatar_url, bio, rating_avg, rating_count, created_at,
              identity_kyc_status, driver_kyc_status, account_type,
              company_name, company_verification_status, email_verified`,
    values,
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });

  // Cégadat-változásnál a NAV-ellenőrzés automatikus újrafuttatása a
  // háttérben (a 'pending' beállítása után) — best-effort.
  if (companyFieldsChanged && rows[0].account_type === 'company' && navTaxpayer.isConfigured()) {
    navTaxpayer.verifyCompanyUser(req.user.sub).catch(() => {});
  }

  res.json(rows[0]);
});

// POST /auth/verify-company — NAV adószám-ellenőrzés kézi indítása
// ("Ellenőrzött cég" jelvény). A profil-oldal gombja hívja; a NAV-ot
// kímélendő userenként óránként max 5 próbálkozás.
router.post(
  '/verify-company',
  authRequired,
  createRateLimit({
    windowMs: 60 * 60 * 1000, max: 5, keyBy: 'user', name: 'nav-verify',
    message: 'Túl sok cég-ellenőrzési kérés — próbáld újra egy óra múlva.',
  }),
  async (req, res) => {
    const result = await navTaxpayer.verifyCompanyUser(req.user.sub);
    res.json(result);
  },
);

// POST /auth/tax-data — DAC7 adóügyi adatok megadása (magánszemély szállító).
// A profil DAC7-kártyája hívja; az adóazonosító jelet ellenőrző összeggel
// validáljuk. Cégnek nem kell (nála az adószám a TIN — már gyűjtjük).
router.post('/tax-data', authRequired, writeRateLimit, async (req, res) => {
  const { validatePersonalTaxId } = require('../services/dac7');
  const { personal_tax_id, birth_date, address } = req.body || {};

  const { rows: userRows } = await db.query(
    `SELECT account_type FROM users WHERE id = $1`, [req.user.sub],
  );
  if (!userRows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  if (userRows[0].account_type === 'company') {
    return res.status(400).json({ error: 'Céges fióknál az adószám az adóügyi azonosító — külön adóazonosító jel nem szükséges.' });
  }

  const cleanTaxId = String(personal_tax_id ?? '').replace(/\s/g, '');
  if (!validatePersonalTaxId(cleanTaxId)) {
    return res.status(400).json({ error: 'Érvénytelen adóazonosító jel — 8-cal kezdődő, 10 számjegyű szám (az adókártyádon találod).' });
  }
  // Születési dátum: valós, múltbeli dátum, 18+ (a KYC ezt már igazolta,
  // itt az elgépelést szűrjük).
  const bd = new Date(String(birth_date ?? ''));
  const age = (Date.now() - bd.getTime()) / (365.25 * 86400000);
  if (Number.isNaN(bd.getTime()) || bd.getFullYear() < 1900 || age < 18 || age > 120) {
    return res.status(400).json({ error: 'Érvénytelen születési dátum.' });
  }
  const cleanAddress = typeof address === 'string' ? address.trim() : '';
  if (cleanAddress.length < 5 || cleanAddress.length > 300) {
    return res.status(400).json({ error: 'Add meg a lakcímed (irányítószám, település, utca, házszám).' });
  }

  await db.query(
    `UPDATE users SET personal_tax_id = $1, birth_date = $2, billing_address = $3,
            updated_at = NOW()
      WHERE id = $4`,
    [cleanTaxId, bd.toISOString().slice(0, 10), cleanAddress, req.user.sub],
  );
  res.json({ ok: true });
});

// GET /auth/users/:id/profile — publikus profil + statisztikák
router.get('/users/:id/profile', authRequired, async (req, res) => {
  const uid = req.params.id;
  const [userRes, jobsDone, routesDone, reviewsRes] = await Promise.all([
    db.query(
      // A vehicle_plate (rendszám) SZÁNDÉKOSAN kimarad: a GDPR értelmében
      // személyes adat, és a publikus profilt bárki lekérheti kontaktus/
      // ügylet nélkül (adat-minimalizálás, 2026-08-09 audit). A jármű TÍPUSA
      // (vehicle_type) marad — az a döntéshez hasznos, nem azonosít.
      `SELECT id, full_name, avatar_url, bio, vehicle_type,
              rating_avg, rating_count, trust_score, is_verified_carrier, created_at,
              account_type, company_name, company_verification_status
         FROM users WHERE id = $1`,
      [uid],
    ),
    // Szállítóként befejezett fuvarok
    db.query(
      `SELECT COUNT(*)::int AS c FROM jobs WHERE carrier_id = $1 AND status IN ('delivered','completed')`,
      [uid],
    ),
    // Fix áras útvonalakon befejezett foglalások
    db.query(
      `SELECT COUNT(*)::int AS c FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE r.carrier_id = $1 AND b.status = 'delivered'`,
      [uid],
    ),
    // Legutóbbi értékelések (max 10)
    db.query(
      `SELECT r.stars, r.comment, r.created_at, u.full_name AS reviewer_name
         FROM reviews r JOIN users u ON u.id = r.reviewer_id
        WHERE r.reviewee_id = $1
        ORDER BY r.created_at DESC LIMIT 10`,
      [uid],
    ),
  ]);
  if (!userRes.rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json({
    ...userRes.rows[0],
    completed_jobs: jobsDone.rows[0].c,
    completed_route_deliveries: routesDone.rows[0].c,
    recent_reviews: reviewsRes.rows,
  });
});

// GET /auth/admin/stats — admin dashboard statisztikák
router.get('/admin/stats', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak admin' });
  }
  const [jobs, activeJobs, users, routes, bookings, disputes] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS c FROM jobs"),
    db.query("SELECT COUNT(*)::int AS c FROM jobs WHERE status IN ('bidding','accepted','in_progress')"),
    db.query("SELECT COUNT(*)::int AS c FROM users"),
    db.query("SELECT COUNT(*)::int AS c FROM carrier_routes"),
    db.query("SELECT COUNT(*)::int AS c FROM route_bookings"),
    db.query("SELECT COUNT(*)::int AS c FROM disputes WHERE status IN ('open','under_review')"),
  ]);
  res.json({
    total_jobs: jobs.rows[0].c,
    active_jobs: activeJobs.rows[0].c,
    total_users: users.rows[0].c,
    total_routes: routes.rows[0].c,
    total_bookings: bookings.rows[0].c,
    open_disputes: disputes.rows[0].c,
  });
});

// GET /auth/me/driver-dashboard — a szállító okos főoldalához MINDEN adat
// Egyetlen hívás: aktív fuvarok, várakozó licitek, heti kereset, közeli fuvarok száma.
router.get('/me/driver-dashboard', authRequired, async (req, res) => {
  const uid = req.user.sub;
  const [
    activeJobsRes, pendingBidsRes, weekEarningsRes,
    nearbyCountRes, gameRes,
  ] = await Promise.all([
    // Aktív fuvarok (elfogadott + folyamatban)
    db.query(
      `SELECT j.id, j.title, j.status, j.pickup_address, j.dropoff_address,
              j.accepted_price_huf, j.distance_km, j.paid_at,
              s.full_name AS shipper_name
         FROM jobs j
         JOIN users s ON s.id = j.shipper_id
        WHERE j.carrier_id = $1 AND j.status IN ('accepted','in_progress')
        ORDER BY j.updated_at DESC LIMIT 5`,
      [uid],
    ),
    // Várakozó licitek száma
    db.query(
      `SELECT COUNT(*)::int AS c FROM bids WHERE carrier_id = $1 AND status = 'pending'`,
      [uid],
    ),
    // Heti kereset (delivered fuvarok az elmúlt 7 napban)
    db.query(
      `SELECT COALESCE(SUM(j.accepted_price_huf), 0)::int AS total,
              COUNT(*)::int AS count
         FROM jobs j
        WHERE j.carrier_id = $1
          AND j.status IN ('delivered','completed')
          AND j.delivered_at >= NOW() - INTERVAL '7 days'`,
      [uid],
    ),
    // Licitálható fuvarok száma (bidding státuszban, nem a sajátja)
    db.query(
      `SELECT COUNT(*)::int AS c FROM jobs
        WHERE status = 'bidding' AND shipper_id <> $1`,
      [uid],
    ),
    // Gamification stats
    db.query(
      `SELECT level, level_name, trust_score, total_deliveries,
              rating_avg, rating_count, is_verified_carrier
         FROM users WHERE id = $1`,
      [uid],
    ),
  ]);

  // Voucher-ek száma
  const { rows: voucherRes } = await db.query(
    `SELECT COUNT(*)::int AS c FROM fee_vouchers
      WHERE user_id = $1 AND used_at IS NULL
        AND valid_from <= CURRENT_DATE AND valid_until >= CURRENT_DATE`,
    [uid],
  );

  const game = gameRes.rows[0] || {};

  res.json({
    activeJobs: activeJobsRes.rows,
    pendingBidsCount: pendingBidsRes.rows[0]?.c || 0,
    weekEarnings: weekEarningsRes.rows[0]?.total || 0,
    weekDeliveries: weekEarningsRes.rows[0]?.count || 0,
    nearbyJobsCount: nearbyCountRes.rows[0]?.c || 0,
    availableVouchers: voucherRes[0]?.c || 0,
    level: game.level || 1,
    levelName: game.level_name || 'Kezdő',
    trustScore: game.trust_score || 0,
    totalDeliveries: game.total_deliveries || 0,
    ratingAvg: game.rating_avg || 0,
    ratingCount: game.rating_count || 0,
    isVerified: game.is_verified_carrier || false,
  });
});

// GET /auth/referral — az ajánlói programom: kód, link, eddigi sikeres
// ajánlások száma, és hány felhasználható ingyenes kapcsolatfelvétel vár.
router.get('/referral', authRequired, async (req, res) => {
  const uid = req.user.sub;
  const code = await getOrCreateReferralCode(uid);
  const [{ rows: referredRows }, { rows: voucherRows }] = await Promise.all([
    // Sikeres ajánlások: akiket behoztam ÉS már teljesítettek (jutalmaztak).
    db.query(
      `SELECT
         COUNT(*)::int AS total_referred,
         COUNT(*) FILTER (WHERE referral_reward_granted_at IS NOT NULL)::int AS completed_referred
       FROM users WHERE referred_by = $1`,
      [uid],
    ),
    // Felhasználható ajánlói (és egyéb) ingyen-kuponok száma.
    db.query(
      `SELECT COUNT(*)::int AS c FROM fee_vouchers
        WHERE user_id = $1 AND used_at IS NULL
          AND valid_from <= CURRENT_DATE AND valid_until >= CURRENT_DATE`,
      [uid],
    ),
  ]);
  const base = process.env.WEB_BASE_URL || 'https://gofuvar.hu';
  res.json({
    code,
    link: code ? `${base}/bejelentkezes?mode=register&ref=${code}` : null,
    totalReferred: referredRows[0]?.total_referred || 0,
    completedReferred: referredRows[0]?.completed_referred || 0,
    availableVouchers: voucherRows[0]?.c || 0,
  });
});

// GET /auth/me/game-stats — gamifikációs dashboard adatok
router.get('/me/game-stats', authRequired, async (req, res) => {
  const stats = await getDriverGameStats(req.user.sub);
  if (!stats) return res.status(404).json({ error: 'Nem található' });
  res.json(stats);
});

// POST /auth/admin/grant-monthly-vouchers — havi voucher generálás (admin)
router.post('/admin/grant-monthly-vouchers', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Csak admin' });
  const count = await grantMonthlyVouchers();
  res.json({ ok: true, granted: count });
});

// POST /auth/avatar — profilkép feltöltés (Cloudflare R2 / disk fallback)
router.post('/avatar', authRequired, uploadSingle('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Csak képfájl tölthető fel (JPG/PNG).' });
  }
  // Magic-byte ellenőrzés (audit 2. tétel) — tartalom dönt, nem a kliens
  const sniffedAvatar = require('../utils/imageSniff').sniffImageType(req.file.buffer);
  if (!sniffedAvatar) {
    return res.status(400).json({ error: 'A fájl nem érvényes képfájl (JPG/PNG/WebP/HEIC fogadott).' });
  }
  req.file.mimetype = sniffedAvatar;
  try {
    const url = await saveFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    // ⚠️ ÁRVA FÁJL (2026-08-09, adatvédelmi audit): a `saveFile` minden
    // feltöltésnél ÚJ véletlen kulcsot ad, az UPDATE viszont felülírja a
    // régi hivatkozást — az előző profilkép így kikerül a rendszer látóköréből,
    // miközben a PUBLIKUS bucketben marad, 1 éves immutable cache-sel. A
    // fiók törlése sem érte el (a gyűjtő az aktuális avatar_url-t nézi).
    // A RÉGI értéket a Postgres önjoin-idiómájával kapjuk vissza: az `elozo`
    // külön olvasás, ezért a frissítés ELŐTTI pillanatképet látja.
    const { rows: regi } = await db.query(
      `UPDATE users u SET avatar_url = $1, updated_at = NOW()
         FROM users elozo
        WHERE u.id = $2 AND elozo.id = u.id
       RETURNING elozo.avatar_url AS elozo`,
      [url, req.user.sub],
    );
    const elozoAvatar = regi[0]?.elozo;
    if (elozoAvatar && elozoAvatar !== url) {
      storage.deleteFile(elozoAvatar).catch(() => {}); // nem blokkolja a választ
    }
    res.json({ url });
  } catch (err) {
    console.error('[auth] avatar upload hiba:', err);
    res.status(500).json({ error: 'Fájl mentés sikertelen' });
  }
});

// POST /auth/kyc-document — KYC dokumentum feltöltés + AI ellenőrzés
//
// Flow: feltöltés → Gemini megnézi → ha valid okmány → azonnal 'verified'
// Ha nem valid (macska fotó, homályos, rossz típus) → 'rejected' + reason
// Ha Gemini nem elérhető → fallback: 'verified' (admin utólag ellenőriz)
router.post('/kyc-document', authRequired, writeRateLimit, uploadSingle('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Csak képfájl tölthető fel (JPG/PNG).' });
  }
  // Magic-byte ellenőrzés: a fájl TARTALMA döntsön, ne a kliens MIME-ja
  // (SVG/HTML image/*-nak álcázva stored-XSS lehetne — audit 2. tétel)
  const sniffedKyc = require('../utils/imageSniff').sniffImageType(req.file.buffer);
  if (!sniffedKyc) {
    return res.status(400).json({ error: 'A fájl nem érvényes képfájl (JPG/PNG/WebP/HEIC fogadott).' });
  }
  req.file.mimetype = sniffedKyc;
  const { doc_type } = req.body || {};
  const validTypes = ['id_card', 'drivers_license', 'insurance', 'vehicle_registration', 'company_document'];
  if (!validTypes.includes(doc_type)) return res.status(400).json({ error: 'Érvénytelen dokumentum típus' });

  // PRIVÁT tárolás (2026-07-13, biztonsági audit): a személyi okmány fotója
  // a privát bucketbe kerül (`private:<kulcs>` a DB-ben), publikus URL-je
  // NINCS — olvasni csak rövid életű aláírt linkkel lehet (admin-felület).
  const url = await savePrivateFile(req.file.buffer, req.file.originalname, req.file.mimetype);

  // AI ellenőrzés: a feltöltött kép tényleg a megadott dokumentum típus-e?
  const { verifyKycDocument } = require('../services/gemini');
  const { createNotification } = require('../services/notifications');
  const aiResult = await verifyKycDocument(req.file.buffer, req.file.mimetype, doc_type);

  // 18 év alatti → adminra vár (pending), nem rejected és nem verified
  // Dokumentum szám duplikáció ellenőrzés — egy személyi = egy fiók
  const docNumberRaw = aiResult.documentNumber;
  let docNumberHash = null;
  if (docNumberRaw) {
    docNumberHash = require('crypto').createHash('sha256').update(docNumberRaw.trim().toUpperCase()).digest('hex');
    const { rows: existing } = await db.query(
      `SELECT k.user_id, u.email FROM kyc_documents k
       JOIN users u ON u.id = k.user_id
       WHERE k.doc_number_hash = $1 AND k.user_id <> $2
         AND k.status IN ('approved', 'pending')`,
      [docNumberHash, req.user.sub],
    );
    if (existing.length > 0) {
      // NE logold a nyers okmányszámot — a DB-ben is csak hash-elve tároljuk.
      // Az app-log (Railway/Sentry) nem lehet kormányzati okmányszám-forrás.
      console.log(`[kyc] DUPLIKÁLT DOKUMENTUM: user=${req.user.sub} docHash=${docNumberHash.slice(0, 12)}… → már használja: ${existing[0].user_id}`);
      return res.status(409).json({
        ok: false,
        status: 'rejected',
        ai_reason: 'Ez a dokumentum már egy másik fiókhoz van regisztrálva. Minden felhasználó csak egy fiókot használhat.',
        code: 'DUPLICATE_DOCUMENT',
      });
    }
  }

  const isUnderage = aiResult.underage === true;
  let docStatus, kycStatus, rejectionReason;

  if (isUnderage) {
    docStatus = 'pending';
    kycStatus = 'pending';
    rejectionReason = 'A dokumentum tulajdonosa 18 év alatti — adminisztrátori jóváhagyásra vár.';
    // A születési dátum PII — nem megy app-logba; az adminnak az értesítésben
    // (jogosult címzett) mutatjuk meg a döntéshez.
    console.log(`[kyc] 18 ÉV ALATTI GYANÚ: user=${req.user.sub}`);
    // Admin értesítés
    try {
      const { rows: admins } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
      const { rows: userInfo } = await db.query(`SELECT full_name, email FROM users WHERE id = $1`, [req.user.sub]);
      const who = userInfo[0]?.full_name || req.user.email;
      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          type: 'kyc_underage_alert',
          title: '⚠️ 18 év alatti KYC!',
          // Adat-minimalizálás (2026-08-09 audit): a teljes e-mail + születési
          // dátum NEM kerül a notif-body-ba (az a notifications táblában
          // határidő nélkül maradna) — a jogosult admin a KYC-panelen látja.
          body: `${who} személyi igazolványa alapján 18 év alatti lehet — kézi jóváhagyás szükséges. A részletek a KYC-panelen.`,
          link: '/admin#kyc',
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[kyc] admin notify hiba:', e.message);
    }
  } else if (aiResult.pending) {
    // AI nem elérhető → kézi ellenőrzés (fail-closed, nem auto-approve)
    docStatus = 'pending';
    kycStatus = 'pending';
    rejectionReason = aiResult.reason;
    console.log(`[kyc] AI nem elérhető, kézi ellenőrzésre vár: user=${req.user.sub} doc=${doc_type}`);
    try {
      const { rows: admins } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          type: 'kyc_manual_review',
          title: '📋 KYC kézi ellenőrzés szükséges',
          // Adat-minimalizálás: nincs teljes e-mail a notif-body-ban.
          body: `Egy felhasználó dokumentumát (${doc_type}) az AI nem tudta ellenőrizni — kézi jóváhagyás kell. Részletek a KYC-panelen.`,
          link: '/admin#kyc',
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[kyc] admin notify hiba:', e.message);
    }
  } else if (aiResult.valid) {
    // ⚠️ 2026-08-09 (audit 3. kör): az AI „valid" ítélete ÖNMAGÁBAN nem ad
    // 'verified' státuszt. A kockázatos jeleket (alacsony bizalom, név-eltérés
    // a fiókhoz képest, másolat/képernyőfotó gyanú, olvashatatlan okmányszám)
    // emberhez tereljük — az automatizmus megmarad, csak nem vak.
    const { needsManualReview } = require('../services/kycReview');
    const { rows: acc } = await db.query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);
    const review = needsManualReview(aiResult, { fullName: acc[0]?.full_name }, doc_type);

    if (review) {
      docStatus = 'pending';
      kycStatus = 'pending';
      rejectionReason = review.reason;
      // PII nélkül naplózunk: sem nevet, sem okmányszámot.
      console.log(`[kyc] KÉZI ELLENŐRZÉSRE: user=${req.user.sub} doc=${doc_type} ok=${review.code} confidence=${aiResult.confidence}`);
      try {
        const { rows: admins } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
        for (const admin of admins) {
          await createNotification({
            user_id: admin.id,
            type: 'kyc_manual_review',
            title: '📋 KYC kézi ellenőrzés szükséges',
            body: `Egy dokumentum (${doc_type}) automatikus jóváhagyása elakadt (${review.code}) — kézi döntés kell. Részletek a KYC-panelen.`,
            link: '/admin#kyc',
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('[kyc] admin notify hiba:', e.message);
      }
    } else {
      docStatus = 'approved';
      kycStatus = 'verified';
      rejectionReason = null;
      console.log(`[kyc] AI jóváhagyva: user=${req.user.sub} doc=${doc_type} confidence=${aiResult.confidence}`);
    }
  } else {
    // ⚠️ AZ AI EGYEDÜL NEM UTASÍT EL (2026-08-09, adatvédelmi + jogi audit).
    // Korábban a Gemini `valid:false` ítélete AZONNAL 'rejected'-et adott,
    // emberi szem nélkül. Az elutasított szállító elesik a keresetszerzés
    // lehetőségétől — ez a GDPR 22. cikk szerinti, „hasonlóan jelentős
    // hatású" döntés, amelyre az adatkezelési tájékoztató, a DPIA ÉS az
    // érdekmérlegelési teszt is azt állítja, hogy „minden esetben emberi
    // adminisztrátor hagyja jóvá". Az elutasítás mostantól KÉZI ELLENŐRZÉSRE
    // vár: a felhasználó tudja, mit javítson, de a végső nemet ember mondja ki.
    // (A gyors, sikeres út változatlan: a tiszta eset automatikusan átmegy.)
    docStatus = 'pending';
    kycStatus = 'pending';
    rejectionReason = aiResult.reason;
    console.log(`[kyc] AI-kifogás → KÉZI ELLENŐRZÉS: user=${req.user.sub} doc=${doc_type} reason="${aiResult.reason}"`);
    try {
      const { rows: admins } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
      for (const admin of admins) {
        await createNotification({
          user_id: admin.id,
          type: 'kyc_manual_review',
          title: '📋 KYC kézi ellenőrzés szükséges',
          body: `Egy dokumentumot (${doc_type}) az AI kifogásolt — a végső döntés emberi. Részletek a KYC-panelen.`,
          link: '/admin#kyc',
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[kyc] admin notify hiba:', e.message);
    }
  }

  // ⚠️ ÁRVA OKMÁNYFOTÓ (2026-08-09, adatvédelmi audit — a legsúlyosabb
  // árva-eset). A `savePrivateFile` minden feltöltésnél ÚJ véletlen kulcsot
  // ad, az ON CONFLICT viszont felülírja a `file_url`-t: az ELŐZŐ személyi
  // igazolvány fotója így kikerül a rendszer látóköréből, miközben a privát
  // bucketben marad. A 30 napos purge a `kyc_documents.file_url`-ből olvas,
  // tehát csak az AKTUÁLISAT látja — az árvát soha többé nem éri el, még a
  // fiók törlése sem.
  //
  // És ez a NORMÁL út, nem szélső eset: a kockázati jelre `pending`-be tett
  // dokumentumnál az értesítés kifejezetten újrafeltöltésre kéri a usert.
  const { rows: elozoDok } = await db.query(
    `SELECT file_url FROM kyc_documents WHERE user_id = $1 AND doc_type = $2`,
    [req.user.sub, doc_type],
  );

  await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, rejection_reason, doc_number_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, doc_type) DO UPDATE SET
       file_url = EXCLUDED.file_url, status = EXCLUDED.status,
       rejection_reason = EXCLUDED.rejection_reason,
       doc_number_hash = EXCLUDED.doc_number_hash,
       reviewed_by = NULL, reviewed_at = NOW()`,
    [req.user.sub, doc_type, url, docStatus, rejectionReason, docNumberHash],
  );

  // A DB-írás UTÁN törlünk: ha az INSERT elhasalna, a régi fotó maradjon meg.
  const elozoUrl = elozoDok[0]?.file_url;
  if (elozoUrl && elozoUrl !== url) {
    storage.deleteFile(elozoUrl).catch(() => {});
  }

  if (doc_type === 'id_card') {
    await db.query(`UPDATE users SET identity_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'drivers_license') {
    await db.query(`UPDATE users SET driver_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'company_document') {
    await db.query(`UPDATE users SET company_verification_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  }

  res.json({
    // Az `ok` a TÉNYLEGES döntést tükrözi: kézi ellenőrzésre terelt
    // dokumentumnál nem „sikeres" (a státusz 'pending').
    ok: kycStatus === 'verified',
    doc_type,
    status: kycStatus,
    // A kliens felé aláírt (rövid életű) olvasó-URL megy, sosem a nyers kulcs
    file_url: await getSignedPrivateUrl(url),
    ai_reason: isUnderage
      ? 'A születési dátumod alapján 18 év alatti vagy. A profilod adminisztrátori jóváhagyásra vár.'
      : (rejectionReason || aiResult.reason),
    ai_confidence: aiResult.confidence,
    underage: isUnderage || false,
  });
});

// GET /auth/kyc-status — KYC státusz lekérdezése
router.get('/kyc-status', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT identity_kyc_status, driver_kyc_status, company_verification_status, account_type FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nem található' });
  const { rows: docs } = await db.query(
    `SELECT doc_type, status, rejection_reason, created_at FROM kyc_documents WHERE user_id = $1`,
    [req.user.sub],
  );
  res.json({ ...rows[0], documents: docs });
});

// POST /auth/push-token — Expo push token regisztrálása
router.post('/push-token', authRequired, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Hiányzó token' });
  await db.query(
    `INSERT INTO push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3`,
    [req.user.sub, token, platform || 'ios'],
  );
  res.json({ ok: true });
});

// GET /auth/me/export — ADATHORDOZHATÓSÁG (GDPR 20. cikk)
//
// Az adatkezelési tájékoztató kifejezetten ígéri: „az adatok strukturált,
// géppel olvasható (JSON) formátumban való kiadása". Eddig ez NEM létezett,
// vagyis egy 20. cikkes kérést kézi SQL-lel kellett volna kiszolgálni,
// 1 hónapos határidővel (2026-08-09 audit).
//
// Amit tartalmaz: minden adat, amit a felhasználó adott meg vagy ami az ő
// tevékenységéből keletkezett. Amit NEM: jelszó-hash, session-token, más
// felhasználók adatai (a fuvarok másik felének elérhetősége), és a
// KYC-okmány FOTÓJA (a metaadat + státusz igen — a nyers okmányképet nem
// adjuk vissza gépi úton).
router.get('/me/export', authRequired, writeRateLimit, async (req, res) => {
  const uid = req.user.sub;
  const q = async (sql, params = [uid]) => (await db.query(sql, params)).rows;

  const [profil] = await q(
    `SELECT id, email, full_name, phone, bio, avatar_url, role, account_type,
            company_name, tax_id, billing_address, billing_country, locale,
            vehicle_type, vehicle_plate, identity_kyc_status,
            driver_kyc_status, company_verification_status, email_verified,
            referral_code, referred_by, trust_score, level, rating_avg,
            rating_count, total_deliveries, created_at, driver_terms_accepted_at
       FROM users WHERE id = $1`,
  );
  if (!profil) return res.status(404).json({ error: 'Felhasználó nem található' });

  const adatok = {
    export_keszult: new Date().toISOString(),
    adatkezelo: 'Tiszta Hód Kft. (GoFuvar)',
    tajekoztatas: 'Ez az export a GDPR 20. cikke szerinti adathordozhatósági jog gyakorlásához készült. '
      + 'A más felhasználókhoz tartozó személyes adatokat (pl. a másik fél elérhetőségét) nem tartalmazza.',
    profil,
    feladott_fuvarok: await q(
      `SELECT id, title, description, pickup_address, dropoff_address, weight_kg,
              suggested_price_huf, accepted_price_huf, connection_fee_huf, status,
              paid_at, created_at, delivered_at
         FROM jobs WHERE shipper_id = $1 ORDER BY created_at DESC`,
    ),
    vallalt_fuvarok: await q(
      `SELECT id, title, pickup_address, dropoff_address, accepted_price_huf,
              status, created_at, delivered_at
         FROM jobs WHERE carrier_id = $1 ORDER BY created_at DESC`,
    ),
    ajanlataim: await q(
      `SELECT id, job_id, amount_huf, currency, message, status, created_at
         FROM bids WHERE carrier_id = $1 ORDER BY created_at DESC`,
    ),
    jarataim: await q(
      `SELECT id, title, description, countries, departure_at, status, created_at
         FROM carrier_routes WHERE carrier_id = $1 ORDER BY created_at DESC`,
    ),
    foglalasaim: await q(
      `SELECT id, route_id, package_size, weight_kg, pickup_address, dropoff_address,
              price_huf, connection_fee_huf, status, paid_at, created_at
         FROM route_bookings WHERE shipper_id = $1 ORDER BY created_at DESC`,
    ),
    uzeneteim: await q(
      `SELECT id, job_id, booking_id, body, created_at
         FROM messages WHERE sender_id = $1 ORDER BY created_at DESC`,
    ),
    ertekeleseim: await q(
      `SELECT id, job_id, stars, comment, created_at
         FROM reviews WHERE reviewer_id = $1 ORDER BY created_at DESC`,
    ),
    rolam_szolo_ertekelesek: await q(
      `SELECT id, job_id, stars, comment, created_at
         FROM reviews WHERE reviewee_id = $1 ORDER BY created_at DESC`,
    ),
    ertesiteseim: await q(
      `SELECT id, type, title, body, link, read_at, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
    ),
    szamlaim: await q(
      `SELECT id, job_id, booking_id, invoice_number, currency, net_amount,
              vat_amount, gross_amount, status, created_at
         FROM invoices WHERE buyer_user_id = $1 ORDER BY created_at DESC`,
    ),
    kyc_metaadat: await q(
      `SELECT doc_type, status, rejection_reason, created_at, reviewed_at
         FROM kyc_documents WHERE user_id = $1`,
    ),
    kuponjaim: await q(
      `SELECT reason, max_fee_huf, valid_from, valid_until, used_at, created_at
         FROM fee_vouchers WHERE user_id = $1 ORDER BY created_at DESC`,
    ),
  };

  res.setHeader('Content-Disposition', `attachment; filename="gofuvar-adatexport-${uid.slice(0, 8)}.json"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(adatok);
});

// DELETE /auth/me — fiók törlése (GDPR "elfeledtetéshez való jog")
router.delete('/me', authRequired, async (req, res) => {
  const userId = req.user.sub;

  // Adatvesztés-védelem (2026-08-09): a self-delete kaszkádol (users →
  // carrier_routes → route_bookings), így MÁS feladók kifizetett foglalásait
  // is elvinné, és a vitás ügyletek 5 éves bizonyíték-zárolását kiürítené.
  // Ugyanaz a guard, mint az admin-törlésnél (a korábbi verzió csak a saját
  // 'accepted'/'in_progress' fuvarokat nézte — se foglalást, se disputed-et,
  // se a fizetettséget). Előbb le kell zárni az ügyletet.
  if (await userHasBlockingDealings(userId)) {
    return res.status(409).json({
      error: 'Nem törölheted a fiókodat, amíg folyamatban lévő, kifizetett vagy vitatott '
        + 'ügyleted van. Előbb zárd le (kézbesítés / lemondás / vita), utána törölhető.',
      code: 'USER_HAS_ACTIVE_PAID',
    });
  }

  // Email-lenyomat az audit-naplóba (nem maga az e-mail — GDPR).
  // ⚠️ HMAC, nem sima SHA-256 (2026-08-09, adatvédelmi audit 3. kör): az
  // e-mail-címek tere felsorolható, ezért egy sózatlan hash egy jelöltlistával
  // visszafejthető — vagyis pszeudonimizált, nem anonim adat. A szerver-oldali
  // titokkal képzett lenyomat egy DB-szivárgásból önmagában nem fordítható
  // vissza. A sor 5 év után a napi retenciós körben törlődik.
  const { rows: user } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const emailHash = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(user[0]?.email || '')
    .digest('hex');

  // A törlendő fájlok kulcsai — MÉG a DB-sorok megléte mellett gyűjtjük ki.
  const fileKeys = await collectUserFileKeys(userId);

  // ⚠️ SORREND (2026-08-09, audit): ELŐBB a DB-törlés (tranzakcióban), és CSAK
  // a sikeres commit UTÁN a tárolóból törlés. A korábbi sorrend fordított volt:
  // a fájlokat (köztük a személyi igazolvány fotóját) VÉGLEGESEN törölte, majd
  // a `DELETE FROM users` egy séma-hibán elhasalt (23502) — a felhasználó
  // „Szerverhibát" kapott, a fiókja megmaradt, az okmánya viszont nem.
  // A fájl-törlés nem visszafordítható, ezért az mindig az utolsó lépés.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO deleted_accounts (original_user_id, email_hash, reason, hash_algo)
       VALUES ($1, $2, $3, 'hmac-sha256')`,
      [userId, emailHash, 'Felhasználó saját kérésére'],
    );
    // CASCADE törli: jobs, bids, photos, reviews, notifications, kyc_documents, stb.
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[account-delete] a törlés meghiúsult, a fájlok érintetlenek:', err.message);
    throw err;
  } finally {
    client.release();
  }

  // A tárolóban maradt objektumok (KYC-okmány, avatar, fuvar-fotók) törlése —
  // a DB-sorok már nincsenek meg, ezért a listát a purge a törlés ELŐTT
  // gyűjtötte ki (lásd utils/userFiles.js). GDPR 17. cikk: e nélkül az
  // R2-objektumok örökre árván maradnának.
  await purgeUserFiles(userId, { keys: fileKeys });

  console.log(`[account-delete] user ${userId} törölve (email hash: ${emailHash.slice(0, 12)}...)`);
  res.json({
    ok: true,
    // Pontosítás: a számviteli bizonylatok (számlák) törvényi megőrzés alá
    // esnek, azokat nem töröljük a fiókkal együtt.
    message: 'A fiókod és a hozzá tartozó adatok törölve lettek. '
      + 'A jogszabály által kötelezően megőrzendő számlázási adatok (számlák) a törvényi '
      + 'megőrzési idő végéig megmaradnak.',
  });
});

module.exports = router;
