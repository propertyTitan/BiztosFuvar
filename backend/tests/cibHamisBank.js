// =====================================================================
//  HAMIS CIB-BANK a tesztekhez (2026-09-29, CIB PR-2/A)
//
//  A valódi bankot (ekit.cib.hu / eki.cib.hu) teszt SOHA nem hívja: a repó
//  NYILVÁNOS, a banki tesztkulcs és a dokumentáció a szerződés szerint
//  bizalmas. Ez a modul egy folyamaton belüli HTTP-szerver véletlen porton
//  (csak 127.0.0.1), SAJÁT, futásidőben generált kulccsal, és a banki
//  protokoll általunk használt szeletét játssza el:
//    - POST /market.saki: MSGT10 → MSGT11, MSGT33 → MSGT31, MSGT32 → MSGT31
//    - GET  /customer.saki?<MSGT20>: tesztoldal „Fizetek / Elutasítom /
//      Bezárom" döntéssel, ami MSGT21-gyel visszairányít a CIB_RETURN_URL-re
//  Forgatókönyvezhető (globális sor üzenettípusonként, vagy TRID-enként):
//  RC-sorozat (PR/00/TO/51/X0/NT…), késleltetés, titkosítatlan RC=Sxx/Dxx
//  HTTP 200-zal vagy 403/500-zal, „feldolgoz, majd bontja a kapcsolatot",
//  „soha nem válaszol", eltérő AMO/TRID a válaszban, ISO-8859-2-es RT.
//  A valódi bankhoz hasonlóan a második FELDOLGOZOTT MSGT32-re D05-öt ad.
//
//  ⚠️ A mért tény (2026-09-29, ekit.cib.hu/market.saki): a bank az üres
//  kérésre HTTP 200-zal és titkosítatlan „RC=S01" törzzsel válaszolt — a
//  hibakód tehát NEM csak 403/500-zal jöhet. A hamis bank mindkét formát
//  tudja, hogy a kliens a TÖRZS alapján döntsön, ne a státuszkód alapján.
// =====================================================================
const http = require('http');
const crypto = require('crypto');
const eki = require('../src/services/ekiCrypt');

const PID = 'TST0001';

/** Új, véletlen .des-kulcsfájl (a selfTest mintájára, a bank kulcsa NÉLKÜL). */
function ujKulcs(pid = PID) {
  const buf = Buffer.alloc(38);
  buf.write('EKI\0', 0, 'latin1');
  buf.writeUInt16BE(2, 4);
  buf.write(`${pid.slice(0, 3)}\0`, 6, 'latin1');
  buf.writeUInt32BE(Math.floor(Date.now() / 1000), 10);
  crypto.randomBytes(24).copy(buf, 14);
  return {
    pid,
    buf,
    b64: buf.toString('base64'),
    kulcs: eki.parseDesKey(buf, pid),
    ujjlenyomat: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12),
  };
}

// A bank az RT-t ISO-8859-2-ben küldi: a magyar ékezetek kódtáblája.
const LATIN2 = {
  Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ö: 0xd6, Ő: 0xd5, Ú: 0xda, Ü: 0xdc, Ű: 0xdb,
  á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ö: 0xf6, ő: 0xf5, ú: 0xfa, ü: 0xfc, ű: 0xfb,
};
function latin2Bajtok(s) {
  return Buffer.from([...String(s)].map((c) => {
    const k = c.charCodeAt(0);
    if (k < 0x80) return k;
    return LATIN2[c] || 0x3f;
  }));
}
function pctKodol(bajtok) {
  let ki = '';
  for (const b of bajtok) {
    const c = String.fromCharCode(b);
    ki += /[A-Za-z0-9._~-]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return ki;
}

/**
 * A BANK oldali titkosítás (a mi ekiEncrypt-ünktől függetlenül, hogy az RT
 * szóközt és latin2 ékezetet is vihessen, amit a kereskedői oldal SZÁNDÉKOSAN
 * nem enged): URL-kódolt belső szöveg + CRC32 → 3DES-EDE-CBC → 1–3 bájtos
 * kiegészítés → Base64 → URL-kódolás.
 */
function bankTitkosit(parok, k, { nyersPlusz = false } = {}) {
  const belso = parok.map(([n, v]) => `${n}=${pctKodol(latin2Bajtok(v))}`).join('&');
  const nyilt = Buffer.from(belso, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(eki._crc32(nyilt));
  const c = crypto.createCipheriv('des-ede3-cbc', k.kulcs.key, k.kulcs.iv);
  let ct = Buffer.concat([c.update(Buffer.concat([nyilt, crc])), c.final()]);
  const p = 3 - (ct.length % 3);
  ct = Buffer.concat([ct, Buffer.alloc(p, p)]);
  const b64 = ct.toString('base64');
  return `PID=${k.pid}&CRYPTO=1&DATA=${nyersPlusz ? b64 : encodeURIComponent(b64)}`;
}

const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });

