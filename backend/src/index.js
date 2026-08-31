// GoFuvar backend belépési pont.
require('dotenv').config();

// Sentry init — ha SENTRY_DSN be van állítva, automatikusan kapcsolódik
// és minden uncaught exception + manuálisan jelentett hiba kimegy a
// Sentry projektbe. A `Sentry.init()`-et MINDEN egyéb require előtt
// kell hívni, hogy az auto-instrumentation a HTTP/Express-t is befogja.
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  // PII-szűrés: request body eldobása + token-paraméterek kitakarása +
  // auth-fejlécek törlése (részletek: utils/sentryScrub.js)
  // ⚠️ MIND A HÁROM BORÍTÉKRA (2026-08-10): a `beforeSend` KIZÁRÓLAG
  // hiba-eseményen fut. A teljesítmény-események (tracesSampleRate) másik
  // borítékban mennek, és a kimenő fetch spanjében ott a teljes URL a query
  // stringgel — vagyis az élő SeeMe-kulcs, a 6 jegyű átvételi kód és a
  // telefonszámok. Egy hook beállítása itt NEM elég; a
  // `sentry-borítékok.test.js` őre gondoskodik róla, hogy egy jövőbeli
  // SDK-verzió új borítéka se maradhasson szűretlen.
  const {
    scrubSentryEvent, scrubSentrySpan, scrubSentryTransaction,
  } = require('./utils/sentryScrub');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    // ⚠️ A CONSOLE-BREADCRUMBÖK KIKAPCSOLVA (2026-08-11, adatáramlási audit).
    // A `consoleIntegration` ALAPBÓL be van kapcsolva, és MINDEN `console.*`
    // hívásból breadcrumbot csinál: a `message` a formázott szöveg, a
    // `data.arguments` pedig a NYERS argumentumok. Így egy `console.error(
    // '[error]', err)` kiviszi a Postgres `detail` mezőjét is:
    //     Key (email)=(kovacs.janos@gmail.com) already exists.
    // A szűrőnk mostantól alak-függetlenül takarja az e-mailt és a
    // telefonszámot — de a legbiztosabb, ha ez a felület be sem nyílik: a
    // szerver-logot úgyis látjuk a Railway-en, a breadcrumb hibakeresési
    // többlete csekély, a kockázata nem az.
    integrations: (alap) => alap.filter((i) => i.name !== 'Console'),
    beforeSend: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpan,
    beforeSendTransaction: scrubSentryTransaction,
  });
  console.log('[sentry] aktív');
}

const http = require('http');
const express = require('express');
// Patch-eli az Express-t, hogy az async route handler-ekben dobott hibák
// (pl. egy elszállt db.query) automatikusan a központi hibakezelőhöz
// jussanak, ahelyett hogy lekezeletlen rejection-ként a kérést timeoutig
// lógatnák. Muszáj az route-ok require-je ELŐTT betölteni.
require('express-async-errors');
const cors = require('cors');

const realtime = require('./realtime');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const bidRoutes = require('./routes/bids');
const photoRoutes = require('./routes/photos');
const trackingRoutes = require('./routes/tracking');
const reviewRoutes = require('./routes/reviews');
const paymentRoutes = require('./routes/payments');
const carrierRoutes = require('./routes/carrierRoutes');
const carrierAlertsRoutes = require('./routes/carrierAlerts');
const { router: notificationsRouter } = require('./services/notifications');
const aiRoutes = require('./routes/ai');
const disputeRoutes = require('./routes/disputes');
const messageRoutes = require('./routes/messages');
const backhaulRoutes = require('./routes/backhaul');
const sosRoutes = require('./routes/sos');
const calculatorRoutes = require('./routes/calculator');
const towingRoutes = require('./routes/towing');
const driverStatsRoutes = require('./routes/driverStats');
const adminRoutes = require('./routes/admin');
const adminMessagesRoutes = require('./routes/adminMessages');
const jobQuestionsRoutes = require('./routes/jobQuestions');
const { globalRateLimit } = require('./middleware/rateLimit');

const app = express();
// A proxy (pl. Nginx, Render, Fly) IP-címeit megbízhatónak jelöljük, hogy
// az X-Forwarded-For header alapján a rate limiter a valódi kliens IP-t lássa.
app.set('trust proxy', 1);

