// =====================================================================
//  CIB EKI — BANKI KLIENS + ÜZENETNAPLÓ (2026-09-29, CIB PR-2/A)
//
//  Az egyetlen hely, ahol a GoFuvar szerver–szerver üzenetet küld a CIB
//  „market" végpontjára (MSGT10/32/33). Három szabály:
//
//   1. A TÖRZS A DÖNTŐ, NEM A HTTP-STÁTUSZ. A bank a titkosítatlan
//      „RC=Sxx/Dxx" hibakódot HTTP 200-zal is adhatja — 2026-09-29-én mérve
//      az ekit.cib.hu üres kérésre 200 + „RC=S01"-et adott. Ezért a választ
//      bájtként (latin1) olvassuk, és az ekiDecrypt({bankValasz:true})
//      dönt; a státuszkódot külön visszaadjuk, osztályozásra.
//   2. „NEM KÜLDTÜK EL" ≠ „ELKÜLDTÜK, DE NEM JÖTT VÁLASZ". A kapcsolódás
//      (TCP/TLS) ELŐTTI hiba bizonyítja, hogy a bank semmit nem kapott
//      (nem_kuldott — a zárásnál újrapróbálható); utána minden hiba KÉTES
//      (idokeret / halozat), mert a bank feldolgozhatta — a MSGT32 ilyenkor
//      soha nem mehet ki újra (kettős terhelés).
//   3. WRITE-AHEAD NAPLÓ. A kimenő titkosított üzenet a küldés ELŐTT, a
//      bejövő utána kerül a cib_messages-be — autocommittal, a pool saját
//      kapcsolatán, így a hívó tranzakciójának ROLLBACK-je sem viszi el. Ha
//      a kimenő sor nem írható, a kérés NEM megy ki. A napló csak
//      titkosított szöveget (vagy a titkosítatlan banki hibakódot) tárol; a
//      kulcs és a nyílt üzenet sehova nem kerül.
//
//  Banki hívás SOHA nem fut nyitott DB-tranzakcióban vagy sorzár alatt — ez
//  a hívó felelőssége (a fizetési folyamat kétfázisú).
// =====================================================================
const http = require('http');
const https = require('https');
const os = require('os');
const db = require('../db');
const eki = require('./ekiCrypt');
const { kulsoHivasSignal } = require('../utils/httpIdokeret');
const {
  maszkoltTrid, bankKodOsztaly, TRID_RE, CibProtokollHiba,
} = require('./cibProtokoll');

// A cib_messages.raw CHECK-je (096) — a nagyobb törzs levágva kerül be.
const NAPLO_MAX_RAW = 4000;
// A banki üzenet néhány száz bájt; a válaszból legfeljebb ennyit olvasunk.
const VALASZ_MAX_BAJT = 64 * 1024;
const NAPLO_MSGT = new Set([10, 11, 20, 21, 31, 32, 33, 37, 38, 70, 71]);
const IRANYOK = new Set(['ki', 'be', 'bongeszo_ki', 'bongeszo_be']);
const VEGPONTOK = new Set(['market', 'customer', 'vissza']);

// A futó banki hívások száma — a szabályos leállás erre vár, hogy egy
// MSGT32 ne szakadjon meg deploy közben.
let futo = 0;

function futoHivasokSzama() {
  return futo;
}

function peldany() {
  return `${process.env.RAILWAY_REPLICA_ID || os.hostname()}:${process.pid}`;
}

function riaszt(uzenet) {
  if (!process.env.SENTRY_DSN) return;
  try { require('@sentry/node').captureMessage(uzenet, 'error'); } catch { /* no-op */ }
}

/**
 * Egy banki üzenet naplózása (autocommit). A böngészős irányokat (MSGT20 a
 * bankhoz küldött átirányításban, MSGT21 a visszatérésben) is ez írja.
 * @returns {Promise<number>} a naplósor azonosítója
 */
