// GoFuvar Gamifikáció — szintrendszer, jelvények.
//
// A SZÁLLÍTÓI jutalékmentes kupon (szintlépéskor + havi) EGYELŐRE KIKAPCSOLVA
// (2026-07-05): a szállító 100% készpénzt kap, sosem fizet kapcsolatfelvételi
// díjat, így egy díj-elengedő kupon számára használhatatlan. A LEVELS[]
// .monthlyVouchers config megmarad (dormant), a szint/jelvény rész él.
// Kupont mostantól csak az ajánlói program oszt (services/referral.js), és
// az a FELADÓ oldalon (kapcsolatfelvételi díjnál) váltható be.

const db = require('../db');
const { createNotification } = require('./notifications');

// ============ SZINT DEFINÍCIÓK ============

const LEVELS = [
  { level: 1,  name: 'Kezdő',        icon: '🌱', minDeliveries: 0,  minRating: 0,   monthlyVouchers: 0 },
  { level: 2,  name: 'Újonc',        icon: '🚗', minDeliveries: 1,  minRating: 0,   monthlyVouchers: 0 },
  { level: 3,  name: 'Profi Szállító',  icon: '🚛', minDeliveries: 5,  minRating: 4.0, monthlyVouchers: 0 },
  { level: 4,  name: 'Megbízható',    icon: '⭐', minDeliveries: 10, minRating: 4.5, monthlyVouchers: 0 },
  { level: 5,  name: 'Diamant',      icon: '💎', minDeliveries: 25, minRating: 4.7, monthlyVouchers: 1 },
  { level: 6,  name: 'Mester',       icon: '🏆', minDeliveries: 50, minRating: 4.8, monthlyVouchers: 1 },
  { level: 7,  name: 'Elit',         icon: '👑', minDeliveries: 100, minRating: 4.8, monthlyVouchers: 2 },
  { level: 8,  name: 'Legenda',      icon: '🌟', minDeliveries: 200, minRating: 4.9, monthlyVouchers: 2 },
  { level: 9,  name: 'Top 1%',       icon: '🔥', minDeliveries: 350, minRating: 4.9, monthlyVouchers: 3 },
  { level: 10, name: 'GoFuvar Hős',  icon: '🚀', minDeliveries: 500, minRating: 5.0, monthlyVouchers: 3 },
];

// ============ JELVÉNY DEFINÍCIÓK ============

const BADGE_DEFS = [
  { id: 'first_delivery',  name: 'Első fuvar',       icon: '🏁', check: (s) => s.totalDeliveries >= 1 },
  { id: 'five_star',       name: '5 csillagos',      icon: '⭐', check: (s) => s.fiveStarCount >= 10 },
  { id: 'lightning',       name: 'Villámgyors',      icon: '⚡', check: (s) => s.totalDeliveries >= 5 }, // simplified
  { id: 'eu_driver',       name: 'Európai szállító',    icon: '🌍', check: (s) => s.countriesCount >= 2 },
  { id: 'communicator',    name: 'Kommunikátor',     icon: '💬', check: (s) => s.messageCount >= 50 },
  { id: 'heavyweight',     name: 'Nehézsúlyú',       icon: '🏋️', check: (s) => s.heavyDeliveries >= 10 },
  { id: 'night_owl',       name: 'Éjszakai bagoly',  icon: '🌙', check: (s) => s.nightDeliveries >= 5 },
  { id: 'verified',        name: 'Verified EU',      icon: '✅', check: (s) => s.isVerified },
  { id: 'centurion',       name: 'Századik fuvar',   icon: '💯', check: (s) => s.totalDeliveries >= 100 },
  { id: 'thousand',        name: 'Ezredik csomag',   icon: '📦', check: (s) => s.totalDeliveries >= 1000 },
];

/**
 * A szállító szintjének újraszámolása a statisztikái alapján.
 * Ha szintet lépett, értesítést küld + ajándék voucher-t ad.
 *
 * @param {string} userId
 * @returns {Promise<{level: number, levelName: string, leveledUp: boolean, newBadges: string[]}>}
 */
