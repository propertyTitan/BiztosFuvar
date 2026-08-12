// =====================================================================
//  ÁFA-motor (services/vat.js) — a számlázás adójogi elágazásai.
//
//  Ez a modul dönti el, mi kerül a kapcsolatfelvételi díjról kiállított
//  VALÓDI adóügyi számlára. Két, pénzben mérhető szabály él benne:
//
//   (1) A díj BRUTTÓ ár (2026-07-19-i javítás). Az 500 Ft-ot terheljük,
//       tehát a számla végösszegének PONTOSAN 500 Ft-nak kell lennie —
//       a nettó visszafelé számolódik. A hiba előtt a motor nettónak
//       vette a díjat, és az első éles számla 635 Ft-ról szólt volna.
//
//   (2) A VIES (EU adószám-ellenőrző) kiesése NEM akaszthatja meg a
//       számlázást: ha nem tudjuk igazolni a közösségi adószámot, a
//       biztonságos irányba tévedünk (27% HU ÁFA felszámítása), de
//       számlát MINDIG adunk. Egy dobás itt a webhook-ágat vinné el,
//       vagyis a befizetett díjról nem keletkezne bizonylat.
//
//  ⚠️ A VIES egy KÜLSŐ HTTP API. Minden teszt mockolt `fetch`-csel fut;
//  a mock a hívás alakját is méri (jó ország-kód, kódolt adószám), és a
//  „nem várt URL" esetet hangosan elbuktatja — így valódi hálózati hívás
//  nem szivároghat be észrevétlenül.
// =====================================================================

import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vat = require('../src/services/vat');

const {
  computeVat, validateVatId, parseTaxId, EU_VAT_RATES, PLATFORM_VAT_RATE,
} = vat;

const VIES_ELOTAG = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';

let viesHivasok;

/**
 * A VIES-választ adja vissza. `valasz` lehet:
 *   - objektum → 200-as JSON válasz
 *   - {__http: 503} → HTTP hibakód
 *   - Error → a fetch eldobja (hálózati hiba / timeout)
 */
function viesMock(valasz) {
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    viesHivasok.push(String(url));
    if (!String(url).startsWith(VIES_ELOTAG)) {
      throw new Error(`Nem várt kimenő HTTP-hívás a teszt alatt: ${url}`);
    }
    if (valasz instanceof Error) throw valasz;
    if (valasz && valasz.__http) {
      return { ok: false, status: valasz.__http, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => valasz, text: async () => '' };
  });
}

beforeEach(() => { viesHivasok = []; });
afterEach(() => { vi.restoreAllMocks(); });

// =====================================================================
//  0) A mérőeszköz épsége
// =====================================================================
describe('ÁFA-motor — a teszt a valós modult méri', () => {
  it('a modul a mért neveket exportálja, és a platform-kulcs 27%', () => {
    expect(
      Object.keys(vat).sort(),
      'A vat.js exportjai megváltoztak — a teszt ettől a ponttól vak lenne.',
    ).toEqual(['EU_VAT_RATES', 'PLATFORM_COUNTRY', 'PLATFORM_VAT_RATE', 'computeVat', 'parseTaxId', 'validateVatId']);
    expect(typeof computeVat).toBe('function');
    expect(typeof validateVatId).toBe('function');
    expect(typeof parseTaxId).toBe('function');
    expect(
      PLATFORM_VAT_RATE,
      'A magyar általános ÁFA-kulcs 27% — ha ez elmozdul, minden kiállított '
      + 'számla rossz adótartalommal megy ki.',
    ).toBe(27);
    expect(EU_VAT_RATES.HU).toBe(27);
    expect(
      Object.keys(EU_VAT_RATES).length,
      'Az EU-tagállamok listája 27 elemű. Ha ez változik, egy ország némán '
      + 'átcsúszhat „harmadik ország" (ÁFA-mentes) besorolásba.',
    ).toBe(27);
  });
});

