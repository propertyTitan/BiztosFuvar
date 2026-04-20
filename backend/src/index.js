// GoFuvar backend belépési pont.
require('dotenv').config();
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
const backhaulRoutes = require('./routes/backhaul');
const sosRoutes = require('./routes/sos');
const calculatorRoutes = require('./routes/calculator');
const towingRoutes = require('./routes/towing');
const driverStatsRoutes = require('./routes/driverStats');
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
const publicTrackingRoutes = require('./routes/publicTracking');
app.use('/', calculatorRoutes);
app.use('/', publicTrackingRoutes);

// Statikus fájl-kiszolgálás a feltöltött fotókhoz
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
app.use('/', backhaulRoutes);
app.use('/', sosRoutes);
app.use('/', towingRoutes);
app.use('/', driverStatsRoutes);

// Központi hibakezelő
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Szerverhiba', detail: err.message });
});

const server = http.createServer(app);
realtime.init(server);

const port = parseInt(process.env.PORT || '4000', 10);
server.listen(port, () => {
  console.log(`[gofuvar] backend fut: http://localhost:${port}`);
});
