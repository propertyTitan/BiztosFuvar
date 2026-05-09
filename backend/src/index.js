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
    tracesSampleRate: 0.1, // 10% trace-sampling — production-ban elég
    // Bizalmas adatok kiszűrése a Sentry payload-ból
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
const { router: notificationsRouter } = require('./services/notifications');
const aiRoutes = require('./routes/ai');
const disputeRoutes = require('./routes/disputes');
const messageRoutes = require('./routes/messages');
const kycRoutes = require('./routes/kyc');
const { router: filesRouter } = require('./routes/files');
const { checkExpiredLicenses, purgeApprovedKycFiles } = require('./services/kyc');
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

// FONTOS: a `/uploads` statikus serve KIZÁRÓLAG fejlesztésre. Production-ben
// minden file a privát R2-en él, a `/files/:id` endpoint-on keresztül érhető
// el (auth + permission + audit log). Ha mégis itt landolnánk élesben, a
// jogosítvány-fotó publikus lenne — ezért szándékos guard.
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
}

// Globális, IP-alapú rate limit: 300 kérés / perc / IP. Második védelmi
// vonal a per-endpoint limitek után — spike-ok, botok ellen védekezik.
// A /health végpontra szándékosan nem alkalmazzuk, hogy a loadbalancer
// health check-jeit ne korlátozza.
app.use(globalRateLimit);

app.use('/auth', authRoutes);
app.use('/jobs', jobRoutes);
app.use('/', bidRoutes);
app.use('/', photoRoutes);
app.use('/', trackingRoutes);
app.use('/', reviewRoutes);
app.use('/', paymentRoutes);
app.use('/', carrierRoutes);
app.use('/', notificationsRouter);
app.use('/', aiRoutes);
app.use('/', disputeRoutes);
app.use('/', messageRoutes);
app.use('/', kycRoutes);
app.use('/', filesRouter);

// Központi hibakezelő
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Szerverhiba', detail: err.message });
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

const port = parseInt(process.env.PORT || '4000', 10);
server.listen(port, () => {
  console.log(`[gofuvar] backend fut: http://localhost:${port}`);
});

// ── Napi cron-ok (egyszerű setInterval; CLOUD_FUNCTIONS / cronjob-runner
//   környezetben ezt érdemes EXTERNAL trigger-rel kiváltani). ──
//
// 1) Lejárt jogosítványok ellenőrzése — license_expiry alapján 30/7 napos
//    figyelmeztetés és a tényleges letiltás.
// 2) KYC fájl-purge — a jóváhagyott jogosítvány-fotót 30 nap után töröljük
//    a tárolóból (adat-minimalizálás, GDPR).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
async function runDailyMaintenance() {
  try { await checkExpiredLicenses(); }
  catch (e) { console.error('[cron] checkExpiredLicenses hiba:', e); }
  try { await purgeApprovedKycFiles(); }
  catch (e) { console.error('[cron] purgeApprovedKycFiles hiba:', e); }
}
// Első futás 60s után (ne torpedozza a boot-ot), aztán naponta.
setTimeout(runDailyMaintenance, 60_000);
setInterval(runDailyMaintenance, ONE_DAY_MS);
