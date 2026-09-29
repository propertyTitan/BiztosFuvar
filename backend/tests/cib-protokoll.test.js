// =====================================================================
//  CIB EKI — KONFIG-FELOLDÁS, ÜZENETÉPÍTÉS, ELLENŐRZÉS, ÚTVÁLASZTÁS
//  (2026-09-29, CIB PR-2/A)
//
//  Ez a fájl a CIB-mag ALAPRÉTEGÉT őrzi, még a fizetési folyamat bekötése
//  előtt. Mindegyik csoport egy konkrét, pénzbe kerülő hibamód ellen véd:
//
//   * KONFIG: egy félig beállított env (kulcs nélkül, rossz host, felcserélt
//     teszt/éles kulcs) NEM indulhat „teljes" módban, és a stub sem nyílhat
//     vissza — különben a platform vagy nem szed díjat, vagy a teszt-bankkal
//     „fizettet" élesben. A régi (vPOS) env-párosról sem eshet vissza némán
//     stubra.
//   * ÜZENETEK: a TRID 16 jegy, a UID nem személyes adat, a TS a DB órájából
//     jön Budapest szerint, és csak az előírt mezők mennek ki (C*-mező soha).
//   * ELLENŐRZÉS: a bank válaszában a CRC nem MAC — sikernek csak a DB-vel
//     EGYEZŐ TRID/AMO/PID/CUR számít; a CNUM (maszkolt kártyaszám) sosem
//     kerül az eredménybe.
//   * OSZTÁLYOZÁS: a zárásnál a „bizonyítottan fel nem dolgozott" és a
//     „kétes" kimenet szétválasztása a kettős terhelés elleni fő védelem.
//   * ÚTVÁLASZTÁS: a teszt-allowlist CSAK teszt-környezetben hat, élesben
//     mindenki a valódi CIB-utat kapja; a kézi nyugtázás a CIB-úton zárva.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';

const util = require('util');
const crypto = require('crypto');
const { db } = require('./helpers');
const eki = require('../src/services/ekiCrypt');
const { ujKulcs, beallitEnv } = require('./cibHamisBank');

const p = require('../src/services/cibProtokoll');
const paymentProvider = require('../src/services/paymentProvider');
const cib = require('../src/services/cib');

const K = ujKulcs();
const TITOK = 'teszt-hmac-titok-legalabb-harminckét-bájt-hosszú';

