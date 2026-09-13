// =====================================================================
//  ÜTEMEZETT KÖRÖK KÖZÖS BURKOLÓJA (2026-09-13, teljes audit D4)
//
//  Az index.js mind a hét napi/órás kört `.catch(() => {})`-tal hívta: ami
//  a körön BELÜL nem riasztott (a KYC-fotó törlés, a fizetési emlékeztető,
//  a nudge, a DAC7, az azonnali-lejárat), annak a hibája SEHOVA nem jutott
//  el — egy átnevezett oszlop vagy egy migráció-késés mellett a kör naponta
//  elhasalt, és hetekig senki nem tudta. (A Railway-logot senki nem nézi
//  naponta — a projekt saját megállapítása.)
//
//  A burkoló: try/catch + Sentry captureException (a kör neve tag-ként) +
//  átfedés-őr (ha az előző futás még tart — pl. egy elakadt külső hívás
//  miatt —, a következő tick kihagy, nem indít második, párhuzamos futást).
// =====================================================================
const futasban = new Set();

function sentry() {
  try { return require('@sentry/node'); } catch { return null; }
}

/**
 * @param {string} nev — a kör neve (a riasztás tag-je és a log-előtag)
 * @param {() => Promise<any>} fn — maga a kör
 * @returns {() => Promise<any>} soha nem dob; hibánál null
 */
function utemezettKor(nev, fn) {
  return async function futtat() {
    if (futasban.has(nev)) {
      console.warn(`[utemezo] ${nev}: az előző futás még tart — ez a tick kimarad`);
      return null;
    }
    futasban.add(nev);
    try {
      return await fn();
    } catch (err) {
      console.error(`[utemezo] ${nev} hiba:`, err && err.message);
      try {
        sentry()?.captureException(err, { tags: { csatorna: 'utemezo', kor: nev } });
      } catch { /* a riasztás hibája nem érintheti a kört */ }
      return null;
    } finally {
      futasban.delete(nev);
    }
  };
}

/**
 * Soronkénti hibák jelzése: a kör folytatja a többi sort, de a végén
 * riaszt, hogy hány sor hibázott (az első hiba üzenetével, PII nélkül).
 */
function jelezSorHibak(nev, hibak) {
  if (!hibak || hibak.length === 0) return;
  const elso = hibak[0];
  const uzenet = `[${nev}] ${hibak.length} sor hibázott a körben (első: ${String(elso && elso.message).slice(0, 200)})`;
  console.error(uzenet);
  try {
    sentry()?.captureMessage(uzenet, { level: 'error', tags: { csatorna: 'utemezo', kor: nev } });
  } catch { /* no-op */ }
}

module.exports = { utemezettKor, jelezSorHibak, __futasbanForTests: futasban };
