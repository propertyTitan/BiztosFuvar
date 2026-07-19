// Számlázz.hu Agent integráció + BRUTTÓ ÁFA-mód.
//
// A kapcsolatfelvételi díj (500/1000 Ft) BRUTTÓ ár — a számlának pontosan a
// terhelt összegről kell szólnia (nettó visszafelé számolva), különben az
// első éles számla 635 Ft-ot mutatna 500 helyett. A Számlázz.hu hívást
// mockoljuk; a teljes láncot teszteljük az XML-től a DB-sorig.
import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

const { db, createUser } = require('./helpers');
const { computeVat } = require('../src/services/vat');
const szamlazz = require('../src/services/szamlazzHu');
const { generatePlatformFeeInvoice, buildInvoiceData } = require('../src/services/invoicing');

function setSzamlazzEnv() {
  process.env.INVOICE_PROVIDER = 'szamlazz_hu';
  process.env.SZAMLAZZ_AGENT_KEY = 'teszt-agent-kulcs';
}

afterEach(() => {
  delete process.env.INVOICE_PROVIDER;
  delete process.env.SZAMLAZZ_AGENT_KEY;
  vi.unstubAllGlobals();
});

/** Sikeres Számlázz.hu válasz (valaszVerzio=2). */
function okResponse(invoiceNumber = 'GFVR-2026-42') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ szlahu_szamlaszam: invoiceNumber }),
    text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
  <sikeres>true</sikeres>
  <szamlaszam>${invoiceNumber}</szamlaszam>
</xmlszamlavalasz>`,
  };
}

function errorResponse(code = '3', message = 'Hibás agent kulcs') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ szlahu_error: message, szlahu_error_code: code }),
    text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
  <sikeres>false</sikeres>
  <hibakod>${code}</hibakod>
  <hibauzenet>${message}</hibauzenet>
</xmlszamlavalasz>`,
  };
}

async function createBuyer({ company = true } = {}) {
  const user = await createUser();
  await db.query(
    `UPDATE users SET account_type = $2, company_name = $3, tax_id = $4,
                      billing_address = '6800 Hódmezővásárhely, Szántó Kovács János utca 144.'
      WHERE id = $1`,
    [
      user.id,
      company ? 'company' : 'individual',
      company ? 'Teszt Bútorbolt Kft.' : null,
      company ? '11111111-2-06' : null,
    ],
  );
  return user;
}

describe('computeVat — BRUTTÓ mód (a díj a terhelt ár)', () => {
  it('HU 500 Ft bruttó → nettó 394 + ÁFA 106 = PONTOSAN 500', async () => {
    const r = await computeVat({
      buyerCountry: 'HU', buyerTaxId: null, buyerIsCompany: false,
      amount: 500, amountIsGross: true, currency: 'HUF',
    });
    expect(r.grossAmount).toBe(500);
    expect(r.netAmount).toBe(394);
    expect(r.vatAmount).toBe(106);
    expect(r.netAmount + r.vatAmount).toBe(500);
  });

  it('HU 1000 Ft bruttó → nettó 787 + ÁFA 213 = 1000', async () => {
    const r = await computeVat({
      buyerCountry: 'HU', buyerTaxId: null, buyerIsCompany: false,
      amount: 1000, amountIsGross: true, currency: 'HUF',
    });
    expect(r.grossAmount).toBe(1000);
    expect(r.netAmount + r.vatAmount).toBe(1000);
  });

  it('nettó mód (default) változatlan: 500 → 635 bruttó', async () => {
    const r = await computeVat({
      buyerCountry: 'HU', buyerTaxId: null, buyerIsCompany: false,
      amount: 500, currency: 'HUF',
    });
    expect(r.netAmount).toBe(500);
    expect(r.vatAmount).toBe(135);
    expect(r.grossAmount).toBe(635);
  });

  it('nem EU-s vevő: 0% — bruttó = nettó = a terhelt összeg', async () => {
    const r = await computeVat({
      buyerCountry: 'US', buyerTaxId: null, buyerIsCompany: true,
      amount: 500, amountIsGross: true, currency: 'HUF',
    });
    expect(r.vatAmount).toBe(0);
    expect(r.netAmount).toBe(500);
    expect(r.grossAmount).toBe(500);
  });
});

