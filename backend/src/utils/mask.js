// Naplózáshoz: érzékeny adatok maszkolása. A szerverlogba (Railway) SOHA ne
// kerüljön teljes e-mail, telefonszám, vagy átvételi kód.

function maskEmail(e) {
  if (!e || typeof e !== 'string' || !e.includes('@')) return '***';
  const [user, domain] = e.split('@');
  return `${(user[0] || '')}***@${domain}`;
}

function maskPhone(p) {
  if (!p) return '***';
  const s = String(p).replace(/\D/g, '');
  return s.length >= 4 ? `***${s.slice(-4)}` : '***';
}

module.exports = { maskEmail, maskPhone };
