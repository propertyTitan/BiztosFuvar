// =====================================================================
//  JÁRAT-ÁG KAPCSOLÓ — közös kapu (2026-09-11 D1; 2026-09-28 audit P1)
//
//  A launchra a járat-ág rejtett (web: NEXT_PUBLIC_JARAT_ENABLED, backend:
//  JARAT_ENABLED). Kikapcsolva a /carrier-routes és /route-bookings alatti
//  ÍRÓ végpontok 503 JARAT_DISABLED-et adnak; az OLVASÓK (GET) élnek.
//
//  ⚠️ MIÉRT KÖZÖS MODUL (2026-09-28, audit P1 R1-3). Az első kapu két helyen
//  volt lyukas:
//   (1) KIS/NAGYBETŰ: kis/nagybetű-érzékeny regexszel nézte a `req.path`-ot,
//       az Express routere viszont alapból érzéketlen — a `POST /Carrier-Routes`
//       vagy a `POST /ROUTE-BOOKINGS/<id>/confirm` átcsúszott a kapun, és
//       elérte a kezelőt;
//   (2) MÁS ROUTER: a `POST /route-bookings/:bookingId/photos` a photos
//       routerben él, ami a carrierRoutes ELŐTT van mountolva — oda a kapu
//       el sem jutott.
//  Ezért a kapu EGY helyen él, `i` flaggel, és minden routerbe be kell tenni,
//  ahol járat-író végpont van. Az őr (audit-20260928-jarat-kapu.test.js) a
//  router-stackből olvassa a végpontokat: egy kapu nélküli új író végpont
//  bármely routerben pirosra váltja.
//
//  ⚠️ Az útvonal-előtag ellenőrzése KÖTELEZŐ (a SOS-kapcsoló tanulsága): a
//  routerek '/'-ra vannak csatolva, előtag nélkül minden utána mountolt
//  végpont 503-at kapna (funkcio-kapcsolo-hatokor.test.js).
// =====================================================================

const JARAT_ELOTAG = /^\/(carrier-routes|route-bookings)(\/|$)/i;

function jaratEnabled() {
  return String(process.env.JARAT_ENABLED || '').toLowerCase() === 'true';
}

/** Express-middleware: a kikapcsolt járat-ág írásait 503-mal zárja. */
function jaratIrasKapu(req, res, next) {
  if (req.method === 'GET' || jaratEnabled()) return next();
  if (!JARAT_ELOTAG.test(req.path)) return next();
  return res.status(503).json({
    error: 'Az induló járatok funkció még nem elérhető — hamarosan. Addig add fel a fuvart, és a szállítók ajánlatot tesznek rá.',
    code: 'JARAT_DISABLED',
  });
}

module.exports = { jaratEnabled, jaratIrasKapu };
