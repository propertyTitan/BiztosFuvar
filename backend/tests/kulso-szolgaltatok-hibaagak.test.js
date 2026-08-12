// =====================================================================
//  KÜLSŐ SZOLGÁLTATÓK HIBAÁGAI (2026-08-12)
//
//  ⚠️ A `geocode.js` és az `exchange.js` 0%-OS elágazás-lefedettségen állt, a
//  `vat.js` 33%-on. Mindhárom KÜLSŐ szolgáltatót hív (Nominatim, EKB, VIES) —
//  olyan függőségeket, amik bármikor lassulhatnak, hibázhatnak vagy szemetet
//  adhatnak vissza, és amikre nincs ráhatásunk.
//
//  A rájuk épülő funkciók: a lane-alert település-neve, a cross-currency
//  ajánlat árfolyama, és a céges fordított adózás. Mindháromnál ugyanaz a
//  kérdés: egy külső hiba MEGÁLLÍTJA-E a fő folyamatot? Nem szabad neki —
//  egy Nominatim-timeout nem akadályozhatja meg a fuvar feladását.
//
//  ⚠️ ÖNVÉDELEM: az első változatom `geocode.geocodeCity?.()`-t hívott, ami
//  NEM LÉTEZIK — az optional chaining miatt a tesztek VAKON ZÖLDEK voltak.
//  Ezért mostantól minden mért függvény LÉTEZÉSÉT is állítjuk.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const geocode = require('../src/services/geocode');
const exchange = require('../src/services/exchange');
const vat = require('../src/services/vat');

let hivasok;
beforeEach(() => { hivasok = []; });
afterEach(() => { vi.restoreAllMocks(); });

function valasz(adat, { ok = true, status = 200 } = {}) {
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    hivasok.push(String(url));
    return {
      ok,
      status,
      json: async () => adat,
      text: async () => (typeof adat === 'string' ? adat : JSON.stringify(adat)),
    };
  });
}

describe('Geokódolás (Nominatim) hibaágai', () => {
  it('a mért függvény létezik (az őr nem lehet vak)', () => {
    expect(typeof geocode.geocodeAddress, 'a geocodeAddress export eltűnt').toBe('function');
  });

  it('hálózati hiba esetén NEM dob — a fuvarfeladás nem akadhat el', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const eredmeny = await geocode.geocodeAddress('Szeged, Kossuth tér 1.')
      .then((x) => ({ ok: x })).catch((e) => ({ dobott: e }));
    expect(
      eredmeny.dobott,
      'A geokódolás KIVÉTELT dobott hálózati hibánál. Ez KIEGÉSZÍTŐ szolgáltatás '
      + '(a lane-alert település-neve) — ha elszáll, a fuvar feladásának attól '
      + 'még mennie kell.',
    ).toBeUndefined();
  });

  it('szemét (nem-JSON) válasz sem dob', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error('nem JSON'); },
      text: async () => '<html>hiba</html>',
    });
    const eredmeny = await geocode.geocodeAddress('Szeged')
      .then((x) => ({ ok: x })).catch((e) => ({ dobott: e }));
    expect(eredmeny.dobott, 'szemét válaszon elszállt').toBeUndefined();
  });

  it('üres találat-listára NEM talál ki koordinátát', async () => {
    valasz([]);
    const eredmeny = await geocode.geocodeAddress('NemLetezoVaros123');
    expect(
      eredmeny && eredmeny.lat,
      'Üres Nominatim-válaszra koordinátát adtunk vissza — kitalált helyadat, '
      + 'amire a lane-alert és a közelség-párosítás épülne.',
    ).toBeFalsy();
  });

  it('hibás HTTP-státuszra sem talál ki semmit', async () => {
    valasz('rate limited', { ok: false, status: 429 });
    const eredmeny = await geocode.geocodeAddress('Szeged');
    expect(eredmeny && eredmeny.lat, '429-re is adtunk koordinátát').toBeFalsy();
  });
});

