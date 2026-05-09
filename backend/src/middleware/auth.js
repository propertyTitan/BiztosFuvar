// JWT alapú authentikációs middleware.
const jwt = require('jsonwebtoken');
const db = require('../db');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Hiányzó token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Érvénytelen token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Nincs jogosultság' });
    }
    next();
  };
}

async function requireIdentityKYC(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT identity_kyc_status, account_type, company_verification_status FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Felhasználó nem található' });
    if (u.identity_kyc_status !== 'verified') {
      return res.status(403).json({
        error: 'A biztonságos fizetéshez és a csomagod védelméhez kérjük, igazold a profilod.',
        code: 'IDENTITY_KYC_REQUIRED',
        identity_kyc_status: u.identity_kyc_status,
      });
    }
    if (u.account_type === 'company' && u.company_verification_status !== 'verified') {
      return res.status(403).json({
        error: 'A céges fiókodat még nem ellenőriztük.',
        code: 'COMPANY_KYC_REQUIRED',
        company_verification_status: u.company_verification_status,
      });
    }
    next();
  } catch (err) { next(err); }
}

async function requireDriverKYC(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT identity_kyc_status, account_type, company_verification_status, driver_kyc_status, can_bid FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Felhasználó nem található' });
    if (u.identity_kyc_status !== 'verified') {
      return res.status(403).json({
        error: 'A biztonságos fizetéshez és a csomagod védelméhez kérjük, igazold a profilod.',
        code: 'IDENTITY_KYC_REQUIRED',
        identity_kyc_status: u.identity_kyc_status,
      });
    }
    if (u.account_type === 'company' && u.company_verification_status !== 'verified') {
      return res.status(403).json({
        error: 'A céges fiókodat még nem ellenőriztük.',
        code: 'COMPANY_KYC_REQUIRED',
        company_verification_status: u.company_verification_status,
      });
    }
    if (u.driver_kyc_status !== 'verified') {
      return res.status(403).json({
        error: 'A sofőri tevékenységhez kérjük, igazold a jogosítványod.',
        code: 'DRIVER_KYC_REQUIRED',
        driver_kyc_status: u.driver_kyc_status,
      });
    }
    if (u.can_bid === false) {
      return res.status(403).json({
        error: 'A jogosítványod lejárt vagy nincs jóváhagyva. Frissítsd a profilodon.',
        code: 'LICENSE_EXPIRED',
      });
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { authRequired, requireRole, requireIdentityKYC, requireDriverKYC };