// =====================================================================
//  1) BRUTTÓ mód — a számla végösszege = a terhelt összeg
// =====================================================================
describe('computeVat — a díj BRUTTÓ ár (2026-07-19-i javítás)', () => {
  it('MINDEN vevőtípusnál: bruttó módban a végösszeg PONTOSAN a terhelt díj', async () => {
    // Ez az invariáns a javítás lényege. Ha bármelyik ágon elcsúszik, a
    // vevő 500 Ft-ot fizet és 635 Ft-ról kap számlát (vagy fordítva).
    viesMock({ isValid: true, name: 'Muster GmbH', address: 'Berlin' });

    const esetek = [
      ['belföldi magánszemély', { buyerCountry: 'HU', buyerIsCompany: false, buyerTaxId: null }],
      ['belföldi cég', { buyerCountry: 'HU', buyerIsCompany: true, buyerTaxId: 'HU24750792' }],
      ['EU-s cég érvényes adószámmal', { buyerCountry: 'DE', buyerIsCompany: true, buyerTaxId: 'DE123456789' }],
      ['EU-s magánszemély', { buyerCountry: 'AT', buyerIsCompany: false, buyerTaxId: null }],
      ['harmadik országbeli', { buyerCountry: 'US', buyerIsCompany: true, buyerTaxId: null }],
    ];

    for (const dij of [500, 1000]) {
      for (const [nev, vevo] of esetek) {
        // eslint-disable-next-line no-await-in-loop
        const r = await computeVat({ ...vevo, amount: dij, amountIsGross: true, currency: 'HUF' });
        expect(
          r.grossAmount,
          `[${nev}, ${dij} Ft] A számla VÉGÖSSZEGE nem egyezik a terhelt díjjal. `
          + 'A kapcsolatfelvételi díj kommunikált ára BRUTTÓ — a nettónak '
          + 'visszafelé kell számolódnia, különben a vevő mást fizet, mint '
          + 'amiről a számlája szól.',
        ).toBe(dij);
        expect(
          r.netAmount + r.vatAmount,
          `[${nev}, ${dij} Ft] nettó + ÁFA ≠ bruttó — a számla önmagával nem egyezik.`,
        ).toBe(dij);
        expect(r.netAmount).toBeGreaterThan(0);
      }
    }
  });

  it('500 Ft bruttó → 394 nettó + 106 ÁFA; 1000 Ft → 787 + 213', async () => {
    const a = await computeVat({
      buyerCountry: 'HU', buyerIsCompany: false, buyerTaxId: null,
      amount: 500, amountIsGross: true, currency: 'HUF',
    });
    expect([a.netAmount, a.vatAmount, a.grossAmount], 'a launch-díj ÁFA-bontása elmozdult').toEqual([394, 106, 500]);

    const b = await computeVat({
      buyerCountry: 'HU', buyerIsCompany: false, buyerTaxId: null,
      amount: 1000, amountIsGross: true, currency: 'HUF',
    });
    expect([b.netAmount, b.vatAmount, b.grossAmount]).toEqual([787, 213, 1000]);
  });

  it('NETTÓ mód (alapértelmezés) felfelé számol: 500 → 635', async () => {
    // Ez a másik ág — ha valaki az `amountIsGross` alapértékét true-ra
    // állítaná, minden nettó-alapú hívó némán elcsúszna.
    const r = await computeVat({
      buyerCountry: 'HU', buyerIsCompany: false, buyerTaxId: null,
      amount: 500, currency: 'HUF',
    });
    expect(
      [r.netAmount, r.vatAmount, r.grossAmount],
      'A nettó mód (amountIsGross elhagyva) nem felfelé számol. Az alapértéknek '
      + 'FALSE-nak kell lennie.',
    ).toEqual([500, 135, 635]);
  });

  it('a tört összeget kerekíti, és a kerekítés után is zár a számla', async () => {
    const r = await computeVat({
      buyerCountry: 'HU', buyerIsCompany: false, buyerTaxId: null,
      amount: 1499.6, amountIsGross: true, currency: 'HUF',
    });
    expect(r.grossAmount, 'a forintra kerekítés elmaradt — tört forint nem számlázható').toBe(1500);
    expect(r.netAmount + r.vatAmount).toBe(1500);
    expect(Number.isInteger(r.netAmount) && Number.isInteger(r.vatAmount)).toBe(true);
  });

  it('0%-os ágon a bruttó = nettó (nincs „visszafelé osztás" nulla kulccsal)', async () => {
    const r = await computeVat({
      buyerCountry: 'US', buyerIsCompany: true, buyerTaxId: null,
      amount: 1000, amountIsGross: true, currency: 'HUF',
    });
    expect([r.netAmount, r.vatAmount, r.grossAmount]).toEqual([1000, 0, 1000]);
  });
});