// ── Biztonsági fejlécek (SEC-002/010, Manus biztonsági audit 2026-08-31) ──
// Az `X-Powered-By: Express` fölösleges fingerprint volt.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // SEC-010: az API-válaszok (profil, KYC-metaadat, üzenetek, fizetés)
  // érzékenyek — semmilyen közbenső/böngésző-cache nem tárolhatja őket.
  // A /uploads statikus fájljai KIVÉTELEK (publikus fotók, cache-elhetők) —
  // ott az express.static a saját fejléceit adja.
  if (!req.path.startsWith('/uploads')) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  }
  next();
});

// CORS: prod-ban a CORS_ORIGIN env-ben felsorolt domain-eket engedjük
// (vesszővel elválasztva), fejlesztéskor pedig mindent (*). A Socket.IO
// transzport külön CORS-t használ a realtime.js-ben.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));

// ── NULL-bájt szűrő (2026-08-06, az adversarial-matrix találata) ──
// A Postgres UTF8 oszlopba nem tud 0x00-t írni és lekérdezni sem: a driver
// „invalid byte sequence for encoding UTF8: 0x00" hibát dob, amiből nyers
// 500-as „Szerverhiba" lett — bármely végponton, ahol a paraméter a DB-ig
// eljut (pl. GET /auth/users/<%00>/profile). Ez a szűrő EGY helyen zárja le
// az egész osztályt: null-bájtot tartalmazó kérés soha nem jut a DB-ig.
// Külön haszon: a null-bájt klasszikus szűrő-megkerülési trükk is
// (a validáció a bájt előtti részt látja, a tároló a mögöttit).
const NULL_BYTE = '\u0000'; // explicit escape — literális NUL-bájt a forrásban láthatatlan és törékeny
function hasNullByte(value, depth = 0) {
  if (depth > 6) return false; // mély/körkörös struktúra ellen
  if (typeof value === 'string') return value.includes(NULL_BYTE);
  if (Array.isArray(value)) return value.some((v) => hasNullByte(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([k, v]) => hasNullByte(k, depth + 1) || hasNullByte(v, depth + 1),
    );
  }
  return false;
}
app.use((req, res, next) => {
  // A req.url a NYERS (még kódolt) útvonal — a %00 dekódolás után válik
  // veszélyessé, ezért mindkét alakot nézzük.
  let decodedUrl = req.url;
  try { decodedUrl = decodeURIComponent(req.url); } catch { /* hibás %-escape */ }
  if (
    decodedUrl.includes(NULL_BYTE) ||
    hasNullByte(req.query) ||
    hasNullByte(req.body)
  ) {
    return res.status(400).json({
      error: 'A kérés érvénytelen karaktert tartalmaz.',
      code: 'INVALID_CHARACTER',
    });
  }
  next();
});

// A /health az EGYETLEN, ami szándékosan a rate limiter ELŐTT van: a
// loadbalancer/monitoring health check-jeit nem szabad korlátozni.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gofuvar-backend' }));

const publicTrackingRoutes = require('./routes/publicTracking');
const linkPreviewRoutes = require('./routes/linkPreview');
const path = require('path');

// Globális, IP-alapú rate limit: 300 kérés / perc / IP. Második védelmi
// vonal a per-endpoint limitek után — spike-ok, botok ellen védekezik.
// ⚠️ MINDEN publikus (auth nélküli) végpont a limiter UTÁN jön, hogy rájuk
// is vonatkozzon. Korábban a /coverage/zones és az /uploads static
// tévedésből a limiter ELÉ csúszott (a /health mellé), így korlátlanul
// hívható volt — a k6 load-teszt találta meg (2026-08-09). Csak a /health
// maradhat elöl (fent). Ha ide új publikus végpont kerül, a
// `publikus-vegpont-ratelimit.test.js` őrzi, hogy a limiter mögé essen.
app.use(globalRateLimit);

// Publikus: szolgáltatási zónák (térkép szürkítéshez) — a limiter MÖGÖTT
app.get('/coverage/zones', (_req, res) => {
  const { getAllZones } = require('./utils/coverage');
  res.json(getAllZones());
});

// ⚠️ A `uploads/private/` almappa (KYC-okmányok disk-fallbackja) SOHA nem
// szolgálható ki statikusan (2026-08-09, audit 3. kör). Eddig az express.static
// hitelesítés nélkül kiadta — élesben egy R2-kiesés is idesodorhatott egy
// személyi igazolvány fotót. Olvasni csak az aláírt /private-files/ úton lehet.
app.use('/uploads/private', (_req, res) => res.status(404).json({ error: 'Nem található' }));

