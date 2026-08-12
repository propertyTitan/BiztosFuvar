// =====================================================================
//  PII-CSATORNA MANIFEST — ki olvashat MÁSOK adatából?
//
//  ⚠️ MIÉRT LÉTEZIK: 2026-08-10-én megépült a szerver-oldali e-mail-kapu
//  (`requireVerifiedEmail`), mert kiderült, hogy egy eldobható, NEM LÉTEZŐ
//  e-mail-címmel készült fiók tokenjével a piactér lapozható volt. A kaput
//  viszont KÉT végpontra tettük rá — arra a kettőre, ahol a rést felfedezték.
//
//  A következő független mérés megmutatta, hogy ugyanaz az adat (házszámig
//  pontos cím) legalább NÉGY másik úton kimegy, az egyiken PUSH-ban (az
//  útvonal-figyelő értesítése és e-mailje), tehát lekérdezni sem kell.
//  Az ügynök megfogalmazása pontos volt:
//
//      „Egy védelem azon az úton épül meg, ahol felfedezték —
//       az egyenértékű utakon nem."
//
//  Ez a manifest ezt a mintát zárja le. MINDEN hitelesített GET-végpontot be
//  kell sorolni, és a `masok` besorolásúakon a kapunak FUTÁSIDŐBEN rajta kell
//  lennie (a hívási láncot az Express router-stackből olvassuk, nem a
//  forrásszövegből). Új végpont besorolás nélkül = piros build.
//
//  KATEGÓRIÁK
//    sajat   — kizárólag a hívó SAJÁT adatát adja vissza → kapu nem kell
//    felek   — egy ügylet felei látják egymás adatát, külön jogosultság-
//              ellenőrzéssel (getJobParty / checkAccess) → az e-mail-kapu itt
//              nem ad többet: a hívó már bizonyítottan érintett
//    admin   — admin-only, saját szerepkör-kapuja van
//    masok   — MÁS felhasználók adatát adja böngészésre → KAPU KÖTELEZŐ
//    kivetel — `masok` lenne, de a kapu szándékosan hiányzik: indoklás kötelező
// =====================================================================

