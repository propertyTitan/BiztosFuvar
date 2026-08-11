// =====================================================================
//  ADMIN-NAPLÓ MANIFEST — melyik admin-olvasás hagy nyomot?
//
//  ⚠️ MIÉRT LÉTEZIK: az admin-hozzáférési napló öt végponton épült meg — azon
//  az ötön, ahol a hiányt felfedezték. A `GET /admin/bookings` kimaradt,
//  holott az a `GET /admin/jobs` PONTOS IKERPÁRJA, és a `/admin/jobs` saját
//  kommentje szó szerint így indokolja a naplózást:
//
//      „A `j.*` a címzett teljes elérhetőségét és az átvételi kódot is hozza,
//       fuvaronként — tömegesen. Ez is naplózandó hozzáférés."
//
//  A foglalási ág ugyanezt hozza (címzett neve + telefonja + e-mailje +
//  átvételi kód + követő-token + pontos címek), és nyom nélkül hozta.
//  Ugyanígy maradt ki a teljes admin↔user levelezés és a viták szabad szövege.
//
//  Ez ugyanaz a minta, amit a PII-csatorna őr a felhasználói oldalon már
//  lezárt: „a védelem azon az úton épül meg, ahol felfedezték". Ez a manifest
//  az ADMIN oldalra teszi ugyanezt.
//
//  KATEGÓRIÁK
//    naplozando — más felhasználók személyes adatát adja vissza → logAdminAccess
//                 KÖTELEZŐ, a hívási láncban futásidőben ellenőrizve
//    kivetel    — nem ad vissza személyes adatot (aggregátum, jelenlét,
//                 saját tartalom); indoklás kötelező
// =====================================================================

const ADMIN_NAPLO_MANIFEST = {
  // ── Naplózandó: mások személyes adata ────────────────────────────────
  'GET /admin/users': 'naplozando',
  'GET /admin/users/:id': 'naplozando',
  'GET /admin/jobs': 'naplozando',
  'GET /admin/bookings': 'naplozando',
  'GET /admin/routes': 'naplozando',
  'GET /admin/bids/:jobId': 'naplozando',
  'GET /admin/messages': 'naplozando',
  'GET /admin/kyc-documents': 'naplozando',
  'GET /admin/dm/threads': 'naplozando',
  'GET /admin/dm/with/:userId': 'naplozando',

  // ── Indokolt kivételek ───────────────────────────────────────────────
  'GET /admin/live': {
    kivetel: 'Élő jelenlét-összesítő: darabszámok szerep szerint. Nevet és '
      + 'elérhetőséget nem ad vissza, csak azt, hányan vannak éppen az oldalon.',
  },
  'GET /admin/dm/broadcasts': {
    kivetel: 'A SAJÁT körüzeneteink naplója (tárgy, szöveg, célcsoport, '
      + 'darabszám) — a platform által küldött tartalom, nem felhasználói adat. '
      + 'Címzett-listát nem tartalmaz.',
  },
};

module.exports = { ADMIN_NAPLO_MANIFEST };