// Statikus fájl-kiszolgálás a feltöltött fotókhoz — a limiter MÖGÖTT
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Privát fájl (KYC disk-fallback) olvasása ALÁÍRT, lejáró linkkel — az R2
// presigned URL megfelelője dev/teszt módban. Aláírás nélkül nincs hozzáférés.
app.get('/private-files/:name', (req, res) => {
  const { resolvePrivateDiskFile } = require('./services/storage');
  const r = resolvePrivateDiskFile(req.params.name, req.query.exp, req.query.sig);
  if (!r.ok) return res.status(r.reason === 'expired' ? 410 : 404).json({ error: 'Nem található vagy lejárt link' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(r.filepath);
});

// =====================================================================
//  MINDEN ADMIN ÍRÁS NYOMOT HAGY — APP-SZINTEN (2026-08-12, 10. mérés A5/F2)
//
//  ⚠️ MIÉRT KERÜLT IDE. Az első változat `router.use` volt az admin.js-ben,
//  tehát KIZÁRÓLAG az admin.js saját routerére hatott. A többi routerben lakó
//  admin-művelet NYOMTALAN maradt:
//
//    PATCH  /disputes/:id            vita-döntés, resolution_note, refund
//    POST   /admin/dm/broadcast      körlevél MINDEN felhasználónak
//    POST   /admin/dm/with/:userId   közvetlen üzenet
//    PATCH  /admin/dm/channel        a user válasz-csatornájának lezárása
//    PATCH  /questions/:id/hide      tartalom-moderáció (DSA-releváns)
//    POST   /auth/admin/grant-monthly-vouchers
//
//  Ez pontosan az a minta, amit a projekt magáról írt: „a védelem azon az
//  úton épül meg, ahol felfedezték". Az OLVASÁSRA volt gépi teljesség-őr, az
//  ÍRÁSRA egyetlen ponthelyes teszt.
//
//  App-szinten a mount-sorrendtől független: a kérés útvonalából és a
//  szerepkörből dönt, tehát egy ÚJ admin-írás bárhol automatikusan naplózott.
// =====================================================================
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => {
    // Csak a TÉNYLEGES változás; a 4xx zajt csinálna.
    if (res.statusCode >= 400) return;
    // A szerepkört az authRequired a DB-ből tölti be (nem a JWT-ből).
    if (req.user?.role !== 'admin') return;
    // Szándékosan NEM naplózzuk a body-t: az személyes adat lenne egy amúgy is
    // retenció alá eső naplóban. A MŰVELET ténye és a célpont azonosítója elég.
    require('./utils/adminAudit').logAdminAccess(
      req,
      `write:${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`,
      { type: 'admin_write', id: req.params?.id || req.params?.userId || null },
    ).catch(() => {});
  });
  next();
});

app.use('/', calculatorRoutes);
app.use('/', publicTrackingRoutes);
app.use('/', linkPreviewRoutes);

app.use('/auth', authRoutes);
app.use('/jobs', jobRoutes);
app.use('/', bidRoutes);
app.use('/', photoRoutes);
app.use('/', trackingRoutes);
app.use('/', reviewRoutes);
app.use('/', paymentRoutes);
app.use('/', carrierRoutes);
app.use('/', carrierAlertsRoutes);
app.use('/', notificationsRouter);
app.use('/', aiRoutes);
app.use('/', disputeRoutes);
app.use('/', messageRoutes);
app.use('/', backhaulRoutes);
app.use('/', sosRoutes);
app.use('/', towingRoutes);
app.use('/', driverStatsRoutes);
app.use('/', adminRoutes);
app.use('/', adminMessagesRoutes);
app.use('/', jobQuestionsRoutes);