const PII_CSATORNA_MANIFEST = {
  // ── Saját adat ──────────────────────────────────────────────────────
  'GET /auth/me': 'sajat',
  'GET /auth/me/export': 'sajat',
  'GET /auth/me/driver-dashboard': 'sajat',
  'GET /auth/me/game-stats': 'sajat',
  'GET /auth/kyc-status': 'sajat',
  'GET /auth/referral': 'sajat',
  'GET /bids/mine': 'sajat',
  'GET /bids/preview': 'sajat',
  'GET /carrier-alerts': 'sajat',
  'GET /carrier-routes/mine': 'sajat',
  'GET /disputes/mine': 'sajat',
  'GET /driver-stats': 'sajat',
  'GET /jobs/mine/list': 'sajat',
  'GET /me/admin-messages': 'sajat',
  'GET /notifications': 'sajat',
  'GET /notifications/unread-count': 'sajat',
  'GET /route-bookings/mine': 'sajat',
  'GET /sos/mine': 'sajat',
  'GET /towing/my-requests': 'sajat',

  // ── Ügylet felei (külön jogosultság-ellenőrzés) ─────────────────────
  'GET /jobs/:jobId/bids': 'felek',
  'GET /jobs/:jobId/escrow': 'felek',
  'GET /jobs/:jobId/location/last': 'felek',
  // ⚠️ 2026-08-11 (10. mérés A1): ez a címke HAMIS volt. A végpont a
  // nem-félnek is adott vissza adatot (listing-fotó), méghozzá a NYERS
  // photos sort — uploader_id-vel és GPS-koordinátával. Most kapuzott, és a
  // nem-fél csak a fotó URL-jét kapja meg.
  'GET /jobs/:jobId/photos': 'masok',
  'GET /messages': 'felek',
  'GET /disputes/:id': 'felek',
  'GET /disputes': 'felek',
  'GET /route-bookings/:id': 'felek',
  'GET /route-bookings/:bookingId/photos': 'felek',
  'GET /carrier-routes/:id/bookings': 'felek',
  'GET /payments/payout-status/:jobId': 'felek',

  // ── MÁSOK adata böngészésre — a kapu KÖTELEZŐ ───────────────────────
  'GET /jobs/': 'masok',
  'GET /jobs/:id': 'masok',
  'GET /carrier-routes': 'masok',
  'GET /jobs/:jobId/questions': 'masok',
  'GET /reviews': 'masok',
  'GET /auth/users/:id/profile': 'masok',

  // ── Admin ───────────────────────────────────────────────────────────
  'GET /admin/users': 'admin',
  'GET /admin/users/:id': 'admin',
  'GET /admin/jobs': 'admin',
  'GET /admin/bookings': 'admin',
  'GET /admin/routes': 'admin',
  'GET /admin/bids/:jobId': 'admin',
  'GET /admin/messages': 'admin',
  'GET /admin/kyc-documents': 'admin',
  'GET /admin/live': 'admin',
  'GET /admin/dm/threads': 'admin',
  'GET /admin/dm/broadcasts': 'admin',
  'GET /admin/dm/with/:userId': 'admin',
  'GET /auth/admin/stats': 'admin',
  'GET /payments/admin/log': 'admin',

  // ── Indokolt kivételek ──────────────────────────────────────────────
  'GET /carrier-routes/:id': {
    kivetel: 'Egy KONKRÉT járat részlete, azonosító birtokában. A lista '
      + '(GET /carrier-routes) kapuzott, tehát a böngészés-alapú learatás zárva; '
      + 'egy egyedi azonosító ismeretében ez csak azt adja, amit a feladó a '
      + 'foglaláshoz úgyis lát. Ha a járat-részlet valaha több személyes adatot '
      + 'ad vissza, ezt át kell sorolni.',
  },
  'GET /carrier-routes/:id/along-jobs': {
    kivetel: 'A SAJÁT járatra eső fuvarok ajánlása. A hívó a járat tulajdonosa '
      + '(jogosultság-ellenőrzött), a válasz pedig a scrubJobForUser-en megy át. '
      + 'Így ez inkább „felek"-jellegű, de a fuvarok nem az övéi, ezért itt van.',
  },
  'GET /backhaul/suggestions': {
    kivetel: 'Visszafuvar-ajánlás a SAJÁT járathoz; a válasz scrubJobForUser-en '
      + 'megy át. Ugyanaz az indok, mint az along-jobs-nál.',
  },
  'GET /backhaul/for-trip/:jobId': {
    kivetel: 'Ugyanaz, egy konkrét fuvarhoz. Jogosultság-ellenőrzött + scrubolt.',
  },
  'GET /towing/incoming': {
    kivetel: 'A mentős-funkció a TOWING_ENABLED kapcsoló nélkül 503-at ad, és a '
      + 'lista scrubja csak ~1 km-re kerekített helyet + keresztnevet ad. '
      + 'Élesedéskor ezt újra kell értékelni.',
  },

  // ── ÍRÁSI (POST) VÉGPONTOK (2026-08-11, 9. mérés Ő5) ─────────────────
  //
  // ⚠️ Az őr korábban KIZÁRÓLAG GET-et sorolt be, tehát egy `POST /jobs/search`
  // végpont — ugyanaz a lekérdezés, csak más metódussal — a hatályán kívül
  // lett volna, és mindhárom manifest-teszt zöld maradt volna. A díj-kapu egy
  // metódus-váltással megkerülhető lett volna.
  //
  // A POST-ok többsége MŰVELET (a válasz a saját, frissen létrehozott sor vagy
  // egy nyugta), nem böngészési felület — de a besorolás mostantól KÖTELEZŐ,
  // hogy egy jövőbeli adat-visszaadó POST ne maradhasson észrevétlen.

  'POST /admin/dm/broadcast': 'admin',
  'POST /admin/dm/with/:userId': 'admin',
  'POST /admin/users/:id/force-logout': 'admin',
  'POST /auth/admin/grant-monthly-vouchers': 'admin',

  'POST /ai/chat': 'sajat',
  'POST /auth/accept-driver-terms': 'sajat',
  'POST /auth/avatar': 'sajat',
  'POST /auth/kyc-document': 'sajat',
  'POST /auth/push-token': 'sajat',
  'POST /auth/resend-verification': 'sajat',
  'POST /auth/tax-data': 'sajat',
  'POST /auth/verify-company': 'sajat',
  'POST /carrier-alerts': 'sajat',
  'POST /carrier-routes': 'sajat',
  'POST /carrier-routes/:id/bookings': 'sajat',
  'POST /jobs/': 'sajat',
  'POST /jobs/:jobId/bids': 'sajat',
  'POST /me/admin-messages': 'sajat',
  'POST /notifications/:id/read': 'sajat',
  'POST /notifications/read-all': 'sajat',
  'POST /sos': 'sajat',
  'POST /towing/register': 'sajat',
  'POST /towing/request': 'sajat',
  'POST /towing/toggle-available': 'sajat',

  'POST /bids/:id/accept': 'felek',
  'POST /bids/:id/accept-counter': 'felek',
  'POST /bids/:id/counter': 'felek',
  'POST /disputes': 'felek',
  'POST /jobs/:id/cancel': 'felek',
  'POST /jobs/:id/confirm-payment': 'felek',
  'POST /jobs/:id/instant-accept': 'felek',
  'POST /jobs/:id/pay': 'felek',
  'POST /jobs/:id/reopen': 'felek',
  'POST /jobs/:jobId/location': 'felek',
  'POST /jobs/:jobId/photos': 'felek',
  'POST /jobs/:jobId/questions': 'felek',
  'POST /jobs/:jobId/reviews': 'felek',
  'POST /messages': 'felek',
  'POST /questions/:id/answer': 'felek',
  'POST /reviews': 'felek',
  'POST /route-bookings/:bookingId/photos': 'felek',
  'POST /route-bookings/:id/cancel': 'felek',
  'POST /route-bookings/:id/confirm': 'felek',
  'POST /route-bookings/:id/confirm-payment': 'felek',
  'POST /route-bookings/:id/pay': 'felek',
  'POST /route-bookings/:id/reject': 'felek',
  'POST /towing/:id/accept': 'felek',
  'POST /towing/:id/arrive': 'felek',
  'POST /towing/:id/cancel': 'felek',
  'POST /towing/:id/complete': 'felek',
};

