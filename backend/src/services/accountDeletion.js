const db = require('../db');
const { userHasBlockingDealings } = require('../utils/activePaid');
const userFiles = require('../utils/userFiles');
const kycHistory = require('../utils/kycHistory');
const queue = require('./fileDeletionQueue');

const REASONS = { self: 'Felhasználó saját kérésére', admin: 'Adminisztrátori törlés', dormant: 'Inaktív fiók törlése' };

async function deleteAccount(userId, { reason, dormantDays = 30, dormantYears = 3 } = {}) {
  if (!REASONS[reason]) throw new Error('Ismeretlen fióktörlési ok');
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]) return { deleted: false, missing: true };
    if (reason === 'dormant') {
      const eligible = await client.query(`SELECT 1 FROM users WHERE id = $1 AND role <> 'admin'
        AND dormant_warned_at < NOW() - ($2 || ' days')::interval
        AND COALESCE(last_login_at, created_at) < NOW() - ($3 || ' years')::interval`, [userId, dormantDays, dormantYears]);
      if (!eligible.rows.length) return { deleted: false };
    }
    // A user-zár az új FK-kapcsolatokat, az ügylet-zár a fizetés, a vita és
    // a fotó mentésének állapotátmeneteit fogja. A gyűjtés ugyanitt történik.
    await client.query('SELECT id FROM jobs WHERE shipper_id = $1 OR carrier_id = $1 ORDER BY id FOR UPDATE', [userId]);
    await client.query('SELECT id FROM carrier_routes WHERE carrier_id = $1 ORDER BY id FOR UPDATE', [userId]);
    await client.query(`SELECT b.id FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
      WHERE b.shipper_id = $1 OR r.carrier_id = $1 ORDER BY b.id FOR UPDATE OF b`, [userId]);
    if (await userHasBlockingDealings(userId, client)) return { deleted: false, blocked: true };
    const keys = await userFiles.collectUserFileKeys(userId, client);
    await queue.enqueueFileDeletions(client, userId, keys);
    await client.query(`INSERT INTO deleted_accounts(original_user_id, email_hash, reason, hash_algo)
      VALUES($1, $2, $3, 'hmac-sha256')`, [userId, require('../utils/pepper').hmac(rows[0].email), REASONS[reason]]);
    await kycHistory.jeloldToroltFioknak(client, userId, reason);
    await client.query('UPDATE reviews SET comment = NULL WHERE reviewer_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  await require('../realtime').disconnectUser(userId).catch(() => {});
  // Fióktörlés már megtörtént. A tárhelyhiba nem veszti el a feladatot és
  // nem ad félrevezető 500-at a végleg megszűnt fióknak.
  await queue.processFileDeletionQueue({ batchId: userId }).catch(() => {});
  try {
    const pending = await db.query('SELECT COUNT(*)::int AS n FROM file_deletion_queue WHERE batch_id = $1', [userId]);
    return { deleted: true, filesPending: pending.rows[0].n > 0 };
  } catch {
    return { deleted: true, filesPending: true };
  }
}

module.exports = { deleteAccount };
