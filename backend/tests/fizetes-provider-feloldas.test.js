// =====================================================================
//  FIZETÉSI PROVIDER-FELOLDÁS — a néma bevétel-kiesés ellen
//
//  Részletes átvizsgálás (2026-08-08), a CIB-re váltás kapcsán.
//
//  A paymentProvider korábban `name() === 'qvik' ? qvik : barion` volt. Ez
//  azt jelentette, hogy MINDEN nem-'qvik' érték — köztük a launch CIB-je és
//  bármelyik elgépelés — CSENDBEN visszaesett Barionra. Barion kulcs nélkül
//  stub → az oldal „élesben" futott volna, de NULLA díjat szedett volna be,
//  és a confirm-payment guardok kinyíltak volna (isStub true). A launch
//  legveszélyesebb néma hibája.
//
//  Javítás: explicit provider-térkép (barion | qvik | cib) + fail-loud
//  ismeretlen értékre. Ez a teszt a feloldást őrzi.
// =====================================================================
import { describe, it, expect, afterEach } from 'vitest';

const paymentProvider = require('../src/services/paymentProvider');
const cib = require('../src/services/cib');

const EREDETI = process.env.PAYMENT_PROVIDER;
afterEach(() => {
  if (EREDETI === undefined) delete process.env.PAYMENT_PROVIDER;
  else process.env.PAYMENT_PROVIDER = EREDETI;
});

describe('paymentProvider: melyik provider oldódik fel', () => {
  it('alapból (env nélkül) cib (a Barion törölve), és teszt-módban stub', () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(paymentProvider.name()).toBe('cib');
    expect(paymentProvider.isStub()).toBe(true); // nincs CIB-kulcs a tesztben
  });

  it('PAYMENT_PROVIDER=cib → a CIB providert használja', () => {
    process.env.PAYMENT_PROVIDER = 'cib';
    expect(paymentProvider.name()).toBe('cib');
    expect(paymentProvider.active()).toBe(cib);
  });

  it('PAYMENT_PROVIDER=qvik → a QVIK providert használja', () => {
    process.env.PAYMENT_PROVIDER = 'qvik';
    expect(paymentProvider.active()).toBe(require('../src/services/qvik'));
  });

  it('nagybetűs/space-es érték is feloldódik (normalizálás)', () => {
    process.env.PAYMENT_PROVIDER = 'CIB';
    expect(paymentProvider.name()).toBe('cib');
    expect(paymentProvider.active()).toBe(cib);
  });

  it('ISMERETLEN provider → HANGOS hiba, NEM csendes Barion-visszaesés', () => {
    process.env.PAYMENT_PROVIDER = 'cibb'; // elgépelés
    expect(() => paymentProvider.active()).toThrow(/Ismeretlen PAYMENT_PROVIDER/i);
    // isStub is a feloldáson megy át → az is hibázik (nem ad néma true/false-t)
    expect(() => paymentProvider.isStub()).toThrow(/Ismeretlen PAYMENT_PROVIDER/i);
  });

  it('a támogatott providerek: qvik + cib (a barion törölve)', () => {
    expect(paymentProvider.providers).toEqual(expect.arrayContaining(['qvik', 'cib']));
    expect(paymentProvider.providers).not.toContain('barion');
  });
});

// 2026-09-29 (CIB PR-2/A): a CIB-adapter a háromállapotú EKI-konfigot
// követi (cibProtokoll.cibKonfig: nincs / teljes / hibás). A teljes
// feloldást a cib-protokoll.test.js méri; itt az adapter-szerződés marad.
describe('CIB provider-adapter (EKI-konfig nélkül stub)', () => {
  const EREDETI_KEY = process.env.CIB_API_KEY;
  const EREDETI_MERCH = process.env.CIB_MERCHANT_ID;
  afterEach(() => {
    if (EREDETI_KEY === undefined) delete process.env.CIB_API_KEY; else process.env.CIB_API_KEY = EREDETI_KEY;
    if (EREDETI_MERCH === undefined) delete process.env.CIB_MERCHANT_ID; else process.env.CIB_MERCHANT_ID = EREDETI_MERCH;
  });

  it('CIB-konfig nélkül stub, és a stub a determinisztikus fake gateway-t adja (a flow tesztelhető)', async () => {
    delete process.env.CIB_API_KEY;
    delete process.env.CIB_MERCHANT_ID;
    expect(cib.isStub()).toBe(true);
    const res = await cib.startFeePayment({ jobId: 'teszt-1', feeHuf: 500, shipperEmail: 'a@b.hu' });
    expect(res).toMatchObject({ stub: true, paymentId: 'cib-stub-teszt-1', gatewayUrl: 'stub:cib/teszt-1' });
  });

  it('a kivezetett vPOS-pár (kulcs + kereskedő) „hibás" módot ad: a stub zárva marad, mint eddig', () => {
    process.env.CIB_API_KEY = 'kulcs';
    delete process.env.CIB_MERCHANT_ID;
    expect(cib.isStub(), 'egyetlen régi változó még nem konfig — stub marad').toBe(true);

    process.env.CIB_MERCHANT_ID = 'merchant';
    expect(cib.isStub(), 'a régi párral a stub kinyílt volna (a kézi nyugtázással együtt)').toBe(false);
    expect(require('../src/services/cibProtokoll').cibKonfig()).toBe('hibas');
    expect(paymentProvider.manualConfirmAllowed()).toBe(false);
  });

  it('nem-stub (hibás vagy EKI) módban az adapter „nincs bekötve" hibát ad — a CIB-út nem ezen fut', async () => {
    process.env.CIB_API_KEY = 'kulcs';
    process.env.CIB_MERCHANT_ID = 'merchant';
    await expect(cib.startFeePayment({ jobId: 'x', feeHuf: 500 })).rejects.toThrow(/nincs bekötve/i);
    await expect(cib.getPaymentState('x')).rejects.toThrow(/nincs bekötve/i);
  });
});