const RT_SZOVEG = {
  '00': 'Sikeres tranzakció',
  PR: 'Folyamatban lévő tranzakció',
  TO: 'Időtúllépés',
  NT: 'Nem található tranzakció',
  51: 'Elutasított tranzakció',
  X0: 'Sikertelen 3D Secure hitelesítés',
};

/** Egy biztosan zárt port (a „nem fogad kapcsolatot" eset). */
async function zartPortUrl(ut = '/market.saki') {
  const s = http.createServer();
  await new Promise((r) => { s.listen(0, '127.0.0.1', r); });
  const { port } = s.address();
  await new Promise((r) => { s.close(r); });
  return `http://127.0.0.1:${port}${ut}`;
}

/**
 * Elindít egy hamis bankot. A lépés-leírók (forgatókönyv):
 *   { rc: '00' | 'PR' | 'TO' | '51' | 'X0' | 'NT' | '02' | '01' … }
 *   { nyers: 'RC=S01', http: 200 | 403 | 500 }   titkosítatlan banki hiba
 *   { http: 500, ures: true }                     üres törzs, RC nélkül
 *   { szemet: 'valami' }                          HTTP 200, értelmetlen törzs
 *   { kesleltetesMs: 200, ... }                   válasz előtt vár
 *   { lefagy: true }                              soha nem válaszol (a kliens időkerete dönt)
 *   { bont: true }                                FELDOLGOZZA, majd bontja a kapcsolatot
 *   { amo: '999' } / { trid: '…' } / { rt: '…' }  eltérő mező a válaszban
 */