// Központi hibakezelő.
// A `detail` (err.message) CSAK fejlesztésben kerül a válaszba — produkcióban
// kiszivárogtatná a belső DB-/stack-üzeneteket (pl. "invalid input syntax for
// type integer"). A frontend a felhasználói üzenethez a `error` mezőt használja,
// nem a `detail`-t, így ez nem töri a UX-et.
app.use((err, _req, res, _next) => {
  // Kliens-oldali input-hibák: a Postgres ezeket NEM szerverhibaként kezeli,
  // hanem a kérés rossz adatként. Tipikus eset: nem-UUID azonosító az URL-ben
  // (?status=open helyett /jobs/NEM-UUID), nem létező enum-érték, nem-szám egy
  // numerikus oszlopnál, vagy túl nagy szám. Ezekre 400-at adunk, és NEM
  // küldjük Sentry-be — különben minden bot/scanner/elgépelés zajt csinál és
  // a valódi hibák elvesznek a zajban.
  //   22P02 = invalid_text_representation (rossz uuid / szám / enum szöveg)
  //   22003 = numeric_value_out_of_range (túl nagy szám az oszlophoz)
  if (err && (err.code === '22P02' || err.code === '22003')) {
    return res.status(400).json({ error: 'Érvénytelen azonosító vagy formátum.' });
  }

  // Hibás vagy túl nagy kérés-TEST (2026-08-06, az adversarial-matrix
  // találata). A body-parser ilyenkor SyntaxError-t dob, amiből eddig nyers
  // 500 „Szerverhiba" lett — pedig a hiba a kérésben van, nem nálunk.
  // Élesben ez NEM elméleti: egy megszakadt mobil-kapcsolat csonka JSON-t
  // küld, a user „Szerverhibát" lát, és a Sentry is riaszt rá feleslegesen.
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({
      error: 'A kérés hibás formátumú. Próbáld újra.',
      code: 'MALFORMED_BODY',
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'A küldött adat túl nagy.',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  console.error('[error]', err);
  if (Sentry) Sentry.captureException(err);
  const body = { error: 'Szerverhiba' };
  if (process.env.NODE_ENV !== 'production') body.detail = err.message;
  res.status(500).json(body);
});

const server = http.createServer(app);
realtime.init(server);

// Globális safety net — Node 22+ a kezelt unhandled promise rejection-t
// process-killel jutalmazza. Inkább csak logolunk + Sentry-be küldünk,
// hogy egy egyszerű DB hibától ne álljon le az egész backend és ne
// legyen production outage.
const Sentry = process.env.SENTRY_DSN ? require('@sentry/node') : null;
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  if (Sentry) Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  if (Sentry) Sentry.captureException(err);
});

// Teszt alatt (vitest/supertest) az app-ot importáljuk, de a szerver nem
// figyel porton — csak közvetlen indításnál (node src/index.js) listen-elünk.
// ── FIZETÉS-KONFIG boot-ellenőrzés (2026-08-08) ──
// Két néma katasztrófát fog el a launchnál:
//  (1) rossz/ismeretlen PAYMENT_PROVIDER (pl. elgépelés) → a paymentProvider
//      most már HANGOSAN hibázik híváskor, de itt boot-időben is jelezzük,
//      hogy ne az első fizetésnél derüljön ki;
//  (2) ÉLES (production) futás mellett STUB provider → az oldal „élesben"
//      futna, de NULLA díjat szedne be, és a confirm-payment guardok nyitva.
//      Ez a launch legveszélyesebb néma hibája — ezért kiabálunk érte.
(function checkPaymentConfig() {
  try {
    const paymentProvider = require('./services/paymentProvider');
    const providerName = paymentProvider.name();
    if (!paymentProvider.providers.includes(providerName)) {
      console.error(
        `[FIZETÉS] ⚠️ ISMERETLEN PAYMENT_PROVIDER="${providerName}". `
        + `Támogatott: ${paymentProvider.providers.join(', ')}. A díjfizetés HIBÁZNI FOG.`,
      );
      return;
    }
    if (paymentProvider.stubEngedelyezve()) {
      // ⚠️⚠️⚠️ TESZT-ÜZEM: a stub-fizetés ÉLESBEN IS engedélyezve van.
      // User-döntés (2026-08-15): a tesztelő így tudja végigjárni a fizetés
      // utáni szakaszt, amíg a CIB nem él. LAUNCH ELŐTT KÖTELEZŐ KIVENNI.
      const uzenet = `[FIZETÉS] 🚨🚨🚨 TESZT-ÜZEM AKTÍV (${paymentProvider.STUB_ENGEDELY_ENV}=true) — `
        + 'a kézi fizetés-nyugtázás ÉLESBEN IS NYITVA van, tehát BÁRKI fizetés '
        + 'nélkül „fizetettnek" jelölheti a SAJÁT fuvarát, és ingyen megkapja a '
        + 'kontaktot. A platform EGYETLEN bevétele így megkerülhető. '
        + `‼️ LAUNCH ELŐTT TÖRÖLD a(z) ${paymentProvider.STUB_ENGEDELY_ENV} env-változót a Railway-en. `
        + '(A PSP-callback SZÁNDÉKOSAN zárva marad — az publikus végpont.)';
      console.error(uzenet);
      if (Sentry) Sentry.captureMessage(uzenet, 'error');
    } else if (paymentProvider.isUnsafeStub()) {
      // BIZTONSÁGOS MÓD (2026-08-09, audit 3. kör). A szerver ELINDUL — a
      // launch előtt a „prod + stub" a normál üzem (a platform még nem szed
      // díjat), és egy boot-leállás itt csak annyit ért el, hogy az éles API
      // újraindítási ciklusba került (502). Amit védeni kell, azt a futásidejű
      // guard védi: kézi fizetés-nyugtázás ZÁRVA, a PSP-callback 503.
      // A hiányzó kulcs nem tud némán elveszni: hangos log + Sentry.
      const uzenet = `[FIZETÉS] ⚠️ BIZTONSÁGOS MÓD: éles (production) futás, de a(z) "${providerName}" `
        + 'provider STUB módban van (nincs beállítva a szolgáltató kulcsa). '
        + 'A kapcsolatfelvételi díj NEM szedhető be — a kézi fizetés-nyugtázás és a '
        + 'PSP-callback ezért ZÁRVA marad (fizetés nélkül senki nem juthat kontakthoz). '
        + 'Élesítéshez: CIB_API_KEY / CIB_MERCHANT_ID / CIB_BASE_URL.';
      console.error(uzenet);
      if (Sentry) Sentry.captureMessage(uzenet, 'warning');
    } else {
      console.log(`[FIZETÉS] provider: ${providerName}${paymentProvider.isStub() ? ' (stub/teszt mód)' : ' (éles)'}`);
    }
  } catch (err) {
    console.error('[FIZETÉS] konfig-ellenőrzés hiba:', err.message);
  }
})();

