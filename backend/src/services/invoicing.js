// GoFuvar számlagenerálás — Számlázz.hu / Billingo API wrapper.
//
// A kapcsolatfelvételi díj megfizetésekor automatikusan generálódik egy
// számla a díjat fizető FELADÓ részére (készpénzes modell, 2026-07-03 —
// a fuvardíj maga a feladó és a szállító közt mozog, arról a platform nem
// számláz). A számla:
//   - A VAT engine által meghatározott adómértékkel — a díj BRUTTÓ árként
//     kezelve (amountIsGross), így a számla végösszege PONTOSAN a terhelt
//     500/1000 Ft
//   - A kötelező jogi szövegekkel (reverse charge, ÁFA tv. hivatkozás)
//   - STUB módban: konzolra logolja + DB-be menti (external_system='stub')
//
// ÉLES PROVIDER: Számlázz.hu (services/szamlazzHu.js — a teljes Agent API
// implementálva, élesítéshez csak a kulcs kell):
//   INVOICE_PROVIDER=szamlazz_hu
//   SZAMLAZZ_AGENT_KEY=<Számla Agent kulcs>
// A Billingo-ág placeholder maradt (nem terv).

const { computeVat } = require('./vat');
const szamlazzHu = require('./szamlazzHu');
const db = require('../db');

function getProvider() {
  return process.env.INVOICE_PROVIDER || 'stub';
}

/**
 * A számla adatszerkezete — provider-független.
 */
