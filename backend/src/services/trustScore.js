// GoFuvar Trust Score — sofőr hitelességi index (0-100).
//
// Összetevők:
//   - Sikeres fuvarok száma (max 30 pont)
//   - Átlag értékelés (max 25 pont)
//   - Értékelések száma (max 15 pont)
//   - Profil kitöltöttség (max 10 pont)
//   - Verified EU Carrier státusz (max 20 pont)
//
// A pontot minden fuvar lezárásakor újraszámoljuk és mentjük a
// users.trust_score oszlopba.

const db = require('../db');

/**
 * Trust score kiszámítása és frissítése.
 * @param {string} userId
 * @returns {Promise<number>} a frissített trust score (0-100)
 */
async function recalcTrustScore(userId) {
  const { rows } = await db.query(
    `SELECT
        u.rating_avg, u.rating_count,
        u.full_name, u.phone, u.bio, u.avatar_url,
        u.vehicle_type, u.tax_id, u.is_verified_carrier,
        (SELECT COUNT(*)::int FROM jobs WHERE carrier_id = $1 AND status IN ('delivered','completed')) AS completed_jobs,
        (SELECT COUNT(*)::int FROM route_bookings b
           JOIN carrier_routes r ON r.id = b.route_id
          WHERE r.carrier_id = $1 AND b.status = 'delivered') AS completed_bookings
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) return 0;
  const u = rows[0];

  let score = 0;

  // 1) Sikeres fuvarok (max 30 pont)
  //    1 fuvar = 3 pont, 10+ fuvar = 30 pont (cap)
  const totalDeliveries = (u.completed_jobs || 0) + (u.completed_bookings || 0);
  score += Math.min(30, totalDeliveries * 3);

  // 2) Átlag értékelés (max 25 pont)
  //    5.0 = 25 pont, 4.0 = 20 pont, 3.0 = 15 pont, stb.
  const rating = Number(u.rating_avg) || 0;
  if (rating > 0 && u.rating_count > 0) {
    score += Math.round(rating * 5);
  }

  // 3) Értékelések száma (max 15 pont)
  //    1 értékelés = 3 pont, 5+ = 15 pont
  score += Math.min(15, (u.rating_count || 0) * 3);

  // 4) Profil kitöltöttség (max 10 pont)
  //    Minden kitöltött mező 2 pont
  if (u.full_name) score += 2;
  if (u.phone) score += 2;
  if (u.bio) score += 2;
  if (u.avatar_url) score += 2;
  if (u.vehicle_type) score += 2;

  // 5) Verified EU Carrier (20 pont)
  if (u.is_verified_carrier) score += 20;

  // Cap 100-nál
  score = Math.min(100, score);

  // Mentés
  await db.query(
    `UPDATE users SET trust_score = $1 WHERE id = $2`,
    [score, userId],
  );

  return score;
}

/**
 * Trust badge szöveg a pontszám alapján.
 */
function getTrustBadge(score, isVerified) {
  if (isVerified) return { label: 'Verified EU Carrier', color: '#16a34a', icon: '✅' };
  if (score >= 80) return { label: 'Megbízható', color: '#16a34a', icon: '🟢' };
  if (score >= 50) return { label: 'Aktív', color: '#f59e0b', icon: '🟡' };
  if (score >= 20) return { label: 'Új tag', color: '#64748b', icon: '⚪' };
  return { label: 'Kezdő', color: '#94a3b8', icon: '⚪' };
}

module.exports = { recalcTrustScore, getTrustBadge };
