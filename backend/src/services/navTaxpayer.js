// NAV Online Számla 3.0 — queryTaxpayer ("Ellenőrzött cég" jelvény).
//
// A céges fiók adószámát a NAV publikus adóalany-lekérdezőjével ellenőrizzük:
// létezik-e, érvényes-e (aktív), és mi a hivatalos cégnév. Ha az adószám
// érvényes ÉS a user által megadott cégnév egyezik a NAV szerinti névvel,
// a company_verification_status automatikusan 'verified' lesz → a felületen
// megjelenik az "Ellenőrzött cég" jelvény. Név-eltérésnél a státusz 'pending'
// marad (az admin a NAV-ból mentett hivatalos név alapján kézzel dönthet —
// így a MÁS cégének érvényes adószámával való visszaélés kizárt).
//
// A TELJES API-hívás implementálva van — élesítéshez CSAK a NAV technikai
// felhasználó hiányzik. Aktiválás (Railway env):
//   NAV_ONLINE_LOGIN      — technikai felhasználó login neve
//   NAV_ONLINE_PASSWORD   — technikai felhasználó jelszava
//   NAV_ONLINE_SIGNKEY    — aláírókulcs (XML aláíráskulcsa)
//   NAV_ONLINE_TAXNUMBER  — a SAJÁT (Tiszta Hód) adószám első 8 jegye: 24750792
// Opcionális:
//   NAV_ONLINE_BASE_URL   — default a NAV éles: https://api.onlineszamla.nav.gov.hu/invoiceService/v3
//                           (teszt-környezet: https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3)
//   NAV_SOFTWARE_ID       — 18 karakteres szoftver-azonosító (default: HU24750792GOFUVAR1)
//
// Technikai felhasználó igénylése (user-teendő, ~10 perc):
//   Online Számla portál (onlineszamla.nav.gov.hu) → cég regisztrálása
//   (ügyfélkapus azonosítással az ügyvezető) → Felhasználók → Új technikai
//   felhasználó → jogosultság: "Számlák lekérdezése" elég → a generált
//   login/jelszó/aláírókulcs megy a fenti env-ekbe.
//
// A queryTaxpayer díjmentes; a NAV-oldali limit miatt a hívásokat
// rate-limiteljük és csak cégadat-változáskor / kézi gombra futtatjuk.

const crypto = require('crypto');
const db = require('../db');

const DEFAULT_BASE_URL = 'https://api.onlineszamla.nav.gov.hu/invoiceService/v3';

function isConfigured() {
  return Boolean(
    process.env.NAV_ONLINE_LOGIN
    && process.env.NAV_ONLINE_PASSWORD
    && process.env.NAV_ONLINE_SIGNKEY
    && process.env.NAV_ONLINE_TAXNUMBER,
  );
}

// A NAV kérés-azonosítója: [+a-zA-Z0-9_]{1,30}, kérésenként egyedi.
function makeRequestId() {
  return `GF${Date.now()}${crypto.randomBytes(6).toString('hex')}`.slice(0, 30);
}

// A requestSignature időbélyeg-maszkja: UTC "yyyyMMddHHmmss" (elválasztók
// és ezredmásodperc nélkül) — a headerbe viszont a teljes ISO-időbélyeg megy.
function timestampMask(isoTimestamp) {
  return isoTimestamp.replace(/[-:TZ]/g, '').slice(0, 14);
}

// SHA3-512(requestId + időbélyeg-maszk + aláírókulcs), NAGYBETŰS hex.
function computeRequestSignature(requestId, isoTimestamp, signKey) {
  return crypto
    .createHash('sha3-512')
    .update(requestId + timestampMask(isoTimestamp) + signKey)
    .digest('hex')
    .toUpperCase();
}

