// GoFuvar VAT Engine — európai ÁFA logika.
//
// A platform (GoFuvar Kft., HU székhelyű) a 10%-os jutalékról
// állít ki számlát a SOFŐRNEK. Az adólogika a sofőr státuszától
// és országától függ:
//
// ┌─────────────────────┬─────────────────────┬────────────────────────┐
// │ Sofőr típusa        │ Ország              │ ÁFA kezelés            │
// ├─────────────────────┼─────────────────────┼────────────────────────┤
// │ Magánszemély        │ HU                  │ 27% HU ÁFA             │
// │ Cég + HU adószám    │ HU                  │ 27% HU ÁFA             │
// │ Cég + EU VAT ID     │ EU (nem HU)         │ 0% fordított adózás    │
// │ Magánszemély        │ EU (nem HU)         │ 27% HU ÁFA (B2C rule) │
// │ Cég (nem EU)        │ 3rd country         │ 0% ÁFA-mentes export  │
// └─────────────────────┴─────────────────────┴────────────────────────┘
//
// EU VIES validáció: az EU-s adószámot a VIES API-n ellenőrizzük,
// mert a fordított adózáshoz ÉRVÉNYES közösségi adószám kell.

const VIES_API = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';

// EU tagállamok + standard ÁFA kulcsok (2025-ös állapot)
const EU_VAT_RATES = {
  AT: 20, BE: 21, BG: 20, HR: 25, CY: 19, CZ: 21,
  DK: 25, EE: 22, FI: 24, FR: 20, DE: 19, GR: 24,
  HU: 27, IE: 23, IT: 22, LV: 21, LT: 21, LU: 17,
  MT: 18, NL: 21, PL: 23, PT: 23, RO: 19, SK: 20,
  SI: 22, ES: 21, SE: 25,
};

const PLATFORM_COUNTRY = 'HU';
const PLATFORM_VAT_RATE = 27; // százalék

/**
 * EU VIES adószám validáció.
 * @param {string} countryCode - 2 betűs ISO kód (pl. 'DE')
 * @param {string} vatNumber - az adószám az országkód NÉLKÜL
 * @returns {Promise<{valid: boolean, name?: string, address?: string}>}
 */
