// Egyszerű auth (regisztráció + bejelentkezés).
// Megjegyzés: a jelszót `crypto.scrypt`-tel hash-eljük – nincs külön bcrypt függőség.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { loginRateLimit, registerRateLimit, writeRateLimit } = require('../middleware/rateLimit');
const { getDriverGameStats, grantMonthlyVouchers } = require('../services/gamification');
const { getOrCreateReferralCode, resolveReferrerId } = require('../services/referral');
const { saveFile } = require('../services/storage');
const {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/email');

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
  // A role mező már opcionális — minden user lehet egyszerre feladó és sofőr is.
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
            driver_terms_accepted_at,
            email_verified
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json(rows[0]);
});

// POST /auth/accept-driver-terms — a sofőri egyszeri nyilatkozat elfogadása:
// a felhasználó kijelenti, hogy minden vonatkozó jogszabályt és a KRESZ-t
// betartja. Ezt a sofőr-mód első használatakor kell elfogadni; enélkül a
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
  // céges/fordított-ÁFA kezeléshez). Admin újra jóváhagyja.
  const COMPANY_FIELDS = ['company_name', 'tax_id', 'company_reg_number', 'eu_vat_number', 'billing_address'];
  if (COMPANY_FIELDS.some((f) => req.body[f] !== undefined)) {
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
  res.json(rows[0]);
});

// GET /auth/users/:id/profile — publikus profil + statisztikák
router.get('/users/:id/profile', authRequired, async (req, res) => {
  const uid = req.params.id;
  const [userRes, jobsDone, routesDone, reviewsRes] = await Promise.all([
    db.query(
      `SELECT id, full_name, avatar_url, bio, vehicle_type, vehicle_plate,
              rating_avg, rating_count, trust_score, is_verified_carrier, created_at
         FROM users WHERE id = $1`,
      [uid],
    ),
    // Sofőrként befejezett fuvarok
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

// GET /auth/me/driver-dashboard — a sofőr okos főoldalához MINDEN adat
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
// ajánlások száma, és hány felhasználható ingyen-feladás kupon vár.
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
  try {
    const url = await saveFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    await db.query(
      `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
      [url, req.user.sub],
    );
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
  const { doc_type } = req.body || {};
  const validTypes = ['id_card', 'drivers_license', 'insurance', 'vehicle_registration', 'company_document'];
  if (!validTypes.includes(doc_type)) return res.status(400).json({ error: 'Érvénytelen dokumentum típus' });

  const url = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);

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
          body: `${who} (${req.user.email}) személyi igazolványa alapján 18 év alatti (szül.: ${aiResult.birthDate || '?'}). Kézi jóváhagyás szükséges.`,
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
          body: `${req.user.email} dokumentumát (${doc_type}) az AI nem tudta ellenőrizni — kézi jóváhagyás kell.`,
          link: '/admin#kyc',
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[kyc] admin notify hiba:', e.message);
    }
  } else if (aiResult.valid) {
    docStatus = 'approved';
    kycStatus = 'verified';
    rejectionReason = null;
    console.log(`[kyc] AI jóváhagyva: user=${req.user.sub} doc=${doc_type} confidence=${aiResult.confidence}`);
  } else {
    docStatus = 'rejected';
    kycStatus = 'rejected';
    rejectionReason = aiResult.reason;
    console.log(`[kyc] AI elutasítva: user=${req.user.sub} doc=${doc_type} reason="${aiResult.reason}"`);
  }

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

  if (doc_type === 'id_card') {
    await db.query(`UPDATE users SET identity_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'drivers_license') {
    await db.query(`UPDATE users SET driver_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'company_document') {
    await db.query(`UPDATE users SET company_verification_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  }

  res.json({
    ok: aiResult.valid && !isUnderage,
    doc_type,
    status: kycStatus,
    file_url: url,
    ai_reason: isUnderage
      ? 'A születési dátumod alapján 18 év alatti vagy. A profilod adminisztrátori jóváhagyásra vár.'
      : aiResult.reason,
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

// DELETE /auth/me — fiók törlése (GDPR "elfeledtetéshez való jog")
router.delete('/me', authRequired, async (req, res) => {
  const userId = req.user.sub;

  // Ellenőrzés: van-e aktív fuvar (in_progress)
  const { rows: active } = await db.query(
    `SELECT id FROM jobs WHERE (shipper_id = $1 OR carrier_id = $1) AND status IN ('accepted', 'in_progress')`,
    [userId],
  );
  if (active.length > 0) {
    return res.status(409).json({
      error: 'Nem törölheted a fiókodat amíg aktív fuvarod van. Zárd le vagy mondd le a fuvarjaidat.',
    });
  }

  // Email hash mentése az audit logba (nem az email maga — GDPR)
  const { rows: user } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const emailHash = crypto.createHash('sha256').update(user[0]?.email || '').digest('hex');

  await db.query(
    `INSERT INTO deleted_accounts (original_user_id, email_hash, reason)
     VALUES ($1, $2, $3)`,
    [userId, emailHash, 'Felhasználó saját kérésére'],
  );

  // CASCADE törli: jobs, bids, photos, reviews, notifications, kyc_documents, stb.
  await db.query('DELETE FROM users WHERE id = $1', [userId]);

  console.log(`[account-delete] user ${userId} törölve (email hash: ${emailHash.slice(0, 12)}...)`);
  res.json({ ok: true, message: 'A fiókod és minden adatod törölve lett.' });
});

module.exports = router;
