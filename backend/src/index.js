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
  const { scrubSentryEvent } = require('./utils/sentryScrub');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    beforeSend: scrubSentryEvent,
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

// Statikus fájl-kiszolgálás a feltöltött fotókhoz — a limiter MÖGÖTT
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
    if (process.env.NODE_ENV === 'production' && paymentProvider.isStub()) {
      console.error(
        `[FIZETÉS] ⚠️⚠️ FIGYELEM: éles (production) futás, de a(z) "${providerName}" `
        + 'provider STUB módban van (nincs beállítva a szolgáltató kulcsa). '
        + 'A kapcsolatfelvételi díj NEM szedődik be, és a kézi fizetés-nyugtázás nyitva! '
        + 'Állítsd be a provider kulcsait, mielőtt éles forgalmat engedsz.',
      );
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
  const { runDailyRetention } = require('./services/retention');
  setTimeout(() => { runDailyRetention().catch(() => {}); }, 90 * 1000).unref();
  setInterval(() => { runDailyRetention().catch(() => {}); }, DAY_MS).unref();
  console.log('[retention] napi adat-retenció ütemezve (fotó 30 nap / chat 6 hó / GPS 7 nap; zárolt: 5 év)');

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
}