async function validateVatId(countryCode, vatNumber) {
  try {
    const res = await fetch(
      `${VIES_API}/${countryCode.toUpperCase()}/vat/${encodeURIComponent(vatNumber)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { valid: false, error: `VIES HTTP ${res.status}` };
    const data = await res.json();
    return {
      valid: data.isValid === true,
      name: data.name || null,
      address: data.address || null,
    };
  } catch (err) {
    console.warn('[vat] VIES validáció hiba:', err.message);
    // VIES nem elérhető → biztonsági okokból NEM engedélyezzük a
    // fordított adózást, a 27% HU ÁFA-t alkalmazzuk.
    return { valid: false, error: err.message };
  }
}

/**
 * Adószám parsing: "DE123456789" → { country: 'DE', number: '123456789' }
 */
function parseTaxId(taxId) {
  if (!taxId || taxId.length < 4) return null;
  const clean = taxId.replace(/[\s.-]/g, '').toUpperCase();
  const country = clean.substring(0, 2);
  const number = clean.substring(2);
  if (!number) return null;
  return { country, number, full: `${country}${number}` };
}

/**
 * A fő ÁFA-meghatározó logika.
 *
 * @param {object} params
 * @param {string} params.buyerCountry    – a sofőr országa ('HU', 'DE', stb.)
 * @param {string|null} params.buyerTaxId – az adószám (pl. 'DE123456789') vagy null
 * @param {boolean} params.buyerIsCompany – cég-e (true) vagy magánszemély (false)
 * @param {number} params.amount          – a nettó összeg (platform jutalék)
 * @param {string} params.currency        – 'HUF' | 'EUR'
 *
 * @returns {Promise<{
 *   vatRate: number,          – 0.27 | 0 | 0.19 stb.
 *   vatAmount: number,        – az ÁFA összege
 *   grossAmount: number,      – bruttó (nettó + ÁFA)
 *   netAmount: number,        – nettó (a platform jutalék)
 *   isReverseCharge: boolean, – fordított adózás-e
 *   vatCountry: string,       – melyik ország ÁFA szabálya érvényes
 *   legalNote: string,        – a kötelező jogi szöveg a számlán
 *   legalNoteEn: string,      – angol verzió
 *   viesValidation?: object   – a VIES ellenőrzés eredménye (ha volt)
 * }>}
 */
async function computeVat({ buyerCountry, buyerTaxId, buyerIsCompany, amount, currency }) {
  const net = Math.round(amount);
  const country = (buyerCountry || PLATFORM_COUNTRY).toUpperCase();
  const isEU = country in EU_VAT_RATES;
  const isDomestic = country === PLATFORM_COUNTRY;

  // 1) Belföldi (HU) tranzakció → mindig 27% HU ÁFA
  if (isDomestic) {
    const vatAmount = Math.round(net * PLATFORM_VAT_RATE / 100);
    return {
      vatRate: PLATFORM_VAT_RATE / 100,
      vatAmount,
      grossAmount: net + vatAmount,
      netAmount: net,
      isReverseCharge: false,
      vatCountry: 'HU',
      legalNote: 'Az ÁFA a magyar adójog szerint kerül felszámításra (27%).',
      legalNoteEn: 'VAT charged according to Hungarian tax law (27%).',
    };
  }

  // 2) EU-s CÉG érvényes adószámmal → fordított adózás (0%)
  if (isEU && buyerIsCompany && buyerTaxId) {
    const parsed = parseTaxId(buyerTaxId);
    if (parsed) {
      const vies = await validateVatId(parsed.country, parsed.number);
      if (vies.valid) {
        return {
          vatRate: 0,
          vatAmount: 0,
          grossAmount: net,
          netAmount: net,
          isReverseCharge: true,
          vatCountry: country,
          legalNote: `Közösségen belüli szolgáltatás – fordított adózás (reverse charge). Vevő adószáma: ${parsed.full}`,
          legalNoteEn: `Intra-community service – reverse charge mechanism applies. Buyer VAT ID: ${parsed.full}`,
          viesValidation: vies,
        };
      }
      // VIES nem validálja → fallback 27% HU ÁFA
      console.warn(`[vat] VIES nem validálja: ${parsed.full} → HU ÁFA alkalmazva`);
    }
  }

  // 3) EU-s MAGÁNSZEMÉLY → HU ÁFA (a platform székhelye szerint)
  //    (B2C digitális szolgáltatásoknál az ügyfél országának ÁFA-ja lenne,
  //    de a fuvarszervezés nem digitális szolgáltatás, hanem közvetítés,
  //    így a szolgáltató székhelye szerinti ÁFA érvényes — 27% HU)
  if (isEU && !buyerIsCompany) {
    const vatAmount = Math.round(net * PLATFORM_VAT_RATE / 100);
    return {
      vatRate: PLATFORM_VAT_RATE / 100,
      vatAmount,
      grossAmount: net + vatAmount,
      netAmount: net,
      isReverseCharge: false,
      vatCountry: 'HU',
      legalNote: `ÁFA a szolgáltató (GoFuvar Kft.) székhelye szerint: ${PLATFORM_VAT_RATE}% HU ÁFA.`,
      legalNoteEn: `VAT applied per supplier (GoFuvar Kft.) registered office: ${PLATFORM_VAT_RATE}% HU VAT.`,
    };
  }

  // 4) Nem EU-s ország → ÁFA-mentes export szolgáltatás
  if (!isEU) {
    return {
      vatRate: 0,
      vatAmount: 0,
      grossAmount: net,
      netAmount: net,
      isReverseCharge: false,
      vatCountry: country,
      legalNote: 'Közösségen kívüli szolgáltatás – ÁFA-mentes (Áfa tv. 37.§).',
      legalNoteEn: 'Service supplied outside the EU – VAT exempt.',
    };
  }

  // Fallback: 27% HU ÁFA (biztonsági háló)
  const vatAmount = Math.round(net * PLATFORM_VAT_RATE / 100);
  return {
    vatRate: PLATFORM_VAT_RATE / 100,
    vatAmount,
    grossAmount: net + vatAmount,
    netAmount: net,
    isReverseCharge: false,
    vatCountry: 'HU',
    legalNote: `ÁFA: ${PLATFORM_VAT_RATE}% (HU).`,
    legalNoteEn: `VAT: ${PLATFORM_VAT_RATE}% (HU).`,
  };
}

module.exports = {
  computeVat,
  validateVatId,
  parseTaxId,
  EU_VAT_RATES,
  PLATFORM_COUNTRY,
  PLATFORM_VAT_RATE,
};
