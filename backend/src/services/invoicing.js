// GoFuvar számlagenerálás — Számlázz.hu / Billingo API wrapper.
//
// A fuvar kézbesítésekor a platform 10% jutalékáról automatikusan
// generálódik egy számla. A számla:
//   - Kétnyelvű (HU + a sofőr nyelve, vagy EN fallback)
//   - A VAT engine által meghatározott adómértékkel
//   - A kötelező jogi szövegekkel (reverse charge, ÁFA tv. hivatkozás)
//   - STUB módban: konzolra logolja és PDF helyett NULL-t ad vissza
//
// Konfigurálás .env-ben:
//   INVOICE_PROVIDER=szamlazz_hu | billingo | stub
//   SZAMLAZZ_AGENT_KEY=...
//   BILLINGO_API_KEY=...

const { computeVat } = require('./vat');
const db = require('../db');

function getProvider() {
  return process.env.INVOICE_PROVIDER || 'stub';
}

/**
 * A számla adatszerkezete — provider-független.
 */
function buildInvoiceData({
  jobId, bookingId, currency, platformFee,
  vatResult, carrierUser, locale,
}) {
  const lang = locale === 'hu' ? 'hu' : 'en';
  const otherLang = lang === 'hu' ? 'en' : 'hu';

  // Kötelező jogi szövegek
  const legalTexts = [];
  if (vatResult.isReverseCharge) {
    legalTexts.push('Fordított adózás / Reverse charge mechanism applies (Art. 196, Council Directive 2006/112/EC)');
  }
  if (vatResult.vatCountry === 'HU' && vatResult.vatRate > 0) {
    legalTexts.push(`ÁFA: ${Math.round(vatResult.vatRate * 100)}% (Áfa tv. 37.§) / VAT: ${Math.round(vatResult.vatRate * 100)}% (Hungarian VAT Act §37)`);
  }
  if (vatResult.vatRate === 0 && !vatResult.isReverseCharge) {
    legalTexts.push('ÁFA-mentes szolgáltatás / VAT exempt service');
  }

  return {
    // Kibocsátó (mindig GoFuvar)
    seller: {
      name: 'GoFuvar Kft.',
      taxId: process.env.COMPANY_TAX_ID || '12345678-2-42',
      address: process.env.COMPANY_ADDRESS || '1234 Budapest, Példa utca 1.',
      bankAccount: process.env.COMPANY_BANK_ACCOUNT || 'HU12 1234 5678 9012 3456 7890 0000',
    },
    // Vevő (a sofőr)
    buyer: {
      name: carrierUser.company_name || carrierUser.full_name,
      taxId: carrierUser.tax_id || null,
      address: carrierUser.billing_address || '—',
      country: carrierUser.billing_country || 'HU',
    },
    // Tételek
    items: [
      {
        name_hu: 'Platform közvetítői díj – GoFuvar',
        name_en: 'Platform brokerage fee – GoFuvar',
        name: lang === 'hu' ? 'Platform közvetítői díj – GoFuvar' : 'Platform brokerage fee – GoFuvar',
        quantity: 1,
        unit: lang === 'hu' ? 'db' : 'pcs',
        unitPrice: vatResult.netAmount,
        vatRate: `${Math.round(vatResult.vatRate * 100)}%`,
        vatAmount: vatResult.vatAmount,
        grossAmount: vatResult.grossAmount,
      },
    ],
    // Összesítő
    currency,
    netTotal: vatResult.netAmount,
    vatTotal: vatResult.vatAmount,
    grossTotal: vatResult.grossAmount,
    // Nyelv + jogi
    language: lang,
    bilingual: true,
    legalTexts,
    isReverseCharge: vatResult.isReverseCharge,
    // Hivatkozás
    jobId: jobId || null,
    bookingId: bookingId || null,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10), // +8 nap
    paymentMethod: 'Barion online fizetés / Barion online payment',
  };
}

/**
 * Számla generálása a platform jutalékról.
 *
 * @param {object} params
 * @param {string} [params.jobId]
 * @param {string} [params.bookingId]
 * @param {number} params.platformFee – a nettó jutalék összeg
 * @param {string} params.currency – 'HUF' | 'EUR'
 * @param {string} params.carrierId – a sofőr user ID-je
 */
async function generatePlatformFeeInvoice({ jobId, bookingId, platformFee, currency, carrierId }) {
  // Sofőr adatainak lekérdezése
  const { rows: userRows } = await db.query(
    `SELECT id, full_name, company_name, tax_id, billing_address, billing_country, locale
       FROM users WHERE id = $1`,
    [carrierId],
  );
  const carrierUser = userRows[0];
  if (!carrierUser) {
    console.error('[invoicing] Sofőr nem található:', carrierId);
    return null;
  }

  // VAT kiszámítása
  const vatResult = await computeVat({
    buyerCountry: carrierUser.billing_country || 'HU',
    buyerTaxId: carrierUser.tax_id,
    buyerIsCompany: !!(carrierUser.company_name || carrierUser.tax_id),
    amount: platformFee,
    currency,
  });

  // Számla adat összeállítása
  const invoiceData = buildInvoiceData({
    jobId, bookingId, currency, platformFee,
    vatResult, carrierUser,
    locale: carrierUser.locale || 'hu',
  });

  const provider = getProvider();

  // === STUB MÓD ===
  if (provider === 'stub') {
    console.log('[invoicing STUB] Számla generálva:');
    console.log(`  Vevő: ${invoiceData.buyer.name} (${invoiceData.buyer.country})`);
    console.log(`  Nettó: ${vatResult.netAmount} ${currency}`);
    console.log(`  ÁFA: ${vatResult.vatAmount} ${currency} (${Math.round(vatResult.vatRate * 100)}%)`);
    console.log(`  Bruttó: ${vatResult.grossAmount} ${currency}`);
    console.log(`  Reverse charge: ${vatResult.isReverseCharge}`);
    console.log(`  Jogi: ${invoiceData.legalTexts.join(' | ')}`);

    // DB mentés
    const { rows: inv } = await db.query(
      `INSERT INTO invoices (
         job_id, booking_id, buyer_user_id, buyer_name, buyer_tax_id,
         buyer_address, buyer_country, currency, net_amount, vat_rate,
         vat_amount, gross_amount, is_reverse_charge, external_system,
         status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'stub','sent')
       RETURNING *`,
      [
        jobId || null, bookingId || null, carrierId,
        invoiceData.buyer.name, invoiceData.buyer.taxId,
        invoiceData.buyer.address, invoiceData.buyer.country,
        currency, vatResult.netAmount, vatResult.vatRate,
        vatResult.vatAmount, vatResult.grossAmount, vatResult.isReverseCharge,
      ],
    );
    return inv[0];
  }

  // === SZÁMLÁZZ.HU ===
  if (provider === 'szamlazz_hu') {
    // TODO: Számlázz.hu Agent XML API hívás
    // https://docs.szamlazz.hu/
    console.log('[invoicing] Számlázz.hu integráció hamarosan...');
    return null;
  }

  // === BILLINGO ===
  if (provider === 'billingo') {
    // TODO: Billingo REST API hívás
    // https://app.billingo.hu/api-docs
    console.log('[invoicing] Billingo integráció hamarosan...');
    return null;
  }

  return null;
}

module.exports = {
  generatePlatformFeeInvoice,
  buildInvoiceData,
};
