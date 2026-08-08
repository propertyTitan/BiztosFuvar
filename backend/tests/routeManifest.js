// =====================================================================
//  Route-manifest — MINDEN végpont hozzáférési besorolása
//
//  Ez a fájl egy SZÁNDÉK-NYILATKOZAT: kit engedünk egy végponthoz.
//  A `hulyebiztos-matrix.test.js` két dolgot csinál vele:
//    1. összeveti az Express router valódi tartalmával — ha új végpont
//       születik és nem kerül ide, a build PIROS lesz (nem lehet véletlenül
//       kapuzatlan végpontot élesíteni);
//    2. a besorolás alapján TÁMADJA a végpontot (token nélkül, idegen
//       userrel, admin-jog nélkül) és ellenőrzi, hogy tényleg úgy véd, ahogy
//       itt írva van.
//
//  Besorolások:
//    'public' — szándékosan bárki hívhatja (nincs authRequired). MINDEN
//               ilyen sorhoz kötelező a `why`: miért biztonságos.
//    'auth'   — bejelentkezés kell; a jogosultság-finomhangolás (ki melyik
//               fuvart látja) a handlerben van, azt a party-tesztek fedik.
//    'admin'  — csak `role === 'admin'`.
//
//  ⚠️ Ha új végpontot adsz hozzá a backendhez, IDE IS vedd fel. A teszt
//  hibaüzenete meg fogja mondani a pontos kulcsot.
// =====================================================================

