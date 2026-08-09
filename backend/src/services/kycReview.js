// =====================================================================
//  KYC: mikor NEM elég az AI ítélete? (2026-08-09, audit 3. kör)
//
//  A KYC-döntés eddig „vak" auto-approve volt: ha a Gemini `valid: true`-t
//  mondott (0.6-os bizalom felett), a fiók AZONNAL 'verified' lett, emberi
//  szem nélkül. Az azonosítás viszont a platform egyik bizalmi alappillére:
//  a szállítói jogosultság (ajánlattétel, járat-hirdetés) és az „egy okmány
//  = egy fiók" csalásvédelem is ezen áll.
//
//  Nem az automatizmust vesszük vissza (a user döntése az admin-tehermentesítés
//  volt), hanem a KOCKÁZATOS eseteket tereljük emberhez. Négy jel:
//
//   1) ALACSONY BIZALOM — a 0.6-os küszöb az „ez egy okmány"-hoz elég, egy
//      SZEMÉLYAZONOSÍTÓ döntéshez kevés. 0.85 alatt admin nézi meg.
//   2) NÉV-ELTÉRÉS — az okmányon más név szerepel, mint a fiókon. Ez a
//      leggyakoribb valós visszaélés (más ember okmányának feltöltése).
//      Nem elutasítás: lehet házassági/felvett név, ékezet- vagy
//      sorrend-eltérés — ezért admin dönt.
//   3) MÁSOLAT-GYANÚ — képernyőfotó / fénymásolat / monitorról fotózott kép.
//   4) OLVASHATATLAN OKMÁNYSZÁM — ilyenkor a duplikátum-ellenőrzés (egy
//      okmány = egy fiók) NEM tud lefutni, vagyis a csalásvédelem néma
//      lyukat kapna. Eddig ez csendben átment.
//
//  A visszaadott ok a felhasználónak is megjelenik (rejection_reason), ezért
//  emberi nyelven, nem vádlón fogalmaz.
// =====================================================================

const AUTO_APPROVE_MIN_CONFIDENCE = 0.85;

/** Ékezet nélküli, kisbetűs szó-halmaz a névhez. */
function nameTokens(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1), // egybetűs kezdőbetű/rövidítés nem számít
  );
}

/**
 * Egyezik-e az okmányon olvasott név a fiók nevével? Sorrend-független
 * (a magyar okmány „Kovács Anna", a profil lehet „Anna Kovács”), ékezet- és
 * írásjel-tűrő. Egy plusz tag (pl. középső név, kettős vezetéknév egyik
 * fele) megengedett — a lényeg, hogy a rövidebb név MINDEN tagja szerepeljen
 * a másikban.
 */
function holderNameMatches(docName, accountName) {
  const doc = nameTokens(docName);
  const acc = nameTokens(accountName);
  if (doc.size === 0 || acc.size === 0) return false;
  const [small, big] = doc.size <= acc.size ? [doc, acc] : [acc, doc];
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

/**
 * @param {object} aiResult — a verifyKycDocument kimenete
 * @param {object} account — { fullName }
 * @param {string} docType — 'id_card' | 'drivers_license' | ...
 * @returns {{code: string, reason: string}|null} null = mehet az auto-approve
 */
function needsManualReview(aiResult, account = {}, docType = 'id_card') {
  if (aiResult.likelyCopy) {
    return {
      code: 'LIKELY_COPY',
      reason: 'A feltöltött kép másolatnak/képernyőfotónak tűnik. Kollégánk ellenőrzi — ha az eredeti okmányról készült fotót töltesz fel, gyorsabban végzünk.',
    };
  }
  if ((aiResult.confidence || 0) < AUTO_APPROVE_MIN_CONFIDENCE) {
    return {
      code: 'LOW_CONFIDENCE',
      reason: 'A dokumentumot nem tudtuk teljes biztonsággal ellenőrizni — kollégánk kézzel nézi át. Ez általában néhány órán belül megtörténik.',
    };
  }
  // Az okmányszám a duplikátum-védelem alapja — csak a személyazonosító
  // okmányoknál kérjük számon (céges iratnál nincs értelme).
  if (['id_card', 'drivers_license'].includes(docType) && !aiResult.documentNumber) {
    return {
      code: 'NO_DOC_NUMBER',
      reason: 'Az okmány azonosítója nem olvasható ki a képről — kollégánk kézzel ellenőrzi. Élesebb, teljes okmányt mutató fotóval gyorsabb.',
    };
  }
  if (docType === 'id_card' && !holderNameMatches(aiResult.holderName, account.fullName)) {
    return {
      code: 'NAME_MISMATCH',
      reason: 'Az okmányon szereplő név eltér a fiókban megadottól — kollégánk ellenőrzi. Ha elírás történt, javítsd a profilodban a teljes neved.',
    };
  }
  return null;
}

module.exports = {
  AUTO_APPROVE_MIN_CONFIDENCE,
  needsManualReview,
  holderNameMatches,
  nameTokens,
};