async function naploz({
  trid = null, irany, msgt = null, endpoint, http: httpStatus = null, rc = null, raw = '',
  hibaOsztaly = null, zarasiKiserlet = null, idoMs = null,
}) {
  if (!IRANYOK.has(irany) || !VEGPONTOK.has(endpoint)) {
    throw new CibProtokollHiba('Érvénytelen naplóirány vagy végpont.');
  }
  const msgtSzam = Number(msgt);
  const rcSzoveg = typeof rc === 'string' ? rc.trim().slice(0, 3) : null;
  const { rows } = await db.query(
    `INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, http_status, rc, raw,
                               error_class, close_attempt, duration_ms, instance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      TRID_RE.test(trid || '') ? trid : null,
      irany,
      NAPLO_MSGT.has(msgtSzam) ? msgtSzam : null,
      endpoint,
      Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
      rcSzoveg || null,
      // A Postgres TEXT nem fogad NUL bájtot — a bizonyíték többi része marad.
      String(raw == null ? '' : raw).replace(/\u0000/g, ' ').slice(0, NAPLO_MAX_RAW),
      hibaOsztaly,
      Number.isInteger(zarasiKiserlet) ? zarasiKiserlet : null,
      Number.isFinite(idoMs) ? Math.round(idoMs) : null,
      peldany(),
    ],
  );
  return rows[0].id;
}

/**
 * Egyetlen HTTPS (teszt alatt: loopback HTTP) POST, a hibafázis pontos
 * rögzítésével. Soha nem dob.
 * @returns {Promise<{kuldve:boolean, http:number|null, raw?:string, hiba?:string, hibaKod?:string}>}
 */
function postol(url, torzs, idokeretMs) {
  return new Promise((resolve) => {
    let kuldve = false;
    let kesz = false;
    const vege = (x) => {
      if (kesz) return;
      kesz = true;
      resolve({ kuldve, ...x });
    };
    let u;
    try { u = new URL(url); } catch { vege({ http: null, hiba: 'nem_kuldott', hibaKod: 'ERR_INVALID_URL' }); return; }
    const tls = u.protocol === 'https:';
    const signal = kulsoHivasSignal(idokeretMs);
    const test = Buffer.from(torzs, 'latin1');
    const hibaUtan = () => {
      if (!kuldve) return 'nem_kuldott';
      return signal.aborted ? 'idokeret' : 'halozat';
    };
    let req;
    try {
      req = (tls ? https : http).request(u, {
        method: 'POST',
        // Saját, egyszer használatos kapcsolat: a „kapcsolódott-e" jel így
        // mindig a MOSTANI kérésről szól (egy újrahasznált keep-alive socket
        // nem adna connect-eseményt).
        agent: false,
        signal,
        ...(tls ? { minVersion: 'TLSv1.2' } : {}),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': test.length,
          Accept: '*/*',
          Connection: 'close',
          'User-Agent': 'GoFuvar-EKI/1.0',
        },
      }, (res) => {
        const darabok = [];
        let meret = 0;
        let tul = false;
        const lezar = () => vege({ http: res.statusCode, raw: Buffer.concat(darabok).toString('latin1') });
        res.on('data', (d) => {
          if (tul) return;
          meret += d.length;
          if (meret > VALASZ_MAX_BAJT) {
            tul = true;
            darabok.push(d.subarray(0, d.length - (meret - VALASZ_MAX_BAJT)));
            res.destroy();
            return;
          }
          darabok.push(d);
        });
        res.on('end', lezar);
        res.on('close', () => { if (tul) lezar(); });
        res.on('error', (err) => vege({ http: res.statusCode, hiba: hibaUtan(), hibaKod: err.code || err.name }));
      });
    } catch (err) {
      vege({ http: null, hiba: 'nem_kuldott', hibaKod: err.code || err.name });
      return;
    }
    req.on('socket', (s) => {
      s.once(tls ? 'secureConnect' : 'connect', () => { kuldve = true; });
    });
    req.on('error', (err) => vege({ http: null, hiba: hibaUtan(), hibaKod: err.code || err.name }));
    req.end(test);
  });
}

/**
 * Szerver–szerver üzenet a bank „market" végpontjára.
 *
 * Soha nem dob szállítási vagy banki hibára — az eredményt a hívó a
 * cibProtokoll kimenet-osztályozóival értékeli. Csak hívói hibára dob
 * (hiányos konfig, szabálytalan mező).
 *
 * @param {object} o
 * @param {object} o.beallitasok — cibProtokoll.cibBeallitasok() 'teljes' eredménye
 * @param {Array<[string,string]>} o.mezok — a cibProtokoll üzenetépítőinek kimenete
 * @param {number} o.idokeretMs — erre a hívásra (a MSGT32-nél a zárási keret)
 * @param {number|null} [o.zarasiKiserlet] — a MSGT32 kísérlet sorszáma a naplóhoz
 * @returns {Promise<{kuldve:boolean, http:number|null, mezok:object|null, bankRc:string|null,
 *   hibaOsztaly:null|'idokeret'|'halozat'|'nem_kuldott'|'visszafejtes'|'http'|'bank_S'|'bank_D',
 *   hibaKod:string|null, idoMs:number, naploHiba?:boolean, naplo:{ki:number|null, be:number|null}}>}
 */
async function marketHivas({
  beallitasok, mezok, idokeretMs, zarasiKiserlet = null,
}) {
  if (!beallitasok || !beallitasok.kulcs || !beallitasok.marketUrl) {
    throw new CibProtokollHiba('A CIB-konfiguráció nem teljes.');
  }
  if (!Number.isFinite(idokeretMs) || idokeretMs <= 0) throw new CibProtokollHiba('Hiányzó időkeret.');
  const mezo = (nev) => (mezok.find(([n]) => n === nev) || [])[1];
  const trid = mezo('TRID');
  const msgtKi = Number(mezo('MSGT'));
  // Szabálytalan mező → hívói hiba (EkiHiba), nem banki kimenet.
  const torzs = eki.ekiEncrypt(mezok, beallitasok.kulcs);

  const eredmeny = {
    kuldve: false, http: null, mezok: null, bankRc: null, hibaOsztaly: null, hibaKod: null, idoMs: 0, naplo: { ki: null, be: null },
  };
  futo += 1;
  try {
    // 1) Write-ahead: a kimenő sor a küldés ELŐTT.
    try {
      eredmeny.naplo.ki = await naploz({
        trid, irany: 'ki', msgt: msgtKi, endpoint: 'market', raw: torzs, zarasiKiserlet,
      });
    } catch (err) {
      const uzenet = `[cib] a kimenő MSGT${msgtKi} naplózása sikertelen (${maszkoltTrid(trid)}) — a kérés NEM ment ki`;
      console.error(uzenet, err && err.message);
      riaszt(uzenet);
      return { ...eredmeny, hibaOsztaly: 'nem_kuldott', naploHiba: true };
    }

    // 2) A banki hívás — zár és tranzakció NÉLKÜL.
    const kezd = Date.now();
    const v = await postol(beallitasok.marketUrl, torzs, idokeretMs);
    eredmeny.idoMs = Date.now() - kezd;
    eredmeny.kuldve = v.kuldve;
    eredmeny.http = v.http;
    eredmeny.hibaKod = v.hibaKod || null;
    if (v.hiba) {
      eredmeny.hibaOsztaly = v.hiba;
    } else {
      try {
        eredmeny.mezok = eki.ekiDecrypt(v.raw, beallitasok.kulcs, { bankValasz: true });
      } catch (err) {
        if (err instanceof eki.EkiBankHiba) {
          eredmeny.bankRc = err.rc;
          eredmeny.hibaOsztaly = bankKodOsztaly(err.rc);
        } else {
          // Értelmezhetetlen törzs: 200-nál visszafejtési hiba (rossz kulcs
          // gyanú), egyébként egy RC nélküli HTTP-hiba.
          eredmeny.hibaOsztaly = v.http === 200 ? 'visszafejtes' : 'http';
        }
      }
    }
    if (eredmeny.hibaOsztaly) {
      console.warn(`[cib] MSGT${msgtKi} ${maszkoltTrid(trid)}: ${eredmeny.hibaOsztaly}`
        + `${eredmeny.bankRc ? ` (${eredmeny.bankRc})` : ''}${eredmeny.http ? `, HTTP ${eredmeny.http}` : ''}`);
    }

    // 3) A bejövő sor (vagy a hiba nyoma) utána.
    try {
      const rc = eredmeny.bankRc || (eredmeny.mezok && typeof eredmeny.mezok.RC === 'string' ? eredmeny.mezok.RC : null);
      eredmeny.naplo.be = await naploz({
        trid,
        irany: 'be',
        msgt: eredmeny.mezok ? eredmeny.mezok.MSGT : null,
        endpoint: 'market',
        http: eredmeny.http,
        rc,
        raw: v.raw || '',
        hibaOsztaly: eredmeny.hibaOsztaly,
        zarasiKiserlet,
        idoMs: eredmeny.idoMs,
      });
    } catch (err) {
      // Az eredmény NEM veszhet el egy napló-hiba miatt (a válasz a bank
      // ítélete) — de a bizonyíték hiánya riasztást ér.
      const uzenet = `[cib] a bejövő válasz naplózása sikertelen (${maszkoltTrid(trid)}, MSGT${msgtKi})`;
      console.error(uzenet, err && err.message);
      riaszt(uzenet);
    }
    return eredmeny;
  } finally {
    futo -= 1;
  }
}

module.exports = {
  marketHivas, naploz, futoHivasokSzama, NAPLO_MAX_RAW,
};
