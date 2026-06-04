// URL-paraméter validáció.
//
// Az azonosítók a DB-ben uuid típusúak. Ha az URL-be nem-uuid érték kerül
// (pl. /jobs/NEM-UUID, bot/scanner/elgépelés), a query a Postgres-nél
// "invalid input syntax for type uuid" hibát dob. A legtöbb route-nál ezt a
// központi hibakezelő 400-ra fordítja, de a saját try/catch-csel rendelkező
// route-oknál a hiba nem buborékol fel odáig. Ez a guard a query ELŐTT,
// router.param-ként fut le, így minden route egységesen tiszta 400-at ad,
// felesleges DB-hívás és Sentry-zaj nélkül.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Express router.param callback: (req, res, next, value) → 400 ha nem uuid.
function uuidParam(req, res, next, value) {
  if (!isUuid(value)) {
    return res.status(400).json({ error: 'Érvénytelen azonosító.' });
  }
  next();
}

module.exports = { isUuid, uuidParam };
