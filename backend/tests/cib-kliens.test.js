// =====================================================================
//  CIB EKI — BANKI KLIENS + ÜZENETNAPLÓ, HAMIS BANKKAL (2026-09-29, PR-2/A)
//
//  A kliens az egyetlen hely, ahol a GoFuvar a bankhoz beszél. Amit őriz:
//
//   * A TÖRZS a döntő, nem a HTTP-státusz: a teszt-bank üres kérésre HTTP
//     200 + „RC=S01"-et adott (mérve, 2026-09-29) — egy státusz-alapú kliens
//     ezt „sikeres válasznak" és visszafejtési hibának látná.
//   * A „nem küldtük el" és az „elküldtük, de nem jött válasz" SZÉTVÁLIK:
//     a zárásnál ezen múlik, hogy szabad-e újrapróbálni (az első biztonságos,
//     a második kettős terhelést okozhat).
//   * WRITE-AHEAD NAPLÓ: a kimenő üzenet a küldés ELŐTT a cib_messages-be
//     kerül, autocommittal — a hívó tranzakciójának ROLLBACK-je sem viszi
//     el. Ez a bank felé a „tranzakció kivizsgálás" bizonyítéka.
//   * A kulcs és a nyílt üzenet sosem kerül a konzolra; a napló csak a
//     titkosított szöveget tárolja, méretkorláttal.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from 'vitest';

const { db } = require('./helpers');
const { inditHamisBank, zartPortUrl } = require('./cibHamisBank');
const p = require('../src/services/cibProtokoll');
const kliens = require('../src/services/cibKliens');

let bank;
let beall;
let tridSzam = 0;
const ujTrid = () => `90000000${String(Date.now() % 1e6).padStart(6, '0')}${String((tridSzam += 1) % 100).padStart(2, '0')}`;

beforeAll(async () => {
  bank = await inditHamisBank();
  beall = p.cibBeallitasok(bank.env());
  expect(beall.allapot, JSON.stringify(beall.okok)).toBe('teljes');
});
afterAll(async () => { await bank.leallit(); });
beforeEach(() => { bank.horog(null); });

function m10(trid) {
  return p.msgt10Mezok({
    pid: beall.pid, trid, uid: 'GTESZTUID01', amo: 500, ts: '20260929120000', url: beall.returnUrl,
  });
}
/** A beállítások másolata más market URL-lel — a (nem felsorolható) kulcs megmarad. */
function modositott(tobb) {
  const o = { ...beall, ...tobb };
  Object.defineProperty(o, 'kulcs', { value: beall.kulcs, enumerable: false });
  return o;
}
const m33 = (trid) => p.msgt33Mezok({ pid: beall.pid, trid, amo: 500 });
const m32 = (trid) => p.msgt32Mezok({ pid: beall.pid, trid, amo: 500 });

async function naplo(trid) {
  const { rows } = await db.query(
    `SELECT id, payment_id, direction, msgt, endpoint, http_status, rc, raw, error_class,
            close_attempt, duration_ms, instance
       FROM cib_messages WHERE payment_id = $1 ORDER BY id`, [trid],
  );
  return rows;
}

describe('marketHivas: sikeres üzenetváltás', () => {
  it('MSGT10 → MSGT11 RC=00: visszafejtett mezők, két naplósor (ki, be), a nyers titkosított szöveggel', async () => {
    const trid = ujTrid();
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r).toMatchObject({ kuldve: true, http: 200, hibaOsztaly: null, bankRc: null });
    expect(r.mezok).toMatchObject({ MSGT: '11', TRID: trid, RC: '00', PID: beall.pid });
    expect(bank.szamol(trid, 10)).toBe(1);

    const sorok = await naplo(trid);
    expect(sorok.map((s) => [s.direction, s.msgt, s.endpoint])).toEqual([['ki', 10, 'market'], ['be', 11, 'market']]);
    expect(sorok[0].raw).toMatch(/^PID=TST0001&CRYPTO=1&DATA=/);
    expect(sorok[1].raw).toMatch(/^PID=TST0001&CRYPTO=1&DATA=/);
    expect(sorok[1]).toMatchObject({ http_status: 200, rc: '00', error_class: null });
    expect(sorok[1].duration_ms).toBeGreaterThanOrEqual(0);
    expect(sorok[0].instance).toMatch(/:\d+$/);
    // A napló NEM tartalmaz nyílt banki adatot (TRID, összeg) — csak a titkosítottat.
    expect(sorok.map((s) => s.raw).join(' ')).not.toContain(trid);
  });

  it('a kimenő sor a KÜLDÉS ELŐTT már a naplóban van (write-ahead)', async () => {
    const trid = ujTrid();
    const latott = [];
    bank.horog(async (u) => {
      if (u.trid !== trid) return;
      const { rows } = await db.query(
        `SELECT direction FROM cib_messages WHERE payment_id = $1 ORDER BY id`, [trid],
      );
      latott.push(rows.map((x) => x.direction));
    });
    await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(latott).toEqual([['ki']]);
  });

  it('a napló autocommit: a hívó tranzakciójának ROLLBACK-je sem viszi el', async () => {
    const trid = ujTrid();
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
      await client.query('ROLLBACK');
    } finally { client.release(); }
    expect((await naplo(trid)).length).toBe(2);
  });

  it('a zárási kísérlet sorszáma a naplóba kerül (a banki kivizsgáláshoz)', async () => {
    const trid = ujTrid();
    await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    bank.dont(trid, 'fizet');
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m32(trid), idokeretMs: 5000, zarasiKiserlet: 1 });
    expect(r.mezok).toMatchObject({ MSGT: '31', RC: '00' });
    const zaras = (await naplo(trid)).filter((s) => s.close_attempt !== null);
    expect(zaras.map((s) => [s.direction, s.msgt, s.close_attempt])).toEqual([['ki', 32, 1], ['be', 31, 1]]);
  });

  it('ISO-8859-2-es RT helyesen dekódolódik', async () => {
    const trid = ujTrid();
    await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    bank.tridre(trid, 33, [{ rc: '51', rt: 'Nincs elegendő fedezet, próbálja újra' }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m33(trid), idokeretMs: 5000 });
    expect(r.mezok.RT).toBe('Nincs elegendő fedezet, próbálja újra');
  });
});

