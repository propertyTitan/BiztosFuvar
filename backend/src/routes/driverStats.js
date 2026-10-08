// =====================================================================
//  Szállító statisztikák / bevétel dashboard endpoint.
//
//  GET /driver-stats → a bejelentkezett szállító teljesítmény adatai:
//    - Összesített és havi bevétel
//    - Befejezett fuvarok száma
//    - Átlagos értékelés
//    - Havi trend (utolsó 6 hónap)
//    - Top útvonalak
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { telepulesNev } = require('../utils/address');

const router = express.Router();

// ⚠️ TOP ÚTVONALAK TELEPÜLÉS-SZINTEN (UX-review A28, 2026-10-08). A korábbi
// SQL `SPLIT_PART(cím, ',', -1)`-gyel az UTOLSÓ vesszős szakaszt vette
// „városnak" — magyar címnél ez az irányítószám, más formátumnál az utca és
// a HÁZSZÁM lett („Margit körút 50. → Király utca 15."): a blokk értelmetlen
// volt, és egy statisztikai felületen feleslegesen kiírta a feladó házszámát.
// Most a közös, tartalom-alapú telepulesNev() csoportosít („Budapest → Pécs").
const ISMERETLEN_TELEPULES = 'Ismeretlen település';

function topUtvonalak(rows, limit = 5) {
  const parok = new Map();
  for (const r of rows) {
    const honnan = telepulesNev(r.pickup_address) || ISMERETLEN_TELEPULES;
    const hova = telepulesNev(r.dropoff_address) || ISMERETLEN_TELEPULES;
    const kulcs = `${honnan.toLowerCase()}\u0000${hova.toLowerCase()}`;
    const e = parok.get(kulcs) || {
      pickup_city: honnan, dropoff_city: hova, count: 0, arOsszeg: 0, arDb: 0,
    };
    e.count += 1;
    if (r.accepted_price_huf != null) {
      e.arOsszeg += Number(r.accepted_price_huf) || 0;
      e.arDb += 1;
    }
    parok.set(kulcs, e);
  }
  return [...parok.values()]
    .sort((a, b) => b.count - a.count || a.pickup_city.localeCompare(b.pickup_city, 'hu'))
    .slice(0, limit)
    .map(({ arOsszeg, arDb, ...e }) => ({ ...e, avg_price: arDb ? Math.round(arOsszeg / arDb) : 0 }));
}

router.get('/driver-stats', authRequired, async (req, res) => {
  const carrierId = req.user.sub;

  // Párhuzamos lekérdezések
  const [totals, monthly, topRoutes, recentJobs] = await Promise.all([
    // Összesített adatok
    db.query(
      `SELECT
         COUNT(*)::int AS total_deliveries,
         COALESCE(SUM(accepted_price_huf), 0)::int AS total_gross_earnings,
         -- ⚠️ A KÁPÉS MODELLBEN A FUVARDÍJ 100%-A A SZÁLLÍTÓÉ (2026-08-12).
         -- Itt a 2026-07-03-án HATÁLYON KÍVÜL HELYEZETT escrow-modell 10% +
         -- 400 Ft-os jutaléka maradt bent. A szállítói dashboard „Nettó
         -- bevétel" néven fuvaronként 10% + 400 Ft-tal KEVESEBBET mutatott a
         -- valósnál — miközben a /fuvarozoknak oldal azt ígéri, hogy a
         -- fuvardíj 100%-a az övé, és a platform tőle semmit nem von le.
         -- Kínálati oldali, felhasználó által LÁTOTT hiba.
         COALESCE(SUM(accepted_price_huf), 0)::int AS total_net_earnings,
         COALESCE(AVG(accepted_price_huf), 0)::int AS avg_price,
         COALESCE(SUM(distance_km), 0)::numeric AS total_km
       FROM jobs
       WHERE carrier_id = $1 AND status IN ('delivered', 'completed')`,
      [carrierId],
    ),

    // Havi trend (utolsó 12 hónap)
    db.query(
      `SELECT
         TO_CHAR(delivered_at, 'YYYY-MM') AS month,
         COUNT(*)::int AS deliveries,
         COALESCE(SUM(accepted_price_huf), 0)::int AS gross,
         -- Ugyanaz a havi bontásban (lásd fent).
         COALESCE(SUM(accepted_price_huf), 0)::int AS net
       FROM jobs
       WHERE carrier_id = $1
         AND status IN ('delivered', 'completed')
         AND delivered_at >= NOW() - INTERVAL '12 months'
       GROUP BY TO_CHAR(delivered_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [carrierId],
    ),

    // Top útvonalak (leggyakoribb TELEPÜLÉS-párok) — a csoportosítás JS-ben,
    // lásd topUtvonalak(). Csak a címek és az ár kell hozzá.
    db.query(
      `SELECT pickup_address, dropoff_address, accepted_price_huf
       FROM jobs
       WHERE carrier_id = $1 AND status IN ('delivered', 'completed')
       ORDER BY delivered_at DESC NULLS LAST
       LIMIT 2000`,
      [carrierId],
    ),

    // Legutóbbi 5 fuvar
    db.query(
      `SELECT id, title, accepted_price_huf, distance_km, delivered_at, status
       FROM jobs
       WHERE carrier_id = $1 AND status IN ('delivered', 'completed')
       ORDER BY delivered_at DESC
       LIMIT 5`,
      [carrierId],
    ),
  ]);

  // User adatok (rating, level)
  const { rows: userRows } = await db.query(
    `SELECT rating_avg, rating_count, trust_score, level, level_name, total_deliveries AS profile_deliveries
     FROM users WHERE id = $1`,
    [carrierId],
  );
  const profile = userRows[0] || {};

  res.json({
    totals: totals.rows[0],
    monthly: monthly.rows,
    top_routes: topUtvonalak(topRoutes.rows),
    recent_jobs: recentJobs.rows,
    profile: {
      rating_avg: profile.rating_avg,
      rating_count: profile.rating_count,
      trust_score: profile.trust_score,
      level: profile.level,
      level_name: profile.level_name,
    },
  });
});

module.exports = router;
module.exports.topUtvonalak = topUtvonalak;