// =====================================================================
//  2) Belföld / EU / harmadik ország
// =====================================================================
describe('computeVat — vevőtípus szerinti adókezelés', () => {
  it('belföldi vevő MINDIG 27% HU ÁFA — cégként is, adószámmal is', async () => {
    viesMock({ isValid: true });
    const r = await computeVat({
      buyerCountry: 'HU', buyerIsCompany: true, buyerTaxId: 'HU24750792',
      amount: 1000, currency: 'HUF',
    });
    expect(r.vatRate).toBe(0.27);
    expect(
      r.isReverseCharge,
      'BELFÖLDI cégre fordított adózást alkalmaztunk. A reverse charge csak '
      + 'közösségen BELÜLI (nem HU) ügyletre jár — belföldön ez adóhiány.',
    ).toBe(false);
    expect(r.vatCountry).toBe('HU');
    expect(
      viesHivasok,
      'Belföldi adószámot elküldtünk a VIES-nek. Fölösleges külső hívás a '
      + 'számlázási úton (és a webhookot lassítja).',
    ).toEqual([]);
  });

  it('hiányzó ország → belföldinek tekintjük (biztonságos irány)', async () => {
    const r = await computeVat({
      buyerCountry: undefined, buyerIsCompany: false, buyerTaxId: null,
      amount: 1000, currency: 'HUF',
    });
    expect(
      r.vatCountry,
      'Ismeretlen országnál nem HU ÁFA-t számoltunk. Adat híján a saját '
      + 'székhely szerinti adó a biztonságos alapértelmezés — különben '
      + 'ÁFA-mentesen számláznánk azt, akiről semmit sem tudunk.',
    ).toBe('HU');
    expect(r.vatRate).toBe(0.27);
  });

  it('EU-s MAGÁNSZEMÉLY: 27% HU ÁFA a szolgáltató székhelye szerint', async () => {
    const r = await computeVat({
      buyerCountry: 'DE', buyerIsCompany: false, buyerTaxId: null,
      amount: 1000, currency: 'HUF',
    });
    expect(r.vatRate).toBe(0.27);
    expect(r.isReverseCharge, 'magánszemélyre nincs fordított adózás').toBe(false);
    expect(r.vatCountry).toBe('HU');
    // ⚠️ A kulcs önmagában NEM elég megkülönböztető: a végén álló biztonsági
    // háló is 27% HU ÁFA-t ad. A határon átnyúló B2C számlán viszont a
    // JOGCÍMNEK is szerepelnie kell (miért magyar ÁFA egy német vevőnek) —
    // ezért itt a záradék SZÖVEGÉT mérjük, nem csak a százalékot.
    expect(
      r.legalNote,
      'Az EU-s magánszemély számlájáról hiányzik a székhely-szabály indoklása. '
      + 'A generikus „ÁFA: 27% (HU)" háló-szöveg ugyanazt a kulcsot adja, de '
      + 'nem indokolja meg, miért magyar ÁFÁ-t fizet egy német vevő — a '
      + 'határon átnyúló számlán ez a jogcím.',
    ).toMatch(/székhely/i);
    expect(r.legalNote).toContain('Tiszta Hód');
    expect(r.legalNoteEn).toMatch(/registered office/i);
    expect(viesHivasok, 'magánszemély adószám nélkül nem küldhető a VIES-be').toEqual([]);
  });

  it('EU-s CÉG érvényes adószámmal: 0% fordított adózás + a kötelező záradék', async () => {
    viesMock({ isValid: true, name: 'Muster GmbH', address: 'Hauptstr. 1, Berlin' });
    const r = await computeVat({
      buyerCountry: 'DE', buyerIsCompany: true, buyerTaxId: 'DE 123.456-789',
      amount: 1000, amountIsGross: true, currency: 'HUF',
    });

    expect(r.vatRate, 'közösségen belüli B2B szolgáltatásra 0% jár').toBe(0);
    expect(r.vatAmount).toBe(0);
    expect(
      r.isReverseCharge,
      'Nincs beállítva a fordított adózás jelölése — a számlázó modul emiatt '
      + 'rossz ÁFA-kulccsal küldené a NAV-nak.',
    ).toBe(true);
    expect(r.vatCountry).toBe('DE');
    expect(
      r.legalNote,
      'Hiányzik a kötelező „fordított adózás" záradék a számláról. Áfa tv. '
      + 'szerint enélkül a bizonylat hibás.',
    ).toMatch(/fordított adózás/i);
    expect(
      r.legalNote,
      'A vevő közösségi adószáma nincs a záradékban — normalizált alakban '
      + '(szóköz/pont/kötőjel nélkül) kell szerepelnie.',
    ).toContain('DE123456789');
    expect(r.legalNoteEn).toMatch(/reverse charge/i);
    expect(r.viesValidation).toMatchObject({ valid: true, name: 'Muster GmbH' });

    expect(
      viesHivasok,
      'A VIES-hívás URL-je nem a normalizált országkód/adószám párral ment ki.',
    ).toEqual([`${VIES_ELOTAG}/DE/vat/123456789`]);
  });

  it('harmadik ország: 0% ÁFA-mentes export, de NEM fordított adózás', async () => {
    const r = await computeVat({
      buyerCountry: 'US', buyerIsCompany: true, buyerTaxId: 'US99-1234567',
      amount: 1000, currency: 'HUF',
    });
    expect(r.vatRate).toBe(0);
    expect(
      r.isReverseCharge,
      'Harmadik országra „fordított adózást" jelöltünk. Az EU-n kívüli '
      + 'szolgáltatás ÁFA-mentes export, nem reverse charge — más a záradék '
      + 'és más az összesítő-nyilatkozat kötelezettség.',
    ).toBe(false);
    expect(r.vatCountry).toBe('US');
    expect(r.legalNote).toMatch(/mentes/i);
    expect(
      viesHivasok,
      'Nem EU-s adószámot küldtünk a VIES-nek — az a rendszer csak közösségi '
      + 'adószámot ismer.',
    ).toEqual([]);
  });

  it('kisbetűs országkód is felismerhető (nem esik ki harmadik országba)', async () => {
    const r = await computeVat({
      buyerCountry: 'at', buyerIsCompany: false, buyerTaxId: null,
      amount: 1000, currency: 'HUF',
    });
    expect(
      r.vatRate,
      'A kisbetűs „at" nem ismerődött fel EU-tagállamként, így egy osztrák '
      + 'magánszemély ÁFA-mentesen kapott volna számlát (adóhiány).',
    ).toBe(0.27);
  });
});

