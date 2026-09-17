const db = require('../db');
const email = require('./email');
const sms = require('./sms');
const { jelezSorHibak } = require('./utemezo');

async function enqueuePickupNotifications(client, { jobId = null, bookingId = null, entity }) {
  if (!entity.delivery_code) return;
  for (const channel of ['sms', 'email']) {
    if (!(channel === 'sms' ? entity.recipient_phone : entity.recipient_email)) continue;
    await client.query(
      `INSERT INTO pickup_notification_queue(job_id, booking_id, channel) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING`, [jobId, bookingId, channel],
    );
  }
}

async function sendPickup(row, pi) {
  if (row.channel === 'email') {
    if (!pi.recipient_email) return true;
    const result = await email.sendRecipientPickupEmail({
      to: pi.recipient_email, recipientName: pi.recipient_name, jobTitle: pi.title,
      trackingUrl: `${process.env.PUBLIC_URL || 'https://gofuvar.hu'}/nyomon-kovetes/${pi.tracking_token}`,
      deliveryCode: pi.delivery_code, carrierName: pi.carrier_name, carrierPhone: pi.carrier_phone,
    });
    return Boolean(result?.id || result?.stub);
  }
  if (!pi.recipient_phone) return true;
  const tel = (pi.carrier_phone || '').replace(/[^\d+]/g, '');
  const nev = (pi.carrier_name || '').slice(0, 14);
  const sofor = nev ? ` Szállító: ${nev}${tel ? ` ${tel}` : ''}.` : '';
  // A meglévő, legfeljebb három szegmenses szöveg és az egyetlen
  // felvételkori SMS megmarad. A retry tulajdonosa kizárólag ez a sor.
  const result = await sms.sendSms(pi.recipient_phone,
    `GoFuvar: úton a csomagod! Átvételi kód: ${pi.delivery_code} – csak az átadáskor add meg a szállítónak.${sofor} Egyeztess vele az érkezésről! Adatkezelés: gofuvar.hu/a`,
    { queueOnFailure: false },
  );
  return result?.ok === true;
}

async function runPickupNotifications({ jobId = null, bookingId = null, limit = 20 } = {}) {
  let sent = 0;
  let expired = 0;
  const errors = [];
  // Csatornánként külön tranzakció: emailhiba nem küldi újra a már
  // sikeres SMS-t. SKIP LOCKED mellett több szerver is dolgozhat.
  for (let i = 0; i < limit; i += 1) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await client.query(
        `SELECT *, created_at < NOW() - INTERVAL '48 hours' AS expired FROM pickup_notification_queue
          WHERE next_attempt_at <= NOW() AND ($1::uuid IS NULL OR job_id = $1)
            AND ($2::uuid IS NULL OR booking_id = $2)
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [jobId, bookingId],
      );
      const row = task.rows[0];
      if (!row) { await client.query('COMMIT'); break; }
      let ok = false;
      await client.query('SAVEPOINT pickup_send');
      try {
        const info = await client.query(row.job_id
          ? `SELECT j.*, c.full_name AS carrier_name, c.phone AS carrier_phone
               FROM jobs j LEFT JOIN users c ON c.id = j.carrier_id WHERE j.id = $1`
          : `SELECT b.*, r.title, c.full_name AS carrier_name, c.phone AS carrier_phone
               FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
               LEFT JOIN users c ON c.id = r.carrier_id WHERE b.id = $1`, [row.job_id || row.booking_id]);
        const pi = info.rows[0];
        const physicalStatus = pi?.status === 'disputed' ? pi.status_before_dispute : pi?.status;
        // Lezárt ügyletről nem küldünk megkésett „úton van” üzenetet.
        if (!pi || physicalStatus !== 'in_progress') ok = true;
        else if (row.expired) { expired += 1; ok = true; }
        else ok = Boolean(pi.delivery_code) && await sendPickup(row, pi);
      } catch {
        // A savepoint megtartja a feladatzárat SQL-hiba után is.
        // A részletekben cím/telefonszám/kód lehet, ezért nem naplózzuk őket.
        await client.query('ROLLBACK TO SAVEPOINT pickup_send');
        await client.query(`UPDATE pickup_notification_queue SET attempts = attempts + 1,
          next_attempt_at = NOW() + INTERVAL '1 minute' WHERE id = $1`, [row.id]);
        errors.push(new Error('A felvételi értesítés újrapróbálásra vár.'));
        await client.query('COMMIT');
        continue;
      }
      if (ok) {
        await client.query('DELETE FROM pickup_notification_queue WHERE id = $1', [row.id]);
        sent += 1;
      } else {
        await client.query(`UPDATE pickup_notification_queue SET attempts = attempts + 1,
          next_attempt_at = NOW() + INTERVAL '1 minute' WHERE id = $1`, [row.id]);
        errors.push(new Error('A felvételi értesítés újrapróbálásra vár.'));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  }
  if (expired) errors.push(new Error(`${expired} felvételi értesítés 48 órán belül sem volt elküldhető.`));
  jelezSorHibak('pickup-notifications', errors);
  return { sent, expired, failed: errors.length };
}

function dispatchPickupNotifications(ids) {
  setImmediate(() => runPickupNotifications(ids).catch(() => {
    jelezSorHibak('pickup-notifications', [new Error('A felvételi értesítések feldolgozása megszakadt; a tartós feladat megmaradt.')]);
  }));
}

module.exports = { enqueuePickupNotifications, runPickupNotifications, dispatchPickupNotifications };
