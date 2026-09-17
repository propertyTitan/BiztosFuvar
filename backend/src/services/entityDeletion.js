const db = require('../db');
const files = require('../utils/userFiles');
const queue = require('./fileDeletionQueue');

const TABLES = { job: 'jobs', booking: 'route_bookings', route: 'carrier_routes' };
const TERMINAL = { job: ['delivered', 'completed', 'cancelled'], booking: ['delivered', 'rejected', 'cancelled'] };

// Ugyanazon ügyletsorzáron döntünk, mint a fizetés, a vita és a fotómentés.
// A fájlok sorsa a DELETE-tel együtt commitol, a tárhelyhívás utána fut.
async function deleteEntity(type, id) {
  const table = TABLES[type];
  if (!table) throw new Error('Ismeretlen törlési típus');
  const client = await db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    if (type === 'booking') {
      const route = await client.query('SELECT route_id FROM route_bookings WHERE id = $1', [id]);
      if (!route.rows[0]) return { missing: true };
      await client.query('SELECT id FROM carrier_routes WHERE id = $1 FOR UPDATE', [route.rows[0].route_id]);
    }
    const entity = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!entity.rows[0]) return { missing: true };
    const dealings = type === 'route'
      ? (await client.query('SELECT * FROM route_bookings WHERE route_id = $1 ORDER BY id FOR UPDATE', [id])).rows
      : entity.rows;
    const kind = type === 'job' ? 'job' : 'booking';
    if (dealings.some(row => row.photo_retention_hold || row.status === 'disputed'
      || (row.paid_at && !TERMINAL[kind].includes(row.status)))) return { blocked: true };
    const jobId = type === 'job' ? id : null;
    const bookingIds = type === 'job' ? [] : dealings.map(row => row.id);
    const blockers = await client.query(
      `SELECT 1 FROM disputes WHERE (job_id = $1 OR booking_id = ANY($2::uuid[]))
         AND status IN ('open', 'under_review')
       UNION ALL
       SELECT 1 FROM payment_sessions WHERE (job_id = $1 OR booking_id = ANY($2::uuid[]))
         AND state IN ('pending', 'needs_review')
       UNION ALL
       SELECT 1 FROM fee_payment_receipts WHERE (job_id = $1 OR booking_id = ANY($2::uuid[]))
         AND invoice_pending LIMIT 1`, [jobId, bookingIds],
    );
    if (blockers.rows.length) return { blocked: true };
    const keys = await files.collectEntityFileKeys(type, id, client);
    await queue.enqueueFileDeletions(client, id, keys);
    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    await client.query('COMMIT');
    committed = true;
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  await queue.processFileDeletionQueue({ batchId: id }).catch(() => {});
  try {
    const pending = await db.query('SELECT 1 FROM file_deletion_queue WHERE batch_id = $1 LIMIT 1', [id]);
    return { deleted: true, filesPending: pending.rows.length > 0 };
  } catch {
    return { deleted: true, filesPending: true };
  }
}

module.exports = { deleteEntity };