/** Egy TELJES, érvényes teszt-környezeti env (a hamis bank loopback címével). */
function teljesEnv(tobb = {}) {
  return {
    NODE_ENV: 'test',
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
const elesEnv = (tobb = {}) => teljesEnv({
  NODE_ENV: 'production',
  CIB_KORNYEZET: 'eles',
  CIB_MARKET_URL: 'https://eki.cib.hu/market.saki',
  CIB_CUSTOMER_URL: 'https://eki.cib.hu/customer.saki',
  ...tobb,
});

// =====================================================================
//  1) KONFIG-FELOLDÁS
// =====================================================================
describe('cibKonfig: nincs / teljes / hibás', () => {
  it('CIB-env nélkül „nincs" — ma a Railway-en pontosan így fut minden (stub)', () => {
    expect(p.cibKonfig({ NODE_ENV: 'production' })).toBe('nincs');
    expect(p.cibKonfig({})).toBe('nincs');
    // A teszt-környezet maga is ilyen: az env-setup minden CIB-kulcsot kiüresít.
    expect(p.cibKonfig()).toBe('nincs');
  });

  it('teljes, érvényes teszt-konfig → „teljes", a kulcs és a titok nem felsorolható', () => {
    const b = p.cibBeallitasok(teljesEnv());
    expect(b.allapot, JSON.stringify(b.okok)).toBe('teljes');
    expect(b.kornyezet).toBe('teszt');
    expect(b.pid).toBe(K.pid);
    expect(b.ujjlenyomat).toBe(K.ujjlenyomat);
    expect(b.apiOrigin).toBe('https://api.gofuvar.hu');
    expect(b.kulcs && b.kulcs.pid).toBe(K.pid);
    expect(b.hmacTitok).toBe(TITOK);
    // Egy `console.log(b)`, egy JSON-naplósor vagy egy Sentry-kontextus se
    // vigye ki a kulcsot / a HMAC-titkot.
    const kiirt = `${JSON.stringify(b)} ${util.inspect(b, { depth: 5 })}`;
    expect(kiirt).not.toContain(K.b64);
    expect(kiirt).not.toContain(TITOK);
    expect(Object.keys(b)).not.toContain('kulcs');
    expect(Object.keys(b)).not.toContain('hmacTitok');
  });

  it('élesen az éles hosttal, https-sel → „teljes"', () => {
    expect(p.cibKonfig(elesEnv())).toBe('teljes');
  });

  for (const hianyzo of ['CIB_PID', 'CIB_KEY_B64', 'CIB_MARKET_URL', 'CIB_CUSTOMER_URL',
    'CIB_KORNYEZET', 'CIB_RETURN_URL', 'CIB_HMAC_TITOK']) {
    it(`részleges konfig (${hianyzo} hiányzik) → „hibás", nem „nincs" (a stub nem nyílik vissza)`, () => {
      const env = teljesEnv();
      delete env[hianyzo];
      const b = p.cibBeallitasok(env);
      expect(b.allapot).toBe('hibas');
      expect(b.okok).toContain(`hianyzo:${hianyzo}`);
    });
  }

  const HIBAS = [
    ['ismeretlen környezet', { CIB_KORNYEZET: 'prod' }, 'kornyezet_ervenytelen'],
    ['teszt-környezet az ÉLES hosttal', { CIB_MARKET_URL: 'https://eki.cib.hu/market.saki' }, 'kornyezet_host_elteres'],
    ['éles környezet a TESZT hosttal', { NODE_ENV: 'production', CIB_KORNYEZET: 'eles', CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki', CIB_CUSTOMER_URL: 'https://eki.cib.hu/customer.saki' }, 'kornyezet_host_elteres'],
    ['éles környezet http-vel', { NODE_ENV: 'production', CIB_KORNYEZET: 'eles', CIB_MARKET_URL: 'http://eki.cib.hu/market.saki', CIB_CUSTOMER_URL: 'https://eki.cib.hu/customer.saki' }, 'kornyezet_host_elteres'],
    ['éles környezet loopbackkel', { NODE_ENV: 'production', CIB_KORNYEZET: 'eles' }, 'kornyezet_host_elteres'],
    ['loopback teszt-bank éles futásban', { NODE_ENV: 'production' }, 'kornyezet_host_elteres'],
    ['market URL query-vel', { CIB_MARKET_URL: 'http://127.0.0.1:9/market.saki?x=1' }, 'market_url_ervenytelen'],
    ['customer URL nem URL', { CIB_CUSTOMER_URL: 'nem-url' }, 'customer_url_ervenytelen'],
    ['visszatérési URL útvonal nélkül', { CIB_RETURN_URL: 'https://api.gofuvar.hu' }, 'return_url_ervenytelen'],
    ['visszatérési URL query-vel', { CIB_RETURN_URL: 'https://api.gofuvar.hu/payments/cib/vissza?a=1' }, 'return_url_ervenytelen'],
    ['visszatérési URL #-tel', { CIB_RETURN_URL: 'https://api.gofuvar.hu/payments/cib/vissza#x' }, 'return_url_ervenytelen'],
    ['visszatérési URL rossz útvonallal', { CIB_RETURN_URL: 'https://api.gofuvar.hu/fizetes/vissza' }, 'return_url_ervenytelen'],
    ['visszatérési URL pont nélküli hosttal', { CIB_RETURN_URL: 'https://localhost/payments/cib/vissza' }, 'return_url_ervenytelen'],
    ['visszatérési URL http-vel éles futásban', { NODE_ENV: 'production', CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki', CIB_CUSTOMER_URL: 'https://ekit.cib.hu/customer.saki', CIB_RETURN_URL: 'http://api.gofuvar.hu/payments/cib/vissza' }, 'return_url_ervenytelen'],
    ['túl rövid HMAC-titok', { CIB_HMAC_TITOK: 'rovid-titok' }, 'hmac_titok_rovid'],
    ['sérült kulcsfájl', { CIB_KEY_B64: Buffer.alloc(20).toString('base64') }, 'kulcs_hibas'],
    ['másik áruház kulcsa', { CIB_PID: 'ABC0001' }, 'kulcs_hibas'],
    ['eltérő kulcs-ujjlenyomat (felcserélt teszt/éles kulcs)', { CIB_KEY_UJJLENYOMAT: '000000000000' }, 'kulcs_ujjlenyomat_elteres'],
    ['formailag hibás ujjlenyomat', { CIB_KEY_UJJLENYOMAT: 'xyz' }, 'kulcs_ujjlenyomat_ervenytelen'],
    ['ismeretlen időzóna', { CIB_TS_IDOZONA: 'Europe/Nincsilyen' }, 'idozona_ervenytelen'],
    ['éles futás WEB_BASE_URL nélkül', { NODE_ENV: 'production', CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki', CIB_CUSTOMER_URL: 'https://ekit.cib.hu/customer.saki', WEB_BASE_URL: undefined }, 'web_base_url_ervenytelen'],
  ];
  for (const [nev, felulir, ok] of HIBAS) {
    it(`„hibás": ${nev} (${ok})`, () => {
      const env = teljesEnv(felulir);
      for (const [kk, v] of Object.entries(felulir)) if (v === undefined) delete env[kk];
      const b = p.cibBeallitasok(env);
      expect(b.allapot, `${nev}: ${JSON.stringify(b.okok)}`).toBe('hibas');
      expect(b.okok).toContain(ok);
    });
  }

  it('egyező kulcs-ujjlenyomat (12 vagy több hexa) → „teljes"', () => {
    const teljesHash = crypto.createHash('sha256').update(K.buf).digest('hex');
    expect(p.cibKonfig(teljesEnv({ CIB_KEY_UJJLENYOMAT: K.ujjlenyomat }))).toBe('teljes');
    expect(p.cibKonfig(teljesEnv({ CIB_KEY_UJJLENYOMAT: teljesHash.toUpperCase() }))).toBe('teljes');
  });

  it('a 3DES-önteszt kudarca → „hibás" (egy Node/OpenSSL-frissítés kivehette)', () => {
    const spy = vi.spyOn(eki, 'selfTest').mockReturnValue(false);
    try {
      const b = p.cibBeallitasok(teljesEnv({ CIB_HMAC_TITOK: `${TITOK}-selftest` }));
      expect(b.allapot).toBe('hibas');
      expect(b.okok).toContain('selftest_hiba');
    } finally { spy.mockRestore(); }
  });

  it('a kivezetett vPOS-pár (CIB_API_KEY + CIB_MERCHANT_ID) önmagában „hibás" — nem esik vissza stubra', () => {
    // Ma e kettővel a stub ZÁRVA van (isStub=false). Ha az új konfig-feloldás
    // „nincs"-nek látná, egy elfelejtett régi env a kézi nyugtázást nyitná ki.
    const b = p.cibBeallitasok({ CIB_API_KEY: 'x', CIB_MERCHANT_ID: 'y' });
    expect(b.allapot).toBe('hibas');
    expect(b.okok).toContain('elavult_vpos_kulcsok');
    const egy = p.cibBeallitasok({ CIB_API_KEY: 'x' });
    expect(egy.allapot).toBe('nincs');
    expect(egy.figyelmeztetesek.join(' ')).toMatch(/CIB_API_KEY/);
  });

  it('az allowlist CSAK teszt-környezetben hat; élesben figyelmen kívül marad és figyelmeztet', () => {
    const u1 = '11111111-1111-4111-8111-111111111111';
    const u2 = '22222222-2222-4222-8222-222222222222';
    const t = p.cibBeallitasok(teljesEnv({ CIB_TESZT_FELHASZNALOK: ` ${u1}, ${u2.toUpperCase()} ,nem-uuid` }));
    expect(t.allapot).toBe('teljes');
    expect(t.tesztFelhasznalok).toEqual([u1, u2]);
    expect(t.figyelmeztetesek.join(' ')).toMatch(/nem-uuid|érvénytelen/);
    const e = p.cibBeallitasok(elesEnv({ CIB_TESZT_FELHASZNALOK: u1 }));
    expect(e.allapot).toBe('teljes');
    expect(e.tesztFelhasznalok).toEqual([]);
    expect(e.figyelmeztetesek.join(' ')).toMatch(/CIB_TESZT_FELHASZNALOK/);
  });

  it('a hangolók alapértéke a terv szerinti; a hibás érték figyelmeztet, és az alapérték marad', () => {
    const b = p.cibBeallitasok(teljesEnv({ CIB_ZARAS_TIMEOUT_MS: 'sok', CIB_HOP_TTL_MP: '-5' }));
    expect(b.allapot).toBe('teljes');
    expect(b.hangolok).toMatchObject({
      httpIdokeretMs: 30000, zarasIdokeretMs: 45000, inditasOsszkeretMs: 40000,
      lekerdezesKozMs: 60000, korTickMs: 30000, korMaxKeres: 10, kiserletMaxPerc: 30,
      hopTtlMp: 120, maxInditasOrankent: 6, maxInditasNaponta: 20,
    });
    expect(b.figyelmeztetesek.join(' ')).toMatch(/CIB_ZARAS_TIMEOUT_MS/);
    expect(b.figyelmeztetesek.join(' ')).toMatch(/CIB_HOP_TTL_MP/);
    expect(b.tsIdozona).toBe('Europe/Budapest');
    expect(b.extra01).toBe(false);
    expect(b.sikertelenLezaras).toBe(true);
    expect(b.riasztasEmail).toBe('info@gofuvar.hu');
    expect(b.bevezetes).toBe(p.CIB_BEVEZETES_ALAP);
  });

  it('a kapcsolók és a bevezetés-dátum: érvényes érték átmegy, a hibás figyelmeztet és alapértéken marad', () => {
    const jo = p.cibBeallitasok(teljesEnv({
      CIB_EXTRA01: 'TRUE', CIB_SIKERTELEN_LEZARAS: '0', CIB_BEVEZETES: '2026-10-05', CIB_KOR_MAX_KERES: '25',
    }));
    expect(jo).toMatchObject({ allapot: 'teljes', extra01: true, sikertelenLezaras: false, bevezetes: '2026-10-05' });
    expect(jo.hangolok.korMaxKeres).toBe(25);
    const rossz = p.cibBeallitasok(teljesEnv({ CIB_EXTRA01: 'talán', CIB_BEVEZETES: 'holnap' }));
    expect(rossz).toMatchObject({ allapot: 'teljes', extra01: false, bevezetes: p.CIB_BEVEZETES_ALAP });
    expect(rossz.figyelmeztetesek.join(' ')).toMatch(/CIB_EXTRA01/);
    expect(rossz.figyelmeztetesek.join(' ')).toMatch(/CIB_BEVEZETES/);
  });

  it('csak hangoló / opcionális változó a kötelezők nélkül: „nincs", de figyelmeztet (hatástalan)', () => {
    const b = p.cibBeallitasok({ CIB_KEY_UJJLENYOMAT: 'abcdefabcdef', CIB_HTTP_TIMEOUT_MS: '5000' });
    expect(b.allapot).toBe('nincs');
    expect(b.figyelmeztetesek.join(' ')).toMatch(/hatástalan/);
  });

  it('a WEB_BASE_URL útvonallal vagy query-vel hibás; nem éles futásban hiányozhat (helyi alapérték)', () => {
    expect(p.cibBeallitasok(teljesEnv({ WEB_BASE_URL: 'https://www.gofuvar.hu/app' })).okok).toContain('web_base_url_ervenytelen');
    const env = teljesEnv();
    delete env.WEB_BASE_URL;
    expect(p.cibBeallitasok(env)).toMatchObject({ allapot: 'teljes', webBaseUrl: 'http://localhost:3000' });
  });

  it('a hibás konfigban sem a kulcs, sem a titok nem érhető el (a hívó nem építhet rá)', () => {
    const b = p.cibBeallitasok(teljesEnv({ CIB_KEY_UJJLENYOMAT: '000000000000' }));
    expect(b.allapot).toBe('hibas');
    expect(b.kulcs).toBe(null);
    expect(b.hmacTitok).toBe(null);
    expect(() => p.customerUrl(b, '0123456789012345')).toThrow();
  });
});

// =====================================================================
//  2) INDULÁSKORI NAPLÓ — csak ujjlenyomat, soha kulcs
// =====================================================================
describe('naplozCibKonfigot: a boot-napló', () => {
  function konzolSpy() {
    const sorok = [];
    const fel = (...a) => sorok.push(a.map(String).join(' '));
    return { sorok, konzol: { log: fel, warn: fel, error: fel } };
  }

  it('„teljes": az ujjlenyomat és a környezet igen, a kulcs és a HMAC-titok SOHA', () => {
    const { sorok, konzol } = konzolSpy();
    const sentry = { captureMessage: vi.fn() };
    p.naplozCibKonfigot({ env: teljesEnv(), konzol, sentry });
    const osszes = sorok.join('\n');
    expect(osszes).toContain(K.ujjlenyomat);
    expect(osszes).toMatch(/teszt/);
    expect(osszes).not.toContain(K.b64);
    expect(osszes).not.toContain(TITOK);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('„hibás": hangos hiba + Sentry error, az okokkal — értékek nélkül', () => {
    const { sorok, konzol } = konzolSpy();
    const sentry = { captureMessage: vi.fn() };
    p.naplozCibKonfigot({ env: teljesEnv({ CIB_KEY_UJJLENYOMAT: '000000000000' }), konzol, sentry });
    const osszes = sorok.join('\n');
    expect(osszes).toMatch(/kulcs_ujjlenyomat_elteres/);
    expect(osszes).not.toContain(K.b64);
    expect(osszes).not.toContain(TITOK);
    expect(sentry.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/CIB/), 'error');
  });

  it('„nincs": nem riaszt (ma ez a normál üzem)', () => {
    const { konzol } = konzolSpy();
    const sentry = { captureMessage: vi.fn() };
    p.naplozCibKonfigot({ env: {}, konzol, sentry });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

// =====================================================================
//  3) ÜZENETÉPÍTŐK és kötött mezőértékek
// =====================================================================
describe('TRID, UID, TS', () => {
  it('a TRID pontosan 16 számjegy, egyedi, és a vezető nulla is megmarad', () => {
    const latott = new Set();
    for (let i = 0; i < 2000; i++) {
      const t = p.ujTrid();
      expect(t).toMatch(/^[0-9]{16}$/);
      latott.add(t);
    }
    expect(latott.size).toBe(2000);
    const spy = vi.spyOn(crypto, 'randomInt').mockReturnValue(7);
    try {
      expect(p.ujTrid()).toBe('0000000700000007');
    } finally { spy.mockRestore(); }
  });

  it('a UID ≤11 alfanumerikus, determinisztikus, nem e-mail és nem a user-azonosító', () => {
    const felado = '5b3c1f8e-2a4d-4c6b-9e7f-0123456789ab';
    const uid = p.uidAlnev(felado, TITOK);
    expect(uid).toMatch(/^G[A-Z2-7]{10}$/);
    expect(p.uidAlnev(felado, TITOK)).toBe(uid);
    expect(p.uidAlnev('6b3c1f8e-2a4d-4c6b-9e7f-0123456789ab', TITOK)).not.toBe(uid);
    expect(p.uidAlnev(felado, `${TITOK}-masik`)).not.toBe(uid);
    expect(uid).not.toMatch(/@/);
    expect(felado.toUpperCase()).not.toContain(uid.slice(1));
  });

  it('a TS a DB órájából, Europe/Budapest szerint — UTC-s munkamenet mellett is', async () => {
    const client = await db.pool.connect();
    try {
      await client.query("SET TIME ZONE 'UTC'");
      // Egy tranzakcióban a NOW() állandó (a tranzakció kezdete) — így a TS
      // és a független számítás PONTOSAN egyezik, perc-/napfordulón is.
      await client.query('BEGIN');
      const ts = await p.lekerTs(client, 'Europe/Budapest');
      const { rows } = await client.query('SELECT NOW() AS most');
      await client.query('COMMIT');
      expect(ts).toMatch(/^[0-9]{14}$/);
      const f = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(rows[0].most));
      const r = Object.fromEntries(f.map((x) => [x.type, x.value]));
      expect(ts).toBe(`${r.year}${r.month}${r.day}${r.hour}${r.minute}${r.second}`);
      // Nem a UTC-idő (nyári időszámításban +2, télen +1 óra az eltérés).
      const utc = new Date(rows[0].most).toISOString().replace(/[-T:]/g, '').slice(0, 14);
      expect(ts).not.toBe(utc);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('RESET TIME ZONE');
      client.release();
    }
  });
});

describe('üzenetépítők', () => {
  const ALAP = {
    pid: K.pid, trid: '0123456789012345', uid: 'GABCDEFGHIJ', amo: 500,
    ts: '20260929123456', url: 'https://api.gofuvar.hu/payments/cib/vissza',
  };

  it('MSGT10: pontosan az előírt mezők, sorrendben; C*-mező soha; EXTRA01 csak kapcsolóval', () => {
    const m = p.msgt10Mezok(ALAP);
    expect(m.map(([n]) => n)).toEqual(['PID', 'TRID', 'MSGT', 'UID', 'AMO', 'CUR', 'TS', 'AUTH', 'LANG', 'URL']);
    expect(Object.fromEntries(m)).toMatchObject({
      MSGT: '10', AMO: '500', CUR: 'HUF', AUTH: '0', LANG: 'HU', URL: ALAP.url,
    });
    expect(m.some(([n]) => /^C(NAME|ADDR|EMAIL|CITY|POSTAL|STATE|COUNTRY)$/.test(n))).toBe(false);
    const x = p.msgt10Mezok({ ...ALAP, extra01JobId: 'abcdef12-3456-7890-abcd-ef1234567890' });
    expect(Object.fromEntries(x).EXTRA01).toBe('GFabcdef12');
    // A mezők a valódi titkosítón is átmennek, és visszafejthetők.
    const v = eki.ekiDecrypt(eki.ekiEncrypt(m, K.kulcs), K.kulcs);
    expect(v).toMatchObject({ MSGT: '10', TRID: ALAP.trid, AMO: '500', TS: ALAP.ts, UID: ALAP.uid });
  });

  it('MSGT10: hibás bemenet (tört/negatív összeg, rossz TRID/TS/UID) hívói hiba, nem banki üzenet', () => {
    expect(() => p.msgt10Mezok({ ...ALAP, amo: 500.5 })).toThrow();
    expect(() => p.msgt10Mezok({ ...ALAP, amo: 0 })).toThrow();
    expect(() => p.msgt10Mezok({ ...ALAP, trid: '123' })).toThrow();
    expect(() => p.msgt10Mezok({ ...ALAP, ts: '2026-09-29' })).toThrow();
    expect(() => p.msgt10Mezok({ ...ALAP, uid: 'a@b.hu' })).toThrow();
  });

  it('MSGT20 / 32 / 33: PID, TRID, MSGT (+AMO a lekérdezéseknél)', () => {
    expect(p.msgt20Mezok(ALAP)).toEqual([['PID', K.pid], ['TRID', ALAP.trid], ['MSGT', '20']]);
    expect(p.msgt32Mezok(ALAP)).toEqual([['PID', K.pid], ['TRID', ALAP.trid], ['MSGT', '32'], ['AMO', '500']]);
    expect(p.msgt33Mezok(ALAP)).toEqual([['PID', K.pid], ['TRID', ALAP.trid], ['MSGT', '33'], ['AMO', '500']]);
  });

  it('a vásárlói átirányítás URL-je a customer URL + a titkosított MSGT20', () => {
    const b = p.cibBeallitasok(teljesEnv());
    const u = p.customerUrl(b, ALAP.trid);
    expect(u.startsWith('http://127.0.0.1:9/customer.saki?PID=')).toBe(true);
    expect(eki.ekiDecrypt(u.slice(u.indexOf('?') + 1), K.kulcs)).toMatchObject({ MSGT: '20', TRID: ALAP.trid });
  });

  it('a naplóba csak maszkolt TRID kerül (a 16 jegy kártyaszámnak látszhat)', () => {
    expect(p.maszkoltTrid('0123456789012345')).toBe('…2345');
  });
});

// =====================================================================
//  4) VÁLASZ-ELLENŐRZÉS a tárolt kísérlethez
// =====================================================================
describe('ellenorizMsgt11 / ellenorizMsgt31', () => {
  const S = { payment_id: '0123456789012345', amount_huf: 500, currency: 'HUF' };
  const j31 = (tobb = {}) => ({
    MSGT: '31', PID: K.pid, TRID: S.payment_id, AMO: '500', RC: '00', RT: 'Sikeres tranzakció', ANUM: 'A1B2C3', CNUM: '4***1234', ...tobb,
  });

  it('MSGT11: MSGT/PID/TRID egyezés kötelező', () => {
    expect(p.ellenorizMsgt11({ MSGT: '11', PID: K.pid, TRID: S.payment_id, RC: '00' }, S, K.pid)).toMatchObject({ ok: true, rc: '00' });
    expect(p.ellenorizMsgt11({ MSGT: '31', PID: K.pid, TRID: S.payment_id, RC: '00' }, S, K.pid)).toMatchObject({ ok: false, mezo: 'MSGT' });
    expect(p.ellenorizMsgt11({ MSGT: '11', PID: 'ABC0001', TRID: S.payment_id, RC: '00' }, S, K.pid)).toMatchObject({ ok: false, mezo: 'PID' });
    expect(p.ellenorizMsgt11({ MSGT: '11', PID: K.pid, TRID: '9999999999999999', RC: '00' }, S, K.pid)).toMatchObject({ ok: false, mezo: 'TRID' });
    expect(p.ellenorizMsgt11({ MSGT: '11', PID: K.pid, TRID: S.payment_id }, S, K.pid)).toMatchObject({ ok: false, mezo: 'RC' });
  });

  it('MSGT31: egyező mezőknél az adatok — CNUM NÉLKÜL; a szóközzel kitöltött AMO is egyezik', () => {
    const r = p.ellenorizMsgt31(j31({ AMO: '  500' }), S, K.pid);
    expect(r.ok).toBe(true);
    expect(r.adatok).toEqual({
      trid: S.payment_id, rc: '00', rt: 'Sikeres tranzakció', anum: 'A1B2C3', amo: 500, cur: 'HUF',
    });
    expect(JSON.stringify(r)).not.toContain('4***1234');
  });

  for (const [nev, mezok, mezo] of [
    ['más üzenettípus', { MSGT: '11' }, 'MSGT'],
    ['idegen PID', { PID: 'ABC0001' }, 'PID'],
    ['más TRID', { TRID: '0123456789012346' }, 'TRID'],
    ['eltérő összeg', { AMO: '5000' }, 'AMO'],
    ['hiányzó összeg', { AMO: undefined }, 'AMO'],
    ['szemét összeg', { AMO: '500abc' }, 'AMO'],
    ['más deviza', { CUR: 'EUR' }, 'CUR'],
    ['hiányzó RC', { RC: undefined }, 'RC'],
    ['formailag hibás RC', { RC: '0' }, 'RC'],
  ]) {
    it(`MSGT31 mezőeltérés: ${nev} → nem építünk rá (${mezo})`, () => {
      const m = j31(mezok);
      for (const [kk, v] of Object.entries(mezok)) if (v === undefined) delete m[kk];
      const r = p.ellenorizMsgt31(m, S, K.pid);
      expect(r.ok).toBe(false);
      expect(r.hiba).toBe('mezo_elteres');
      expect(r.mezo).toBe(mezo);
    });
  }

  it('az RT legfeljebb 255 karakter, vezérlőkarakter nélkül; a szóközös ANUM levágódik', () => {
    const r = p.ellenorizMsgt31(j31({ RT: `a\u0000b${'x'.repeat(400)}`, ANUM: ' A1B2 ' }), S, K.pid);
    expect(r.ok).toBe(true);
    expect(r.adatok.rt.length).toBeLessThanOrEqual(255);
    expect(r.adatok.rt).not.toMatch(/[\u0000-\u001f]/);
    expect(r.adatok.anum).toBe('A1B2');
  });
});

// =====================================================================
//  5) KIMENET-OSZTÁLYOZÁS (a hívó kliens-eredményéből)
// =====================================================================
describe('kimenet-osztályozás', () => {
  const S = { payment_id: '0123456789012345', amount_huf: 500, currency: 'HUF' };
  const valasz = (mezok, tobb = {}) => ({
    kuldve: true, http: 200, mezok, bankRc: null, hibaOsztaly: null, ...tobb,
  });
  const m31 = (rc, tobb = {}) => ({
    MSGT: '31', PID: K.pid, TRID: S.payment_id, AMO: '500', RC: rc, RT: 'x', ANUM: rc === '00' ? 'ABC123' : '', ...tobb,
  });
  const hiba = (hibaOsztaly, tobb = {}) => ({
    kuldve: hibaOsztaly !== 'nem_kuldott', http: null, mezok: null, bankRc: null, hibaOsztaly, ...tobb,
  });
  const bank = (rc, http = 500) => ({
    kuldve: true, http, mezok: null, bankRc: rc, hibaOsztaly: rc[0] === 'S' ? 'bank_S' : 'bank_D',
  });

  it('bankKodOsztaly: Sxx → bank_S, Dxx → bank_D, más → null', () => {
    expect(p.bankKodOsztaly('S01')).toBe('bank_S');
    expect(p.bankKodOsztaly('D04')).toBe('bank_D');
    expect(p.bankKodOsztaly('00')).toBe(null);
  });

  it('indítás (MSGT10→11): 00 kész; 02 új TRID; 01 sikertelen; banki S/D, hálózat, időkeret sikertelen', () => {
    const m11 = (rc) => ({ MSGT: '11', PID: K.pid, TRID: S.payment_id, RC: rc });
    expect(p.inditasKimenet(valasz(m11('00')), S, K.pid)).toMatchObject({ kimenet: 'kesz' });
    expect(p.inditasKimenet(valasz(m11('02')), S, K.pid)).toMatchObject({ kimenet: 'trid_foglalt', ok: 'trid_foglalt' });
    expect(p.inditasKimenet(valasz(m11('01')), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_rc01' });
    expect(p.inditasKimenet(valasz(m11('77')), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_rc01' });
    expect(p.inditasKimenet(bank('S01', 200), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_bank_S', megszakito: true });
    expect(p.inditasKimenet(bank('D04'), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_bank_S', foglalt: true });
    expect(p.inditasKimenet(hiba('idokeret'), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_idokeret', megszakito: true });
    expect(p.inditasKimenet(hiba('nem_kuldott'), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_idokeret', megszakito: true });
    expect(p.inditasKimenet(hiba('visszafejtes', { http: 200 }), S, K.pid)).toMatchObject({ kimenet: 'sikertelen' });
    expect(p.inditasKimenet(valasz({ ...m11('00'), TRID: '1111111111111111' }), S, K.pid)).toMatchObject({ kimenet: 'sikertelen', ok: 'init_valasz_hibas' });
  });

  it('lekérdezés (MSGT33): PR vár, 00 engedélyezve, TO lejárt, más RC elutasítva, NT külön, D04 visszalépés', () => {
    expect(p.lekerdezesKimenet(valasz(m31('PR')), S, K.pid)).toMatchObject({ kimenet: 'folyamatban' });
    expect(p.lekerdezesKimenet(valasz(m31('00')), S, K.pid)).toMatchObject({ kimenet: 'engedelyezve', adatok: expect.objectContaining({ rc: '00', anum: 'ABC123' }) });
    expect(p.lekerdezesKimenet(valasz(m31('TO')), S, K.pid)).toMatchObject({ kimenet: 'lejart', ok: 'bank_to' });
    expect(p.lekerdezesKimenet(valasz(m31('51')), S, K.pid)).toMatchObject({ kimenet: 'elutasitva', ok: 'bank_elutasitas' });
    expect(p.lekerdezesKimenet(valasz(m31('X0')), S, K.pid)).toMatchObject({ kimenet: 'elutasitva' });
    expect(p.lekerdezesKimenet(valasz(m31('NT')), S, K.pid)).toMatchObject({ kimenet: 'nem_talalt' });
    expect(p.lekerdezesKimenet(valasz(m31('00', { AMO: '999' })), S, K.pid)).toMatchObject({ kimenet: 'mezo_elteres' });
    expect(p.lekerdezesKimenet(bank('D04'), S, K.pid)).toMatchObject({ kimenet: 'visszalepes' });
    expect(p.lekerdezesKimenet(bank('S01', 403), S, K.pid)).toMatchObject({ kimenet: 'bank_s', megszakito: true });
    expect(p.lekerdezesKimenet(bank('S01', 200), S, K.pid)).toMatchObject({ kimenet: 'bank_s' });
    for (const o of ['idokeret', 'halozat', 'nem_kuldott', 'http', 'visszafejtes']) {
      expect(p.lekerdezesKimenet(hiba(o), S, K.pid), o).toMatchObject({ kimenet: 'folyamatban', hiba: o });
    }
  });

  it('zárás (MSGT32): 00 siker; TO lejárt; más RC elutasítva; D03/D04/D07, PR és a küldés előtti hiba NEM FELDOLGOZOTT', () => {
    expect(p.zarasKimenet(valasz(m31('00')), S, K.pid)).toMatchObject({ kimenet: 'siker', adatok: expect.objectContaining({ anum: 'ABC123' }) });
    expect(p.zarasKimenet(valasz(m31('TO')), S, K.pid)).toMatchObject({ kimenet: 'lejart', ok: 'bank_to' });
    expect(p.zarasKimenet(valasz(m31('51')), S, K.pid)).toMatchObject({ kimenet: 'elutasitva', ok: 'bank_elutasitas' });
    expect(p.zarasKimenet(valasz(m31('PR')), S, K.pid)).toMatchObject({ kimenet: 'nem_feldolgozott' });
    for (const d of ['D03', 'D07']) expect(p.zarasKimenet(bank(d), S, K.pid), d).toMatchObject({ kimenet: 'nem_feldolgozott' });
    expect(p.zarasKimenet(bank('D04'), S, K.pid)).toMatchObject({ kimenet: 'nem_feldolgozott', visszalepesMs: 60000 });
    expect(p.zarasKimenet(hiba('nem_kuldott'), S, K.pid)).toMatchObject({ kimenet: 'nem_feldolgozott', visszalepesMs: 30000 });
  });

  it('zárás: minden más KÉTES — a MSGT32-t SOHA nem küldjük újra (kettős terhelés ellen)', () => {
    const esetek = [
      [hiba('idokeret'), 'zaras_valasz_nelkul'],
      [hiba('halozat'), 'zaras_valasz_nelkul'],
      [hiba('http', { http: 502 }), 'zaras_valasz_nelkul'],
      [bank('D05'), 'zaras_d05'],
      [bank('S01', 403), 'zaras_s'],
      [bank('S01', 200), 'zaras_s'],
      [bank('D06'), 'zaras_bank_d'],
      [hiba('visszafejtes', { http: 200 }), 'zaras_mezo_elteres'],
      [valasz(m31('00', { AMO: '999' })), 'zaras_mezo_elteres'],
      [valasz(m31('00', { TRID: '0123456789012346' })), 'zaras_mezo_elteres'],
    ];
    for (const [v, ok] of esetek) {
      expect(p.zarasKimenet(v, S, K.pid), ok).toMatchObject({ kimenet: 'ketes', ok });
    }
  });

  it('elutasított eredetű zárásnál MINDEN nem-00 kimenet „elutasitva" (onnan terhelés nem lehet)', () => {
    const o = { eredete: 'declined' };
    expect(p.zarasKimenet(valasz(m31('00')), S, K.pid, o)).toMatchObject({ kimenet: 'siker' });
    for (const v of [hiba('idokeret'), hiba('nem_kuldott'), bank('D05'), bank('D04'), valasz(m31('TO')), valasz(m31('PR'))]) {
      expect(p.zarasKimenet(v, S, K.pid, o)).toMatchObject({ kimenet: 'elutasitva' });
    }
  });
});

// =====================================================================
//  6) ÚTVÁLASZTÁS felhasználónként (paymentProvider)
// =====================================================================
describe('paymentProvider.fizetesiUt / usesCibEki / manualConfirmAllowed', () => {
  const LISTAS = '33333333-3333-4333-8333-333333333333';
  const MASIK = '44444444-4444-4444-8444-444444444444';
  let visszaallit = () => {};
  afterEach(() => { visszaallit(); visszaallit = () => {}; });

  it('CIB-env nélkül: stub — ma bitre azonos (kézi nyugtázás nyitva teszt-futásban, cib-stub-<id>)', async () => {
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('stub');
    expect(paymentProvider.fizetesiUt()).toBe('stub');
    expect(paymentProvider.usesCibEki()).toBe(false);
    expect(paymentProvider.manualConfirmAllowed()).toBe(true);
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(true);
    expect(cib.isStub()).toBe(true);
    const r = await cib.startFeePayment({ jobId: 'abc', feeHuf: 500 });
    expect(r).toMatchObject({ paymentId: 'cib-stub-abc', gatewayUrl: 'stub:cib/abc', stub: true });
  });

  it('teljes + éles: mindenki CIB-utat kap, a kézi nyugtázás zárva (ALLOW_STUB_PAYMENTS mellett is)', () => {
    visszaallit = beallitEnv({ ...elesEnv(), ALLOW_STUB_PAYMENTS: 'true', CIB_TESZT_FELHASZNALOK: LISTAS });
    expect(paymentProvider.fizetesiUt(LISTAS)).toBe('cib');
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('cib');
    expect(paymentProvider.usesCibEki()).toBe(true);
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(false);
    expect(paymentProvider.manualConfirmAllowed()).toBe(false);
    expect(cib.isStub()).toBe(false);
  });

  it('teljes + teszt, üres allowlist: mindenki CIB-utat kap', () => {
    visszaallit = beallitEnv(teljesEnv());
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('cib');
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(false);
  });

  it('teljes + teszt + allowlist: a listás user CIB, a többi stub (kézi nyugtázással)', () => {
    visszaallit = beallitEnv({ ...teljesEnv({ CIB_TESZT_FELHASZNALOK: LISTAS }) });
    expect(paymentProvider.fizetesiUt(LISTAS)).toBe('cib');
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('stub');
    expect(paymentProvider.fizetesiUt()).toBe('stub');
    expect(paymentProvider.manualConfirmAllowed(LISTAS)).toBe(false);
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(true);
  });

  it('teszt-kulcs az éles domainen (NODE_ENV=production): a nem-listás user kézi nyugtázása CSAK ALLOW_STUB_PAYMENTS-szel', () => {
    visszaallit = beallitEnv(teljesEnv({
      NODE_ENV: 'production',
      CIB_MARKET_URL: 'https://ekit.cib.hu/market.saki',
      CIB_CUSTOMER_URL: 'https://ekit.cib.hu/customer.saki',
      CIB_TESZT_FELHASZNALOK: LISTAS,
      ALLOW_STUB_PAYMENTS: '',
    }));
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('stub');
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(false);
    process.env.ALLOW_STUB_PAYMENTS = 'true';
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(true);
    expect(paymentProvider.manualConfirmAllowed(LISTAS)).toBe(false);
  });

  it('hibás konfig: „hibas" út, a stub NEM nyílik vissza, a kézi nyugtázás zárva', async () => {
    visszaallit = beallitEnv({ ...teljesEnv({ CIB_KEY_UJJLENYOMAT: '000000000000' }), ALLOW_STUB_PAYMENTS: 'true' });
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('hibas');
    expect(paymentProvider.usesCibEki()).toBe(false);
    expect(paymentProvider.manualConfirmAllowed(MASIK)).toBe(false);
    expect(paymentProvider.manualConfirmAllowed()).toBe(false);
    expect(cib.isStub()).toBe(false);
    await expect(cib.startFeePayment({ jobId: 'x', feeHuf: 500 })).rejects.toThrow();
  });

  it('a stub-adapter explicit hívása teljes konfig mellett is a determinisztikus cib-stub-<id> formát adja', () => {
    visszaallit = beallitEnv(teljesEnv({ CIB_TESZT_FELHASZNALOK: LISTAS }));
    expect(cib.stubFeePayment({ jobId: 'j1', feeHuf: 1000 })).toMatchObject({
      paymentId: 'cib-stub-j1', gatewayUrl: 'stub:cib/j1', stub: true, currency: 'HUF',
    });
  });

  it('PAYMENT_PROVIDER=qvik (kulcs nélkül): stub, a CIB-konfig nem számít', () => {
    visszaallit = beallitEnv({ ...teljesEnv(), PAYMENT_PROVIDER: 'qvik' });
    expect(paymentProvider.fizetesiUt(MASIK)).toBe('stub');
    expect(paymentProvider.usesCibEki()).toBe(false);
  });
});

// =====================================================================
//  7) KÖZÖS ADATFORRÁSOK: kötelező feliratok és RC-csoportok
// =====================================================================
describe('cibFeliratok / cibRcCsoportok (a banki teszt szó szerint keresi)', () => {
  const { CIB_FELIRATOK, CIB_ADATSOR_SORREND } = require('../src/data/cibFeliratok');
  const {
    rcCsoport, CSOPORT_KODOK, RC_CSOPORT_UZENET, X0_UZENET,
  } = require('../src/data/cibRcCsoportok');

  it('az öt kötelező felirat szó szerint, a banki sorrendben', () => {
    expect(CIB_FELIRATOK).toEqual({
      trid: 'A tranzakció azonosítója (TrID)',
      rc: 'A tranzakció eredményének kódja (RC)',
      rt: 'A tranzakció eredményének szöveges ismertetése (RT)',
      amo: 'A fizetett összeg (AMO)',
      penznem: 'HUF',
      anum: 'A kibocsátó bank által adott engedélyszám (ANUM)',
    });
    expect(CIB_ADATSOR_SORREND).toEqual(['trid', 'rc', 'rt', 'amo', 'anum']);
    expect(Object.isFrozen(CIB_FELIRATOK)).toBe(true);
  });

  it('a négy csoport a banki listák szerint; 00/PR/üres → null, TO → kapcsolat, ismeretlen → technikai', () => {
    expect(rcCsoport('05')).toBe('technikai');
    expect(rcCsoport('51')).toBe('technikai');
    expect(rcCsoport('54')).toBe('kartya');
    expect(rcCsoport('X3')).toBe('kartya');
    expect(rcCsoport('14')).toBe('szamla');
    expect(rcCsoport('70')).toBe('szamla');
    expect(rcCsoport('A9')).toBe('kapcsolat');
    expect(rcCsoport('X0')).toBe('technikai');
    expect(rcCsoport('NT')).toBe('technikai');
    expect(rcCsoport('TO')).toBe('kapcsolat');
    expect(rcCsoport('ZZ')).toBe('technikai');
    for (const x of ['00', 'PR', '', null, undefined]) expect(rcCsoport(x)).toBe(null);
    for (const cs of Object.keys(CSOPORT_KODOK)) expect(RC_CSOPORT_UZENET[cs].length).toBeGreaterThan(20);
    expect(X0_UZENET).toMatch(/3D Secure/);
  });
});

// Az env-et minden teszt visszaállítja — a fájl végén se maradjon CIB-kulcs.
describe('takarítás', () => {
  beforeAll(() => {});
  afterAll(() => {
    expect(process.env.CIB_KEY_B64 || '').toBe('');
    expect(process.env.CIB_HMAC_TITOK || '').toBe('');
  });
  it('a konfig a fájl végén ismét „nincs"', () => {
    expect(p.cibKonfig()).toBe('nincs');
  });
});
