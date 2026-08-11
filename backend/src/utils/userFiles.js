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
       SELECT url FROM photos WHERE uploader_id = $1 AND url IS NOT NULL
       UNION ALL
       -- ⚠️ 2026-08-09 (adatáramlási + séma-audit): a MÁSIK FÉL által a user
       -- fuvarjaira/foglalásaira feltöltött fotók. Az uploader_id-szűrés
       -- ezeket kihagyta, a CASCADE viszont elviszi a DB-sorukat: a feladó
       -- fiók-törlésekor a SZÁLLÍTÓ felvételi/kézbesítési fotói (a bennük lévő
       -- GPS-koordinátával) örökre az R2-ben ragadtak.
       SELECT p.url FROM photos p JOIN jobs j ON j.id = p.job_id
        WHERE (j.shipper_id = $1 OR j.carrier_id = $1) AND p.url IS NOT NULL
       UNION ALL
       SELECT p.url FROM photos p JOIN route_bookings b ON b.id = p.booking_id
        WHERE b.shipper_id = $1 AND p.url IS NOT NULL
       UNION ALL
       SELECT p.url FROM photos p
         JOIN route_bookings b ON b.id = p.booking_id
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE r.carrier_id = $1 AND p.url IS NOT NULL
       UNION ALL
       -- A vita csatolt bizonyítéka. A disputes.opened_by CASCADE elviszi a
       -- sort, a napi purge pedig a disputes táblából olvasná a kulcsot —
       -- tehát a fiók törlése után SOHA nem törlődött volna.
       SELECT evidence_url FROM disputes
        WHERE (opened_by = $1 OR against_user = $1) AND evidence_url IS NOT NULL`,
      [userId],
    );
    // Egyedivé tesszük: a UNION ALL ágak átfedhetnek (a saját fuvarára maga
    // feltöltött fotó az uploader- ÉS a felek-ágon is illeszkedik), és ilyenkor
    // ugyanarra az objektumra kétszer indulna törlés.
    return [...new Set(rows.map((r) => r.u).filter(Boolean))];
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
    let sikertelen = 0;
    for (const key of keys) {
      if (await storage.deleteFile(key)) deleted += 1;
      else sikertelen += 1;
    }
    if (deleted > 0) {
      console.log(`[user-files] ${deleted} tárolt fájl törölve a fiók-törléskor (user ${userId})`);
    }
    // ⚠️ ITT NEM LEHET „MEGTARTJUK A MUTATÓT" (2026-08-11, 8. mérés).
    // A retenciós köröknél a sikertelen tároló-törlésnél megtartjuk a DB-sort,
    // és holnap újrapróbáljuk. Fiók-törlésnél ez nem járható: a sorok
    // CASCADE-del amúgy is elmennek, tehát a mutató elveszik. Ilyenkor a
    // fájl VÉGLEGESEN árva marad — beleértve a személyi igazolvány fotóját.
    // Ezért ez az egyetlen hely, ahol a néma kudarc elfogadhatatlan: RIASZT,
    // hogy legyen mit egyeztetni a bucket ↔ DB összevetéskor.
    if (sikertelen > 0) {
      console.error(`[user-files] ⚠️ ${sikertelen} fájl törlése SIKERTELEN a fiók-törléskor (user ${userId}) — VÉGLEGESEN árva marad`);
      try {
        require('@sentry/node').captureMessage(
          `[user-files] ${sikertelen} fájl árván maradt a fiók törlésekor (user ${userId}) — GDPR 17. cikk, kézi takarítás kell`,
          'error',
        );
      } catch { /* a Sentry hiánya ne akassza meg a törlést */ }
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
  // A vita bizonyíték-fájlja is kaszkádol az entitással (disputes.job_id /
  // booking_id ON DELETE CASCADE) — tehát ugyanígy össze kell szedni.
  const sql = {
    job: `SELECT url FROM photos WHERE job_id = $1 AND url IS NOT NULL
          UNION ALL
          SELECT evidence_url FROM disputes WHERE job_id = $1 AND evidence_url IS NOT NULL`,
    booking: `SELECT url FROM photos WHERE booking_id = $1 AND url IS NOT NULL
              UNION ALL
              SELECT evidence_url FROM disputes WHERE booking_id = $1 AND evidence_url IS NOT NULL`,
    route: `SELECT p.url FROM photos p
              JOIN route_bookings b ON b.id = p.booking_id
             WHERE b.route_id = $1 AND p.url IS NOT NULL
            UNION ALL
            SELECT d.evidence_url FROM disputes d
              JOIN route_bookings b ON b.id = d.booking_id
             WHERE b.route_id = $1 AND d.evidence_url IS NOT NULL`,
  }[tipus];
  if (!sql) return [];
  try {
    const { rows } = await db.query(sql, [id]);
    return [...new Set(rows.map((r) => r.url).filter(Boolean))];
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