describe('Számlázz.hu segédek', () => {
  it('cím-szétbontás: teljes magyar cím', () => {
    expect(szamlazz.parseBillingAddress('6800 Hódmezővásárhely, Szántó Kovács János utca 144.'))
      .toEqual({ zip: '6800', city: 'Hódmezővásárhely', street: 'Szántó Kovács János utca 144.' });
  });

  it('cím-szétbontás: irányítószám nélkül és bonthatatlanul sem dob', () => {
    expect(szamlazz.parseBillingAddress('Szeged, Fő utca 1.').city).toBe('Szeged');
    expect(szamlazz.parseBillingAddress('—').zip).toBe('0000');
    expect(szamlazz.parseBillingAddress(null).city).toBe('N/A');
  });

  it('áfakulcs-kód: 27% → "27", fordított adózás → EUFAD37, harmadik ország → HO', () => {
    expect(szamlazz.vatCodeFor({ vatRate: 0.27, isReverseCharge: false })).toBe('27');
    expect(szamlazz.vatCodeFor({ vatRate: 0, isReverseCharge: true })).toBe('EUFAD37');
    expect(szamlazz.vatCodeFor({ vatRate: 0, isReverseCharge: false })).toBe('HO');
  });

  it('a kérés-XML konzisztens: kulcs, vevő, fizetve, bruttó = terhelt díj', async () => {
    setSzamlazzEnv();
    const vatResult = await computeVat({
      buyerCountry: 'HU', buyerTaxId: '11111111-2-06', buyerIsCompany: true,
      amount: 500, amountIsGross: true, currency: 'HUF',
    });
    const data = buildInvoiceData({
      jobId: 'JOB-1', bookingId: null, currency: 'HUF', platformFee: 500,
      vatResult, buyerUser: { company_name: 'Teszt Bútorbolt Kft.', tax_id: '11111111-2-06', billing_address: '6800 Hódmezővásárhely, Fő u. 1.' },
      locale: 'hu',
    });
    const xml = szamlazz.buildInvoiceXml(data, {
      buyerEmail: 'vevo@teszt.hu', vatResult, orderNumber: 'JOB-1',
    });
    expect(xml).toContain('<szamlaagentkulcs>teszt-agent-kulcs</szamlaagentkulcs>');
    expect(xml).toContain('<nev>Teszt Bútorbolt Kft.</nev>');
    expect(xml).toContain('<adoszam>11111111-2-06</adoszam>');
    expect(xml).toContain('<fizetve>true</fizetve>');
    expect(xml).toContain('<afakulcs>27</afakulcs>');
    expect(xml).toContain('<nettoErtek>394</nettoErtek>');
    expect(xml).toContain('<afaErtek>106</afaErtek>');
    expect(xml).toContain('<bruttoErtek>500</bruttoErtek>');
    expect(xml).toContain('<email>vevo@teszt.hu</email>');
  });
});

describe('generatePlatformFeeInvoice — Számlázz.hu úton', () => {
  it('sikeres kiállítás: invoices sor "sent" + számlaszám + bruttó = díj', async () => {
    setSzamlazzEnv();
    const fetchMock = vi.fn(async () => okResponse('GFVR-2026-42'));
    vi.stubGlobal('fetch', fetchMock);
    const buyer = await createBuyer();

    const inv = await generatePlatformFeeInvoice({
      jobId: null, bookingId: null, platformFee: 500, currency: 'HUF', buyerUserId: buyer.id,
    });

    expect(inv.status).toBe('sent');
    expect(inv.external_system).toBe('szamlazz_hu');
    expect(inv.invoice_number).toBe('GFVR-2026-42');
    expect(inv.gross_amount).toBe(500);
    expect(inv.net_amount).toBe(394);
    expect(inv.vat_amount).toBe(106);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('szamlazz.hu');
  });

  it('Számlázz.hu hiba: "failed" sor marad nyomnak, nincs throw', async () => {
    setSzamlazzEnv();
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse()));
    const buyer = await createBuyer();

    const inv = await generatePlatformFeeInvoice({
      jobId: null, bookingId: null, platformFee: 1000, currency: 'HUF', buyerUserId: buyer.id,
    });

    expect(inv.status).toBe('failed');
    expect(inv.external_system).toBe('szamlazz_hu');
    expect(inv.invoice_number).toBeNull();
    expect(inv.gross_amount).toBe(1000);
  });

  it('kulcs nélkül stub-ra esik vissza (a fizetés-feldolgozás sosem törik)', async () => {
    process.env.INVOICE_PROVIDER = 'szamlazz_hu'; // kulcs NINCS
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const buyer = await createBuyer({ company: false });

    const inv = await generatePlatformFeeInvoice({
      jobId: null, bookingId: null, platformFee: 500, currency: 'HUF', buyerUserId: buyer.id,
    });

    expect(inv.status).toBe('sent');
    expect(inv.external_system).toBe('stub');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
