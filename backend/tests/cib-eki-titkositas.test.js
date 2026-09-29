// CIB EKI titkosítás (services/ekiCrypt.js) — a banki protokoll alaprétege.
//
// ⚠️ A CIB dokumentációja és mintakulcsa a szerződés szerint bizalmas, a repó
// pedig NYILVÁNOS: ezért itt SAJÁT, véletlen kulccsal dolgozunk. A modul a
// dokumentáció kidolgozott példáját (Technikai dok. 26–29. o.) bájtra pontosan
// visszaadta (helyi, nem commitolt ellenőrzés, 2026-09-28). A tesztek egy
// FÜGGETLEN úton (kétkulcsos 'des-ede-cbc', kézi padding, táblás CRC) ellenőrzik
// a modul kimenetét, hogy ne a modul saját magát igazolja.
import { describe, it, expect, vi } from 'vitest';
const crypto = require('crypto');
const util = require('util');
const zlib = require('zlib');
const eki = require('../src/services/ekiCrypt');

const PID = 'TST0001';

function kulcsfajl({ aruhaz = 'TST', verzio = 2, magic = 'EKI\0', meret = 38, kulcsBajtok } = {}) {
  const buf = Buffer.alloc(meret);
  buf.write(magic, 0, 'latin1');
  if (meret >= 6) buf.writeUInt16BE(verzio, 4);
  if (meret >= 10) buf.write(`${aruhaz}\0`, 6, 'latin1');
  if (meret >= 14) buf.writeUInt32BE(1790000000, 10);
  if (meret >= 38) (kulcsBajtok || crypto.randomBytes(24)).copy(buf, 14);
  return buf;
}

// Független CRC-32 (táblás, bitenként) — nem a modul implementációja.
function crcFuggetlen(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Független visszafejtés: kétkulcsos EDE (K1|K2, 16 bájt), kézi lépésekkel.
function fuggetlenVisszafejt(uzenet, fajl) {
  const data = /DATA=([^&]+)$/.exec(uzenet)[1];
  const b64 = decodeURIComponent(data);
  let buf = Buffer.from(b64, 'base64');
  const p3 = buf[buf.length - 1];
  buf = buf.subarray(0, buf.length - p3);
  const d = crypto.createDecipheriv('des-ede-cbc', fajl.subarray(14, 30), fajl.subarray(30, 38));
  return Buffer.concat([d.update(buf), d.final()]); // PKCS#7 le
}

// A BANK felől érkező üzenet gyártása tetszőleges belső szöveggel (pl. latin2
// RT), független úton; `teljesBlokk=false` a „nincs padding 8 többszörösénél"
// banki változatot állítja elő.
function bankUzenet(belso, fajl, {
  pid = PID, teljesBlokk = true, nyersPlusz = false, rosszCrc = false,
} = {}) {
  const nyilt = Buffer.from(belso, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crcFuggetlen(nyilt) ^ (rosszCrc ? 1 : 0)) >>> 0);
  let adat = Buffer.concat([nyilt, crc]);
  const c = crypto.createCipheriv('des-ede-cbc', fajl.subarray(14, 30), fajl.subarray(30, 38));
  c.setAutoPadding(false);
  const maradek = adat.length % 8;
  if (maradek || teljesBlokk) {
    const p = 8 - maradek;
    adat = Buffer.concat([adat, Buffer.alloc(p, p)]);
  }
  let ct = Buffer.concat([c.update(adat), c.final()]);
  const p3 = 3 - (ct.length % 3);
  ct = Buffer.concat([ct, Buffer.alloc(p3, p3)]);
  const b64 = ct.toString('base64');
  return `PID=${pid}&CRYPTO=1&DATA=${nyersPlusz ? b64 : encodeURIComponent(b64)}`;
}

