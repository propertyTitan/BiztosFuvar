// =====================================================================
//  Sofőr statisztikák / bevétel dashboard endpoint.
//
//  GET /driver-stats → a bejelentkezett sofőr teljesítmény adatai:
//    - Összesített és havi bevétel
//    - Befejezett fuvarok száma
//    - Átlagos értékelés
//    - Havi trend (utolsó 6 hónap)
//    - Top útvonalak
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/driver-stats', authRequired, async (req, res) => {
  const carrierId = req.user.sub;

  // Párhuzamos lekérdezések
  const [totals, monthly, topRoutes, recentJobs] = await Promise.all([
    // Összesített adatok
    db.query(
      `SELECT
         COUNT(*)::int AS total_deliveries,
         COALESCE(SUM(accepted_price_huf), 0)::int AS total_gross_earnings,
         COALESCE(SUM(accepted_price_huf * 0.9), 0)::int AS total_net_earnings,
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
         COALESCE(SUM(accepted_price_huf * 0.9), 0)::int AS net
       FROM jobs
       WHERE carrier_id = $1
         AND status IN ('delivered', 'completed')
         AND delivered_at >= NOW() - INTERVAL '12 months'
       GROUP BY TO_CHAR(delivered_at, 'YYYY-MM')
       ORDER BY month ASC`,
      [carrierId],
    ),

    // Top útvonalak (leggyakoribb város-párok)
    db.query(
      `SELECT
         SPLIT_PART(pickup_address, ',', -1) AS pickup_city,
         SPLIT_PART(dropoff_address, ',', -1) AS dropoff_city,
         COUNT(*)::int AS count,
         COALESCE(AVG(accepted_price_huf), 0)::int AS avg_price
       FROM jobs
       WHERE carrier_id = $1 AND status IN ('delivered', 'completed')
       GROUP BY pickup_city, dropoff_city
       ORDER BY count DESC
       LIMIT 5`,
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
    top_routes: topRoutes.rows,
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