async function recalcLevel(userId) {
  // Statisztikák lekérdezése
  const { rows } = await db.query(
    `SELECT
        u.level AS current_level, u.rating_avg, u.rating_count, u.is_verified_carrier,
        (SELECT COUNT(*)::int FROM jobs WHERE carrier_id = $1 AND status IN ('delivered','completed')) AS job_deliveries,
        (SELECT COUNT(*)::int FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
          WHERE r.carrier_id = $1 AND b.status = 'delivered') AS booking_deliveries,
        (SELECT COUNT(*)::int FROM reviews WHERE reviewee_id = $1 AND stars = 5) AS five_star_count,
        (SELECT COUNT(*)::int FROM messages WHERE sender_id = $1) AS message_count,
        (SELECT COUNT(DISTINCT j.country_code) FROM jobs j WHERE j.carrier_id = $1 AND j.status IN ('delivered','completed')) AS countries_count
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) return { level: 1, levelName: 'Kezdő', leveledUp: false, newBadges: [] };
  const s = rows[0];

  const totalDeliveries = (s.job_deliveries || 0) + (s.booking_deliveries || 0);
  const rating = Number(s.rating_avg) || 0;
  const currentLevel = s.current_level || 1;

  // Szint meghatározása
  let newLevel = 1;
  let newLevelName = 'Kezdő';
  for (const lvl of LEVELS) {
    if (totalDeliveries >= lvl.minDeliveries && rating >= lvl.minRating) {
      newLevel = lvl.level;
      newLevelName = lvl.name;
    }
  }

  const leveledUp = newLevel > currentLevel;

  // Szint mentése
  await db.query(
    `UPDATE users SET level = $1, level_name = $2, total_deliveries = $3 WHERE id = $4`,
    [newLevel, newLevelName, totalDeliveries, userId],
  );

  // Ha szintet lépett: ajándék voucher + értesítés
  if (leveledUp) {
    const lvlDef = LEVELS.find((l) => l.level === newLevel);
    // Szállítói jutalékmentes kupon EGYELŐRE KIKAPCSOLVA (2026-07-05): a szállító
    // 100% készpénzt kap, sosem fizet kapcsolatfelvételi díjat, így egy
    // díj-elengedő kupon számára használhatatlan. Csak szint + értesítés marad.
    await createNotification({
      user_id: userId,
      type: 'level_up',
      title: `${lvlDef?.icon || '🎉'} Szintet léptél: ${newLevelName}!`,
      body: `Elérted a(z) ${newLevel}. szintet: ${newLevelName}. Gratulálunk, csak így tovább!`,
      link: '/profil',
    }).catch(() => {});
  }

  // Jelvények ellenőrzése
  const stats = {
    totalDeliveries,
    fiveStarCount: s.five_star_count || 0,
    countriesCount: s.countries_count || 0,
    messageCount: s.message_count || 0,
    heavyDeliveries: 0, // TODO: query heavy jobs
    nightDeliveries: 0, // TODO: query night jobs
    isVerified: s.is_verified_carrier || false,
  };

  const newBadges = [];
  for (const badge of BADGE_DEFS) {
    if (badge.check(stats)) {
      try {
        const { rowCount } = await db.query(
          `INSERT INTO user_badges (user_id, badge_id, badge_name, badge_icon)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, badge_id) DO NOTHING`,
          [userId, badge.id, badge.name, badge.icon],
        );
        if (rowCount > 0) {
          newBadges.push(badge);
          await createNotification({
            user_id: userId,
            type: 'badge_earned',
            title: `${badge.icon} Új jelvény: ${badge.name}!`,
            body: `Gratulálunk! Megszerezted a "${badge.name}" jelvényt.`,
            link: '/profil',
          }).catch(() => {});
        }
      } catch {}
    }
  }

  return { level: newLevel, levelName: newLevelName, leveledUp, newBadges };
}

/**
 * Jutalékmentes voucher generálása.
 * @param {string} userId
 * @param {string} reason - 'level_monthly' | 'level_up_bonus' | 'promo'
 * @param {number} validDays - hány napig érvényes
 */
async function grantVoucher(userId, reason, validDays = 30, maxFeeHuf = null) {
  const validUntil = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO fee_vouchers (user_id, reason, valid_until, max_fee_huf)
     VALUES ($1, $2, $3, $4)`,
    [userId, reason, validUntil, maxFeeHuf],
  );
}

/**
 * Havi voucher-ek generálása a szint alapján.
 * Ez minden hónap 1-jén fut (cron job vagy manuális trigger).
 */