// SHA-512(jelszó), NAGYBETŰS hex.
function computePasswordHash(password) {
  return crypto.createHash('sha512').update(password).digest('hex').toUpperCase();
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// A queryTaxpayer kérés XML-je (BasicOnlineInvoiceRequestType).
function buildQueryTaxpayerXml({ taxNumber8, requestId, timestamp }) {
  const login = process.env.NAV_ONLINE_LOGIN;
  const passwordHash = computePasswordHash(process.env.NAV_ONLINE_PASSWORD);
  const ownTaxNumber = process.env.NAV_ONLINE_TAXNUMBER;
  const signature = computeRequestSignature(requestId, timestamp, process.env.NAV_ONLINE_SIGNKEY);
  const softwareId = process.env.NAV_SOFTWARE_ID || 'HU24750792GOFUVAR1';

  return `<?xml version="1.0" encoding="UTF-8"?>
<QueryTaxpayerRequest xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
  <common:header>
    <common:requestId>${xmlEscape(requestId)}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>3.0</common:requestVersion>
    <common:headerVersion>1.0</common:headerVersion>
  </common:header>
  <common:user>
    <common:login>${xmlEscape(login)}</common:login>
    <common:passwordHash cryptoType="SHA-512">${passwordHash}</common:passwordHash>
    <common:taxNumber>${xmlEscape(ownTaxNumber)}</common:taxNumber>
    <common:requestSignature cryptoType="SHA3-512">${signature}</common:requestSignature>
  </common:user>
  <software>
    <softwareId>${xmlEscape(softwareId)}</softwareId>
    <softwareName>GoFuvar</softwareName>
    <softwareOperation>ONLINE_SERVICE</softwareOperation>
    <softwareMainVersion>1.0</softwareMainVersion>
    <softwareDevName>Tiszta Hod Kft.</softwareDevName>
    <softwareDevContact>info@gofuvar.hu</softwareDevContact>
    <softwareDevCountryCode>HU</softwareDevCountryCode>
    <softwareDevTaxNumber>24750792</softwareDevTaxNumber>
  </software>
  <taxNumber>${xmlEscape(taxNumber8)}</taxNumber>
</QueryTaxpayerRequest>`;
}

// Minimális, függőség-mentes XML-kiolvasás: a NAV válasz-namespace prefixei
// telepítésenként változnak (ns2:, ns3:, …), ezért lokális elemnévre illesztünk.
function extractTag(xml, localName) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${localName}>([\\s\\S]*?)</(?:\\w+:)?${localName}>`));
  return m ? m[1].trim() : null;
}

/**
 * Adóalany-lekérdezés a NAV-tól. A taxNumber az adószám első 8 jegye.
 * @returns {Promise<{found: boolean, valid: boolean, name: string|null, shortName: string|null}>}
 * Hibánál (hálózat / NAV-hiba / hibás credential) Error-t dob.
 */
async function queryTaxpayer(taxNumber8) {
  if (!isConfigured()) throw new Error('NAV Online Számla nincs konfigurálva');
  if (!/^\d{8}$/.test(String(taxNumber8))) throw new Error('Érvénytelen adószám-törzsszám (8 számjegy kell)');

  const baseUrl = process.env.NAV_ONLINE_BASE_URL || DEFAULT_BASE_URL;
  const requestId = makeRequestId();
  const timestamp = new Date().toISOString();
  const body = buildQueryTaxpayerXml({ taxNumber8: String(taxNumber8), requestId, timestamp });

  const res = await fetch(`${baseUrl}/queryTaxpayer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const xml = await res.text();

  if (!res.ok) {
    const errorCode = extractTag(xml, 'errorCode') || `HTTP ${res.status}`;
    const message = extractTag(xml, 'message') || '';
    throw new Error(`NAV queryTaxpayer hiba: ${errorCode} ${message}`.trim());
  }

  const funcCode = extractTag(xml, 'funcCode');
  if (funcCode !== 'OK') {
    throw new Error(`NAV queryTaxpayer funcCode=${funcCode || 'ismeretlen'}`);
  }

  // Ha az adószám nem létezik, a válaszban nincs taxpayerValidity.
  const validity = extractTag(xml, 'taxpayerValidity');
  if (validity === null) {
    return { found: false, valid: false, name: null, shortName: null };
  }
  return {
    found: true,
    valid: validity === 'true',
    name: extractTag(xml, 'taxpayerName'),
    shortName: extractTag(xml, 'taxpayerShortName'),
  };
}

// ---------------------------------------------------------------------------
// Cégnév-egyeztetés
// ---------------------------------------------------------------------------

// Cégforma-rövidítések: a hosszú alakot ékezet-mentesített, kisbetűs formában
// keressük (a normalizálás UTÁN futnak a cserék), leghosszabb előbb.
const LEGAL_FORMS = [
  ['zartkoruen mukodo reszvenytarsasag', 'zrt'],
  ['nyilvanosan mukodo reszvenytarsasag', 'nyrt'],
  ['korlatolt felelossegu tarsasag', 'kft'],
  ['kozkereseti tarsasag', 'kkt'],
  ['reszvenytarsasag', 'rt'],
  ['beteti tarsasag', 'bt'],
  ['egyeni vallalkozo', 'ev'],
  ['egyeni ceg', 'ec'],
];

