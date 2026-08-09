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
 * @param {string} userId
 * @returns {Promise<number>} a törölt fájlok száma
 */
async function purgeUserFiles(userId) {
  let deleted = 0;
  try {
    // Minden fájl-URL, ami a userhez tartozik (a deleteFile kezeli a
    // `private:<kulcs>` és a publikus URL-t is). A KYC-fotó státusztól
    // függetlenül megy (pending is), a fiók-törléskor minden törlendő.
    const { rows } = await db.query(
      `SELECT file_url AS u FROM kyc_documents WHERE user_id = $1 AND file_url IS NOT NULL
       UNION ALL
       SELECT avatar_url FROM users WHERE id = $1 AND avatar_url IS NOT NULL
       UNION ALL
       SELECT url FROM photos WHERE uploader_id = $1 AND url IS NOT NULL`,
      [userId],
    );
    for (const r of rows) {
      if (await storage.deleteFile(r.u)) deleted += 1;
    }
    if (deleted > 0) {
      console.log(`[user-files] ${deleted} tárolt fájl törölve a fiók-törléskor (user ${userId})`);
    }
  } catch (err) {
    console.error('[user-files] fiók-fájl purge hiba:', err.message);
  }
  return deleted;
}

module.exports = { purgeUserFiles };
