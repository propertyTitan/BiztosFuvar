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
const { saveFile } = require('../services/storage');

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
  const {
    email, password, full_name, phone, vehicle_type, vehicle_plate,
    account_type: rawAccountType, company_name, tax_id, company_reg_number,
    eu_vat_number, billing_address,
  } = req.body || {};
  // A role mező már opcionális — minden user lehet egyszerre feladó és sofőr is.
  // A DB-ben még tároljuk a legacy role mezőt, de a logika nem használja.
  const role = (req.body?.role === 'carrier' || req.body?.role === 'admin') ? req.body.role : 'shipper';
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
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

  try {
    const { rows } = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone, vehicle_type, vehicle_plate,
                          account_type, company_name, tax_id, company_reg_number, eu_vat_number, billing_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, role, email, full_name, account_type`,
      [role, email, hashPassword(password), full_name, phone || null, vehicle_type || null, vehicle_plate || null,
       accountType, company_name || null, tax_id || null, company_reg_number || null, eu_vat_number || null, billing_address || null],
    );
    const user = rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Foglalt email' });
    console.error(err);
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
router.get('/me', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, role, email, full_name, phone, vehicle_type, vehicle_plate,
            avatar_url, bio, rating_avg, rating_count, created_at,
            account_type, identity_kyc_status, driver_kyc_status, company_verification_status,
            company_name, tax_id, company_reg_number, eu_vat_number, billing_address
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json(rows[0]);
});

// PATCH /auth/me — profil szerkesztés
// Engedélyezett mezők: full_name, phone, vehicle_type, vehicle_plate, bio, avatar_url
router.patch('/me', authRequired, async (req, res) => {
  const allowed = ['full_name', 'phone', 'vehicle_type', 'vehicle_plate', 'bio', 'avatar_url', 'company_name', 'tax_id', 'company_reg_number', 'eu_vat_number', 'billing_address'];
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
              avatar_url, bio, rating_avg, rating_count, created_at`,
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
router.post('/avatar', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
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
router.post('/kyc-document', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  const { doc_type } = req.body || {};
  const validTypes = ['id_card', 'drivers_license', 'insurance', 'vehicle_registration', 'company_document'];
  if (!validTypes.includes(doc_type)) return res.status(400).json({ error: 'Érvénytelen dokumentum típus' });

  const url = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);

  // AI ellenőrzés: a feltöltött kép tényleg a megadott dokumentum típus-e?
  const { verifyKycDocument } = require('../services/gemini');
  const aiResult = await verifyKycDocument(req.file.buffer, req.file.mimetype, doc_type);
  const docStatus = aiResult.valid ? 'approved' : 'rejected';
  const rejectionReason = aiResult.valid ? null : aiResult.reason;

  await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, rejection_reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, doc_type) DO UPDATE SET
       file_url = EXCLUDED.file_url, status = EXCLUDED.status,
       rejection_reason = EXCLUDED.rejection_reason,
       reviewed_by = NULL, reviewed_at = NOW()`,
    [req.user.sub, doc_type, url, docStatus, rejectionReason],
  );

  // KYC státusz frissítés: approved → verified, rejected → rejected
  const kycStatus = aiResult.valid ? 'verified' : 'rejected';
  if (doc_type === 'id_card') {
    await db.query(`UPDATE users SET identity_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'drivers_license') {
    await db.query(`UPDATE users SET driver_kyc_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  } else if (doc_type === 'company_document') {
    await db.query(`UPDATE users SET company_verification_status = $1 WHERE id = $2`, [kycStatus, req.user.sub]);
  }

  if (aiResult.valid) {
    console.log(`[kyc] AI jóváhagyva: user=${req.user.sub} doc=${doc_type} confidence=${aiResult.confidence}`);
  } else {
    console.log(`[kyc] AI elutasítva: user=${req.user.sub} doc=${doc_type} reason="${aiResult.reason}"`);
  }

  res.json({
    ok: aiResult.valid,
    doc_type,
    status: kycStatus,
    file_url: url,
    ai_reason: aiResult.reason,
    ai_confidence: aiResult.confidence,
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

module.exports = router;
