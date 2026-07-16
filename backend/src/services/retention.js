// Adat-retenció — a nem-KYC adattípusok gépesített életciklusa
// (az adatkezelési tájékoztató 5. szakaszával szinkronban; a KYC-fotók
// 30 napos törlése külön, a kyc.js-ben él).
//
//   FUVARFOTÓK (pickup/dropoff, 2026-07-16 user-döntés): a lezárás után
//     30 nappal törlődnek; zárolt (photo_retention_hold — vita-nyitás
//     auto-zárol, vagy admin) fuvarnál 5 év. A 'listing'/'damage'/
//     'document' fotókat nem érinti.
//   CHAT-ÜZENETEK (2026-07-17): a lezárás után 6 HÓNAPPAL törlődnek;
//     zárolt ügyletnél 5 év (ugyanaz a hold flag — a zárolás egységes
//     "bizonyíték-megőrzés": fotó + chat együtt).
//   GPS-PINGEK (2026-07-17): 7 nap után törlődnek (rögzítéstől — az élő
//     GPS a mobil-fázisban indul, de a job már most él, így sosem gyűlhet).
//
// Naponta fut (index.js: runDailyRetention). Soha nem dob.

const db = require('../db');
const { deleteFile } = require('./storage');

const DEFAULT_RETENTION_DAYS = 30;
const HOLD_RETENTION_YEARS = 5;

// Terminális státuszok — csak lezárt ügylet fotóját törölhetjük
const JOB_TERMINAL = ['delivered', 'completed', 'cancelled'];
const BOOKING_TERMINAL = ['delivered', 'rejected', 'cancelled'];

/**
 * Lejárt felvételi/lerakós fotók törlése.
 * @returns {Promise<number>} a törölt fotók száma
 */
async function purgeOldDeliveryPhotos() {
  let purged = 0;
  try {
    // --- Fuvar-fotók ---
    const { rows: jobPhotos } = await db.query(
      `SELECT p.id, p.url
         FROM photos p
         JOIN jobs j ON j.id = p.job_id
        WHERE p.kind IN ('pickup', 'dropoff')
          AND (
            (j.photo_retention_hold = FALSE
              AND j.status = ANY($1)
              AND j.updated_at < NOW() - ($2 || ' days')::interval)
            OR
            (j.photo_retention_hold = TRUE
              AND j.updated_at < NOW() - ($3 || ' years')::interval)
          )`,
      [JOB_TERMINAL, DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS],
    );

    // --- Foglalás-fotók (route_bookings; nincs updated_at → delivered_at
    //     vagy created_at a viszonyítás) ---
    const { rows: bookingPhotos } = await db.query(
      `SELECT p.id, p.url
         FROM photos p
         JOIN route_bookings b ON b.id = p.booking_id
        WHERE p.kind IN ('pickup', 'dropoff')
          AND (
            (b.photo_retention_hold = FALSE
              AND b.status::text = ANY($1)
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($2 || ' days')::interval)
            OR
            (b.photo_retention_hold = TRUE
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($3 || ' years')::interval)
          )`,
      [BOOKING_TERMINAL, DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS],
    );

    for (const p of [...jobPhotos, ...bookingPhotos]) {
      await deleteFile(p.url); // data:/hiányzó objektumnál is "rendben" — nem blokkol
      await db.query('DELETE FROM photos WHERE id = $1', [p.id]);
      purged += 1;
    }
    if (purged > 0) {
      console.log(`[photo-retention] ${purged} felvételi/lerakós fotó törölve (>${DEFAULT_RETENTION_DAYS} nap, zároltak: ${HOLD_RETENTION_YEARS} év)`);
    }
  } catch (err) {
    console.error('[photo-retention] hiba:', err.message);
  }
  return purged;
}

const CHAT_RETENTION_MONTHS = 6;
const GPS_RETENTION_DAYS = 7;

/**
 * Lejárt chat-üzenetek törlése: lezárt ügylet üzenetei 6 hónap után,
 * zárolt (vitás/admin-holdos) ügyletéi 5 év után.
 * @returns {Promise<number>} a törölt üzenetek száma
 */
async function purgeOldChatMessages() {
  let purged = 0;
  try {
    const { rowCount: jobMsgs } = await db.query(
      `DELETE FROM messages m
        USING jobs j
        WHERE m.job_id = j.id
          AND (
            (j.photo_retention_hold = FALSE
              AND j.status = ANY($1)
              AND j.updated_at < NOW() - ($2 || ' months')::interval)
            OR
            (j.photo_retention_hold = TRUE
              AND j.updated_at < NOW() - ($3 || ' years')::interval)
          )`,
      [JOB_TERMINAL, CHAT_RETENTION_MONTHS, HOLD_RETENTION_YEARS],
    );
    const { rowCount: bookingMsgs } = await db.query(
      `DELETE FROM messages m
        USING route_bookings b
        WHERE m.booking_id = b.id
          AND (
            (b.photo_retention_hold = FALSE
              AND b.status::text = ANY($1)
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($2 || ' months')::interval)
            OR
            (b.photo_retention_hold = TRUE
              AND COALESCE(b.delivered_at, b.created_at) < NOW() - ($3 || ' years')::interval)
          )`,
      [BOOKING_TERMINAL, CHAT_RETENTION_MONTHS, HOLD_RETENTION_YEARS],
    );
    purged = (jobMsgs || 0) + (bookingMsgs || 0);
    if (purged > 0) {
      console.log(`[retention] ${purged} chat-üzenet törölve (>${CHAT_RETENTION_MONTHS} hónap, zároltak: ${HOLD_RETENTION_YEARS} év)`);
    }
  } catch (err) {
    console.error('[retention] chat-purge hiba:', err.message);
  }
  return purged;
}

/**
 * 7 napnál régebbi nyers GPS-pingek törlése (adatkezelési ígéret).
 * @returns {Promise<number>} a törölt pingek száma
 */
async function purgeOldLocationPings() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM location_pings WHERE recorded_at < NOW() - ($1 || ' days')::interval`,
      [GPS_RETENTION_DAYS],
    );
    if (rowCount > 0) console.log(`[retention] ${rowCount} GPS-ping törölve (>${GPS_RETENTION_DAYS} nap)`);
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] GPS-purge hiba:', err.message);
    return 0;
  }
}

/** Az összes napi retenciós kör egyben (index.js ezt ütemezi). */
async function runDailyRetention() {
  await purgeOldDeliveryPhotos();
  await purgeOldChatMessages();
  await purgeOldLocationPings();
}

module.exports = {
  purgeOldDeliveryPhotos, purgeOldChatMessages, purgeOldLocationPings,
  runDailyRetention,
  DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS, CHAT_RETENTION_MONTHS, GPS_RETENTION_DAYS,
};