describe('marketHivas: a törzs a döntő, a HTTP-státusz külön', () => {
  it('titkosítatlan RC=S01 HTTP 200-zal (a mért ekit-viselkedés) → bank_S, nem visszafejtési hiba', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ nyers: 'RC=S01', http: 200 }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r).toMatchObject({ kuldve: true, http: 200, bankRc: 'S01', hibaOsztaly: 'bank_S', mezok: null });
    const be = (await naplo(trid)).find((s) => s.direction === 'be');
    expect(be).toMatchObject({ http_status: 200, rc: 'S01', error_class: 'bank_S', raw: 'RC=S01' });
  });

  it('RC=S01 HTTP 403-mal → bank_S', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ nyers: 'RC=S01', http: 403 }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r).toMatchObject({ http: 403, bankRc: 'S01', hibaOsztaly: 'bank_S' });
  });

  it('RC=D04 HTTP 500-zal → bank_D', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ nyers: 'RC=D04', http: 500 }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r).toMatchObject({ http: 500, bankRc: 'D04', hibaOsztaly: 'bank_D' });
  });

  it('HTTP 500 törzs nélkül → http; HTTP 200 szemét törzzsel → visszafejtes', async () => {
    const t1 = ujTrid();
    bank.forgatokonyv(10, [{ http: 500, ures: true }]);
    expect(await kliens.marketHivas({ beallitasok: beall, mezok: m10(t1), idokeretMs: 5000 }))
      .toMatchObject({ kuldve: true, http: 500, hibaOsztaly: 'http', mezok: null });
    const t2 = ujTrid();
    bank.forgatokonyv(10, [{ szemet: 'PID=TST0001&CRYPTO=1&DATA=AAAA' }]);
    expect(await kliens.marketHivas({ beallitasok: beall, mezok: m10(t2), idokeretMs: 5000 }))
      .toMatchObject({ kuldve: true, http: 200, hibaOsztaly: 'visszafejtes', mezok: null });
    expect((await naplo(t2)).find((s) => s.direction === 'be').error_class).toBe('visszafejtes');
  });
});

describe('marketHivas: nem küldött vs. elküldött, de válasz nélküli', () => {
  it('a kapcsolatot el sem fogadó bank → nem_kuldott (a zárásnál újrapróbálható)', async () => {
    const trid = ujTrid();
    const zart = modositott({ marketUrl: await zartPortUrl() });
    const r = await kliens.marketHivas({ beallitasok: zart, mezok: m10(trid), idokeretMs: 3000 });
    expect(r).toMatchObject({ kuldve: false, http: null, hibaOsztaly: 'nem_kuldott', mezok: null });
    const sorok = await naplo(trid);
    expect(sorok.map((s) => [s.direction, s.error_class])).toEqual([['ki', null], ['be', 'nem_kuldott']]);
  });

  it('elküldött kérés, a bank nem válaszol → idokeret, kuldve=true (a zárásnál KÉTES)', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ lefagy: true }]);
    const kezd = Date.now();
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 400 });
    expect(Date.now() - kezd).toBeLessThan(3000);
    expect(r).toMatchObject({ kuldve: true, http: null, hibaOsztaly: 'idokeret' });
    expect(bank.szamol(trid, 10)).toBe(1);
  });

  it('a bank feldolgozza, majd bontja a kapcsolatot → halozat, kuldve=true', async () => {
    const trid = ujTrid();
    await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    bank.dont(trid, 'fizet');
    bank.tridre(trid, 32, [{ bont: true }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m32(trid), idokeretMs: 5000, zarasiKiserlet: 1 });
    expect(r).toMatchObject({ kuldve: true, hibaOsztaly: 'halozat', mezok: null });
    // ... és a bank tényleg lezárta: a második MSGT32-re D05 („már kiszolgálva").
    const r2 = await kliens.marketHivas({ beallitasok: beall, mezok: m32(trid), idokeretMs: 5000, zarasiKiserlet: 2 });
    expect(r2).toMatchObject({ bankRc: 'D05', hibaOsztaly: 'bank_D', http: 500 });
  });

  it('a futó banki hívások száma követhető (a szabályos leállás erre vár)', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ kesleltetesMs: 300 }]);
    const folyamat = kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(kliens.futoHivasokSzama()).toBeGreaterThanOrEqual(1);
    await folyamat;
    expect(kliens.futoHivasokSzama()).toBe(0);
  });
});