const port = parseInt(process.env.PORT || '4000', 10);
if (require.main === module) {
  server.listen(port, () => {
    console.log(`[gofuvar] backend fut: http://localhost:${port}`);
  });
}

module.exports = { app, server };

// A korábbi 5 perces DB keep-alive ping KIVÉVE (2026-07-09): a Supabase-korszak
// maradványa volt (rosszul elnevezve — valójában a DATABASE_URL-t, azaz a
// Neont pingelte). A Neon compute-idő alapján számláz: a ping 0-24 ébren
// tartotta → felesleges compute-fogyasztás (a júniusi kvóta-kifutás egyik
// valószínű oka). Nélküle a Neon üresjáratban elalszik; az első kérésnél
// ~1 mp cold start — alacsony forgalomnál ez a jó csere.
if (process.env.DATABASE_URL) {
  // KYC-okmányok nyers fotóinak napi törlése a végleges döntés után
  // (adatminimalizálás). Boot után ~1 perccel egyszer, majd 24 óránként.
  const { purgeOldKycFiles } = require('./services/kyc');
  const DAY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => { purgeOldKycFiles().catch(() => {}); }, 60 * 1000).unref();
  setInterval(() => { purgeOldKycFiles().catch(() => {}); }, DAY_MS).unref();
  console.log('[kyc-retention] napi okmány-fotó törlés ütemezve');

  // Adat-retenció (fotó 30 nap / chat 6 hó / GPS 7 nap; zárolt: 5 év) —
  // egy napi körben (2026-07-16/17 user-döntések).
  const { runDailyRetention, lastSuccessfulRetentionRun } = require('./services/retention');
  setTimeout(() => { runDailyRetention().catch(() => {}); }, 90 * 1000).unref();
  setInterval(() => { runDailyRetention().catch(() => {}); }, DAY_MS).unref();
  console.log('[retention] napi adat-retenció ütemezve (fotó 30 nap / chat 6 hó / GPS 7 nap; zárolt: 5 év)');

  // ⚠️ WATCHDOG: A RETENCIÓ FUTÁSA IS MEGFIGYELT (2026-08-12, 11. mérés T3).
  //
  // A `retention_runs` napló eddig WRITE-ONLY volt: senki nem olvasta. A
  // Sentry-riasztás csak akkor ment, ha egy kör DOBOTT — ha a kör EL SEM
  // INDULT (elrontott ütemezés, egy `if` mögé került blokk, megváltoztatott
  // periódus), arról SEMMI nem szólt. A GDPR 5. cikk (2) nem naplót kér,
  // hanem BIZONYÍTHATÓSÁGOT — bizonyítani viszont csak akkor tudunk, ha
  // valaki nézi is.
  //
  // Ez a kör 6 óránként ellenőrzi, mikor futott le utoljára SIKERESEN a
  // retenció. Ha 48 óránál régebben, az riasztás: a megőrzési ígéreteink
  // (30 nap fotó, 7 nap GPS, 3 év fuvar-PII) ilyenkor NEM teljesülnek,
  // miközben a rendszer kívülről hibátlanul működik.
  const RETENCIO_WATCHDOG_ORA = 48;
  const watchdog = async () => {
    try {
      const utolso = await lastSuccessfulRetentionRun();
      if (!utolso) return; // friss telepítés: még nem futott le egyszer sem
      // ⚠️ A lastSuccessfulRetentionRun SORT ad vissza, nem időbélyeget —
      // az első változatom `new Date(utolso)`-t számolt, ami NaN-t adott, és
      // a watchdog SOSEM riasztott volna. (A saját tesztje fogta meg.)
      const mikor = utolso.finished_at || utolso.started_at;
      const oraja = (Date.now() - new Date(mikor).getTime()) / 3600000;
      if (oraja > RETENCIO_WATCHDOG_ORA) {
        const uzenet = `[retention-watchdog] a retenció ${Math.round(oraja)} órája nem futott le sikeresen `
          + `(küszöb: ${RETENCIO_WATCHDOG_ORA} óra) — a megőrzési határidők NEM teljesülnek`;
        console.error(uzenet);
        try { require('@sentry/node').captureMessage(uzenet, 'error'); } catch { /* nincs Sentry */ }
      }
    } catch (err) {
      console.error('[retention-watchdog] hiba:', err.message);
    }
  };
  setTimeout(watchdog, 5 * 60 * 1000).unref();
  setInterval(watchdog, 6 * 60 * 60 * 1000).unref();
  console.log(`[retention-watchdog] figyelés indul (riasztás ${RETENCIO_WATCHDOG_ORA} óra után)`);

  // DAC7: adóazonosító-emlékeztetők (21 naponta, max 2; 60 nap után a
  // requireDriverKYC kapu blokkol) — napi kör.
  const { runDailyDac7Reminders } = require('./services/dac7');
  setTimeout(() => { runDailyDac7Reminders().catch(() => {}); }, 120 * 1000).unref();
  setInterval(() => { runDailyDac7Reminders().catch(() => {}); }, DAY_MS).unref();
  console.log('[dac7] napi adóazonosító-emlékeztető kör ütemezve');

  // Fizetetlen-fuvar emlékeztető: az accepted+fizetetlen fuvarra 24h/48h
  // után (max 2×). A platform bevétele ezen a lépcsőn akad el a leggyakrabban.
  const { runPaymentReminders } = require('./services/paymentReminders');
  setTimeout(() => { runPaymentReminders().catch(() => {}); }, 150 * 1000).unref();
  setInterval(() => { runPaymentReminders().catch(() => {}); }, DAY_MS).unref();
  console.log('[payment-reminder] napi fizetetlen-fuvar emlékeztető kör ütemezve');

  // SMS-újraküldési kör (2026-08-30): a SeeMe-nél elakadt (code=13/7,
  // hálózati hiba) SMS-eket 10 percenként újrapróbálja, 48 órás ablakban —
  // a hiba elhárítása után a bennragadt átvételi kódok maguktól kimennek.
  // A boot utáni első futás korai (2 perc): egy deploy-újraindulás ne
  // késleltesse az épp bennragadt SMS-eket.
  const { runSmsRetryQueue } = require('./services/smsRetry');
  setTimeout(() => { runSmsRetryQueue().catch(() => {}); }, 2 * 60 * 1000).unref();
  setInterval(() => { runSmsRetryQueue().catch(() => {}); }, 10 * 60 * 1000).unref();
  console.log('[sms-retry] újraküldési kör ütemezve (10 percenként, 48 órás ablak)');
}
