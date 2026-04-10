// Egyszerű auth (regisztráció + bejelentkezés).
// Megjegyzés: a jelszót `crypto.scrypt`-tel hash-eljük – nincs külön bcrypt függőség.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { loginRateLimit, registerRateLimit } = require('../middleware/rateLimit');

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
  try {
    const { rows } = await db.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone, vehicle_type, vehicle_plate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, role, email, full_name`,
      [role, email, hashPassword(password), full_name, phone || null, vehicle_type || null, vehicle_plate || null],
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
            avatar_url, bio, rating_avg, rating_count, created_at
       FROM users WHERE id = $1`,
    [req.user.sub],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json(rows[0]);
});

// PATCH /auth/me — profil szerkesztés
// Engedélyezett mezők: full_name, phone, vehicle_type, vehicle_plate, bio, avatar_url
router.patch('/me', authRequired, async (req, res) => {
  const allowed = ['full_name', 'phone', 'vehicle_type', 'vehicle_plate', 'bio', 'avatar_url'];
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

// GET /auth/users/:id/profile — publikus profil (más felhasználók)
router.get('/users/:id/profile', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, full_name, avatar_url, bio, vehicle_type, vehicle_plate,
            rating_avg, rating_count, created_at
       FROM users WHERE id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json(rows[0]);
});

module.exports = router;