// =====================================================================
//  3) A VIES kiesése nem akaszthatja meg a számlázást
// =====================================================================
describe('computeVat — a VIES hibája nem állíthatja meg a számlát', () => {
  const deCeg = {
    buyerCountry: 'DE', buyerIsCompany: true, buyerTaxId: 'DE123456789',
    amount: 1000, amountIsGross: true, currency: 'HUF',
  };

  it('a VIES „érvénytelen"-t mond → 27% HU ÁFA, a számla kiáll', async () => {
    viesMock({ isValid: false });
    const r = await computeVat(deCeg);
    expect(
      r.isReverseCharge,
      'ÉRVÉNYTELEN közösségi adószámra is fordított adózást adtunk. Így a '
      + 'platform nem hárítja át az adót, viszont nem is fizeti meg — '
      + 'adóhiány, amit egy hamis adószámmal bárki kiváltana.',
    ).toBe(false);
    expect(r.vatRate).toBe(0.27);
    expect(r.grossAmount, 'a végösszeg elcsúszott a fallback-ágon').toBe(1000);
    expect(r.netAmount + r.vatAmount).toBe(1000);
  });

  it('a VIES HTTP-hibát ad (503) → nem dob, 27% HU ÁFA', async () => {
    viesMock({ __http: 503 });
    const r = await computeVat(deCeg);
    expect(r.vatRate, 'VIES-kiesésnél a biztonságos irány a 27% felszámítása').toBe(0.27);
    expect(r.isReverseCharge).toBe(false);
    expect(r.grossAmount).toBe(1000);
  });

  it('a VIES hálózati hibával elszáll → NEM dob, a számla kiáll', async () => {
    // Ez a legfontosabb ág: a hívó a fizetési webhook. Ha itt kivétel
    // szabadul el, a befizetett díjról nem keletkezik bizonylat.
    viesMock(new Error('ECONNRESET'));
    let r;
    await expect(
      (async () => { r = await computeVat(deCeg); })(),
      'A VIES hálózati hibája KIVÉTELKÉNT csapódott ki a computeVat-ból. A '
      + 'hívó a fizetési webhook: egy uniós VIES-kiesés így megakasztaná a '
      + 'számlázást a MÁR BEFIZETETT díjról.',
    ).resolves.toBeUndefined();
    expect(r.vatRate).toBe(0.27);
    expect(r.grossAmount).toBe(1000);
  });

  it('EU-s cég adószám NÉLKÜL → 27% HU ÁFA (VIES-hívás nélkül)', async () => {
    const r = await computeVat({ ...deCeg, buyerTaxId: null });
    expect(
      r.isReverseCharge,
      'Adószám NÉLKÜLI „cégre" fordított adózást adtunk. A reverse charge '
      + 'feltétele az érvényes közösségi adószám — enélkül nem járhat.',
    ).toBe(false);
    expect(r.vatRate).toBe(0.27);
    expect(r.grossAmount).toBe(1000);
    expect(viesHivasok).toEqual([]);
  });

  it('EU-s cég ÉRTELMEZHETETLEN adószámmal → 27% HU ÁFA (VIES-hívás nélkül)', async () => {
    // A `parseTaxId` null-t ad ('DE.-' → csak az országkód marad), ezért a
    // VIES-t meg sem szabad hívni.
    const r = await computeVat({ ...deCeg, buyerTaxId: 'DE.-' });
    expect(r.vatRate).toBe(0.27);
    expect(r.isReverseCharge).toBe(false);
    expect(
      viesHivasok,
      'Üres adószámot küldtünk a VIES-nek — fölösleges külső hívás, ráadásul '
      + 'a válasza sem lenne értelmezhető.',
    ).toEqual([]);
  });
});