async function grantMonthlyVouchers() {
  // Szállítói havi jutalékmentes kupon EGYELŐRE KIKAPCSOLVA (2026-07-05): a
  // szállító 100% készpénzt kap, sosem fizet kapcsolatfelvételi díjat, így a
  // díj-elengedő kupon számára haszontalan. Visszakapcsoláshoz a korábbi,
  // LEVELS[].monthlyVouchers alapján osztó ciklus állítható vissza.
  console.log('[gamification] Havi szállítói voucher-ek kikapcsolva — 0 db.');
  return 0;
}

/**
 * Ellenőrzi, hogy a szállítónak van-e felhasználható voucher-je.
 * Ha igen, felhasználja (used_at = NOW) és true-t ad vissza.
 */
async function useVoucherIfAvailable(userId, { jobId = null, bookingId = null, feeHuf = null } = {}) {
  // A legkorábban lejáró, még érvényes és a díj-plafonnak megfelelő kupont
  // használjuk fel. A max_fee_huf plafon (ajánlói kuponoknál) kizárja a
  // magas díjú feladásokat; NULL plafon = bármekkora díjra jó (szint-kupon).
  const { rows } = await db.query(
    `SELECT id FROM fee_vouchers
      WHERE user_id = $1
        AND used_at IS NULL
        AND valid_from <= CURRENT_DATE
        AND valid_until >= CURRENT_DATE
        AND (max_fee_huf IS NULL OR $2::int IS NULL OR max_fee_huf >= $2::int)
      ORDER BY valid_until ASC
      LIMIT 1`,
    [userId, feeHuf],
  );
  if (!rows[0]) return false;
  await db.query(
    `UPDATE fee_vouchers
        SET used_at = NOW(),
            used_on_job = $2,
            used_on_booking = $3
      WHERE id = $1`,
    [rows[0].id, jobId || null, bookingId || null],
  );
  return true;
}

/**
 * Szállító gamifikációs összesítője (a dashboard-hoz).
 */
async function getDriverGameStats(userId) {
  const [userRes, badgesRes, vouchersRes] = await Promise.all([
    db.query(
      `SELECT level, level_name, total_deliveries, total_earnings,
              trust_score, is_verified_carrier, rating_avg, rating_count
         FROM users WHERE id = $1`,
      [userId],
    ),
    db.query(
      `SELECT badge_id, badge_name, badge_icon, earned_at
         FROM user_badges WHERE user_id = $1
         ORDER BY earned_at DESC`,
      [userId],
    ),
    db.query(
      `SELECT COUNT(*)::int AS available
         FROM fee_vouchers
        WHERE user_id = $1 AND used_at IS NULL
          AND valid_from <= CURRENT_DATE AND valid_until >= CURRENT_DATE`,
      [userId],
    ),
  ]);

  const user = userRes.rows[0];
  if (!user) return null;

  // Következő szint
  const currentLvl = LEVELS.find((l) => l.level === user.level) || LEVELS[0];
  const nextLvl = LEVELS.find((l) => l.level === user.level + 1);
  const progressToNext = nextLvl
    ? Math.min(100, Math.round((user.total_deliveries / nextLvl.minDeliveries) * 100))
    : 100;

  return {
    level: user.level,
    levelName: user.level_name,
    levelIcon: currentLvl.icon,
    totalDeliveries: user.total_deliveries,
    totalEarnings: user.total_earnings,
    trustScore: user.trust_score,
    isVerified: user.is_verified_carrier,
    ratingAvg: user.rating_avg,
    ratingCount: user.rating_count,
    badges: badgesRes.rows,
    availableVouchers: vouchersRes.rows[0]?.available || 0,
    nextLevel: nextLvl ? {
      level: nextLvl.level,
      name: nextLvl.name,
      icon: nextLvl.icon,
      deliveriesNeeded: nextLvl.minDeliveries - user.total_deliveries,
      ratingNeeded: nextLvl.minRating,
      monthlyVouchers: nextLvl.monthlyVouchers,
    } : null,
    progressToNext,
  };
}

module.exports = {
  LEVELS,
  BADGE_DEFS,
  recalcLevel,
  grantVoucher,
  grantMonthlyVouchers,
  useVoucherIfAvailable,
  getDriverGameStats,
};
