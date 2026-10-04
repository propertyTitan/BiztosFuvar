// =====================================================================
//  CIB PR-5/B — A KONFIGURÁCIÓ FAIL-CLOSED SZABÁLYAI (2026-10-03)
//
//  Amit ez a fájl őriz (mindegyik a javítás nélkül piros):
//   * a jövőbeli (elgépelt) CIB_BEVEZETES nem kapcsolhatja ki NÉMÁN a
//     lekérdező kört — „hibás" konfig (503, hangos boot-hiba);
//   * éles futásban a teszt-környezet üres / csupa érvénytelen allowlistje
//     mellett SENKI nem kapja a banki (tesztkártyás) utat — eddig mindenki;
//   * éles környezetben a banki host pontos engedélylistán van (hasonmás,
//     ponttal végződő teszt-host nem „teljes"), a visszatérési URL az API
//     hostján él (soha nem a web hostján), az ismert teszt-kulcs élesben hibás.
// =====================================================================
import {
  describe, it, expect, afterEach,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { ujKulcs, beallitEnv } = require('./cibHamisBank');
const p = require('../src/services/cibProtokoll');
const paymentProvider = require('../src/services/paymentProvider');

const K = ujKulcs();
const TITOK = 'teszt-hmac-titok-legalabb-harminckét-bájt-hosszú';
const USER = '11111111-1111-4111-8111-111111111111';
const MASIK = '22222222-2222-4222-8222-222222222222';

function teljesEnv(tobb = {}) {
  return {
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'cib',
    CIB_PID: K.pid,
    CIB_KEY_B64: K.b64,
    CIB_MARKET_URL: 'http://127.0.0.1:9/market.saki',
    CIB_CUSTOMER_URL: 'http://127.0.0.1:9/customer.saki',
    CIB_KORNYEZET: 'teszt',
    CIB_RETURN_URL: 'https://api.gofuvar.hu/payments/cib/vissza',
    CIB_HMAC_TITOK: TITOK,
    WEB_BASE_URL: 'https://www.gofuvar.hu',
    ...tobb,
  };
}
/** A mai Railway-állapot: éles futás, a bank TESZT-környezete. */
const elesTesztEnv = (tobb = {}) => teljesEnv({
  NODE_ENV: 'production',
  CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki',
  CIB_CUSTOMER_URL: 'https://ekit.cib.hu/customer.saki',
  ALLOW_STUB_PAYMENTS: '',
  ...tobb,
});
const elesEnv = (tobb = {}) => teljesEnv({
  NODE_ENV: 'production',
  CIB_KORNYEZET: 'eles',
  CIB_MARKET_URL: 'https://eki.cib.hu/market.saki',
  CIB_CUSTOMER_URL: 'https://eki.cib.hu/customer.saki',
  ...tobb,
});
const maUtc = () => new Date().toISOString().slice(0, 10);
const napMulva = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let visszaallit = () => {};
afterEach(() => { visszaallit(); visszaallit = () => {}; });

// =====================================================================
describe('CIB_BEVEZETES: a jövőbeli dátum hibás konfig, nem néma kikapcsolás', () => {
  it('a mai (UTC) napnál későbbi dátum → „hibas" (bevezetes_jovobeli), a mai és a múltbeli „teljes"', () => {
    const jovo = p.cibBeallitasok(teljesEnv({ CIB_BEVEZETES: napMulva(30) }));
    expect(jovo.allapot).toBe('hibas');
    expect(jovo.okok).toContain('bevezetes_jovobeli');
    expect(p.cibBeallitasok(teljesEnv({ CIB_BEVEZETES: '2026-01-01' })).allapot).toBe('teljes');
    expect(p.cibBeallitasok(teljesEnv({ CIB_BEVEZETES: maUtc() })).allapot).toBe('teljes');
  });

  it('a boot-napló hangos hibát ír (Sentry error), és a kártyás út „hibas" — a /pay 503, a kör nem fut', () => {
    const naplo = [];
    const jelzes = [];
    const konzol = { log: () => {}, warn: () => {}, error: (m) => naplo.push(m) };
    const sentry = { captureMessage: (m, szint) => jelzes.push([m, szint]) };
    p.naplozCibKonfigot({ env: teljesEnv({ CIB_BEVEZETES: napMulva(31) }), konzol, sentry });
    expect(naplo.join('\n')).toMatch(/bevezetes_jovobeli/);
    expect(jelzes.some(([m, szint]) => /bevezetes_jovobeli/.test(m) && szint === 'error')).toBe(true);
    visszaallit = beallitEnv(teljesEnv({ CIB_BEVEZETES: napMulva(32) }));
    expect(paymentProvider.fizetesiUt(USER)).toBe('hibas');
    expect(paymentProvider.usesCibEki()).toBe(false);
  });
});

// =====================================================================
describe('Teszt-allowlist: éles futásban fail-closed', () => {
  it('éles futás + teszt-környezet + ÜRES allowlist → senki sem kapja a banki utat', () => {
    visszaallit = beallitEnv(elesTesztEnv({ CIB_TESZT_FELHASZNALOK: '' }));
    expect(p.cibKonfig()).toBe('teljes');
    expect(paymentProvider.fizetesiUt(USER)).toBe('stub');
    expect(paymentProvider.fizetesiUt()).toBe('stub');
    // A kör ettől még él: a már elindult kísérleteket lezárja.
    expect(paymentProvider.usesCibEki()).toBe(true);
    // Biztonságos mód: a kézi nyugtázás ALLOW_STUB_PAYMENTS nélkül zárva.
    expect(paymentProvider.manualConfirmAllowed(USER)).toBe(false);
  });

  it('csupa érvénytelen (e-mail, idézőjeles) bejegyzés → senki sem kapja a banki utat — éles és nem éles futásban is', () => {
    for (const lista of ['jovanybusz@gmail.com,tisztahod@gmail.com', `"${USER}"`, ' , ,']) {
      visszaallit = beallitEnv(elesTesztEnv({ CIB_TESZT_FELHASZNALOK: lista }));
      expect(paymentProvider.fizetesiUt(USER), `éles: ${lista}`).toBe('stub');
      visszaallit();
      visszaallit = beallitEnv(teljesEnv({ CIB_TESZT_FELHASZNALOK: lista }));
      if (lista.trim().replace(/[ ,]/g, '')) {
        expect(paymentProvider.fizetesiUt(USER), `helyi: ${lista}`).toBe('stub');
      }
      visszaallit();
      visszaallit = () => {};
    }
  });

  it('a boot-napló hangos hibát ír a fail-closed allowlistről (Sentry error)', () => {
    const naplo = [];
    const jelzes = [];
    const konzol = { log: () => {}, warn: () => {}, error: (m) => naplo.push(m) };
    const sentry = { captureMessage: (m, szint) => jelzes.push([m, szint]) };
    p.naplozCibKonfigot({ env: elesTesztEnv({ CIB_TESZT_FELHASZNALOK: 'jovanybusz@gmail.com' }), konzol, sentry });
    expect(naplo.join('\n')).toMatch(/CIB_TESZT_FELHASZNALOK/);
    expect(jelzes.some(([m, szint]) => /CIB_TESZT_FELHASZNALOK/.test(m) && szint === 'error')).toBe(true);
  });

  it('érvényes allowlist: a listás user banki utat kap, a többi stubot (változatlan)', () => {
    visszaallit = beallitEnv(elesTesztEnv({ CIB_TESZT_FELHASZNALOK: `${USER}, rossz@bejegyzes` }));
    expect(paymentProvider.fizetesiUt(USER)).toBe('cib');
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('stub');
  });

  it('nem éles futás (helyi / hamis bank), allowlist nélkül: a mai szabály marad — mindenki banki utat kap', () => {
    visszaallit = beallitEnv(teljesEnv());
    expect(paymentProvider.fizetesiUt(USER)).toBe('cib');
  });
});

// =====================================================================
describe('Éles konfig: pontos host-engedélylista, a visszatérés az API hostján', () => {
  it('a bank által megerősített éles host „teljes"', () => {
    const b = p.cibBeallitasok(elesEnv());
    expect(b.allapot, JSON.stringify(b.okok)).toBe('teljes');
    expect(p.CIB_ELES_HOSTOK).toContain('eki.cib.hu');
  });

  const ROSSZ = [
    ['hasonmás market-host', { CIB_MARKET_URL: 'https://eki-cib.hu.example.net/market.saki' }],
    ['hasonmás customer-host (kártyaadat!)', { CIB_CUSTOMER_URL: 'https://eki.cib.hu.example.com/customer.saki' }],
    ['ponttal végződő teszt-host', { CIB_MARKET_URL: 'https://ekit.cib.hu./market.saki', CIB_CUSTOMER_URL: 'https://ekit.cib.hu./customer.saki' }],
    ['ponttal végződő éles host', { CIB_MARKET_URL: 'https://eki.cib.hu./market.saki' }],
    ['portos éles host', { CIB_CUSTOMER_URL: 'https://eki.cib.hu:8443/customer.saki' }],
  ];
  for (const [nev, felulir] of ROSSZ) {
    it(`${nev} → „hibas" (kornyezet_host_elteres)`, () => {
      const b = p.cibBeallitasok(elesEnv(felulir));
      expect(b.allapot).toBe('hibas');
      expect(b.okok).toContain('kornyezet_host_elteres');
    });
  }

  const ROSSZ_VISSZA = [
    ['a web hostján', 'https://www.gofuvar.hu/payments/cib/vissza'],
    ['a web apex-hostján', 'https://gofuvar.hu/payments/cib/vissza'],
    ['idegen (hasonmás) hoston', 'https://api.gofuvar-hu.example.net/payments/cib/vissza'],
  ];
  for (const [nev, url] of ROSSZ_VISSZA) {
    it(`a visszatérési URL ${nev} → „hibas" (return_url_nem_api_host)`, () => {
      const b = p.cibBeallitasok(elesEnv({ CIB_RETURN_URL: url }));
      expect(b.allapot).toBe('hibas');
      expect(b.okok).toContain('return_url_nem_api_host');
    });
  }

  it('apex web-host mellett a www-host sem lehet a visszatérés helye; az api-aldomain igen', () => {
    const www = p.cibBeallitasok(elesEnv({
      WEB_BASE_URL: 'https://gofuvar.hu', CIB_RETURN_URL: 'https://www.gofuvar.hu/payments/cib/vissza',
    }));
    expect(www.allapot).toBe('hibas');
    expect(www.okok).toContain('return_url_nem_api_host');
    const api = p.cibBeallitasok(elesEnv({ WEB_BASE_URL: 'https://gofuvar.hu' }));
    expect(api.allapot, JSON.stringify(api.okok)).toBe('teljes');
  });

  it('az ismert teszt-kulcs (ujjlenyomat) éles környezetben hibás', () => {
    expect(p.ismertTesztKulcs('5540ea8b5541')).toBe(true);
    expect(p.ismertTesztKulcs('5540ea8b5541ffee')).toBe(true);
    expect(p.ismertTesztKulcs(K.ujjlenyomat)).toBe(false);
    expect(p.ismertTesztKulcs(null)).toBe(false);
    // Élesben a teszt-kulcs ujjlenyomatára rögzített konfig is hibás (a kulcs
    // maga sem egyezik vele — de az ok kódja a teendőt mondja meg).
    const b = p.cibBeallitasok(elesEnv({ CIB_KEY_UJJLENYOMAT: '5540ea8b5541' }));
    expect(b.allapot).toBe('hibas');
    expect(b.okok).toContain('teszt_kulcs_elesben');
  });

  it('a teszt-környezet szabályai változatlanok (ekit.cib.hu, loopback csak nem éles futásban)', () => {
    expect(p.cibBeallitasok(elesTesztEnv()).allapot).toBe('teljes');
    expect(p.cibBeallitasok(teljesEnv()).allapot).toBe('teljes');
  });
});
