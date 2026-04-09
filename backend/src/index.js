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

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'gofuvar-backend' }));

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
