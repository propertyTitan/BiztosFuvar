// =====================================================================
//  GET /config/public — publikus üzemi konfig a webnek (2026-10-03, CIB
//  PR-5, szerződés: C1). Hitelesítés nélkül, IP-limittel, no-store (a
//  globális API-fejléc adja). Csak két mező: { teszt_uzem, kartyas_fizetes }.
// =====================================================================
const express = require('express');
const { createRateLimit } = require('../middleware/rateLimit');
const { publikusKonfig } = require('../services/publikusKonfig');

const router = express.Router();

const konfigLimit = createRateLimit({
  windowMs: 60_000,
  max: 120,
  keyBy: 'ip',
  name: 'konfig-publikus',
  message: 'Túl sok kérés. Kérlek várj egy percet.',
});

router.get('/config/public', konfigLimit, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  return res.json(publikusKonfig());
});

module.exports = router;
