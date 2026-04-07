// Egyszerű auth (regisztráció + bejelentkezés).
// Megjegyzés: a jelszót `crypto.scrypt`-tel hash-eljük – nincs külön bcrypt függőség.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

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

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, role, phone, vehicle_type, vehicle_plate } = req.body || {};
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }
  if (!['shipper', 'carrier'].includes(role)) {
    return res.status(400).json({ error: 'Érvénytelen szerepkör' });
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

// POST /auth/login
router.post('/login', async (req, res) => {
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

module.exports = router;