// Socket-csatornák: a szoba-belépésnek ugyanazt kell megkövetelnie, mint a
// REST-párjának. A `feed` payloadja (jobs:new) NYITOTT fuvarnál házszámig
// pontos címet visz — ugyanazt, amiért a GET /jobs kaput kapott.
const SOCKET_CSATORNAK = {
  feed: { kapu: 'emailVerified', indok: 'a jobs:new payload pontos címet és GPS-t visz' },
  // A `job:<id>` szoba élő GPS-t, fotó-URL-eket (GPS-metaadattal) és nyers
  // ajánlat-sorokat visz. A belépés DB-ből ellenőrzött (a fuvar fele vagy
  // admin) — ez ERŐSEBB kapu, mint az e-mail-verifikáció, ezért nem azt
  // követeljük meg. ⚠️ A `role` 2026-08-11 óta szintén a DB-ből jön: a
  // JWT-ből olvasva egy lefokozott admin a token lejártáig bejutott.
  job: { kapu: 'db.query', indok: 'élő GPS + fotó-URL-ek + ajánlat-sorok' },
  // A `user:<id>` szoba kizárólag a HITELESÍTETT saját azonosítóval nyílik —
  // a kliens által küldött id-t nem vesszük figyelembe. Ennél szűkebb kaput
  // nem lehet adni.
  user: { kapu: 'me()', indok: 'személyes értesítések, kizárólag a saját szobába' },
};

module.exports = { PII_CSATORNA_MANIFEST, SOCKET_CSATORNAK };
