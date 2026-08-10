// GoFuvar KYC & Jogosítvány kezelés.
//
// Flow:
//   1) Szállító feltölti a jogosítványt → kyc_documents (status: pending)
//   2) Admin jóváhagyja → status: approved, lejárat mentve
//   3) 30 nappal lejárat előtt → értesítés ("Frissítsd a jogosítványod!")
//   4) 7 nappal előtt → utolsó figyelmeztetés
//   5) Lejárat napján → can_bid = false, ajánlattétel letiltva
//
// A checkExpiredLicenses() cron job-ként fut naponta.

const db = require('../db');
const { createNotification } = require('./notifications');
const { deleteFile } = require('./storage');

// Adatminimalizálás: a KYC-okmány NYERS fotóját a végleges döntés (approved/
// rejected) után ennyi nappal töröljük a tárolóból. A metaadat (státusz,
// dokumentumszám-hash a csalásvédelemhez) megmarad — csak a kép tűnik el.
const KYC_FILE_RETENTION_DAYS = 30;
// Abszolút plafon az ELDÖNTETLEN (pending) okmányfotókra: ha az admin ennyi
// idő alatt sem döntött, a nyers fotó akkor is törlődik. Az érintett a
// felületen bármikor újratölthet, ha időközben megszületik a döntés-igény.
const KYC_PENDING_MAX_DAYS = 60;





/**
 * KYC-okmányok nyers fotóinak törlése a végleges döntés után
 * (adatminimalizálás). A pending okmányokat NEM érinti (azokat az admin még
 * látja). A metaadatot (státusz, doc_number_hash) megtartjuk a csalásvédelemhez.
 * Naponta fut (lásd index.js). Soha nem dob — csak naplóz.
 * @returns {Promise<number>} a kiürített okmányok száma
 */
async function purgeOldKycFiles() {
  let purged = 0;
  try {
    // ⚠️ A 'pending' okmány is kap FELSŐ KORLÁTOT (2026-08-09, adatvédelmi
    // audit). Korábban a purge csak eldöntött (approved/rejected/expired)
    // okmányra futott — ha az admin sosem döntött, a személyi igazolvány
    // fotója HATÁRIDŐ NÉLKÜL a tárolóban maradt. Épp a legkényesebb esetek
    // kerülnek pendingbe: AI-kiesés, alacsony bizalom, név-eltérés,
    // másolat-gyanú — és a 18 év alattinak vélt személyek okmánya.
    // A metaadat (státusz, doc_number_hash) marad, csak a NYERS FOTÓ megy.
    const { rows } = await db.query(
      `SELECT id, file_url
         FROM kyc_documents
        WHERE file_url IS NOT NULL
          AND (
            (status IN ('approved', 'rejected', 'expired')
              AND COALESCE(reviewed_at, created_at) < NOW() - ($1 || ' days')::interval)
            OR
            (status = 'pending'
              AND created_at < NOW() - ($2 || ' days')::interval)
          )`,
      [KYC_FILE_RETENTION_DAYS, KYC_PENDING_MAX_DAYS],
    );
    for (const doc of rows) {
      const ok = await deleteFile(doc.file_url);
      // Akkor is nullázzuk a file_url-t, ha a tároló-törlés nem sikerült
      // (data:URL vagy már hiányzó objektum), hogy ne próbálkozzunk újra végtelenül.
      await db.query(`UPDATE kyc_documents SET file_url = NULL WHERE id = $1`, [doc.id]);
      if (ok) purged += 1;
    }
    if (rows.length > 0) {
      console.log(`[kyc-retention] ${rows.length} okmány nyers fotója kiürítve (>${KYC_FILE_RETENTION_DAYS} nap)`);
    }
  } catch (err) {
    console.error('[kyc-retention] hiba:', err.message);
  }
  return purged;
}

// ⚠️ A jogosítvány-kezelő függvények (submitLicenseDocument, approveDocument,
// rejectDocument, checkExpiredLicenses) 2026-08-10-én TÖRÖLVE: a
// jogosítvány-követelmény 2026-07-07 óta nincs, egyiküket sem hívta semmi, és
// a `checkExpiredLicenses` ütemezve sem volt. A hozzájuk tartozó oszlopokat a
// 066-os migráció vitte (köztük a NYERS okmányszámot).
module.exports = {
  purgeOldKycFiles,
  KYC_FILE_RETENTION_DAYS,
  KYC_PENDING_MAX_DAYS,
};