describe('napló-integritás és titokvédelem', () => {
  it('ha a kimenő sor nem írható (DB-hiba), a kérés NEM megy ki — nem_kuldott', async () => {
    const trid = ujTrid();
    const eredeti = db.query;
    db.query = async (sql, params) => {
      if (/INSERT INTO cib_messages/.test(sql)) throw new Error('szimulált DB-kiesés');
      return eredeti(sql, params);
    };
    let r;
    try {
      r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 3000 });
    } finally { db.query = eredeti; }
    expect(r).toMatchObject({ kuldve: false, hibaOsztaly: 'nem_kuldott', naploHiba: true });
    expect(bank.szamol(trid, 10)).toBe(0);
  });

  it('a nagy banki törzs levágva kerül a naplóba (≤4000 karakter), a feldolgozás nem akad el', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ szemet: 'X'.repeat(10000) }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r.hibaOsztaly).toBe('visszafejtes');
    const be = (await naplo(trid)).find((s) => s.direction === 'be');
    expect(be.raw.length).toBeLessThanOrEqual(4000);
  });

  it('a konzolra sem a kulcs, sem a nyílt üzenet (TRID, összeg) nem kerül — csak maszkolt TRID', async () => {
    const trid = ujTrid();
    const sorok = [];
    const fel = (...a) => sorok.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    const spyk = ['log', 'warn', 'error', 'info'].map((m) => vi.spyOn(console, m).mockImplementation(fel));
    try {
      bank.forgatokonyv(10, [{ lefagy: true }]);
      await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 300 });
      await kliens.marketHivas({ beallitasok: modositott({ marketUrl: await zartPortUrl() }), mezok: m10(ujTrid()), idokeretMs: 300 });
    } finally { spyk.forEach((s) => s.mockRestore()); }
    const osszes = sorok.join('\n');
    expect(osszes).not.toContain(bank.kulcs.b64);
    expect(osszes).not.toContain(trid);
    expect(osszes).not.toContain('GTESZTUID01');
  });

  it('a túlméretes banki válasz csak a korlátig olvasódik (memória), és nem értelmezzük sikernek', async () => {
    const trid = ujTrid();
    bank.forgatokonyv(10, [{ szemet: 'Y'.repeat(200 * 1024) }]);
    const r = await kliens.marketHivas({ beallitasok: beall, mezok: m10(trid), idokeretMs: 5000 });
    expect(r).toMatchObject({ kuldve: true, http: 200, hibaOsztaly: 'visszafejtes', mezok: null });
    expect((await naplo(trid)).find((s) => s.direction === 'be').raw.length).toBe(4000);
  });

  it('hívói hiba (hiányos konfig, időkeret nélkül, rossz napló-irány) dob — nem banki kimenet', async () => {
    await expect(kliens.marketHivas({ beallitasok: { ...beall }, mezok: m10(ujTrid()), idokeretMs: 1000 })).rejects.toThrow();
    await expect(kliens.marketHivas({ beallitasok: beall, mezok: m10(ujTrid()) })).rejects.toThrow();
    await expect(kliens.naploz({ irany: 'oldalra', endpoint: 'market', raw: '' })).rejects.toThrow();
  });

  it('böngészős üzenet naplózása (MSGT20 ki, MSGT21 be) a közös helperrel', async () => {
    const trid = ujTrid();
    const q = bank.msgt21Query(trid);
    await kliens.naploz({ trid, irany: 'bongeszo_ki', msgt: 20, endpoint: 'customer', raw: p.customerUrl(beall, trid) });
    await kliens.naploz({ trid, irany: 'bongeszo_be', msgt: 21, endpoint: 'vissza', raw: q });
    const sorok = await naplo(trid);
    expect(sorok.map((s) => [s.direction, s.msgt, s.endpoint])).toEqual([
      ['bongeszo_ki', 20, 'customer'], ['bongeszo_be', 21, 'vissza'],
    ]);
  });
});
