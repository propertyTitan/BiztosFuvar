// Naplózáshoz: érzékeny adatok maszkolása. A szerverlogba (Railway) SOHA ne
// kerüljön teljes e-mail, telefonszám, vagy átvételi kód.

function maskEmail(e) {
  if (!e || typeof e !== 'string' || !e.includes('@')) return '***';
  const [user, domain] = e.split('@');
  return `${(user[0] || '')}***@${domain}`;
}

/**
 * SZÖVEGBEN álló e-mail-címek és telefonszámok maszkolása.
 *
 * ⚠️ A `maskEmail` EGYETLEN címre való: ha egy JSON-törzset adnánk át neki,
 * az első '@'-nál elvágná, és a diagnosztika elveszne (miközben egy második
 * cím bennmaradhatna). Külső API hibaválaszához ez kell — a Resend például
 * VISSZHANGOZZA a címzettet a 4xx-válaszaiban, és az így maszkolatlanul
 * került a Railway-logba (2026-08-11, adatáramlási audit).
 */
const SZOVEG_EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SZOVEG_TEL_RE = /(?:\+\d[\d\s\-/().]{7,18}\d|\b06[\s\-/]?\d{1,2}[\s\-/]?\d{3}[\s\-/]?\d{3,4}\b)/g;
function maskInText(szoveg) {
  if (!szoveg || typeof szoveg !== 'string') return szoveg;
  return szoveg.replace(SZOVEG_EMAIL_RE, '***@***').replace(SZOVEG_TEL_RE, '***');
}

function maskPhone(p) {
  if (!p) return '***';
  const s = String(p).replace(/\D/g, '');
  return s.length >= 4 ? `***${s.slice(-4)}` : '***';
}

module.exports = { maskEmail, maskPhone, maskInText };
