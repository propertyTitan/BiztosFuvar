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
//   ADMIN-ÜZENETEK (2026-08-08): az admin ↔ user levelezés a küldéstől
//     számított 3 ÉV után törlődik (a fogyasztóvédelmi panasz-megőrzés
//     3 éves mércéjéhez igazítva — Fgytv. 17/A. §; a csatornán panasz is
//     érkezhet). A körüzenet-napló (admin_broadcasts) ugyanennyi.
//     Fiók-törléskor a user szála azonnal megy (FK CASCADE).
//
// Naponta fut (index.js: runDailyRetention). Soha nem dob.

const db = require('../db');
const { deleteFile } = require('./storage');

const DEFAULT_RETENTION_DAYS = 30;
const HOLD_RETENTION_YEARS = 5;
const ADMIN_DM_RETENTION_YEARS = 3;

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
// Az értesítések fél évig maradnak: a felhasználónak ennyi idő után már
// nincs haszna belőlük, viszont a body-juk PII-t hordozhat (lásd
// purgeOldNotifications).
const NOTIFICATION_RETENTION_MONTHS = 6;
// Az admin-hozzáférési napló megőrzése — pontosan annyi, amennyit az
// adatkezelési tájékoztató ígér („File-hozzáférési audit log: 1 évig”).
const ADMIN_ACCESS_LOG_RETENTION_YEARS = 1;

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

/**
 * 3 évnél régebbi admin ↔ user üzenetek + körüzenet-napló törlése.
 * (2026-08-08: a feature-rel együtt gépesítve, hogy a "minden adattípus
 * életciklusa gépesített" állítás igaz maradjon.)
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldAdminMessages() {
  try {
    const { rowCount: msgs } = await db.query(
      `DELETE FROM admin_messages WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_DM_RETENTION_YEARS],
    );
    const { rowCount: bcs } = await db.query(
      `DELETE FROM admin_broadcasts WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_DM_RETENTION_YEARS],
    );
    const purged = (msgs || 0) + (bcs || 0);
    if (purged > 0) {
      console.log(`[retention] ${purged} admin-üzenet/körüzenet törölve (>${ADMIN_DM_RETENTION_YEARS} év)`);
    }
    return purged;
  } catch (err) {
    console.error('[retention] admin-üzenet purge hiba:', err.message);
    return 0;
  }
}

/**
 * A szállító UTOLSÓ ISMERT pozíciójának elévülése.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit): a nyers GPS-pingeket 7 nap után töröltük,
 * de a `users.last_known_lat/lng` egy MÁSOLAT ugyanarról a koordinátáról —
 * és arra semmilyen retenció nem volt. Az utolsó ping tipikusan a nap végi
 * tartózkodási hely (gyakran a lakcím környéke), vagyis a fiók élettartamáig
 * őriztünk egy pontos otthon-koordinátát, miközben a tájékoztató 7 napot ígér.
 * A mező a matchinghez kell (azonnali fuvar, mentős) — a friss érték marad,
 * a 7 napnál régebbi törlődik.
 * @returns {Promise<number>} a nullázott sorok száma
 */
async function purgeStaleLastKnownLocation() {
  try {
    const { rowCount } = await db.query(
      `UPDATE users
          SET last_known_lat = NULL, last_known_lng = NULL
        WHERE (last_known_lat IS NOT NULL OR last_known_lng IS NOT NULL)
          AND (last_ping_at IS NULL OR last_ping_at < NOW() - ($1 || ' days')::interval)`,
      [GPS_RETENTION_DAYS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} elavult utolsó-pozíció törölve (>${GPS_RETENTION_DAYS} nap)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] utolsó-pozíció purge hiba:', err.message);
    return 0;
  }
}

/**
 * Régi ÉRTESÍTÉSEK törlése.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit): a `notifications` táblának NEM VOLT
 * életciklusa, pedig a `body` mezőben PII-t hordoz (SOS: teljes név +
 * telefonszám + pontos GPS; mentés-elvállalás: telefonszám; chat-értesítés: az
 * üzenet első 100 karaktere). Ez utóbbi ráadásul TÚLÉLTE a 6 hónapos
 * chat-retenciót: a `messages` sor törlődött, a másolata az értesítésben
 * maradt. Az „minden adattípus életciklusa gépesített" állítás enélkül nem
 * volt igaz.
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldNotifications() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM notifications WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [NOTIFICATION_RETENTION_MONTHS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} értesítés törölve (>${NOTIFICATION_RETENTION_MONTHS} hónap)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] értesítés-purge hiba:', err.message);
    return 0;
  }
}

/**
 * Az admin-hozzáférési napló elévülése (1 év — a tájékoztató ígérete).
 * @returns {Promise<number>} a törölt sorok száma
 */
async function purgeOldAdminAccessLog() {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM admin_access_log WHERE created_at < NOW() - ($1 || ' years')::interval`,
      [ADMIN_ACCESS_LOG_RETENTION_YEARS],
    );
    if (rowCount > 0) {
      console.log(`[retention] ${rowCount} admin-hozzáférési naplósor törölve (>${ADMIN_ACCESS_LOG_RETENTION_YEARS} év)`);
    }
    return rowCount || 0;
  } catch (err) {
    console.error('[retention] admin-napló purge hiba:', err.message);
    return 0;
  }
}

/** Az összes napi retenciós kör egyben (index.js ezt ütemezi). */
async function runDailyRetention() {
  await purgeOldDeliveryPhotos();
  await purgeOldChatMessages();
  await purgeOldLocationPings();
  await purgeStaleLastKnownLocation();
  await purgeOldNotifications();
  await purgeOldAdminMessages();
  await purgeOldAdminAccessLog();
}

module.exports = {
  purgeOldDeliveryPhotos, purgeOldChatMessages, purgeOldLocationPings,
  purgeStaleLastKnownLocation, purgeOldNotifications,
  purgeOldAdminMessages, purgeOldAdminAccessLog, runDailyRetention,
  ADMIN_ACCESS_LOG_RETENTION_YEARS,
  NOTIFICATION_RETENTION_MONTHS,
  DEFAULT_RETENTION_DAYS, HOLD_RETENTION_YEARS, CHAT_RETENTION_MONTHS, GPS_RETENTION_DAYS,
  ADMIN_DM_RETENTION_YEARS,
};