describe('Árfolyam (EKB) hibaágai', () => {
  it('a mért függvények léteznek', () => {
    expect(typeof exchange.getEurHufRate).toBe('function');
    expect(typeof exchange.convertEurToHuf).toBe('function');
  });

  it('hálózati hiba esetén NEM dob (van tartalék-árfolyam)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const eredmeny = await exchange.getEurHufRate()
      .then((x) => ({ ertek: x })).catch((e) => ({ dobott: e }));
    expect(
      eredmeny.dobott,
      'Az árfolyam-lekérdezés kivételt dobott. Egy EKB-kiesés nem akadályozhatja '
      + 'meg az ajánlattételt — tartalék-árfolyammal is mennie kell.',
    ).toBeUndefined();
    // A függvény OBJEKTUMOT ad: { rate, fetchedAt, source }.
    expect(
      eredmeny.ertek && typeof eredmeny.ertek.rate === 'number' && eredmeny.ertek.rate > 0,
      'hálózati hibánál nem kaptunk használható tartalék-árfolyamot — a '
      + 'cross-currency ajánlat ára kiszámíthatatlan lenne',
    ).toBe(true);
  });

  it('szemét válasz esetén sem ad nullát vagy negatívot', async () => {
    valasz({ rates: {} });
    const { rate } = await exchange.getEurHufRate();
    expect(
      rate > 0,
      'Az árfolyam 0 vagy negatív lett — ezzel a cross-currency ajánlat ára '
      + '0 Ft-ra vagy negatívra számolódna.',
    ).toBe(true);
  });

  it('a konverzió kerekít és nem ad NaN-t', async () => {
    valasz({ rates: { HUF: 400 } });
    // A konverzió is objektumot ad (összeg + a használt árfolyam + forrás).
    const eredmeny = await exchange.convertEurToHuf(10);
    const osszeg = typeof eredmeny === 'number' ? eredmeny : (eredmeny.hufAmount ?? eredmeny.huf ?? eredmeny.amount);
    expect(Number.isFinite(osszeg), `a konverzió nem számot adott: ${JSON.stringify(eredmeny)}`).toBe(true);
    expect(osszeg > 0, 'a konvertált összeg nem pozitív').toBe(true);
  });
});

describe('Adószám-ellenőrzés (VIES) hibaágai', () => {
  it('a mért függvények léteznek', () => {
    expect(typeof vat.validateVatId).toBe('function');
    expect(typeof vat.computeVat).toBe('function');
  });

  it('a VIES kiesése nem akadályozhatja meg a számlázást', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('VIES down'));
    const eredmeny = await Promise.resolve(vat.validateVatId('HU12345678'))
      .then((x) => ({ ok: x })).catch((e) => ({ dobott: e }));
    expect(
      eredmeny.dobott,
      'A VIES-hiba kivételként jött vissza. Az Európai Bizottság szolgáltatása '
      + 'rendszeresen elérhetetlen — ettől a számla nem maradhat el.',
    ).toBeUndefined();
  });

  it('a bruttó/nettó számítás nem csúszhat el (a díj BRUTTÓ ár)', async () => {
    // ⚠️ Ez a 2026-07-19-i javítás őre: a motor eredetileg NETTÓNAK vette a
    // díjat, és az első éles számla 500 helyett 635 Ft-ról szólt volna.
    // (A függvény ASZINKRON, és `buyerCountry`-t vár, nem `country`-t.)
    const r = await vat.computeVat({
      buyerCountry: 'HU', amount: 500, amountIsGross: true, currency: 'HUF',
    });
    const brutto = r.gross ?? r.brutto ?? r.total ?? r.grossAmount;
    expect(
      brutto,
      `Az 500 Ft-os BRUTTÓ díjból nem 500 Ft bruttó lett (${JSON.stringify(r)}) — `
      + 'a felhasználónak ígért ár és a számla összege szétcsúszik.',
    ).toBe(500);
  });

  it('a parseTaxId string-bemenetre soha nem dob', () => {
    for (const rossz of ['', 'x', 'HU', 'HU ', '  ', 'HUABCDEFGH', '12345']) {
      expect(
        () => vat.parseTaxId(rossz),
        `parseTaxId(${JSON.stringify(rossz)}) kivételt dobott — a hibás adószám `
        + 'nem döntheti el a számlázást.',
      ).not.toThrow();
    }
    expect(vat.parseTaxId(''), 'üres adószámból mégis lett eredmény').toBeNull();
    expect(vat.parseTaxId('HU12345678'), 'az érvényes adószámot nem ismertük fel').toBeTruthy();
  });
});