// Kisbetű + ékezet-mentesítés + írásjelek ki + cégforma egységesítve.
function normalizeCompanyName(raw) {
  if (!raw) return '';
  let s = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // ékezetek (kombináló jelek) le
    .replace(/[^a-z0-9 ]+/g, ' ')    // írásjelek → szóköz
    .replace(/\s+/g, ' ')
    .trim();
  for (const [long, short] of LEGAL_FORMS) {
    s = s.replaceAll(long, short);
  }
  return s;
}

// A megkülönböztető név (cégforma-szó nélkül) egyezik-e. "Tiszta Hód Kft."
// vs "TISZTA HÓD KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG" → mindkettő "tiszta hod".
const FORM_WORDS = new Set(LEGAL_FORMS.map(([, short]) => short));
function distinctivePart(raw) {
  return normalizeCompanyName(raw)
    .split(' ')
    .filter((w) => !FORM_WORDS.has(w))
    .join(' ');
}

function companyNamesMatch(userName, navName, navShortName) {
  const user = distinctivePart(userName);
  if (user.length < 3) return false;
  return [navName, navShortName].some((candidate) => {
    const nav = distinctivePart(candidate);
    if (nav.length < 3) return false;
    return nav === user || nav.includes(user) || user.includes(nav);
  });
}

// ---------------------------------------------------------------------------
// Orkesztráció: egy user cég-ellenőrzésének teljes lefuttatása
// ---------------------------------------------------------------------------

/**
 * Lefuttatja a NAV-ellenőrzést egy userre és beírja az eredményt.
 * Sosem dob — az eredményt status-szal adja vissza:
 *   verified       — adószám érvényes + cégnév egyezik → jelvény jár
 *   name_mismatch  — adószám érvényes, de a cégnév eltér (admin dönthet)
 *   invalid        — az adószám nem létezik / nem érvényes a NAV szerint
 *   not_company    — nem céges fiók
 *   no_tax_id      — nincs adószám megadva
 *   not_configured — a NAV-integráció még nincs élesítve
 *   error          — hálózati / NAV-oldali hiba (később újrapróbálható)
 */
async function verifyCompanyUser(userId) {
  try {
    const { rows } = await db.query(
      `SELECT account_type, tax_id, company_name, company_verification_status
         FROM users WHERE id = $1`,
      [userId],
    );
    const user = rows[0];
    if (!user) return { status: 'error', message: 'Felhasználó nem található' };
    if (user.account_type !== 'company') return { status: 'not_company' };
    if (!user.tax_id) return { status: 'no_tax_id' };
    if (!isConfigured()) return { status: 'not_configured' };

    const taxNumber8 = String(user.tax_id).replace(/\D/g, '').slice(0, 8);
    const result = await queryTaxpayer(taxNumber8);

    const navName = result.name || result.shortName || null;
    if (!result.found || !result.valid) {
      // Érvénytelen adószám: a jelvényt nem adjuk meg, de nem is "rejected"-elünk
      // gépi úton — a státusz marad, az admin a naplózott eredmény alapján dönthet.
      await db.query(
        `UPDATE users SET nav_taxpayer_checked_at = NOW(), nav_taxpayer_valid = FALSE,
                          nav_taxpayer_name = $2
          WHERE id = $1`,
        [userId, navName],
      );
      return { status: 'invalid', nav_name: navName };
    }

    const matched = companyNamesMatch(user.company_name, result.name, result.shortName);
    await db.query(
      `UPDATE users SET nav_taxpayer_checked_at = NOW(), nav_taxpayer_valid = TRUE,
                        nav_taxpayer_name = $2
                        ${matched ? `, company_verification_status = 'verified'` : ''}
        WHERE id = $1`,
      [userId, navName],
    );
    if (matched) return { status: 'verified', nav_name: navName };
    return { status: 'name_mismatch', nav_name: navName };
  } catch (e) {
    console.warn(`[nav] cég-ellenőrzés hiba (user ${userId}):`, e.message);
    return { status: 'error', message: e.message };
  }
}

module.exports = {
  isConfigured,
  queryTaxpayer,
  verifyCompanyUser,
  // tesztekhez / belső használatra:
  buildQueryTaxpayerXml,
  computeRequestSignature,
  computePasswordHash,
  timestampMask,
  normalizeCompanyName,
  companyNamesMatch,
  extractTag,
};
