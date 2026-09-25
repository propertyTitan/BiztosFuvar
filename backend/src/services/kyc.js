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
const storage = require('./storage');

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
 * (adatminimalizálás). A pending képeknek külön 60 napos plafonjuk van.
 * A metaadatot (státusz, doc_number_hash) megtartjuk a csalásvédelemhez.
 * Naponta fut (lásd index.js); DB-hibát az ütemezőnek továbbad.
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
      `SELECT id, file_url, uploaded_at, user_id
         FROM kyc_documents
        WHERE file_url IS NOT NULL
          AND (
            (status IN ('approved', 'rejected', 'expired')
              AND GREATEST(reviewed_at, uploaded_at, created_at) < NOW() - ($1 || ' days')::interval)
            OR
            (status = 'pending'
              AND COALESCE(uploaded_at, created_at) < NOW() - ($2 || ' days')::interval)
          )`,
      [KYC_FILE_RETENTION_DAYS, KYC_PENDING_MAX_DAYS],
    );
    for (const doc of rows) {
      const client = await db.pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        // Az admin review, feltöltés és fióktörlés is user → dokumentum
        // sorrendben zárol. Az előválogatott sor közben megváltozhatott.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [doc.user_id]);
        const current = await client.query(
          `SELECT file_url FROM kyc_documents WHERE id = $1 AND user_id = $4
            AND file_url IS NOT NULL AND (
              (status IN ('approved', 'rejected', 'expired')
                AND GREATEST(reviewed_at, uploaded_at, created_at) < NOW() - ($2 || ' days')::interval)
              OR (status = 'pending'
                AND COALESCE(uploaded_at, created_at) < NOW() - ($3 || ' days')::interval)
            ) FOR UPDATE`, [doc.id, KYC_FILE_RETENTION_DAYS, KYC_PENDING_MAX_DAYS, doc.user_id],
        );
        if (!current.rows.length) {
          await client.query('COMMIT'); committed = true; continue;
        }
        // A tároló megszakítható (10s) kérése alatt is tartjuk a zárat:
        // közben új admin-döntés nem commitolhat a törlés elé.
        const ok = await storage.deleteFile(current.rows[0].file_url);
        // Sikertelen törlésnél a mutató megmarad a napi újrapróbáláshoz.
        // A már hiányzó objektum törlése idempotensen sikeres.
        if (!ok) {
          console.error(`[kyc-retention] tároló-törlés sikertelen, a mutatót MEGTARTJUK (doc ${doc.id})`);
          try {
            require('@sentry/node').captureMessage(
              `[kyc-retention] okmányfotó törlése sikertelen (doc ${doc.id}) — a holnapi kör újrapróbálja`,
              'warning',
            );
          } catch { /* a riasztás hiánya ne akassza meg a kört */ }
          await client.query('COMMIT'); committed = true; continue;
        }
        // A sor zárolt, ezért nincs szükség JS Date-en át visszaküldött
        // timestamp-CAS-re (a PostgreSQL mikrosecondja ott elveszne).
        const cleared = await client.query('UPDATE kyc_documents SET file_url = NULL WHERE id = $1', [doc.id]);
        await client.query('COMMIT'); committed = true;
        purged += cleared.rowCount;
      } finally {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }
    if (rows.length > 0) {
      console.log(`[kyc-retention] ${purged} okmány nyers fotója kiürítve (>${KYC_FILE_RETENTION_DAYS} nap)`);
    }
  } catch (err) {
    // (D4, 2026-09-13) TOVÁBBDOBJUK: ez a kör NEM része a retention_runs
    // naplónak és a watchdognak — egy DB-hiba (átnevezett oszlop,
    // jogosultság) mellett a SZEMÉLYI IGAZOLVÁNY-fotók 30 napos törlése
    // hónapokig kimaradt volna, és csak a Railway-log tudott róla. Az
    // ütemező burkolója (services/utemezo.js) riaszt.
    console.error('[kyc-retention] hiba:', err.message);
    throw err;
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