// =====================================================================
//  4) validateVatId — a VIES-kliens önmagában
// =====================================================================
describe('validateVatId — a VIES-kliens szerződése', () => {
  it('érvényes adószám: valid + név + cím', async () => {
    viesMock({ isValid: true, name: 'Muster GmbH', address: 'Berlin' });
    const r = await validateVatId('de', '123456789');
    expect(r).toEqual({ valid: true, name: 'Muster GmbH', address: 'Berlin' });
    expect(
      viesHivasok[0],
      'Az országkódot nem nagybetűsítettük az URL-ben — a VIES a kisbetűs '
      + 'kódot nem ismeri fel.',
    ).toBe(`${VIES_ELOTAG}/DE/vat/123456789`);
  });

  it('hiányzó név/cím esetén null (nem „undefined" szivárog a számlára)', async () => {
    viesMock({ isValid: true });
    const r = await validateVatId('DE', '123456789');
    expect(r).toEqual({ valid: true, name: null, address: null });
  });

  it('a „majdnem igaz" válasz nem elég: isValid csak szigorúan true lehet', async () => {
    // Egy `"true"` string vagy 1-es szám nem igazolhat közösségi adószámot.
    for (const hamis of ['true', 1, {}, null, undefined]) {
      viesMock({ isValid: hamis });
      // eslint-disable-next-line no-await-in-loop
      const r = await validateVatId('DE', '123456789');
      expect(
        r.valid,
        `Az isValid=${JSON.stringify(hamis)} érvényesnek számított. A VIES `
        + 'válaszát szigorúan (===) kell nézni, különben egy formátumváltás '
        + 'némán ÁFA-mentessé tenné az összes EU-s céges számlát.',
      ).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it('HTTP-hiba: valid=false + beszédes hibaüzenet, nem dobás', async () => {
    viesMock({ __http: 500 });
    const r = await validateVatId('DE', '123456789');
    expect(r.valid).toBe(false);
    expect(r.error, 'a HTTP-státusz nincs a hibaüzenetben — vakon nyomozunk').toContain('500');
  });

  it('hálózati hiba / timeout: valid=false, nem dobás', async () => {
    viesMock(new Error('The operation was aborted due to timeout'));
    const r = await validateVatId('DE', '123456789');
    expect(
      r.valid,
      'Hálózati hiba esetén nem szabad érvényesnek tekinteni az adószámot.',
    ).toBe(false);
    expect(r.error).toMatch(/timeout|abort/i);
  });

  it('az adószámot URL-kódolva küldi (nem lehet vele útvonalat törni)', async () => {
    viesMock({ isValid: false });
    await validateVatId('DE', '123/456?x=1');
    expect(
      viesHivasok[0],
      'A nyers adószám bekerült az URL-be kódolatlanul: egy „/" vagy „?" '
      + 'karakterrel más VIES-útvonalra lehetne irányítani a kérést.',
    ).toBe(`${VIES_ELOTAG}/DE/vat/123%2F456%3Fx%3D1`);
  });
});

// =====================================================================
//  5) parseTaxId
// =====================================================================
describe('parseTaxId — adószám-felbontás', () => {
  it('a formázó karaktereket eldobja, és nagybetűsít', () => {
    expect(parseTaxId('de 123.456-789')).toEqual({
      country: 'DE', number: '123456789', full: 'DE123456789',
    });
    expect(parseTaxId('HU24750792')).toEqual({
      country: 'HU', number: '24750792', full: 'HU24750792',
    });
  });

  it('a használhatatlan bemenetre null-t ad (nem félkész objektumot)', () => {
    // Ha itt objektum jönne vissza üres `number`-rel, a hívó lekérdezné a
    // VIES-t egy üres adószámra, és a válaszra építené az adómentességet.
    for (const rossz of [null, undefined, '', 'DE', 'D', 'DE.-', '  .-  ']) {
      expect(
        parseTaxId(rossz),
        `A(z) ${JSON.stringify(rossz)} bemenetre nem null jött vissza. `
        + 'Használhatatlan adószámból nem szabad „érvényes" adatot gyártani.',
      ).toBeNull();
    }
  });

  it('a 4 karakteres minimum-hossz a határ', () => {
    expect(parseTaxId('DE1'), 'a 3 karakteres bemenet átment a hossz-szűrőn').toBeNull();
    expect(parseTaxId('DE12')).toEqual({ country: 'DE', number: '12', full: 'DE12' });
  });
});
