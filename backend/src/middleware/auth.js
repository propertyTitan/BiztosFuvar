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
    const { rows } = await db.query(
      'SELECT token_version, role, email_verified FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!rows[0]) return res.status(401).json({ error: 'Érvénytelen token' });
    if ((rows[0].token_version ?? 0) !== (payload.tv ?? 0)) {
      return res.status(401).json({
        error: 'A munkameneted lejárt — jelentkezz be újra.',
        code: 'SESSION_INVALIDATED',
      });
    }
    // A SZEREPKÖR A DB-BŐL JÖN, nem a tokenből (2026-08-06, az
    // adversarial-matrix találata). Korábban a `requireRole` a JWT payload
    // `role` mezőjében hitt: egy lefokozott admin a token lejártáig (1 nap)
    // megtartotta az admin-jogát, pedig a DB-ben már nem volt az. A lekérdezés
    // amúgy is lefut a token_version miatt, tehát ez nem kerül plusz körbe.
    req.user = { ...payload, role: rows[0].role, emailVerified: !!rows[0].email_verified };
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

// ⚠️ 2026-07-19 (user-döntés): a FELADÓI útvonalakról ez a kapu KIKERÜLT —
// a feladónak nem kell személyi igazolvány (a kapcsolatfelvételi díj banki
// megfizetése a de facto azonosítás; iparági minta: Shiply/uShip). A
// middleware megmarad KOCKÁZAT-ALAPÚ eszköznek (progressive KYC): nagy
// értékű fuvar / vita / visszaélés-gyanú esetén bármely útvonalra
// visszatehető. A szállítói kapu (requireDriverKYC) változatlan.
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
      `SELECT identity_kyc_status, driver_terms_accepted_at,
              account_type, personal_tax_id, tax_data_requested_at,
              tax_data_reminder_count
         FROM users WHERE id = $1`,
      [req.user.sub],
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'Felhasználó nem található' });
    // A személyi igazolvány (identity KYC) a SZÁLLÍTÓI tevékenységhez kötelező
    // (2026-07-19 óta a feladónak nem kell). A jogosítvány-követelmény
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
    // DAC7-kikényszerítés (Aktv.): ha a magánszemély szállító az adóazonosító-
    // bekérés után 2 emlékeztető + 60 nap elteltével sem adta meg az adatait,
    // az ÚJ ajánlattétel/járat-hirdetés blokkolódik, amíg meg nem adja.
    // (A folyamatban lévő fuvarjait ez nem érinti — csak az újakat.)
    // Lusta require: a dac7 → notifications → middleware/auth körkörös
    // betöltést kerüli el (futáskor már minden modul kész).
    const { computeTaxDataState } = require('../services/dac7');
    const taxState = computeTaxDataState(u);
    if (taxState.blocked) {
      return res.status(403).json({
        error: 'Jogszabályi kötelezettség (DAC7) miatt add meg az adóazonosító jeled a profilodon — utána azonnal folytathatod az ajánlattételt.',
        code: 'TAX_DATA_REQUIRED',
      });
    }
    next();
  } catch (err) { next(err); }
}

/**
 * Megerősített e-mail-cím megkövetelése.
 *
 * ⚠️ 2026-08-10 (adatáramlási audit): az e-mail-kapu eddig KIZÁRÓLAG
 * frontend-oldali volt (EmailVerifyGate overlay). A regisztráció azonnal
 * érvényes JWT-t ad, tehát egy eldobható, NEM LÉTEZŐ e-mail-címmel készült
 * fiók tokenjével a piactér-listák API-ból szabadon lapozhatók voltak
 * (200 sor/kérés, pontos címekkel). Egy böngésző-overlay nem hozzáférés-
 * vezérlés.
 *
 * Csak ott alkalmazzuk, ahol MÁSOK adatait olvassa a felhasználó — a saját
 * profilja, a verifikáció újraküldése és a kijelentkezés nyitva marad,
 * különben nem tudná feloldani a helyzetét.
 */
function requireVerifiedEmail(req, res, next) {
  if (req.user?.emailVerified) return next();
  return res.status(403).json({
    error: 'Erősítsd meg az e-mail-címedet a folytatáshoz. '
      + 'A megerősítő linket a regisztrációkor küldtük el.',
    code: 'EMAIL_NOT_VERIFIED',
  });
}

module.exports = {
  authRequired, requireRole, requireIdentityKYC, requireDriverKYC, requireVerifiedEmail,
};
