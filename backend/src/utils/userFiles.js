// =====================================================================
//  Felhasználói fájlok törlése a TÁROLÓBÓL (R2) fiók-törléskor.
//
//  IGÉNY (2026-08-09, biztonsági/adatvédelmi audit): a fiók-törlés eddig
//  CSAK a DB-sorokat vitte (CASCADE), az R2-objektumok viszont bennragadtak
//  — a legérzékenyebb adat, a SZEMÉLYI IGAZOLVÁNY fotója túlélte a GDPR
//  17. cikk szerinti „elfeledtetést". A napi purge-jobok a DB-sorokból
//  olvassák a törlendő kulcsokat, így a CASCADE után SOSEM érik el őket
//  (örök árva fájl). Ezért a fiók-törlésnek a DB-CASCADE ELŐTT kell
//  törölnie a tárolóból: KYC-okmány + avatar + fuvar-/foglalás-fotók.
//
//  Sose dob — a törlés fő tranzakcióját nem akaszthatja meg (ha egy fájl
//  nem törölhető, azt naplózzuk; a napi retenció is próbálkozhat vele).
// =====================================================================

const db = require('../db');
// Az objektumon át hívjuk (nem destrukturálva), hogy a teszt spy-olhassa.
const storage = require('../services/storage');

/**
 * A userhez tartozó összes tárolt fájl kulcsa/URL-je.
 *
 * ⚠️ Ezt a DB-törlés ELŐTT kell meghívni (utána a sorok már nincsenek meg),
 * a tényleges törlést viszont a sikeres DB-törlés UTÁN végezzük (lásd
 * `purgeUserFiles`) — a fájl-törlés visszafordíthatatlan, ezért nem futhat
 * egy olyan tranzakció előtt, ami még elhasalhat.
 *
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function collectUserFileKeys(userId) {
  try {
    // A KYC-fotó státusztól függetlenül megy (pending is), fiók-törléskor
    // minden törlendő. A `deleteFile` kezeli a `private:<kulcs>` és a
    // publikus URL alakot is.
    const { rows } = await db.query(
      `SELECT file_url AS u FROM kyc_documents WHERE user_id = $1 AND file_url IS NOT NULL
       UNION ALL
       SELECT avatar_url FROM users WHERE id = $1 AND avatar_url IS NOT NULL
       UNION ALL
       SELECT url FROM photos WHERE uploader_id = $1 AND url IS NOT NULL`,
      [userId],
    );
    return rows.map((r) => r.u).filter(Boolean);
  } catch (err) {
    console.error('[user-files] kulcs-gyűjtés hiba:', err.message);
    return [];
  }
}

/**
 * A megadott (vagy a userhez tartozó) fájlok törlése a tárolóból.
 * Sose dob — a hívó tranzakcióját nem akaszthatja meg.
 *
 * @param {string} userId
 * @param {{keys?: string[]}} [opts] — előre kigyűjtött kulcsok (a DB-törlés
 *        után ez az egyetlen forrás; enélkül a függvény maga kérdezi le)
 * @returns {Promise<number>} a törölt fájlok száma
 */
async function purgeUserFiles(userId, opts = {}) {
  let deleted = 0;
  try {
    const keys = Array.isArray(opts.keys) ? opts.keys : await collectUserFileKeys(userId);
    for (const key of keys) {
      if (await storage.deleteFile(key)) deleted += 1;
    }
    if (deleted > 0) {
      console.log(`[user-files] ${deleted} tárolt fájl törölve a fiók-törléskor (user ${userId})`);
    }
  } catch (err) {
    console.error('[user-files] fiók-fájl purge hiba:', err.message);
  }
  return deleted;
}

/**
 * Egy FUVARHOZ / JÁRATHOZ / FOGLALÁSHOZ tartozó tárolt fájlok kulcsai.
 *
 * ⚠️ 2026-08-09 (adatvédelmi audit 3. kör): az admin fuvar-, járat- és
 * foglalás-törlése ugyanabba a hibába futott, amit a fiók-törlésnél már
 * javítottunk — a `photos.job_id`/`booking_id` CASCADE elviszi a DB-sort, az
 * R2-objektum viszont marad, és mivel a napi purge a DB-sorokból olvassa a
 * kulcsokat, SOHA többé nem éri el. Örök árva fájl, benne a felvételi/
 * kézbesítési fotóval és annak GPS-koordinátájával.
 *
 * A járat törlése a foglalásain át kaszkádol, ezért ott a hozzá tartozó
 * összes foglalás fotóját is össze kell szedni.
 *
 * @param {'job'|'booking'|'route'} tipus
 * @param {string} id
 * @returns {Promise<string[]>}
 */
async function collectEntityFileKeys(tipus, id) {
  const sql = {
    job: 'SELECT url FROM photos WHERE job_id = $1 AND url IS NOT NULL',
    booking: 'SELECT url FROM photos WHERE booking_id = $1 AND url IS NOT NULL',
    route: `SELECT p.url FROM photos p
              JOIN route_bookings b ON b.id = p.booking_id
             WHERE b.route_id = $1 AND p.url IS NOT NULL`,
  }[tipus];
  if (!sql) return [];
  try {
    const { rows } = await db.query(sql, [id]);
    return rows.map((r) => r.url).filter(Boolean);
  } catch (err) {
    console.error('[entity-files] kulcs-gyűjtés hiba:', err.message);
    return [];
  }
}

/** A megadott kulcsok törlése a tárolóból. Sose dob. */
async function purgeFileKeys(keys) {
  let deleted = 0;
  for (const key of keys || []) {
    try {
      if (await storage.deleteFile(key)) deleted += 1;
    } catch (err) {
      console.error('[entity-files] törlés hiba:', err.message);
    }
  }
  if (deleted > 0) console.log(`[entity-files] ${deleted} tárolt fájl törölve`);
  return deleted;
}

module.exports = {
  purgeUserFiles, collectUserFileKeys, collectEntityFileKeys, purgeFileKeys,
};
