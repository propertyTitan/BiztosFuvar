// CIB eCommerce (EKI / SAKI 1.50) üzenet-titkosítás — tiszta Node.js.
//
// A kereskedő ↔ bank üzenetek (MSGT10/11/20/21/31/32/33 …) query-string
// alakú „NÉV=érték&…" szövegek, amelyeket a banktól kapott kulccsal
// titkosítunk. A CIB PHP/Java/C# mintakódot ad; ez azok Node-os megfelelője
// (node:crypto + node:zlib, külső csomag és OpenSSL legacy provider nélkül).
// A mintakódok és a bank programja a szerződés szerint bizalmasak, ezért a
// repóba (NYILVÁNOS!) nem kerül belőlük semmi — sem a dokumentáció
// mintakulcsa, sem a banktól kapott teszt/éles kulcs.
//
// A lépések (Technikai dokumentáció, 26–29. o.):
//   titkosítás:  URL-kódolás ('&' és '=' kivételével, NAGYBETŰS %XX)
//                → CRC32 (zlib/IEEE) az URL-kódolt szövegre, 4 bájt big-endian
//                → 3DES-EDE-CBC (K1|K2|K1, a kulcsfájl IV-jével, PKCS#7)
//                → kiegészítés 3-mal osztható hosszra (1–3 bájt, értéke a hossz)
//                → Base64 → a Base64 URL-kódolása → 'PID=…&CRYPTO=1&DATA=…'
//   visszafejtés: ugyanez fordított sorrendben; a CRC és a belső PID = külső
//                PID egyezése KÖTELEZŐ.
//
// ⚠️ A CRC32 NEM üzenet-hitelesítő (MAC), a fix IV miatt a titkosítás
// determinisztikus: a visszafejtett adat hitelességét csak a kulcs titkossága
// adja. A hívó MINDEN visszafejtett mezőt (TRID, AMO, MSGT) vessen össze a
// saját nyilvántartásával, és sikernek kizárólag a MSGT32-re kapott MSGT31
// RC=00-t tekintse (GYFK 6. o.).

const crypto = require('crypto');
const util = require('util');
const zlib = require('zlib');

const KULCSFAJL_MERET = 38;
const PID_MINTA = /^[A-Z]{3}[01][0-9]{3}$/;
// A banki üzenetek kicsik (néhány száz bájt) — a nagy bemenet csak memóriát és
// eseményhurok-időt égetne (5 MB ≈ 128 MB heap, mérve).
const MAX_UZENET = 16 * 1024;

class EkiHiba extends Error {
  /** @param {string} code — a sakiCrypt hibakódjainak megfelelő azonosító */
  constructor(code, message) {
    super(message || code);
    this.name = 'EkiHiba';
    this.code = code;
  }
}

/**
 * A bank titkosítatlan hibaválasza (HTTP 403/500 törzse): „RC=Sxx" a
 * titkosítási, „RC=Dxx" a feldolgozási hiba (Technikai dok. 24. o.).
 */
class EkiBankHiba extends Error {
  constructor(rc, raw) {
    super(`CIB banki hiba: ${rc}`);
    this.name = 'EkiBankHiba';
    this.code = 'BANK_ERROR';
    this.rc = rc;
    // vezérlőkarakter nélkül — a naplóba sortöréssel ne lehessen hamis sort írni
    this.raw = String(raw).replace(/[\u0000-\u001f\u007f]/g, ' ');
  }
}