async function inditHamisBank({ pid = PID } = {}) {
  const k = ujKulcs(pid);
  const tranzakciok = new Map(); // TRID → { amo, uid, url, ts, dontes, zarva, anum }
  const globalisSor = { 10: [], 32: [], 33: [] };
  const tridSor = new Map(); // TRID → { 32: [], 33: [] }
  const uzenetek = []; // { ido, msgt, trid, mezok, raw, csatorna }
  const socketek = new Set();
  let horog = null; // async (uzenet) => void — a válasz ELŐTT fut (pl. DB-napló ellenőrzése)

  function kovetkezoLepes(msgt, trid) {
    const sajat = tridSor.get(trid);
    if (sajat && sajat[msgt] && sajat[msgt].length) return sajat[msgt].shift();
    if (globalisSor[msgt] && globalisSor[msgt].length) return globalisSor[msgt].shift();
    return null;
  }

  function alapRc(msgt, t) {
    if (!t) return 'NT';
    if (msgt === 32 && t.zarva) return null; // → D05
    if (t.dontes === 'fizet') return '00';
    if (t.dontes === 'elutasit') return '51';
    return 'PR';
  }

  async function marketKezelo(req, res, raw) {
    let mezok;
    try {
      mezok = eki.ekiDecrypt(raw, k.kulcs);
    } catch {
      // A valódi bank a nem értelmezhető kérésre titkosítatlan S-kódot ad.
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('RC=S01');
      return;
    }
    const msgt = Number(mezok.MSGT);
    const trid = mezok.TRID;
    const uzenet = { ido: Date.now(), msgt, trid, mezok, raw, csatorna: 'market' };
    uzenetek.push(uzenet);
    if (horog) await horog(uzenet);

    const lepes = kovetkezoLepes(msgt, trid) || {};
    if (lepes.kesleltetesMs) await varj(lepes.kesleltetesMs);
    const t = tranzakciok.get(trid);

    if (lepes.lefagy) {
      if (msgt === 32 && t && lepes.feldolgoz !== false) t.zarva = true;
      return; // soha nem válaszol — a socketet a leállítás bontja
    }
    if (lepes.nyers !== undefined) {
      res.writeHead(lepes.http || 200, { 'Content-Type': 'text/plain' });
      res.end(lepes.nyers);
      return;
    }
    if (lepes.ures) {
      res.writeHead(lepes.http || 500);
      res.end();
      return;
    }
    if (lepes.szemet !== undefined) {
      res.writeHead(lepes.http || 200, { 'Content-Type': 'text/plain' });
      res.end(lepes.szemet);
      return;
    }

    let valasz;
    if (msgt === 10) {
      const rc = lepes.rc || '00';
      if (rc === '00') {
        tranzakciok.set(trid, {
          amo: mezok.AMO, uid: mezok.UID, url: mezok.URL, ts: mezok.TS,
          dontes: null, zarva: false, anum: String(crypto.randomInt(100000, 999999)),
        });
      }
      valasz = [['MSGT', '11'], ['PID', k.pid], ['TRID', lepes.trid || trid], ['RC', rc]];
    } else if (msgt === 33 || msgt === 32) {
      const rc = lepes.rc || alapRc(msgt, t);
      if (rc === null) {
        // Második feldolgozott MSGT32: „a kéréstípus már ki lett szolgálva".
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('RC=D05');
        return;
      }
      if (msgt === 32 && t && rc !== 'PR') t.zarva = true;
      valasz = [
        ['MSGT', '31'], ['PID', k.pid], ['TRID', lepes.trid || trid],
        ['AMO', lepes.amo !== undefined ? lepes.amo : (t ? t.amo : mezok.AMO)],
        ['RC', rc], ['RT', lepes.rt || RT_SZOVEG[rc] || 'Elutasított tranzakció'],
        ['ANUM', rc === '00' && t ? t.anum : ''],
      ];
      // A maszkolt kártyaszám CSAK a MSGT33-ra adott válaszban jön.
      if (msgt === 33) valasz.push(['CNUM', '4***********1234']);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('RC=D02');
      return;
    }

    const torzs = bankTitkosit(valasz, k);
    if (lepes.bont) {
      // Feldolgozva — de a válasz sosem ér vissza (a kapcsolat megszakad).
      req.socket.destroy();
      return;
    }
    res.writeHead(lepes.http || 200, { 'Content-Type': 'text/plain' });
    res.end(torzs);
  }

  function customerKezelo(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/customer.saki/dontes') {
      const trid = url.searchParams.get('trid');
      const d = url.searchParams.get('d');
      const t = tranzakciok.get(trid);
      if (!t) { res.writeHead(404); res.end(); return; }
      if (d === 'bezar') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>Bezártad</p>'); return; }
      t.dontes = d === 'fizet' ? 'fizet' : 'elutasit';
      res.writeHead(302, { Location: `${t.url}?${bankTitkosit([['MSGT', '21'], ['PID', k.pid], ['TRID', trid]], k)}` });
      res.end();
      return;
    }
    const raw = req.url.slice(req.url.indexOf('?') + 1);
    let mezok;
    try { mezok = eki.ekiDecrypt(raw, k.kulcs); } catch { res.writeHead(400); res.end('Hibás kérés'); return; }
    uzenetek.push({ ido: Date.now(), msgt: Number(mezok.MSGT), trid: mezok.TRID, mezok, raw, csatorna: 'customer' });
    const trid = mezok.TRID;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Hamis CIB</title>
<a href="/customer.saki/dontes?trid=${trid}&d=fizet">Fizetek</a>
<a href="/customer.saki/dontes?trid=${trid}&d=elutasit">Elutasítom</a>
<a href="/customer.saki/dontes?trid=${trid}&d=bezar">Bezárom</a>`);
  }

  const server = http.createServer((req, res) => {
    const darabok = [];
    req.on('data', (d) => darabok.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(darabok).toString('latin1');
      if (req.method === 'POST' && req.url === '/market.saki') {
        marketKezelo(req, res, raw).catch(() => { try { res.writeHead(500); res.end(); } catch { /* no-op */ } });
      } else if (req.method === 'GET' && req.url.startsWith('/customer.saki')) {
        customerKezelo(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  server.on('connection', (s) => { socketek.add(s); s.on('close', () => socketek.delete(s)); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const { port } = server.address();
  const alap = `http://127.0.0.1:${port}`;

  return {
    pid: k.pid,
    kulcs: k,
    url: alap,
    marketUrl: `${alap}/market.saki`,
    customerUrl: `${alap}/customer.saki`,
    uzenetek,
    tranzakciok,
    /** Globális forgatókönyv egy üzenettípusra (a TRID-ek előre nem ismertek). */
    forgatokonyv(msgt, lepesek) { globalisSor[msgt].push(...lepesek); },
    /** TRID-enkénti forgatókönyv. */
    tridre(trid, msgt, lepesek) {
      if (!tridSor.has(trid)) tridSor.set(trid, { 32: [], 33: [] });
      tridSor.get(trid)[msgt].push(...lepesek);
    },
    /** A vásárló döntése a banki oldalon ('fizet' | 'elutasit'). */
    dont(trid, d) { const t = tranzakciok.get(trid); if (t) t.dontes = d; },
    /** A válasz előtt futó horog (pl. a DB-napló ellenőrzésére). */
    horog(fn) { horog = fn; },
    szamol(trid, msgt) { return uzenetek.filter((u) => u.trid === trid && u.msgt === msgt && u.csatorna === 'market').length; },
    /** A böngésző visszatérő query-je (MSGT21), ahogy a bank adja. */
    msgt21Query(trid, opciok) { return bankTitkosit([['MSGT', '21'], ['PID', k.pid], ['TRID', trid]], k, opciok); },
    /** A konfig-feloldáshoz szükséges env (a bank TESZT-környezetét játssza). */
    env(tobb = {}) {
      return {
        NODE_ENV: 'test',
        PAYMENT_PROVIDER: 'cib',
        CIB_PID: k.pid,
        CIB_KEY_B64: k.b64,
        CIB_MARKET_URL: `${alap}/market.saki`,
        CIB_CUSTOMER_URL: `${alap}/customer.saki`,
        CIB_KORNYEZET: 'teszt',
        CIB_RETURN_URL: 'https://api.gofuvar.hu/payments/cib/vissza',
        CIB_HMAC_TITOK: 'teszt-hmac-titok-legalabb-harminckét-bájt-hosszú',
        WEB_BASE_URL: 'https://www.gofuvar.hu',
        ...tobb,
      };
    },
    async leallit() {
      for (const s of socketek) s.destroy();
      await new Promise((r) => { server.close(r); });
    },
  };
}

/**
 * Env-változók ideiglenes beállítása a process.env-en; a visszaadott függvény
 * PONTOSAN visszaállítja az előző állapotot (a teszt-kornyezet őr ellenőrzi,
 * hogy a CIB-kulcs a fájl végén ne maradjon bent).
 */
function beallitEnv(ertekek) {
  const elozo = {};
  for (const [kulcs, ertek] of Object.entries(ertekek)) {
    elozo[kulcs] = Object.prototype.hasOwnProperty.call(process.env, kulcs) ? process.env[kulcs] : undefined;
    if (ertek === undefined) delete process.env[kulcs];
    else process.env[kulcs] = ertek;
  }
  return function visszaallit() {
    for (const [kulcs, ertek] of Object.entries(elozo)) {
      if (ertek === undefined) delete process.env[kulcs];
      else process.env[kulcs] = ertek;
    }
  };
}

module.exports = {
  PID, ujKulcs, bankTitkosit, inditHamisBank, zartPortUrl, beallitEnv,
};