const ROUTE_MANIFEST = {
  // ── Szándékosan publikus ────────────────────────────────────────────
  'GET /health': { access: 'public', why: 'életjel a Railway/monitorozás számára, nincs adat' },
  'GET /coverage/zones': { access: 'public', why: 'a lefedettségi zónák a landingen is kellenek' },
  'GET /calculator/estimate': { access: 'public', why: 'nyilvános ár-kalkulátor a marketing-oldalon' },
  'GET /link-preview': { access: 'public', why: '„Hozasd el" OG-előnézet; SSRF-védett host-allowlist + rate limit' },
  'GET /tracking/:token': { access: 'public', why: 'a címzett SMS-ben kapott linkje — a token maga a belépő' },
  'GET /auth/verify-email': { access: 'public', why: 'email-megerősítő link, a token azonosít' },
  'POST /auth/register': { access: 'public', why: 'regisztráció' },
  'POST /auth/login': { access: 'public', why: 'belépés' },
  'POST /auth/forgot-password': { access: 'public', why: 'jelszó-emlékeztető kérése' },
  'POST /auth/reset-password': { access: 'public', why: 'jelszó-visszaállítás a token birtokában' },
  'POST /payments/barion/callback': { access: 'public', why: 'PSP szerver-szerver webhook (dormant); a hitelesítés a szolgáltatónál' },
  'POST /payments/qvik/callback': { access: 'public', why: 'PSP szerver-szerver webhook; a hitelesítés a szolgáltatónál' },

  // ── Admin-only ──────────────────────────────────────────────────────
  'GET /auth/admin/stats': { access: 'admin' },
  'GET /admin/users': { access: 'admin' },
  'PATCH /admin/users/:id': { access: 'admin' },
  'DELETE /admin/users/:id': { access: 'admin' },
  'POST /admin/users/:id/force-logout': { access: 'admin' },
  'GET /admin/jobs': { access: 'admin' },
  'PATCH /admin/jobs/:id': { access: 'admin' },
  'DELETE /admin/jobs/:id': { access: 'admin' },
  'GET /admin/bids/:jobId': { access: 'admin' },
  'DELETE /admin/bids/:id': { access: 'admin' },
  'GET /admin/bookings': { access: 'admin' },
  'DELETE /admin/bookings/:id': { access: 'admin' },
  'GET /admin/routes': { access: 'admin' },
  'DELETE /admin/routes/:id': { access: 'admin' },
  'GET /admin/kyc-documents': { access: 'admin' },
  'PATCH /admin/kyc-documents/:id': { access: 'admin' },
  'GET /admin/live': { access: 'admin' },
  'GET /admin/messages': { access: 'admin' },
  'GET /admin/users/:id': { access: 'admin' },
  'GET /admin/dm/threads': { access: 'admin' },
  'GET /admin/dm/with/:userId': { access: 'admin' },
  'POST /admin/dm/with/:userId': { access: 'admin' },
  'POST /admin/dm/broadcast': { access: 'admin' },
  'GET /admin/dm/broadcasts': { access: 'admin' },
  'PATCH /admin/dm/channel': { access: 'admin' },
  'PATCH /admin/photo-hold': { access: 'admin' },
  'PATCH /admin/coverage/:zoneId': { access: 'admin' },
  'GET /payments/admin/log': { access: 'admin' },
  'POST /auth/admin/grant-monthly-vouchers': { access: 'admin' },

  // ── Bejelentkezés kell ──────────────────────────────────────────────
  'GET /auth/me': { access: 'auth' },
  'PATCH /auth/me': { access: 'auth' },
  'DELETE /auth/me': { access: 'auth' },
  'GET /auth/me/driver-dashboard': { access: 'auth' },
  'GET /auth/me/game-stats': { access: 'auth' },
  'GET /auth/kyc-status': { access: 'auth' },
  'POST /auth/kyc-document': { access: 'auth' },
  'POST /auth/avatar': { access: 'auth' },
  'POST /auth/push-token': { access: 'auth' },
  'POST /auth/resend-verification': { access: 'auth' },
  'POST /auth/accept-driver-terms': { access: 'auth' },
  'POST /auth/tax-data': { access: 'auth' },
  'POST /auth/verify-company': { access: 'auth' },
  'GET /auth/referral': { access: 'auth' },
  'GET /auth/users/:id/profile': { access: 'auth' },
  'GET /me/admin-messages': { access: 'auth' },
  'POST /me/admin-messages': { access: 'auth' },

  'GET /jobs/': { access: 'auth' },
  'POST /jobs/': { access: 'auth' },
  'GET /jobs/:id': { access: 'auth' },
  'GET /jobs/mine/list': { access: 'auth' },
  'POST /jobs/:id/pay': { access: 'auth' },
  'POST /jobs/:id/confirm-payment': { access: 'auth' },
  'POST /jobs/:id/cancel': { access: 'auth' },
  'POST /jobs/:id/reopen': { access: 'auth' },
  'POST /jobs/:id/instant-accept': { access: 'auth' },
  'GET /jobs/:jobId/bids': { access: 'auth' },
  'POST /jobs/:jobId/bids': { access: 'auth' },
  'GET /jobs/:jobId/escrow': { access: 'auth' },
  'GET /jobs/:jobId/photos': { access: 'auth' },
  'POST /jobs/:jobId/photos': { access: 'auth' },
  'GET /jobs/:jobId/questions': { access: 'auth' },
  'POST /jobs/:jobId/questions': { access: 'auth' },
  'POST /jobs/:jobId/reviews': { access: 'auth' },
  'GET /jobs/:jobId/location/last': { access: 'auth' },
  'POST /jobs/:jobId/location': { access: 'auth' },

  'GET /bids/mine': { access: 'auth' },
  'GET /bids/preview': { access: 'auth' },
  'POST /bids/:id/accept': { access: 'auth' },
  'POST /bids/:id/counter': { access: 'auth' },
  'POST /bids/:id/accept-counter': { access: 'auth' },

  'GET /carrier-routes': { access: 'auth' },
  'POST /carrier-routes': { access: 'auth' },
  'GET /carrier-routes/mine': { access: 'auth' },
  'GET /carrier-routes/:id': { access: 'auth' },
  'PATCH /carrier-routes/:id': { access: 'auth' },
  'PATCH /carrier-routes/:id/status': { access: 'auth' },
  'GET /carrier-routes/:id/along-jobs': { access: 'auth' },
  'GET /carrier-routes/:id/bookings': { access: 'auth' },
  'POST /carrier-routes/:id/bookings': { access: 'auth' },

  'GET /route-bookings/mine': { access: 'auth' },
  'GET /route-bookings/:id': { access: 'auth' },
  'POST /route-bookings/:id/pay': { access: 'auth' },
  'POST /route-bookings/:id/confirm-payment': { access: 'auth' },
  'POST /route-bookings/:id/confirm': { access: 'auth' },
  'POST /route-bookings/:id/reject': { access: 'auth' },
  'POST /route-bookings/:id/cancel': { access: 'auth' },
  'GET /route-bookings/:bookingId/photos': { access: 'auth' },
  'POST /route-bookings/:bookingId/photos': { access: 'auth' },

  'GET /carrier-alerts': { access: 'auth' },
  'POST /carrier-alerts': { access: 'auth' },
  'PATCH /carrier-alerts/:id': { access: 'auth' },
  'DELETE /carrier-alerts/:id': { access: 'auth' },

  'GET /disputes': { access: 'auth' },
  'GET /disputes/mine': { access: 'auth' },
  'GET /disputes/:id': { access: 'auth' },
  'POST /disputes': { access: 'auth' },
  'PATCH /disputes/:id': { access: 'auth' },

  'GET /messages': { access: 'auth' },
  'POST /messages': { access: 'auth' },
  'GET /reviews': { access: 'auth' },
  'POST /reviews': { access: 'auth' },
  'POST /questions/:id/answer': { access: 'auth' },
  'PATCH /questions/:id/hide': { access: 'auth' },

  'GET /notifications': { access: 'auth' },
  'GET /notifications/unread-count': { access: 'auth' },
  'POST /notifications/:id/read': { access: 'auth' },
  'POST /notifications/read-all': { access: 'auth' },

  'GET /backhaul/suggestions': { access: 'auth' },
  'GET /backhaul/for-trip/:jobId': { access: 'auth' },
  'GET /driver-stats': { access: 'auth' },
  'GET /payments/payout-status/:jobId': { access: 'auth' },

  'POST /ai/chat': { access: 'auth' },
  'POST /sos': { access: 'auth' },
  'GET /sos/mine': { access: 'auth' },

  'POST /towing/register': { access: 'auth' },
  'POST /towing/request': { access: 'auth' },
  'POST /towing/toggle-available': { access: 'auth' },
  'GET /towing/incoming': { access: 'auth' },
  'GET /towing/my-requests': { access: 'auth' },
  'POST /towing/:id/accept': { access: 'auth' },
  'POST /towing/:id/arrive': { access: 'auth' },
  'POST /towing/:id/complete': { access: 'auth' },
  'POST /towing/:id/cancel': { access: 'auth' },
};

module.exports = { ROUTE_MANIFEST };
