// Felvételi/lerakós fotók retenciója (2026-07-16, user-döntés).
//
// Szabály:
//   - ALAPESET: a fuvar/foglalás lezárása (terminális státusz) után 30
//     nappal a pickup/dropoff fotók törlődnek (tároló + photos sor).
//   - ZÁROLÁS (photo_retention_hold): vitarendezés (a vita-nyitás
//     automatikusan bekapcsolja) vagy admin-utasítás esetén az érintett
//     fuvar fotói 5 ÉVIG maradnak (az adatkezelési tájékoztató szerint),
//     utána azok is törlődnek.
//
// A 'listing' (hirdetés-) és 'damage'/'document' fotókat NEM érinti — a
// damage/document tipikusan vita-bizonyíték (a hold úgyis védi), a listing
// a hirdetés része.
//
// Naponta fut (index.js ütemezi, a KYC-retencióval együtt). Soha nem dob.

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

module.exports = { purgeOldDeliveryPhotos, DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS };
