// =====================================================================
//  Ismert termék-boltok (a „Hozasd el" flow) — KÖZÖS allowlist
//
//  Két fogyasztó:
//   - routes/linkPreview.js: CSAK ezekről a hosztokról töltünk le
//     Open Graph előnézetet (SSRF-védelem);
//   - utils/contactGuard.js (2026-09-13, D1): a kontakt-szűrő link-mintája
//     ezeket a domaineket NEM tekinti platformon kívüli csatornának — a
//     feladás leírásába a flow maga írja be a termék linkjét
//     („Forrás (IKEA): https://www.ikea.com/…"), és a 05-ös E2E ezt fogta
//     meg, amikor a szűrő minden URL-t blokkolt.
//  Új bolt: IDE vedd fel, mindkét helyen érvényes lesz.
// =====================================================================
const ALLOWED_HOSTS = new Set([
  // Apróhirdetés
  'jofogas.hu', 'www.jofogas.hu',
  // Bútor / barkács áruházak
  'ikea.com', 'www.ikea.com',
  'obi.hu', 'www.obi.hu',
  'praktiker.hu', 'www.praktiker.hu',
]);

/** Pontos hoszt-egyezés (a „ikea.com.csalo.hu" NEM ismert bolt). */
function ismertBoltHost(host) {
  return ALLOWED_HOSTS.has(String(host || '').toLowerCase().replace(/\.$/, ''));
}

/** URL-szerű szöveg (séma nélkül is) → ismert bolt-e a hosztja. */
function ismertBoltUrl(szoveg) {
  try {
    const tiszta = String(szoveg).replace(/[.,;:!?)\]]+$/, '');
    const u = new URL(/^https?:\/\//i.test(tiszta) ? tiszta : `https://${tiszta}`);
    return ismertBoltHost(u.hostname);
  } catch {
    return false;
  }
}

module.exports = { ALLOWED_HOSTS, ismertBoltHost, ismertBoltUrl };