// CRC-32 (IEEE, a zlib-é). A zlib.crc32 Node 22.2 / 20.15 óta van — régebbi
// futtatókörnyezetre táblás tartalék, hogy a modul ne függjön a kisverziótól.
let crcTabla = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!crcTabla) {
    crcTabla = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTabla[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A banktól kapott 38 bájtos .des kulcsfájl értelmezése (Technikai dok. 25.
 * o., a sakiCrypt kulcsbetöltője szerint):
 *   0–3 'EKI\0' | 4–5 verzió (0x0002, big-endian) | 6–9 áruház-azonosító +
 *   '\0' (a PID első 3 betűje) | 10–13 létrehozási idő (Unix, big-endian) |
 *   14–21 K1 | 22–29 K2 | 30–37 IV
 * A kulcsot SOHA nem naplózzuk — csak az ujjlenyomatát (SHA-256 eleje), amivel
 * a teszt és az éles kulcs (a banknál AZONOS fájlnévvel jön) megkülönböztethető.
 * @param {Buffer} buf
 * @param {string} pid — a szerződés szerinti kereskedő-azonosító (pl. ABC0001)
 */
function parseDesKey(buf, pidBe) {
  if (!Buffer.isBuffer(buf) || buf.length !== KULCSFAJL_MERET) {
    throw new EkiHiba('UER_BADKEY', `A kulcsfájl ${KULCSFAJL_MERET} bájtos kell legyen.`);
  }
  // A bank a PID-et nagybetűvel küldi — egy kisbetűs env-érték minden banki
  // üzenetet „idegennek" látna, ezért itt egységesítünk.
  const pid = typeof pidBe === 'string' ? pidBe.trim().toUpperCase() : '';
  if (!PID_MINTA.test(pid)) {
    throw new EkiHiba('UER_BADPARM', 'Érvénytelen kereskedő-azonosító (PID).');
  }
  if (buf.toString('latin1', 0, 4) !== 'EKI\0' || buf.readUInt16BE(4) !== 2) {
    throw new EkiHiba('UER_BADKEY', 'A kulcsfájl fejléce érvénytelen.');
  }
  const aruhaz = buf.toString('latin1', 6, 10).split('\0')[0];
  if (aruhaz.toUpperCase() !== pid.slice(0, 3).toUpperCase()) {
    throw new EkiHiba('UER_BADKEY', 'A kulcsfájl nem ehhez a kereskedő-azonosítóhoz tartozik.');
  }
  const k1 = buf.subarray(14, 22);
  const k2 = buf.subarray(22, 30);
  const kulcs = {
    pid,
    createdAt: new Date(buf.readUInt32BE(10) * 1000),
    fingerprint: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
  };
  // A kulcsbájtok NEM felsorolhatók, és a naplózó/JSON-nézet sem mutatja őket:
  // egy `console.log({ kulcs })` vagy egy Sentry-kontextus így sem viszi ki.
  const biztonsagos = () => ({ pid, fingerprint: kulcs.fingerprint, createdAt: kulcs.createdAt });
  Object.defineProperties(kulcs, {
    key: { value: Buffer.concat([k1, k2, k1]), enumerable: false },
    iv: { value: Buffer.from(buf.subarray(30, 38)), enumerable: false },
    toJSON: { value: biztonsagos, enumerable: false },
    [util.inspect.custom]: { value: () => `EkiKulcs ${util.inspect(biztonsagos())}`, enumerable: false },
  });
  return Object.freeze(kulcs);
}

function ellenorizKulcs(kulcs) {
  if (!kulcs || typeof kulcs.pid !== 'string' || !Buffer.isBuffer(kulcs.key) || kulcs.key.length !== 24
    || !Buffer.isBuffer(kulcs.iv) || kulcs.iv.length !== 8) {
    throw new EkiHiba('UER_NOKEY', 'Hiányzó vagy érvénytelen CIB-kulcs.');
  }
}

/**
 * Kulcs a környezetből: CIB_PID + CIB_KEY_B64 (a .des fájl base64-ben; a
 * Railway-en nincs tartós lemez, és a kulcs így sosem kerül a repóba).
 * @returns {ReturnType<typeof parseDesKey>|null} null, ha nincs beállítva
 */
function loadKeyFromEnv(env = process.env) {
  if (!env.CIB_PID || !env.CIB_KEY_B64) return null;
  return parseDesKey(Buffer.from(env.CIB_KEY_B64, 'base64'), env.CIB_PID);
}

// PHP rawurlencode-megfelelő, NAGYBETŰS hexával (a sakiCrypt dekódolója a
// kisbetűs %xx-et hibásan olvassa). Ez adja vissza bájtra a dokumentáció
// kidolgozott példáját.
function rawurlencode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Bájtszintű %XX-dekódolás (kis- és nagybetűs hexa). A decodeURIComponent itt
// nem jó: a bank ISO-8859-2-es bájtjain (pl. %F5) URIError-t dobna.
function pctToBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const h = s.slice(i + 1, i + 3);
    if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(h)) {
      out.push(parseInt(h, 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Üzenet titkosítása a bank felé.
 * @param {Array<[string, string|number]>} mezok — sorrendben, pl.
 *   [['PID','ABC0001'],['TRID','…'],['MSGT','10'], …]; az első a PID
 * @param {ReturnType<typeof parseDesKey>} kulcs
 * @returns {string} 'PID=…&CRYPTO=1&DATA=…'
 */
function ekiEncrypt(mezok, kulcs) {
  ellenorizKulcs(kulcs);
  if (!Array.isArray(mezok) || !mezok.length) throw new EkiHiba('UER_BADPARM', 'Üres üzenet.');
  const latott = new Set();
  const parok = mezok.map((par) => {
    if (!Array.isArray(par) || par.length !== 2) throw new EkiHiba('UER_BADPARM', 'A mező [név, érték] pár legyen.');
    const [nev, ertek] = par;
    if (typeof nev !== 'string' || !/^[A-Z0-9]+$/.test(nev)) throw new EkiHiba('UER_BADPARM', 'Érvénytelen mezőnév.');
    if (nev === 'CRYPTO') throw new EkiHiba('UER_BADPARM', 'A CRYPTO nem része a titkosított üzenetnek.');
    if (latott.has(nev)) throw new EkiHiba('UER_BADPARM', `Ismétlődő mező: ${nev}`);
    latott.add(nev);
    // Csak szöveg vagy véges szám — a `UID=undefined` hívói hiba ne menjen ki
    // „érvényes" adatként a bankhoz.
    if (!(typeof ertek === 'string' || (typeof ertek === 'number' && Number.isFinite(ertek)))) {
      throw new EkiHiba('UER_BADPARM', `Érvénytelen érték a(z) ${nev} mezőben.`);
    }
    const v = String(ertek);
    // Csak nyomtatható ASCII, '&' és '=' nélkül — SZÁNDÉKOS szigorítás a
    // leíráshoz képest (az egyes mezőknél szóközt is enged): a bank a TELJES
    // belső szöveget dekódolja, és csak utána bont, így egy értékbeli '&'/'='
    // szétszedné az üzenetet; a nem-ASCII érték kódolása (UTF-8 vs. a bank
    // ISO-8859-2-je) pedig nem egyértelmű. Az általunk küldött mezők (PID,
    // TRID, UID, AMO, CUR, TS, AUTH, LANG, URL, EXTRA01) mind ilyenek; a
    // CNAME/CADDR-féle mezőket nem küldjük (adatminimalizálás).
    if (!/^[\x21-\x7e]*$/.test(v) || /[&=]/.test(v)) {
      throw new EkiHiba('UER_BADPARM', `Tiltott karakter a(z) ${nev} mezőben.`);
    }
    return [nev, v];
  });
  const pid = parok.find(([n]) => n === 'PID')?.[1];
  if (!pid || pid !== kulcs.pid) throw new EkiHiba('UER_BADPARM', 'A PID hiányzik vagy nem a kulcshoz tartozik.');

  const kodolt = rawurlencode(parok.map(([n, v]) => `${n}=${v}`).join('&'))
    .replace(/%3D/g, '=')
    .replace(/%26/g, '&');
  const nyilt = Buffer.from(kodolt, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(nyilt));

  // A Node maga paddel (PKCS#7, blokkhatárnál teljes blokk) — előtte kézzel
  // paddelni TILOS (dupla padding, Fejlesztői útmutató 14. o.).
  const c = crypto.createCipheriv('des-ede3-cbc', kulcs.key, kulcs.iv);
  let rejtett = Buffer.concat([c.update(Buffer.concat([nyilt, crc])), c.final()]);
  const p = 3 - (rejtett.length % 3); // 1–3, így a Base64 sosem végződik '='-re
  rejtett = Buffer.concat([rejtett, Buffer.alloc(p, p)]);
  return `PID=${pid}&CRYPTO=1&DATA=${encodeURIComponent(rejtett.toString('base64'))}`;
}

/**
 * A bank üzenetének visszafejtése: a HTTP-válasz törzse, vagy a vásárló
 * visszairányításánál (MSGT21) a NYERS query string — nem az Express
 * req.query-je, mert az a Base64 '+' jelét szóközzé alakítja.
 * @param {string} raw
 * @param {ReturnType<typeof parseDesKey>} kulcs
 * @returns {Record<string,string>} nagybetűs mezőnevek; az RT ISO-8859-2-ből dekódolva
 */
function ekiDecrypt(raw, kulcs, { bankValasz = false } = {}) {
  ellenorizKulcs(kulcs);
  if (typeof raw !== 'string') throw new EkiHiba('UER_BADURL', 'Hiányzó üzenet.');
  if (raw.length > MAX_UZENET) throw new EkiHiba('UER_BADURL', 'Túl hosszú üzenet.');
  const szoveg = raw.trim().replace(/^\?/, '');
  // A titkosítatlan „RC=Sxx/Dxx" CSAK a bank szerver–szerver HTTP-válaszában
  // hiteles. A böngészős visszatérést (MSGT21) a vásárló is átírhatja — ott
  // egy ilyen szöveg egyszerűen érvénytelen üzenet, nem banki ítélet.
  if (bankValasz) {
    const bankHiba = /^RC=([SD]\d{2})\b/.exec(szoveg);
    if (bankHiba) throw new EkiBankHiba(bankHiba[1], szoveg.slice(0, 200));
  }

  const kulso = {};
  for (const resz of szoveg.split('&')) {
    const i = resz.indexOf('=');
    if (i < 1) continue;
    const nev = resz.slice(0, i).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(kulso, nev)) throw new EkiHiba('UER_BADURL', 'Ismétlődő mező.');
    kulso[nev] = resz.slice(i + 1);
  }
  if (!kulso.PID || kulso.CRYPTO !== '1' || !kulso.DATA) throw new EkiHiba('UER_BADURL', 'Hiányos EKI-üzenet.');
  if (kulso.PID !== kulcs.pid) throw new EkiHiba('UER_BADURL', 'Idegen kereskedő-azonosító.');

  // Ha útközben valami (webszerver, proxy) már dekódolta, a '+' szóköz lett.
  const b64 = pctToBytes(kulso.DATA).toString('latin1').replace(/ /g, '+');
  if (!/^[A-Za-z0-9+/]+$/.test(b64) || b64.length % 4 !== 0) throw new EkiHiba('UER_BADURL', 'Hibás DATA.');
  let buf = Buffer.from(b64, 'base64');
  const p3 = buf[buf.length - 1];
  if (!(p3 >= 1 && p3 <= 3) || buf.length <= p3 || !buf.subarray(buf.length - p3).every((b) => b === p3)) {
    throw new EkiHiba('UER_BADPAD', 'Hibás kiegészítés (Base64).');
  }
  buf = buf.subarray(0, buf.length - p3);
  if (!buf.length || buf.length % 8 !== 0) throw new EkiHiba('UER_BADSIZE', 'Hibás blokkhossz.');

  const d = crypto.createDecipheriv('des-ede3-cbc', kulcs.key, kulcs.iv);
  d.setAutoPadding(false);
  const nyers = Buffer.concat([d.update(buf), d.final()]);

  // A bank könyvtára mindig PKCS#7-tel paddel (blokkhatárnál teljes blokk). A
  // leírás szövege 8 többszörösénél „nincs padding"-ot is sugall — ezt a
  // változatot is elviseljük: a padding csak akkor jön le, ha érvényes, a
  // végső döntést a CRC hozza.
  const jeloltek = [];
  const p8 = nyers[nyers.length - 1];
  if (p8 >= 1 && p8 <= 8 && nyers.subarray(nyers.length - p8).every((b) => b === p8)) {
    jeloltek.push(nyers.subarray(0, nyers.length - p8));
  }
  jeloltek.push(nyers);
  const test = jeloltek.find((j) => j.length >= 4
    && crc32(j.subarray(0, j.length - 4)) === j.readUInt32BE(j.length - 4));
  if (!test) throw new EkiHiba('UER_CRC', 'Az üzenet ellenőrzőösszege hibás (sérült üzenet vagy rossz kulcs).');

  // ELŐBB bontunk, UTÁNA dekódolunk (a %26/%3D egy értékben ne bontson).
  const eredmeny = Object.create(null);
  for (const kv of test.subarray(0, test.length - 4).toString('latin1').split('&')) {
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const nev = kv.slice(0, i).toUpperCase();
    // Ismétlődő mező → elutasítás: az „utolsó nyer" szemantika egy
    // blokk-toldásos hamisítással mezőt írhatna felül (a CRC nem MAC).
    if (nev in eredmeny) throw new EkiHiba('UER_BADURL', 'Ismétlődő mező a banki üzenetben.');
    const bajtok = pctToBytes(kv.slice(i + 1).replace(/\+/g, ' '));
    eredmeny[nev] = nev === 'RT' ? new TextDecoder('iso-8859-2').decode(bajtok) : bajtok.toString('latin1');
  }
  if (eredmeny.PID !== kulso.PID) throw new EkiHiba('UER_BADURL', 'A belső és a külső PID eltér.');
  return { ...eredmeny };
}

/**
 * Induláskori önteszt: a futtatókörnyezet OpenSSL-je tudja-e a 3DES-EDE-CBC-t
 * (egy jövőbeli Node/OpenSSL-frissítés legacy providerbe teheti). Véletlen
 * kulccsal, a banki kulcs nélkül fut.
 * @returns {boolean}
 */
function selfTest() {
  try {
    const buf = Buffer.alloc(KULCSFAJL_MERET);
    buf.write('EKI\0', 0, 'latin1');
    buf.writeUInt16BE(2, 4);
    buf.write('TST\0', 6, 'latin1');
    crypto.randomBytes(24).copy(buf, 14);
    const kulcs = parseDesKey(buf, 'TST0001');
    const uzenet = ekiEncrypt([['PID', 'TST0001'], ['MSGT', '10'], ['TRID', '0000000000000001']], kulcs);
    const vissza = ekiDecrypt(uzenet, kulcs);
    // Az RT mező ISO-8859-2 dekódolása ICU-t igényel (ICU nélküli Node-buildben
    // csak az első valódi banki válasznál derülne ki) — azt is kipróbáljuk.
    const latin2 = new TextDecoder('iso-8859-2').decode(Buffer.from([0xf5]));
    return vissza.MSGT === '10' && vissza.TRID === '0000000000000001' && latin2 === '\u0151';
  } catch {
    return false;
  }
}

module.exports = {
  EkiHiba,
  EkiBankHiba,
  parseDesKey,
  loadKeyFromEnv,
  ekiEncrypt,
  ekiDecrypt,
  selfTest,
  // belső segédek — a tesztek független ellenőrzéséhez
  _crc32: crc32,
  _rawurlencode: rawurlencode,
};
