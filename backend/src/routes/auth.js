// Egyszerű auth (regisztráció + bejelentkezés).
// Megjegyzés: a jelszót `crypto.scrypt`-tel hash-eljük – nincs külön bcrypt függőség.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { loginRateLimit, registerRateLimit } = require('../middleware/rateLimit');
const { getDriverGameStats, grantMonthlyVouchers } = require('../services/gamification');
const { uploadAndRegister } = require('./files');
const { purgeUserData } = require('../services/kyc');
const {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/email');

// ---------- Helper a verifikációs / reset tokenekhez ----------
// Egyszer használatos, kriptografikailag random token. A nyers token
// CSAK a kimenő e-mailbe kerül. A DB-ben SHA-256 hash van. A user a
// linkkel jön vissza, mi újra hash-eljük és így keressük.
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function getWebBase() {
  return process.env.WEB_BASE_URL || 'http://localhost:3000';
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

// POST /auth/register — óránként max 5 új fiók IP-nként
router.post('/register', registerRateLimit, async (req, res) => {
  const { email, password, full_name, phone, vehicle_type, vehicle_plate } = req.body || {};
  // A role mező már opcionális — minden user lehet egyszerre feladó és sofőr is.
  // A DB-ben még tároljuk a legacy role mezőt, de a logika nem használja.
  const role = (req.body?.role === 'carrier' || req.body?.role === 'admin') ? req.body.role : 'shipper';
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'A jelszó minimum 8 karakter legyen' });
  }
  try {
    // Email verifikációs token előállítása már regisztrációkor —
    // azonnal megy egy welcome+verify mail. A user be tud lépni
    // verifikálatlanul is, csak banner figyelmezteti.
    const verifyToken = generateToken();
    const verifyHash = hashToken(verifyToken);

    const { rows } = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone, vehicle_type, vehicle_plate,
                          email_verification_token_hash, email_verification_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, role, email, full_name, email_verified`,
      [role, email, hashPassword(password), full_name, phone || null, vehicle_type || null, vehicle_plate || null, verifyHash],
    );
    const user = rows[0];

    // Email küldés — best-effort, soha nem akasztjuk meg vele a registert
    sendEmailVerificationEmail({
      to: email,
      fullName: full_name,
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
      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 perc
      await db.query(
        `UPDATE users
            SET password_reset_token_hash = $1,
                password_reset_expires_at = $2
          WHERE id = $3`,
        [tokenHash, expiresAt, user.id],
      );
      sendPasswordResetEmail({
        to: email,
        fullName: user.full_name,
        resetUrl: `${getWebBase()}/jelszo-reset?token=${token}`,
      }).catch((e) => console.warn('[auth] reset mail hiba:', e.message));
    }
  } catch (err) {
    // SECURITY: DB hibát is generic módon kezelünk, hogy ne szivárogjon
    // ki belőle melyik email létezik. A hibát logoljuk, a user 200-at kap.
    console.error('[auth] forgot-password hiba:', err.message);
  }
  res.json(generic);
});

// POST /auth/reset-password — új jelszó beállítása a tokennel
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'A jelszó minimum 8 karakter legyen' });
  }
  try {
    const tokenHash = hashToken(token);
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
    const tokenHash = hashToken(String(token));
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

    // Anti-spam: 1 perc minimum az újraküldések között
    if (user.email_verification_sent_at) {
      const ago = Date.now() - new Date(user.email_verification_sent_at).getTime();
      if (ago < 60 * 1000) {
        return res.status(429).json({
          error: 'Pár másodpercet várj — frissen küldtünk egyet. Nézd meg a postaládád + spam mappát.',
        });
      }
    }

    const verifyToken = generateToken();
    const verifyHash = hashToken(verifyToken);
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
  const { rows } = await db.query(
    'SELECT id, role, email, full_name, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Hibás email vagy jelszó' });
  }
  delete user.password_hash;
  res.json({ user, token: signToken(user) });
});

// GET /auth/me — a bejelentkezett user teljes profilja
//
// A KYC mezők (kyc_status, can_bid, license_expiry, kyc_verified_at) is
// itt jönnek vissza, hogy a mobil/web kliensek egyetlen hívásból tudják
// eldönteni, kell-e „hitelesítsd magad" banner / a licit gomb tiltása.
router.get('/me', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, role, email, full_name, phone, vehicle_type, vehicle_plate,
            avatar_url, avatar_file_id, bio, rating_avg, rating_count, created_at,
            kyc_status, kyc_verified_at, license_expiry, can_bid,
            email_verified
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json(rows[0]);
});

// PATCH /auth/me — profil szerkesztés.
// Az avatar mostantól csak a /auth/avatar feltöltésen keresztül változhat
// (az állítja az avatar_file_id-t). Itt direkt URL-t SEM lehet beírni —
// a régi `avatar_url` mezőre szándékosan nincs írás-jog, hogy a privát
// gate-elt fájl-rendszer kötelező legyen.
router.patch('/me', authRequired, async (req, res) => {
  const allowed = ['full_name', 'phone', 'vehicle_type', 'vehicle_plate', 'bio'];
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

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nincs módosítandó mező' });
  }

  values.push(req.user.sub);
  const { rows } = await db.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${idx}
    RETURNING id, role, email, full_name, phone, vehicle_type, vehicle_plate,
              avatar_url, avatar_file_id, bio, rating_avg, rating_count, created_at`,
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
      `SELECT id, full_name, avatar_url, avatar_file_id, bio, vehicle_type, vehicle_plate,
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

// POST /auth/avatar — profilkép feltöltés. Privát R2-ra; a kliens
// a `users.avatar_file_id`-t kapja, a /files/:id endpointtal jeleníti meg.
router.post('/avatar', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  try {
    const file = await uploadAndRegister({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimetypeHint: req.file.mimetype,
      kind: 'avatar',
      ownerId: req.user.sub,
    });
    await db.query(
      `UPDATE users SET avatar_file_id = $1, avatar_url = NULL, updated_at = NOW()
        WHERE id = $2`,
      [file.id, req.user.sub],
    );
    res.json({ file_id: file.id });
  } catch (err) {
    console.error('[auth] avatar upload hiba:', err);
    res.status(400).json({ error: err.message || 'Fájl mentés sikertelen' });
  }
});

// DELETE /auth/me — Right-to-be-forgotten.
// A user MINDEN feltöltött fájlja törlődik R2-ről, a profil anonimizálva,
// a jogi okból megőrzendő naplók (file_access_log, payment_events) megmaradnak
// de már nem köthetők személyhez.
router.delete('/me', authRequired, async (req, res) => {
  try {
    const result = await purgeUserData(req.user.sub);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[auth] account purge hiba:', err);
    res.status(500).json({ error: 'Adattörlés sikertelen — vedd fel a kapcsolatot az ügyfélszolgálattal.' });
  }
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

module.exports = router;
