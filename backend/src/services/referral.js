// Ajánlói program (referral) — egyoldalú modell (2026-07-05, user döntése).
//
// Aki a saját linkjén (?ref=KÓD) keresztül hoz egy új felhasználót, ÉS az
// teljesíti az első fuvarját, az AJÁNLÓ kap egy "ingyen feladás" kupont
// (fee_vouchers, reason='referral'), ami egy kapcsolatfelvételi díjat
// elenged — a REFERRAL_VOUCHER_MAX_FEE_HUF plafonig.
//
// "Teljesítés" = a meghívott
//   - feladóként: kifizette az első kapcsolatfelvételi díját (paid_at), VAGY
//   - sofőrként: lezárta az első fuvart (delivered).
// Amelyik előbb bekövetkezik. Userenként EGYSZER (referral_reward_granted_at).
//
// Visszaélés-védelem:
//   1) a meghívott identity-KYC-ja legyen 'verified' (valós igazolvány) —
//      kamu fiókokat drága gyártani,
//   2) userenként egyetlen jutalom (atomi guard),
//   3) az ajánlónak havi plafon (REFERRAL_MONTHLY_CAP) a tömeges farmolás ellen.

const db = require('../db');
const { grantVoucher } = require('./gamification');
const { createNotification } = require('./notifications');

// ---- Konfig (egy helyen hangolható) ----
// A kupon a legfeljebb ~100.000 Ft értékű feladás díját (2.490 Ft-os sáv és
// alatta) fedezi teljesen; efölött nem alkalmazható (költség-plafon).
const REFERRAL_VOUCHER_MAX_FEE_HUF = 2490;
// Meddig érvényes a kapott kupon.
const REFERRAL_VOUCHER_VALID_DAYS = 60;
// Egy ajánló legfeljebb ennyi jutalmat szerezhet naptári hónaponként.
const REFERRAL_MONTHLY_CAP = 5;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ambivalens karakterek (0/O, 1/I) nélkül

function generateReferralCode(len = 7) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/**
 * Visszaadja a user ajánlói kódját; ha még nincs, generál egyet (ütközésnél
 * újrapróbál). Idempotens.
 */
async function getOrCreateReferralCode(userId) {
  const { rows } = await db.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  if (rows[0].referral_code) return rows[0].referral_code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateReferralCode();
    try {
      const upd = await db.query(
        `UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL RETURNING referral_code`,
        [code, userId],
      );
      if (upd.rows[0]) return upd.rows[0].referral_code;
      // Közben másik kérés beállította — olvassuk vissza.
      const re = await db.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
      if (re.rows[0]?.referral_code) return re.rows[0].referral_code;
    } catch (err) {
      if (err.code !== '23505') throw err; // csak az UNIQUE-ütközésre próbálunk újra
    }
  }
  return null;
}

/**
 * Egy ajánlói kódhoz megkeresi az ajánló user-t. Kis/nagybetűre érzéketlen.
 * @returns {string|null} az ajánló user id-ja
 */
async function resolveReferrerId(code) {
  if (!code || typeof code !== 'string') return null;
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const { rows } = await db.query(
    'SELECT id FROM users WHERE UPPER(referral_code) = $1 LIMIT 1',
    [clean],
  );
  return rows[0]?.id || null;
}

/**
 * A trigger: ha a `userId` egy meghívott, aki most teljesítette az első
 * fuvarját, az ajánlója kap egy ingyen-feladás kupont. Idempotens és
 * self-guardolt — több helyről is nyugodtan hívható (fizetés, kézbesítés).
 * Sose dob hibát (best-effort), hogy az eredeti tranzakciót ne akassza meg.
 *
 * @param {string} userId — a meghívott (aki teljesített)
 * @param {object} [ctx] — { role: 'shipper'|'carrier', jobId }
 */
async function maybeGrantReferralReward(userId, ctx = {}) {
  try {
    if (!userId) return;
    const { rows } = await db.query(
      `SELECT referred_by, referral_reward_granted_at, identity_kyc_status
         FROM users WHERE id = $1`,
      [userId],
    );
    const u = rows[0];
    if (!u) return;
    if (!u.referred_by) return;                         // nem meghívott
    if (u.referral_reward_granted_at) return;           // már jutalmazott
    if (u.identity_kyc_status !== 'verified') return;   // KYC-feltétel
    if (u.referred_by === userId) return;               // önmagára-ajánlás védőháló

    // Atomi guard: csak az első kérés nyer, dupla jutalom kizárva.
    const claim = await db.query(
      `UPDATE users SET referral_reward_granted_at = NOW()
        WHERE id = $1 AND referral_reward_granted_at IS NULL
        RETURNING referred_by`,
      [userId],
    );
    if (claim.rowCount === 0) return;
    const referrerId = claim.rows[0].referred_by;

    // Ajánló havi plafonja: hány 'referral' kupont kapott ebben a hónapban?
    const { rows: capRows } = await db.query(
      `SELECT COUNT(*)::int AS c FROM fee_vouchers
        WHERE user_id = $1 AND reason = 'referral'
          AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [referrerId],
    );
    if ((capRows[0]?.c || 0) >= REFERRAL_MONTHLY_CAP) {
      // A meghívott már 'granted' (nem próbálkozik újra), de a plafon miatt
      // most nem jár kupon. Ritka edge — logoljuk.
      console.log(`[referral] havi plafon elérve, kupon kihagyva (referrer=${referrerId})`);
      return;
    }

    await grantVoucher(referrerId, 'referral', REFERRAL_VOUCHER_VALID_DAYS, REFERRAL_VOUCHER_MAX_FEE_HUF);

    await createNotification({
      user_id: referrerId,
      type: 'referral_reward',
      title: '🎉 Ingyen feladást kaptál!',
      body: 'Akit meghívtál, teljesítette az első fuvarját — a következő feladásod kapcsolatfelvételi díját elengedjük. Nézd meg a "Fizetés" lépésnél.',
      link: '/dashboard',
    }).catch(() => {});
  } catch (err) {
    console.warn('[referral] maybeGrantReferralReward hiba:', err.message);
  }
}

module.exports = {
  REFERRAL_VOUCHER_MAX_FEE_HUF,
  REFERRAL_VOUCHER_VALID_DAYS,
  REFERRAL_MONTHLY_CAP,
  generateReferralCode,
  getOrCreateReferralCode,
  resolveReferrerId,
  maybeGrantReferralReward,
};