describe('CRC-32 és URL-kódolás', () => {
  it('a szabványos ellenőrző érték (zlib és a táblás tartalék is)', () => {
    const minta = Buffer.from('123456789');
    expect(eki._crc32(minta)).toBe(0xcbf43926);
    const eredeti = zlib.crc32;
    try {
      zlib.crc32 = undefined; // régebbi Node szimulálása
      expect(eki._crc32(minta)).toBe(0xcbf43926);
      expect(eki._crc32(Buffer.from('PID=ABC0001&MSGT=10'))).toBe(crcFuggetlen(Buffer.from('PID=ABC0001&MSGT=10')));
    } finally {
      zlib.crc32 = eredeti;
    }
  });

  it('rawurlencode: NAGYBETŰS hexa, a !\'()* is kódolt, a . - _ ~ marad', () => {
    expect(eki._rawurlencode("https://a.hu/x y!'()*~._-ő"))
      .toBe('https%3A%2F%2Fa.hu%2Fx%20y%21%27%28%29%2A~._-%C5%91');
  });
});

describe('Kulcsfájl (.des) értelmezése', () => {
  it('érvényes fájl: K1|K2|K1 kulcs, IV, ujjlenyomat, létrehozási idő', () => {
    const fajl = kulcsfajl();
    const k = eki.parseDesKey(fajl, PID);
    expect(k.key.equals(Buffer.concat([fajl.subarray(14, 22), fajl.subarray(22, 30), fajl.subarray(14, 22)]))).toBe(true);
    expect(k.iv.equals(fajl.subarray(30, 38))).toBe(true);
    expect(k.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(k.createdAt.getTime()).toBe(1790000000 * 1000);
    expect(k.pid).toBe(PID);
  });

  it('az áruház-azonosító kis/nagybetűre érzéketlenül egyezik; a kisbetűs PID nagybetűsödik', () => {
    expect(() => eki.parseDesKey(kulcsfajl({ aruhaz: 'tst' }), PID)).not.toThrow();
    expect(eki.parseDesKey(kulcsfajl(), ' tst0001 ').pid).toBe(PID);
  });

  it.each([
    ['rossz méret', () => eki.parseDesKey(kulcsfajl({ meret: 37 }), PID), 'UER_BADKEY'],
    ['nem Buffer', () => eki.parseDesKey('x'.repeat(38), PID), 'UER_BADKEY'],
    ['rossz fejléc', () => eki.parseDesKey(kulcsfajl({ magic: 'XYZ\0' }), PID), 'UER_BADKEY'],
    ['rossz verzió', () => eki.parseDesKey(kulcsfajl({ verzio: 1 }), PID), 'UER_BADKEY'],
    ['másik áruház kulcsa', () => eki.parseDesKey(kulcsfajl({ aruhaz: 'ABC' }), PID), 'UER_BADKEY'],
    ['érvénytelen PID', () => eki.parseDesKey(kulcsfajl(), 'TST001'), 'UER_BADPARM'],
    ['érvénytelen PID (deviza-jegy)', () => eki.parseDesKey(kulcsfajl(), 'TST5001'), 'UER_BADPARM'],
  ])('%s → %s', (_nev, fn, kod) => {
    expect(fn).toThrow(expect.objectContaining({ name: 'EkiHiba', code: kod }));
  });

  it('loadKeyFromEnv: hiányzó beállításnál null, egyébként a base64 fájlt értelmezi', () => {
    expect(eki.loadKeyFromEnv({})).toBeNull();
    expect(eki.loadKeyFromEnv({ CIB_PID: PID })).toBeNull();
    const fajl = kulcsfajl();
    const k = eki.loadKeyFromEnv({ CIB_PID: PID, CIB_KEY_B64: fajl.toString('base64') });
    expect(k.iv.equals(fajl.subarray(30, 38))).toBe(true);
  });

  it('a kulcsbájtok egyik hibaüzenetben sem látszanak (egyenként sem)', () => {
    const kulcsBajtok = crypto.randomBytes(24);
    const reszek = [kulcsBajtok.subarray(0, 8), kulcsBajtok.subarray(8, 16), kulcsBajtok.subarray(16, 24)];
    const esetek = [
      () => eki.parseDesKey(kulcsfajl({ aruhaz: 'ABC', kulcsBajtok }), PID),
      () => eki.parseDesKey(kulcsfajl({ magic: 'XYZ\0', kulcsBajtok }), PID),
      () => eki.parseDesKey(kulcsfajl({ verzio: 3, kulcsBajtok }), PID),
      () => eki.parseDesKey(kulcsfajl({ kulcsBajtok }), 'rossz'),
    ];
    expect.assertions(esetek.length * 7);
    for (const fn of esetek) {
      let hiba;
      try { fn(); } catch (e) { hiba = e; }
      expect(hiba).toBeInstanceOf(eki.EkiHiba);
      for (const r of reszek) {
        expect(hiba.message).not.toContain(r.toString('hex'));
        expect(hiba.message).not.toContain(r.toString('base64'));
      }
    }
  });

  it('a kulcs-objektum naplózva / JSON-ként sem adja ki a kulcsot', () => {
    const fajl = kulcsfajl();
    const k = eki.parseDesKey(fajl, PID);
    const kulcsHex = fajl.subarray(14, 22).toString('hex');
    expect(Object.keys(k)).not.toContain('key');
    expect(Object.keys(k)).not.toContain('iv');
    const json = JSON.stringify({ k });
    expect(json).toContain(k.fingerprint);
    expect(json).not.toContain('"data"');
    expect(json).not.toContain(kulcsHex);
    const nezet = util.inspect({ k }, { depth: 5 });
    expect(nezet).toContain(k.fingerprint);
    expect(nezet.replace(/\s/g, '')).not.toContain(kulcsHex);
    expect(nezet).not.toMatch(/Buffer/);
  });
});

describe('Titkosítás a bank felé', () => {
  const fajl = kulcsfajl();
  const kulcs = eki.parseDesKey(fajl, PID);
  const MEZOK = [
    ['PID', PID], ['TRID', '0123456789012345'], ['MSGT', '10'], ['UID', 'U0000000001'],
    ['AMO', '500'], ['CUR', 'HUF'], ['TS', '20260928120000'], ['AUTH', '0'], ['LANG', 'HU'],
    ['URL', 'https://api.gofuvar.hu/payments/cib/visszateres/'],
  ];

  it('a formátum: PID=…&CRYPTO=1&DATA=…, a DATA-ban nincs nyers + / =', () => {
    const u = eki.ekiEncrypt(MEZOK, kulcs);
    expect(u.startsWith(`PID=${PID}&CRYPTO=1&DATA=`)).toBe(true);
    const data = u.slice(u.indexOf('DATA=') + 5);
    expect(data).not.toMatch(/[+/=]/);
    expect(data).toMatch(/^[A-Za-z0-9%]+$/);
  });

  it('FÜGGETLEN visszafejtéssel: a belső szöveg az URL-kódolt üzenet + big-endian CRC32', () => {
    const nyilt = fuggetlenVisszafejt(eki.ekiEncrypt(MEZOK, kulcs), fajl);
    const szoveg = nyilt.subarray(0, nyilt.length - 4).toString('latin1');
    expect(szoveg).toBe(
      'PID=TST0001&TRID=0123456789012345&MSGT=10&UID=U0000000001&AMO=500&CUR=HUF'
      + '&TS=20260928120000&AUTH=0&LANG=HU&URL=https%3A%2F%2Fapi.gofuvar.hu%2Fpayments%2Fcib%2Fvisszateres%2F',
    );
    expect(nyilt.readUInt32BE(nyilt.length - 4)).toBe(crcFuggetlen(nyilt.subarray(0, nyilt.length - 4)));
  });

  it('a Base64 előtti kiegészítés 1–3 bájt, értéke a hossza (a Base64 sosem végződik =-re)', () => {
    for (let hossz = 1; hossz <= 40; hossz++) {
      const u = eki.ekiEncrypt([['PID', PID], ['X', 'a'.repeat(hossz)]], kulcs);
      const buf = Buffer.from(decodeURIComponent(u.slice(u.indexOf('DATA=') + 5)), 'base64');
      const p = buf[buf.length - 1];
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(3);
      expect([...buf.subarray(buf.length - p)].every((b) => b === p)).toBe(true);
      expect((buf.length - p) % 8).toBe(0);
    }
  });

  it('determinisztikus (fix IV): ugyanaz az üzenet ugyanazt a kimenetet adja', () => {
    expect(eki.ekiEncrypt(MEZOK, kulcs)).toBe(eki.ekiEncrypt(MEZOK, kulcs));
  });

  it.each([
    ['nem-ASCII érték (ő)', [['PID', PID], ['X', 'ő']]],
    ['magányos surrogate', [['PID', PID], ['X', 'a\ud800']]],
    ['undefined érték', [['PID', PID], ['UID', undefined]]],
    ['null érték', [['PID', PID], ['AMO', null]]],
    ['objektum érték', [['PID', PID], ['X', { a: 1 }]]],
    ['NaN érték', [['PID', PID], ['AMO', Number.NaN]]],
    ['ismétlődő mező', [['PID', PID], ['AMO', '500'], ['AMO', '1']]],
    ['nem pár', [['PID', PID], ['X']]],
    ['nem tömb elem', [['PID', PID], null]],
    ['& az értékben', [['PID', PID], ['X', 'a&b']]],
    ['= az értékben', [['PID', PID], ['X', 'a=b']]],
    ['szóköz az értékben', [['PID', PID], ['X', 'a b']]],
    ['sortörés az értékben', [['PID', PID], ['X', 'a\nb']]],
    ['CRYPTO mező', [['PID', PID], ['CRYPTO', '1']]],
    ['kisbetűs mezőnév', [['PID', PID], ['msgt', '10']]],
    ['hiányzó PID', [['MSGT', '10']]],
    ['idegen PID', [['PID', 'ABC0001'], ['MSGT', '10']]],
  ])('%s → UER_BADPARM', (_nev, mezok) => {
    expect(() => eki.ekiEncrypt(mezok, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADPARM' }));
  });

  it('üres üzenet → UER_BADPARM; hiányzó vagy hibás kulcs → UER_NOKEY', () => {
    expect(() => eki.ekiEncrypt([], kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADPARM' }));
    expect(() => eki.ekiEncrypt(MEZOK, null)).toThrow(expect.objectContaining({ code: 'UER_NOKEY' }));
    expect(() => eki.ekiEncrypt(MEZOK, { pid: PID, key: Buffer.alloc(16), iv: Buffer.alloc(8) }))
      .toThrow(expect.objectContaining({ code: 'UER_NOKEY' }));
    expect(() => eki.ekiDecrypt('PID=x', { pid: PID })).toThrow(expect.objectContaining({ code: 'UER_NOKEY' }));
  });

  it('a szám értéket szövegként viszi (AMO=500)', () => {
    const nyilt = fuggetlenVisszafejt(eki.ekiEncrypt([['PID', PID], ['AMO', 500]], kulcs), fajl);
    expect(nyilt.subarray(0, nyilt.length - 4).toString('latin1')).toBe(`PID=${PID}&AMO=500`);
  });
});

describe('Visszafejtés (a bank üzenete)', () => {
  const fajl = kulcsfajl();
  const kulcs = eki.parseDesKey(fajl, PID);
  const BELSO = `PID=${PID}&MSGT=31&TRID=0123456789012345&RC=00&ANUM=123456&AMO=500&RT=Sikeres+tranzakci%F3+%F5`;

  it('oda-vissza: minden hosszra, a PKCS teljes blokkos esetével együtt', () => {
    for (let hossz = 1; hossz <= 40; hossz++) {
      const ertek = 'b'.repeat(hossz);
      const vissza = eki.ekiDecrypt(eki.ekiEncrypt([['PID', PID], ['MSGT', '33'], ['X', ertek]], kulcs), kulcs);
      expect(vissza).toEqual({ PID, MSGT: '33', X: ertek });
    }
  });

  it('a független úton gyártott banki üzenet: RT ISO-8859-2-ből, + szóközként', () => {
    const v = eki.ekiDecrypt(bankUzenet(BELSO, fajl), kulcs);
    expect(v).toMatchObject({ MSGT: '31', RC: '00', ANUM: '123456', AMO: '500', TRID: '0123456789012345' });
    expect(v.RT).toBe('Sikeres tranzakció ő');
  });

  it('a „nincs padding 8 többszörösénél" banki változatot is elfogadja (a CRC dönt)', () => {
    // olyan belső hossz, amelynél belső + CRC pontosan 8 többszöröse
    let belso = `PID=${PID}&MSGT=31&RC=00`;
    while ((Buffer.byteLength(belso) + 4) % 8 !== 0) belso += 'X';
    expect(eki.ekiDecrypt(bankUzenet(belso, fajl, { teljesBlokk: false }), kulcs).RC).toMatch(/^00X*$/);
    expect(eki.ekiDecrypt(bankUzenet(belso, fajl, { teljesBlokk: true }), kulcs).RC).toMatch(/^00X*$/);
  });

  it('nyers + és / a DATA-ban, szóközzé romlott +, kisbetűs %2b, vezető ? — mind visszafejthető', () => {
    const nyers = bankUzenet(BELSO, fajl, { nyersPlusz: true });
    expect(eki.ekiDecrypt(nyers, kulcs).ANUM).toBe('123456');
    expect(eki.ekiDecrypt(nyers.replace(/\+/g, ' '), kulcs).ANUM).toBe('123456');
    const kodolt = bankUzenet(BELSO, fajl);
    expect(eki.ekiDecrypt(kodolt.replace(/%2B/g, '%2b').replace(/%2F/g, '%2f'), kulcs).ANUM).toBe('123456');
    expect(eki.ekiDecrypt(`?${kodolt}`, kulcs).ANUM).toBe('123456');
  });

  it('titkosítatlan banki hibaválasz (RC=Sxx / RC=Dxx) CSAK a bank HTTP-válaszában → EkiBankHiba', () => {
    const opt = { bankValasz: true };
    expect(() => eki.ekiDecrypt('RC=S01', kulcs, opt)).toThrow(expect.objectContaining({ name: 'EkiBankHiba', rc: 'S01' }));
    expect(() => eki.ekiDecrypt('RC=D04\r\n', kulcs, opt)).toThrow(expect.objectContaining({ name: 'EkiBankHiba', rc: 'D04' }));
    // a naplóba vezérlőkarakter nem jut
    try { eki.ekiDecrypt('RC=S01\nHAMIS NAPLÓSOR', kulcs, opt); } catch (e) { expect(e.raw).not.toMatch(/[\r\n]/); }
  });

  it('a böngészős visszatérésen (alapértelmezés) a titkosítatlan RC= nem banki ítélet, csak érvénytelen üzenet', () => {
    for (const hamis of ['RC=D05', '?RC=S01&PID=TST0001']) {
      let hiba;
      try { eki.ekiDecrypt(hamis, kulcs); } catch (e) { hiba = e; }
      expect(hiba?.name, hamis).toBe('EkiHiba');
    }
    // egy valódi banki üzenet elé írt hamis RC nem számít: az eredmény a
    // titkosított részből jön
    expect(eki.ekiDecrypt(`RC=D04&${bankUzenet(BELSO, fajl)}`, kulcs).RC).toBe('00');
  });

  it('ugyanabból a kulcsfájlból másik devizájú PID-del (TST1001) titkosított üzenet → UER_BADURL', () => {
    // a kulcsfájl csak az áruház 3 betűjét köti, a PID 4. jegye a deviza —
    // itt a KÜLSŐ PID-ellenőrzés a teherhordó
    const masikPid = eki.parseDesKey(fajl, 'TST1001');
    const u = eki.ekiEncrypt([['PID', 'TST1001'], ['MSGT', '21'], ['TRID', '1']], masikPid);
    expect(() => eki.ekiDecrypt(u, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
  });

  it('ELŐBB bont, UTÁNA dekódol: a %26 / %3D egy banki értékben nem ad új mezőt', () => {
    const v = eki.ekiDecrypt(bankUzenet(`PID=${PID}&MSGT=31&X=a%26RC%3D00`, fajl), kulcs);
    expect(v.X).toBe('a&RC=00');
    expect(v.RC).toBeUndefined();
  });

  it('ismétlődő belső vagy külső mező → UER_BADURL (az „utolsó nyer" nem írhat felül RC-t)', () => {
    expect(() => eki.ekiDecrypt(bankUzenet(`PID=${PID}&MSGT=31&RC=05&RC=00`, fajl), kulcs))
      .toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
    const u = bankUzenet(BELSO, fajl);
    expect(() => eki.ekiDecrypt(`${u}&DATA=AAAA`, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
  });

  it('túl hosszú bemenet → UER_BADURL (nem dolgozza fel)', () => {
    expect(() => eki.ekiDecrypt(`PID=${PID}&CRYPTO=1&DATA=${'A'.repeat(20000)}`, kulcs))
      .toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
  });

  it('a visszafejtett objektum sima objektum, prototípus-mezőt nem ír felül', () => {
    const v = eki.ekiDecrypt(bankUzenet(`PID=${PID}&__proto__=x&CONSTRUCTOR=y`, fajl), kulcs);
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(v.__PROTO__).toBe('x');
    expect({}.x).toBeUndefined();
  });

  it('rossz kulccsal → UER_CRC vagy UER_BADPAD (soha nem ad „sikeres" adatot)', () => {
    const idegen = eki.parseDesKey(kulcsfajl(), PID);
    const u = bankUzenet(BELSO, fajl);
    expect(() => eki.ekiDecrypt(u, idegen)).toThrow(expect.objectContaining({ name: 'EkiHiba' }));
  });

  it('érvényes titkosítás, de hibás CRC (sérült vagy hamisított belső szöveg) → UER_CRC', () => {
    // A padding itt HELYES, tehát csak a CRC-ellenőrzés foghatja meg — enélkül a
    // sérült üzenet mezői „érvényes" banki válaszként mennének tovább.
    expect(() => eki.ekiDecrypt(bankUzenet(BELSO, fajl, { rosszCrc: true }), kulcs))
      .toThrow(expect.objectContaining({ code: 'UER_CRC' }));
  });

  it('módosított DATA → hiba (CRC / padding)', () => {
    const u = bankUzenet(BELSO, fajl);
    const i = u.indexOf('DATA=') + 10;
    const csere = u[i] === 'A' ? 'B' : 'A';
    expect(() => eki.ekiDecrypt(u.slice(0, i) + csere + u.slice(i + 1), kulcs)).toThrow(expect.objectContaining({ name: 'EkiHiba' }));
  });

  it('idegen külső PID, eltérő belső PID, hiányzó CRYPTO/DATA → UER_BADURL', () => {
    expect(() => eki.ekiDecrypt(bankUzenet(BELSO, fajl, { pid: 'ABC0001' }), kulcs))
      .toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
    const masBelso = BELSO.replace(`PID=${PID}`, 'PID=TST0002');
    expect(() => eki.ekiDecrypt(bankUzenet(masBelso, fajl), kulcs))
      .toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
    expect(() => eki.ekiDecrypt(`PID=${PID}&DATA=AAAA`, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
    expect(() => eki.ekiDecrypt(`PID=${PID}&CRYPTO=1`, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
    expect(() => eki.ekiDecrypt(undefined, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
  });

  it('a „AwMD" (üres üzenet) és a hibás hosszú DATA nem ad eredményt', () => {
    expect(() => eki.ekiDecrypt(`PID=${PID}&CRYPTO=1&DATA=AwMD`, kulcs)).toThrow(expect.objectContaining({ name: 'EkiHiba' }));
    expect(() => eki.ekiDecrypt(`PID=${PID}&CRYPTO=1&DATA=abc`, kulcs)).toThrow(expect.objectContaining({ code: 'UER_BADURL' }));
  });
});

describe('Önteszt', () => {
  it('a futtatókörnyezet tudja a 3DES-EDE-CBC-t (véletlen kulccsal, banki kulcs nélkül)', () => {
    expect(eki.selfTest()).toBe(true);
  });

  it('ha a 3DES nem elérhető (pl. legacy providerbe került), false — és nem dob', () => {
    const kem = vi.spyOn(crypto, 'createCipheriv').mockImplementation(() => {
      throw new Error('ERR_OSSL_EVP_UNSUPPORTED');
    });
    try {
      expect(eki.selfTest()).toBe(false);
    } finally {
      kem.mockRestore();
    }
  });

  it('ha a dekódolás csendben ROSSZ eredményt ad (nem dob), akkor is false', () => {
    const eredeti = globalThis.TextDecoder;
    globalThis.TextDecoder = class { decode() { return '?'; } };
    try {
      expect(eki.selfTest()).toBe(false);
    } finally {
      globalThis.TextDecoder = eredeti;
    }
  });

  it('ha az ISO-8859-2 dekódolás nem elérhető (ICU nélkül), false', () => {
    const eredeti = globalThis.TextDecoder;
    globalThis.TextDecoder = class { constructor() { throw new RangeError('ERR_ENCODING_NOT_SUPPORTED'); } };
    try {
      expect(eki.selfTest()).toBe(false);
    } finally {
      globalThis.TextDecoder = eredeti;
    }
  });
});
