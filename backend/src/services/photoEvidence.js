// A külső feltöltés után a jogosultság, a fotó és a fizikai állapot egyetlen
// zárolt tranzakcióhoz tartozik. Hálózati feltöltés alatt az ügyletet nem zároljuk.
const crypto = require('crypto');
const db = require('../db');

function codesMatch(input, expected) {
  if (!expected) return false;
  const hash = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(hash(input), hash(expected));
}

function reject(status, error, code = 'STATE_CHANGED') {
  return Object.assign(new Error(error), { photoStatus: status, photoBody: { error, code } });
}

async function commitPhoto({ jobId, bookingId, uploaderId, kind, url, gps, deliveryCode, maxPhotos }) {
  const isJob = Boolean(jobId);
  const id = jobId || bookingId;
  const table = isJob ? 'jobs' : 'route_bookings';
  const foreignKey = isJob ? 'job_id' : 'booking_id';
  let client;
  let releaseError;
  let committing = false;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(isJob
      ? 'SELECT * FROM jobs WHERE id = $1 FOR UPDATE'
      : `SELECT b.*, r.carrier_id, r.title AS route_title
           FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
          WHERE b.id = $1 FOR UPDATE OF b, r`, [id]);
    const entity = rows[0];
    if (!entity) throw reject(404, isJob ? 'Fuvar nem található' : 'Foglalás nem található');
    const expectedUser = kind === 'listing' && isJob ? entity.shipper_id : entity.carrier_id;
    if (expectedUser !== uploaderId) throw reject(403, 'A feltöltési jogosultság időközben megváltozott.');
    if (kind !== 'listing' && !entity.paid_at) {
      throw reject(409, 'A kapcsolatfelvételi díj még nincs megfizetve.');
    }
    const physicalStatus = isJob && entity.status === 'disputed' ? entity.status_before_dispute : entity.status;
    const ready = isJob ? 'accepted' : 'confirmed';
    // Régi vitás sor előállapot nélkül is fogadhat kiegészítő pickup
    // bizonyítékot, ahogy eddig; állapotot csak ismert kiindulásból léptetünk.
    if ((!isJob && ['delivered', 'cancelled', 'rejected'].includes(entity.status))
        || (isJob && ['pickup', 'dropoff'].includes(kind)
          && ['delivered', 'completed', 'cancelled'].includes(physicalStatus))) {
      throw reject(409, 'Az ügylet állapota időközben megváltozott — frissítsd az oldalt.');
    }
    if (kind === 'dropoff' && physicalStatus !== 'in_progress') {
      throw reject(409, 'Előbb töltsd fel a felvételi fotót.', 'PICKUP_REQUIRED_FIRST');
    }

    let closedByCodeType = null;
    if (kind === 'dropoff') {
      if (entity.delivery_code_locked_until && new Date(entity.delivery_code_locked_until) > new Date()) {
        throw reject(429, 'A kód-ellenőrzés átmenetileg zárolva. Próbáld újra később.', 'CODE_LOCKED');
      }
      const code = String(deliveryCode || '').trim();
      const recipient = codesMatch(code, entity.delivery_code);
      const sender = isJob && codesMatch(code, entity.sender_delivery_code);
      if (!entity.delivery_code || (!recipient && !sender)) {
        throw reject(403, 'Az átvételi kód időközben megváltozott. Kérd el az aktuális kódot.');
      }
      closedByCodeType = sender ? 'sender_emergency' : 'recipient';
    }
    const count = await client.query(`SELECT count(*)::int AS n FROM photos WHERE ${foreignKey} = $1 AND kind = $2`, [id, kind]);
    if (count.rows[0].n >= maxPhotos) {
      throw reject(400, `Ehhez az ügylethez már ${maxPhotos} „${kind}" fotó tartozik — több nem tölthető fel.`, 'PHOTO_LIMIT');
    }
    const cleanupHash = url.startsWith('data:') ? null : crypto.createHash('sha256').update(url).digest('hex');
    if (cleanupHash) {
      const pending = await client.query('SELECT 1 FROM file_deletion_queue WHERE key_hash = $1 FOR UPDATE', [cleanupHash]);
      if (!pending.rows.length) throw reject(409, 'A fotó feltöltése lejárt. Töltsd fel újra.', 'UPLOAD_EXPIRED');
    }
    const inserted = await client.query(
      `INSERT INTO photos (${foreignKey}, uploader_id, kind, url, gps_lat, gps_lng, gps_accuracy_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, uploaderId, kind, url, ...gps],
    );
    const pickedUp = kind === 'pickup' && physicalStatus === ready;
    const delivered = kind === 'dropoff';
    const statusColumn = isJob && entity.status === 'disputed' ? 'status_before_dispute' : 'status';
    if (pickedUp) {
      await client.query(`UPDATE ${table} SET ${statusColumn} = 'in_progress'${isJob ? ', updated_at = NOW()' : ''} WHERE id = $1`, [id]);
      await require('./pickupNotifications').enqueuePickupNotifications(client, { jobId, bookingId, entity });
    }
    if (delivered) {
      await client.query(
        `UPDATE ${table} SET ${statusColumn} = 'delivered', delivered_at = COALESCE(delivered_at, NOW()),
                delivery_code_attempts = 0, delivery_code_locked_until = NULL
                ${isJob ? ', closed_by_code_type = $2, updated_at = NOW()' : ''}
          WHERE id = $1`, isJob ? [id, closedByCodeType] : [id],
      );
    }
    if (cleanupHash) await client.query('DELETE FROM file_deletion_queue WHERE key_hash = $1', [cleanupHash]);
    committing = true;
    await client.query('COMMIT');
    return { entity, photo: inserted.rows[0], pickedUp, delivered };
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    }
    // COMMIT közbeni kapcsolatvesztésnél a DB már menthetett. Ilyenkor
    // nem töröljük a lehetséges érvényes bizonyítékot találomra.
    if (committing) require('@sentry/node').captureMessage('[photos] A fotótranzakció COMMIT-visszaigazolása bizonytalan', 'error');
    throw error;
  } finally {
    if (client) client.release(releaseError);
  }
}

module.exports = { commitPhoto, codesMatch };
