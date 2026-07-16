// JWT alapú authentikációs middleware.
const jwt = require('jsonwebtoken');
const db = require('../db');

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Hiányzó token' });
  let payload;
  try {
    // Explicit algoritmus-whitelist: HS256 (szimmetrikus). Enélkül elméletben
    // alg-confusion nyílna, ha valaha nyilvános kulcsra váltanánk.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Érvénytelen token' });
  }
  try {
    // Session-invalidáció: a token `tv` claimje egyezzen a DB aktuális
    // token_version-jével. Jelszó-reset (token_version++) után a régi token
    // itt bukik el. A `tv ?? 0` a migráció előtt kiadott tokeneket 0-ként
    // kezeli (zökkenőmentes bevezetés).
    const { rows } = await db.query('SELECT token_version FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Érvénytelen token' });
    if ((rows[0].token_version ?? 0) !== (payload.tv ?? 0)) {
      return res.status(401).json({
        error: 'A munkameneted lejárt — jelentkezz be újra.',
        code: 'SESSION_INVALIDATED',
      });
    }
    req.user = payload;
    next();
  } catch (err) {
    // DB-hiba NEM jelent érvénytelen tokent (pl. Neon cold start) — továbbadjuk
    // a hibakezelőnek (500, retryable), nem léptetjük ki feleslegesen a usert.
    next(err);
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
    // Céges KYB-kapu szándékosan kikapcsolva (2026-07-05): a céges fiók az
    // adószám + cégnév megadásával működik, nincs dokumentum/fotó-ellenőrzés.
    // A company_verification_status oszlop + admin-folyamat dormant, később
    // visszakapcsolható. A természetes személyt az identity KYC továbbra is védi.
    next();
  } catch (err) { next(err); }
}

async function requireDriverKYC(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT identity_kyc_status, driver_terms_accepted_at FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Felhasználó nem található' });
    // A személyi igazolvány (identity KYC) mindenkinek kötelező — aki ezt
    // igazolta, jogosult MINDENRE (feladó és szállító). A jogosítvány-követelmény
    // megszűnt (2026-07-07): a nem-motoros futárokat is engedjük.
    if (u.identity_kyc_status !== 'verified') {
      return res.status(403).json({
        error: 'A biztonságos fizetéshez és a csomagod védelméhez kérjük, igazold a profilod.',
        code: 'IDENTITY_KYC_REQUIRED',
        identity_kyc_status: u.identity_kyc_status,
      });
    }
    // Szállítói egyszeri nyilatkozat: minden jogszabály + KRESZ betartása.
    if (!u.driver_terms_accepted_at) {
      return res.status(403).json({
        error: 'A fuvarozás megkezdéséhez fogadd el a nyilatkozatot: minden vonatkozó jogszabályt és a KRESZ-t betartod.',
        code: 'DRIVER_TERMS_REQUIRED',
      });
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { authRequired, requireRole, requireIdentityKYC, requireDriverKYC };