function buildInvoiceData({
  jobId, bookingId, currency, platformFee,
  vatResult, buyerUser, locale,
}) {
  const lang = locale === 'hu' ? 'hu' : 'en';
  const otherLang = lang === 'hu' ? 'en' : 'hu';

  // Kötelező jogi szövegek
  const legalTexts = [];
  if (vatResult.isReverseCharge) {
    legalTexts.push('Fordított adózás / Reverse charge mechanism applies (Art. 196, Council Directive 2006/112/EC)');
  }
  if (vatResult.vatCountry === 'HU' && vatResult.vatRate > 0) {
    legalTexts.push(`ÁFA: ${Math.round(vatResult.vatRate * 100)}% / VAT: ${Math.round(vatResult.vatRate * 100)}% (Hungarian VAT)`);
  }
  if (vatResult.vatRate === 0 && !vatResult.isReverseCharge) {
    legalTexts.push('ÁFA-mentes szolgáltatás / VAT exempt service');
  }

  return {
    // Kibocsátó — a platform üzemeltetője (a Számlázz.hu a fiók cégadataiból
    // dolgozik, ez a blokk a stub/DB-napló számára van)
    seller: {
      name: 'Tiszta Hód Kft.',
      taxId: process.env.COMPANY_TAX_ID || '24750792-2-06',
      address: process.env.COMPANY_ADDRESS || '6800 Hódmezővásárhely, Szántó Kovács János utca 144.',
      bankAccount: process.env.COMPANY_BANK_ACCOUNT || '',
    },
    // Vevő (a díjat fizető feladó)
    buyer: {
      name: buyerUser.company_name || buyerUser.full_name,
      taxId: buyerUser.tax_id || null,
      address: buyerUser.billing_address || '—',
      country: buyerUser.billing_country || 'HU',
    },
    // Tételek
    items: [
      {
        name_hu: 'Kapcsolatfelvételi (közvetítési) díj – GoFuvar',
        name_en: 'Connection (brokerage) fee – GoFuvar',
        name: lang === 'hu' ? 'Kapcsolatfelvételi (közvetítési) díj – GoFuvar' : 'Connection (brokerage) fee – GoFuvar',
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
    paymentMethod: lang === 'hu' ? 'Online fizetés' : 'Online payment',
  };
}

/**
 * Számla generálása a kapcsolatfelvételi díjról.
 *
 * @param {object} params
 * @param {string} [params.jobId]
 * @param {string} [params.bookingId]
 * @param {number} params.platformFee – a díj összege (bruttó, HUF)
 * @param {string} params.currency – 'HUF' | 'EUR'
 * @param {string} params.buyerUserId – a díjat fizető user (feladó) ID-je
 */
async function generatePlatformFeeInvoice({ jobId, bookingId, platformFee, currency, buyerUserId }) {
  // Vevő adatainak lekérdezése
  const { rows: userRows } = await db.query(
    `SELECT id, full_name, email, company_name, tax_id, billing_address, billing_country, locale
       FROM users WHERE id = $1`,
    [buyerUserId],
  );
  const buyerUser = userRows[0];
  if (!buyerUser) {
    console.error('[invoicing] Vevő nem található:', buyerUserId);
    return null;
  }

  // VAT kiszámítása — a díj BRUTTÓ ár (a kommunikált 500/1000 Ft pontosan
  // annyi, amennyi terhelődik), a nettó visszafelé számolódik
  const vatResult = await computeVat({
    buyerCountry: buyerUser.billing_country || 'HU',
    buyerTaxId: buyerUser.tax_id,
    buyerIsCompany: !!(buyerUser.company_name || buyerUser.tax_id),
    amount: platformFee,
    amountIsGross: true,
    currency,
  });

  // Számla adat összeállítása
  const invoiceData = buildInvoiceData({
    jobId, bookingId, currency, platformFee,
    vatResult, buyerUser,
    locale: buyerUser.locale || 'hu',
  });

  let provider = getProvider();
  if (provider === 'szamlazz_hu' && !szamlazzHu.isConfigured()) {
    console.warn('[invoicing] INVOICE_PROVIDER=szamlazz_hu, de a SZAMLAZZ_AGENT_KEY hiányzik — stub módban futok');
    provider = 'stub';
  }

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
        jobId || null, bookingId || null, buyerUserId,
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
    const result = await szamlazzHu.issueInvoice(invoiceData, {
      buyerEmail: buyerUser.email,
      vatResult,
      orderNumber: jobId || bookingId || '',
    });

    if (!result.ok) {
      // A számla-kudarc nem akaszthatja meg a fizetés-feldolgozást — a
      // 'failed' sor a nyoma, ebből lehet kézzel pótolni (Számlázz.hu fiók).
      console.error('[invoicing] Számlázz.hu kiállítás sikertelen:', result.error);
      const { rows: inv } = await db.query(
        `INSERT INTO invoices (
           job_id, booking_id, buyer_user_id, buyer_name, buyer_tax_id,
           buyer_address, buyer_country, currency, net_amount, vat_rate,
           vat_amount, gross_amount, is_reverse_charge, external_system,
           status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'szamlazz_hu','failed')
         RETURNING *`,
        [
          jobId || null, bookingId || null, buyerUserId,
          invoiceData.buyer.name, invoiceData.buyer.taxId,
          invoiceData.buyer.address, invoiceData.buyer.country,
          currency, vatResult.netAmount, vatResult.vatRate,
          vatResult.vatAmount, vatResult.grossAmount, vatResult.isReverseCharge,
        ],
      );
      return inv[0];
    }

    console.log(`[invoicing] Számlázz.hu számla kiállítva: ${result.invoiceNumber}`);
    const { rows: inv } = await db.query(
      `INSERT INTO invoices (
         job_id, booking_id, buyer_user_id, buyer_name, buyer_tax_id,
         buyer_address, buyer_country, currency, net_amount, vat_rate,
         vat_amount, gross_amount, is_reverse_charge, external_system,
         invoice_number, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'szamlazz_hu',$14,'sent')
       RETURNING *`,
      [
        jobId || null, bookingId || null, buyerUserId,
        invoiceData.buyer.name, invoiceData.buyer.taxId,
        invoiceData.buyer.address, invoiceData.buyer.country,
        currency, vatResult.netAmount, vatResult.vatRate,
        vatResult.vatAmount, vatResult.grossAmount, vatResult.isReverseCharge,
        result.invoiceNumber,
      ],
    );
    return inv[0];
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
