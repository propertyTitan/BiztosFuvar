// =====================================================================
//  Okmány-lenyomat előzmény — „egy okmány = egy fiók", a törlés után is
//
//  USER-DÖNTÉS (2026-08-10): „a fiók törlésével ne lehessen újra
//  regisztrálni kvázi újként."
//
//  A `kyc_documents.user_id` CASCADE-el a userrel, tehát a fiók törlésekor a
//  doc_number_hash is eltűnt — miközben az adatkezelési tájékoztató, a
//  30. cikk nyilvántartás és egy teljes érdekmérlegelési teszt is 5 éves
//  megőrzést állított, épp erre a csalásvédelmi célra. A kitiltott
//  felhasználó tehát törölte a fiókját, és ugyanazzal a személyivel
//  visszajött, tiszta lappal.
//
//  Ez a tábla csak SHA-256 LENYOMATOT tárol (az okmányszámot sosem) és
//  időbélyegeket — személyhez nem köthető vissza, csak összevetni lehet vele
//  egy új feltöltést. 5 év után a napi retenciós kör törli.
//
//  ⚠️ NEM KEMÉNY TILTÁS: a visszatérő felhasználó KYC-je emberi ellenőrzésre
//  kerül, nem automatikus elutasításra. A cél nem a kizárás, hanem hogy ne
//  lehessen ELŐZMÉNY NÉLKÜLI, „friss" fiókként visszajönni. Egy vak tiltás a
//  jóhiszemű visszatérőt is kizárná, és emberi felülvizsgálat nélküli
//  automatizált döntés lenne (GDPR 22. cikk).
// =====================================================================

const db = require('../db');

/** Feltöltéskor: rögzítjük/frissítjük a lenyomatot. Sose dob. */
async function rogzitLenyomat(docNumberHash) {
  if (!docNumberHash) return;
  try {
    await db.query(
      `INSERT INTO kyc_doc_history (doc_number_hash) VALUES ($1)
       ON CONFLICT (doc_number_hash) DO UPDATE SET last_seen_at = NOW()`,
      [docNumberHash],
    );
  } catch (err) {
    console.warn('[kyc-history] lenyomat-rögzítés hiba:', err.message);
  }
}

/**
 * Fiók-törléskor: megjelöljük a userhez tartozó lenyomatokat.
 *
 * ⚠️ A DB-CASCADE ELŐTT kell hívni (utána a kyc_documents sor már nincs meg),
 * és ugyanabban a tranzakcióban, mint a törlés — ezért kap `client`-et.
 *
 * @param {object} client — a futó tranzakció kliense
 * @param {string} userId
 * @param {string} reason — 'self' | 'admin' (nem tartalmaz személyes adatot)
 */
async function jeloldToroltFioknak(client, userId, reason) {
  await client.query(
    `UPDATE kyc_doc_history h
        SET deleted_account_count = h.deleted_account_count + 1,
            last_deletion_reason = $2,
            last_seen_at = NOW()
       FROM kyc_documents k
      WHERE k.user_id = $1 AND k.doc_number_hash = h.doc_number_hash`,
    [userId, reason],
  );
}

/** Van-e korábban törölt fiók ezzel az okmánnyal? */
async function korabbanToroltFiok(docNumberHash) {
  if (!docNumberHash) return null;
  try {
    const { rows } = await db.query(
      `SELECT deleted_account_count, last_deletion_reason
         FROM kyc_doc_history WHERE doc_number_hash = $1`,
      [docNumberHash],
    );
    return (rows[0]?.deleted_account_count || 0) > 0 ? rows[0] : null;
  } catch (err) {
    console.warn('[kyc-history] előzmény-lekérdezés hiba:', err.message);
    return null;
  }
}

module.exports = { rogzitLenyomat, jeloldToroltFioknak, korabbanToroltFiok };
