// GoFuvar backend belépési pont.
require('dotenv').config();

// Sentry init — ha SENTRY_DSN be van állítva, automatikusan kapcsolódik
// és minden uncaught exception + manuálisan jelentett hiba kimegy a
// Sentry projektbe. A `Sentry.init()`-et MINDEN egyéb require előtt
// kell hívni, hogy az auto-instrumentation a HTTP/Express-t is befogja.
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
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

app.get('/health', (_req, res) => res.json({ ok: true, service: 'gofuvar-backend' }));

// Publikus: szolgáltatási zónák (térkép szürkítéshez)
app.get('/coverage/zones', (_req, res) => {
  const { getAllZones } = require('./utils/coverage');
  res.json(getAllZones());
});
const publicTrackingRoutes = require('./routes/publicTracking');
const linkPreviewRoutes = require('./routes/linkPreview');

// Statikus fájl-kiszolgálás a feltöltött fotókhoz
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Globális, IP-alapú rate limit: 300 kérés / perc / IP. Második védelmi
// vonal a per-endpoint limitek után — spike-ok, botok ellen védekezik.
// A /health végpontra szándékosan nem alkalmazzuk, hogy a loadbalancer
// health check-jeit ne korlátozza.
// A publikus (auth nélküli) végpontok — kalkulátor, címzett-követés —
// szándékosan a limiter UTÁN jönnek, hogy rájuk is vonatkozzon.
app.use(globalRateLimit);

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
const port = parseInt(process.env.PORT || '4000', 10);
if (require.main === module) {
  server.listen(port, () => {
    console.log(`[gofuvar] backend fut: http://localhost:${port}`);
  });
}

module.exports = { app, server };

// Supabase free-tier keep-alive: a project 7 nap inaktivitás után auto-pause-ol.
// 5 percenként egy könnyű SELECT 1-et küldünk a DB-nek, hogy a "last activity"
// soha ne ürüljön ki. Cost: ~8.640 query/hó, ami a free-tier alatt elhanyagolható.
// Lokál fejlesztésnél is fut, nem zavaró (csak egy gyors ping).
if (process.env.DATABASE_URL) {
  const db = require('./db');
  const KEEPALIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    db.query('SELECT 1').catch((err) => {
      console.error('[keepalive] DB ping hiba:', err.message);
    });
  }, KEEPALIVE_MS).unref();
  console.log('[keepalive] Supabase ping aktív (5 perc)');

  // KYC-okmányok nyers fotóinak napi törlése a végleges döntés után
  // (adatminimalizálás). Boot után ~1 perccel egyszer, majd 24 óránként.
  const { purgeOldKycFiles } = require('./services/kyc');
  const DAY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => { purgeOldKycFiles().catch(() => {}); }, 60 * 1000).unref();
  setInterval(() => { purgeOldKycFiles().catch(() => {}); }, DAY_MS).unref();
  console.log('[kyc-retention] napi okmány-fotó törlés ütemezve');
}
