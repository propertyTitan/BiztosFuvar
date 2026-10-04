// =====================================================================
//  CIB EKI (SAKI 1.50) — KONFIGURÁCIÓ, ÜZENETÉPÍTÉS, VÁLASZ-ELLENŐRZÉS,
//  KIMENET-OSZTÁLYOZÁS (2026-09-29, CIB PR-2/A)
//
//  A kártyás kapcsolatfelvételi díj banki protokolljának TISZTA rétege:
//  hálózatot nem hív, állapotot nem ír (a TS-hez a hívó DB-kliensét
//  használja). A titkosítás KIZÁRÓLAG az ekiCrypt.js-ben él.
//
//  Három dolgot dönt el, mindegyik pénzbe kerülő hibamód ellen:
//   1. KONFIG: 'nincs' | 'teljes' | 'hibas'. CIB-env nélkül (ma a Railway-en)
//      'nincs' — minden bitre úgy fut, mint eddig (stub). Részleges, rossz
//      hostú, felcserélt kulcsú vagy önteszten elbukó konfignál 'hibas':
//      a fizetés 503, a stub SEM nyílik vissza (a kézi nyugtázás zárva).
//   2. ÜZENETEK: csak az előírt mezők mennek ki (C*-mező soha —
//      adatminimalizálás), a TRID 16 jegyű kriptográfiai véletlen, a UID egy
//      HMAC-álnév (nem e-mail, nem user-id), a TS a DB órájából jön.
//   3. ELLENŐRZÉS + OSZTÁLYOZÁS: a CRC nem MAC, ezért sikernek CSAK a
//      MSGT32-re kapott, a DB-vel EGYEZŐ (MSGT/PID/TRID/AMO/CUR) MSGT31
//      RC=00 számít; a zárásnál a „bizonyítottan fel nem dolgozott" és a
//      „kétes" kimenet szétválasztása a kettős terhelés elleni fő védelem.
// =====================================================================
const crypto = require('crypto');
const eki = require('./ekiCrypt');
const { rcCsoport } = require('../data/cibRcCsoportok');

// A CIB-mód kötelező változói. Ha EGYIK sincs beállítva → 'nincs'.
const KOTELEZO_ENV = Object.freeze([
  'CIB_PID', 'CIB_KEY_B64', 'CIB_MARKET_URL', 'CIB_CUSTOMER_URL',
  'CIB_KORNYEZET', 'CIB_RETURN_URL', 'CIB_HMAC_TITOK',
]);
// A kivezetett vPOS-változók (a 2026-08-08-i skeleton maradványai).
const ELAVULT_ENV = Object.freeze(['CIB_API_KEY', 'CIB_MERCHANT_ID', 'CIB_BASE_URL']);

// Hangolók: [env, kulcs, alapérték, min, max] — egész számok. A hibás
// érték figyelmeztetést ad és az alapérték marad (egy elgépelt időkeret ne
// tegye „hibás"-sá az egész fizetést, de ne is fusson némán 0 ms-mal).
// ⚠️ 2026-10-03 (PR-5): a felső határok a 9:30-as zárási ablakhoz és a web
// 55 mp-es /pay-keretéhez kötöttek. Eddig egy 600 000 ms-os köz vagy tick, egy
// 120 s-os indítási keret figyelmeztetés nélkül átment: a lekérdezés vagy a
// zárás rendszeresen a bank határidején túlra csúszott, a web pedig feladta a
// még futó /pay-t. A banki hívások 60 s-os plafonja a bérletet is rövidre
// fogja (berletMp a cibFizetes-ben). A tick 60 s fölött a 2 perces
// szívverés-kaput is elbuktatná (a /pay folyamatosan 503 lenne).
const HANGOLOK = Object.freeze([
  ['CIB_HTTP_TIMEOUT_MS', 'httpIdokeretMs', 30000, 1000, 60000],
  ['CIB_ZARAS_TIMEOUT_MS', 'zarasIdokeretMs', 45000, 1000, 60000],
  ['CIB_INDITAS_OSSZKERET_MS', 'inditasOsszkeretMs', 40000, 1000, 50000],
  // A bank szerint az 1–3 perces MSGT33 megfelelő (2026-10-01).
  ['CIB_LEKERDEZES_KOZ_MS', 'lekerdezesKozMs', 60000, 5000, 180000],
  ['CIB_KOR_TICK_MS', 'korTickMs', 30000, 5000, 60000],
  ['CIB_KOR_MAX_KERES', 'korMaxKeres', 10, 1, 100],
  ['CIB_KISERLET_MAX_PERC', 'kiserletMaxPerc', 30, 5, 240],
  ['CIB_HOP_TTL_MP', 'hopTtlMp', 120, 10, 3600],
  ['CIB_MAX_INDITAS_ORANKENT', 'maxInditasOrankent', 6, 1, 100],
  ['CIB_MAX_INDITAS_NAPONTA', 'maxInditasNaponta', 20, 1, 1000],
  // 2026-10-01 (a CIB írásos válasza): „10 perc a lezárási határidő, ami a
  // kapott 10-es üzenet beérkezésétől számítódik." A helyi zárási ablak a
  // MSGT10-től ennyi másodpercig tart — 30 mp tartalék a bank 600 mp-ével
  // szemben (a MSGT32 útja és válasza is beleférjen). A felső korlát 590:
  // a bank határidejét a beállítás sem érheti el.
  ['CIB_ZARAS_HATARIDO_MP', 'zarasHataridoMp', 570, 60, 590],
  // 2026-10-03 (PR-5): a kétes (close_unknown) kísérlet automatikus
  // egyeztetése — egy CSAK-OLVASÓ MSGT33 (MSGT32 soha).
  // ⚠️ 2026-10-04 (a PR-5 1. javítóköre, BLOKKOLÓ): a horgony az UTOLSÓ
  // kimenő MSGT32 (nem a MSGT10), és a „lezárt"-hoz két, legalább 15 perc
  // különbségű 00 kell ugyanazzal az ANUM-mal. A valódi teszt-banknál mérve
  // a le nem zárt jóváhagyás a JÓVÁHAGYÁSHOZ képest ~9–10,5 perc múlva
  // fordul TO-ra (egy ~9 perckor jóváhagyott kísérletre a MSGT10 után 13 perc
  // 06 mp-kor még 00 jött) — a régi 12 perces minimum és a MSGT10-horgony
  // mellett egy el sem jutott zárás 00-jára könyvelhettünk volna (fizetés
  // nélküli kontakt). A jóváhagyás mindig megelőzi a MSGT32-t, így már az
  // utolsó MSGT32 + 20 perc is kb. kétszerese a mért reverzál-időnek.
  // Ezért legalább 20, alapból 25.
  ['CIB_EGYEZTETES_PERC', 'egyeztetesPerc', 25, 20, 120],
]);
// A hangolók együttese a zárási ablakba férjen: a jóváhagyás után egy tick,
// egy köz, egy MSGT33 és egy MSGT32 a határidő előtt (30 mp tartalékkal).
const ABLAK_TARTALEK_MS = 30000;
const ABLAK_HANGOLOK = Object.freeze(['korTickMs', 'lekerdezesKozMs', 'httpIdokeretMs', 'zarasIdokeretMs']);
// [env, kulcs, alapérték, (opcionális) a nem értelmezhető értéknél érvényes érték]
const LOGIKAI = Object.freeze([
  // ⚠️ 2026-10-01: bekapcsolva a fuvar rövid hivatkozása is a bankhoz megy —
  // az adatkezelési tájékoztató 4/A. pontja ezt ma NEM sorolja a továbbított
  // adatok közé; bekapcsolás előtt a tájékoztatót bővíteni kell.
  ['CIB_EXTRA01', 'extra01', false],
  // A GYFK javasolt algoritmusa szerint az elutasított authorizációt is
  // MSGT32-vel kell lezárni — a bank megerősítéséig ez az alapérték.
  ['CIB_SIKERTELEN_LEZARAS', 'sikertelenLezaras', true],
  // 2026-10-03 (PR-5): SZÜNET-KAPCSOLÓ. true → új kártyás fizetés nem indul
  // (a /pay 503 CIB_PAUSED, a még fel nem használt hop-link sem visz a
  // bankhoz), de a lekérdező kör és a zárás a MEGLÉVŐ kísérleteket befejezi.
  // A visszaállás és a teszt→éles átállás receptje: előbb ez, és csak ha az
  // admin „ellenorzes" szűrője és az SQL-ellenőrzés is 0 nem végső kísérletet
  // mutat, jöhet a CIB_* törlése / a kulcs-, host- és környezetváltás.
  // ⚠️ 2026-10-04 (a PR-5 1. javítóköre): FAIL-CLOSED. Egy elgépelt érték
  // („yes", „on") eddig csak figyelmeztetett, és a szünet KI maradt — a
  // visszaállás első lépése mellett tovább indultak új banki zárolások. Most
  // a nem értelmezhető érték SZÜNET, hangos hibával (naplozCibKonfigot).
  ['CIB_UJ_FIZETES_TILTVA', 'ujFizetesTiltva', false, true],
]);
const EGYEB_ENV = Object.freeze([
  'CIB_KEY_UJJLENYOMAT', 'CIB_TESZT_FELHASZNALOK', 'CIB_RIASZTAS_EMAIL', 'CIB_TS_IDOZONA', 'CIB_BEVEZETES',
]);
// A kód által olvasott ÖSSZES CIB-változó (2026-09-29, PR-2/C): a
// .env.example-őr ehhez méri a dokumentációt, a forrás-szkennelés pedig azt,
// hogy a lista ne avulhasson el (új env.CIB_X olvasás = ide is fel kell venni).
const OLVASOTT_ENV = Object.freeze([
  ...KOTELEZO_ENV,
  ...ELAVULT_ENV,
  ...HANGOLOK.map(([nev]) => nev),
  ...LOGIKAI.map(([nev]) => nev),
  ...EGYEB_ENV,
]);

const TESZT_HOST = 'ekit.cib.hu';
// 2026-10-03 (PR-5/B): az ÉLES banki végpont pontos engedélylistája. Eddig
// élesben csak a tiltólista élt (nem ekit.cib.hu, nem loopback) — egy
// elgépelt vagy hasonmás host (eki-cib.hu.example.net), a ponttal végződő
// teszt-host (ekit.cib.hu.) vagy egy porttal megadott cím „teljes" volt, és a
// vásárló kártyaadata egy idegen fizetőoldalra mehetett volna. Az éles hostot
// a bank e-mailben erősíti meg; ha mást ad meg, ez a lista kódmódosítással
// (review-val) bővül — szándékosan nem env-ből, hogy egy elgépelés ne
// nyithasson utat.
const CIB_ELES_HOSTOK = Object.freeze(['eki.cib.hu']);
// A bank TESZT-kulcsának ismert ujjlenyomata (a kulcs SHA-256-jának eleje;
// nem titok — a boot-napló is kiírja). Éles környezetben ezzel a kulccsal a
// fizetés csak az első banki hibánál derülne ki, ezért ott hibás konfig.
const ISMERT_TESZT_UJJLENYOMATOK = Object.freeze(['5540ea8b5541']);
const RETURN_UT = '/payments/cib/vissza';
const HMAC_MIN_BAJT = 32;
// A lekérdező kör csak az ennél újabb kísérletekhez nyúl (a projektszabály:
// új idő-alapú kör = created_at >= a bevezetés dátuma). Env-ből felülírható.
const CIB_BEVEZETES_ALAP = '2026-09-29';
const ALAP_IDOZONA = 'Europe/Budapest';
const ALAP_RIASZTAS_EMAIL = 'info@gofuvar.hu';
const ALAP_WEB_BASE_URL = 'http://localhost:3000';

const TRID_RE = /^[0-9]{16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

class CibProtokollHiba extends Error {
  constructor(message) {
    super(message);
    this.name = 'CibProtokollHiba';
    this.code = 'CIB_PROTOKOLL';
  }
}

const nemUres = (v) => typeof v === 'string' && v.trim() !== '';

function urlElemez(s) {
  try { return new URL(s); } catch { return null; }
}

/**
 * Banki végpont (market / customer) ellenőrzése. A környezet és a host
 * EGYEZZEN: a teszt- és az éles kulcs a banknál AZONOS fájlnévvel jön, egy
 * felcserélés élesben teszt-terhelést vagy folyamatos S01-et okozna.
 */
function bankUrlHibak(ertek, okNev, kornyezet, eles) {
  const u = urlElemez(ertek);
  if (!u || !['http:', 'https:'].includes(u.protocol) || u.search || u.hash
    || u.username || u.password || !u.pathname || u.pathname === '/') {
    return [okNev];
  }
  if (kornyezet === 'eles') {
    // Pontos egyezés (a WHATWG URL a záró pontot megtartja, a portot külön
    // adja — egyik sem fér át): engedélylista, nem tiltólista.
    if (u.protocol !== 'https:' || u.port || !CIB_ELES_HOSTOK.includes(u.hostname)) {
      return ['kornyezet_host_elteres'];
    }
  } else if (kornyezet === 'teszt') {
    const bankiTeszt = u.protocol === 'https:' && u.hostname === TESZT_HOST;
    // A hamis bank (tesztek, helyi fejlesztés) csak NEM éles futásban.
    const helyi = !eles && LOOPBACK.has(u.hostname);
    if (!bankiTeszt && !helyi) return ['kornyezet_host_elteres'];
  }
  return [];
}

/**
 * A bank URL-mezője (T 12. o.): `https?://.+\..+/` minta, paraméter nélkül,
 * abszolút útvonal; a titkosító nyomtatható ASCII-t enged, '&' és '=' nélkül.
 * Az útvonal kötelezően a mi visszatérési végpontunk — ebből képződik a
 * hop-link originje is.
 */
function returnUrlHibas(ertek, kornyezet, eles) {
  if (!nemUres(ertek)) return true;
  const s = ertek.trim();
  if (s.length > 255 || !/^[\x21-\x7e]+$/.test(s) || /[?#&=]/.test(s)) return true;
  if (!/^https?:\/\/.+\..+\//.test(s)) return true;
  const u = urlElemez(s);
  if (!u || u.username || u.password || !u.hostname.includes('.')) return true;
  if (u.pathname !== RETURN_UT) return true;
  if ((eles || kornyezet === 'eles') && u.protocol !== 'https:') return true;
  return false;
}

/** A mai nap UTC-ben (ÉÉÉÉ-HH-NN) — a CIB_BEVEZETES összevetéséhez. */
function maiUtcNap() {
  return new Date().toISOString().slice(0, 10);
}

/** A bank teszt-kulcsának ismert ujjlenyomata-e (az első 12 hexa jegy)? */
function ismertTesztKulcs(ujjlenyomat) {
  if (typeof ujjlenyomat !== 'string' || ujjlenyomat.length < 12) return false;
  return ISMERT_TESZT_UJJLENYOMATOK.includes(ujjlenyomat.trim().toLowerCase().slice(0, 12));
}

/**
 * Éles környezetben a visszatérési URL az API hostján él (2026-10-03, PR-5/B):
 * a web domainjének aldomainje (api.gofuvar.hu ↔ www.gofuvar.hu), de SOHA nem
 * maga a web host vagy annak apexe. A web hostján a hop-link és a visszatérés
 * a webre menne (minden fizetés 404), egy idegen hoston a bank válasza és a
 * vásárló böngészője harmadik félhez kerülne. Port nélkül (443).
 */
function returnHostHibas(returnUrl, webBase) {
  const r = urlElemez(returnUrl);
  const w = urlElemez(webBase);
  if (!r || !w) return true;
  const apex = w.hostname.replace(/^www\./, '');
  // Az apex web-host mellett (WEB_BASE_URL = https://gofuvar.hu) a www-host
  // is a web — nem lehet a visszatérés helye.
  return r.port !== '' || r.hostname === w.hostname || r.hostname === apex || r.hostname === `www.${apex}`
    || !r.hostname.endsWith(`.${apex}`);
}

function webBaseUrl(env, eles, okok) {
  if (!nemUres(env.WEB_BASE_URL)) {
    if (eles) okok.push('web_base_url_ervenytelen');
    return ALAP_WEB_BASE_URL;
  }
  const u = urlElemez(env.WEB_BASE_URL.trim());
  if (!u || !['http:', 'https:'].includes(u.protocol) || u.search || u.hash
    || (u.pathname && u.pathname !== '/') || (eles && u.protocol !== 'https:')) {
    okok.push('web_base_url_ervenytelen');
    return ALAP_WEB_BASE_URL;
  }
  return u.origin;
}

function idozonaErvenyes(tz) {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

function hangolok(env, figyelmeztetesek) {
  const ki = {};
  for (const [nev, kulcs, alap, min, max] of HANGOLOK) {
    const nyers = env[nev];
    if (!nemUres(nyers)) { ki[kulcs] = alap; continue; }
    const n = Number(nyers.trim());
    if (!Number.isInteger(n) || n < min || n > max) {
      figyelmeztetesek.push(`${nev} érvénytelen (egész szám ${min}–${max} kell) — az alapérték (${alap}) marad.`);
      ki[kulcs] = alap;
    } else {
      ki[kulcs] = n;
    }
  }
  ablakEllenorzes(ki, figyelmeztetesek);
  return ki;
}

const ablakOsszeg = (h) => ABLAK_HANGOLOK.reduce((o, k) => o + h[k], 0);
const ablakMs = (h) => h.zarasHataridoMp * 1000 - ABLAK_TARTALEK_MS;

/**
 * 2026-10-03 (PR-5): a tick + köz + MSGT33 + MSGT32 keret a zárási ablakba
 * férjen. Ha nem fér, a négy hangoló az alapértékre áll (egy elgépelés ne
 * tegye „hibás"-sá — 503-assá — az egész fizetést, de a jóváhagyott
 * tételek se csússzanak rendszeresen a bank határidején túlra); ha az
 * alapértékekkel sem fér (túl rövid CIB_ZARAS_HATARIDO_MP), az ablak is.
 */
function ablakEllenorzes(h, figyelmeztetesek) {
  if (ablakOsszeg(h) <= ablakMs(h)) return;
  const elotte = ablakOsszeg(h);
  for (const [, kulcs, alap] of HANGOLOK) {
    if (ABLAK_HANGOLOK.includes(kulcs)) h[kulcs] = alap;
  }
  let uzenet = `A CIB-hangolók együtt (${Math.round(elotte / 1000)} mp) nem férnek a ${h.zarasHataridoMp} mp-es `
    + 'zárási ablakba — a CIB_KOR_TICK_MS, CIB_LEKERDEZES_KOZ_MS, CIB_HTTP_TIMEOUT_MS és CIB_ZARAS_TIMEOUT_MS az alapértékre áll.';
  if (ablakOsszeg(h) > ablakMs(h)) {
    const alap = HANGOLOK.find((x) => x[1] === 'zarasHataridoMp')[2];
    uzenet += ` A ${h.zarasHataridoMp} mp-es ablak az alapértékekkel sem elég — a CIB_ZARAS_HATARIDO_MP is (${alap}).`;
    h.zarasHataridoMp = alap;
  }
  figyelmeztetesek.push(uzenet);
}

function logikai(env, nev, alap, figyelmeztetesek, { hibasErtek = alap, kritikus = null } = {}) {
  const nyers = env[nev];
  if (!nemUres(nyers)) return alap;
  const v = nyers.trim().toLowerCase();
  if (['true', '1', 'igen'].includes(v)) return true;
  if (['false', '0', 'nem'].includes(v)) return false;
  if (hibasErtek !== alap && kritikus) {
    // Az érték maga nem kerül a naplóba (bármi lehet), csak a döntés.
    kritikus.push(`${nev} érvénytelen (true/false kell) — FAIL-CLOSED: ${hibasErtek} érvényes. Javítsd a Railway env-et.`);
    return hibasErtek;
  }
  figyelmeztetesek.push(`${nev} érvénytelen (true/false kell) — az alapérték (${alap}) marad.`);
  return alap;
}

/**
 * A teszt-allowlist feloldása. ⚠️ 2026-10-03 (PR-5/B): FAIL-CLOSED. Eddig az
 * üres vagy csupa érvénytelen lista (e-mail a UUID helyett, idézőjel, törölt
 * változó) „mindenki"-t jelentett: éles futásban MINDEN felhasználó a bank
 * teszt-környezetébe került, ahol a nyilvános tesztkártya sikeres MSGT32-t
 * ad — fizetett állapot és kontakt valódi pénz nélkül, amint az
 * ALLOW_STUB_PAYMENTS már nincs, de a környezet még teszt. Most:
 *   - beállított, de egyetlen érvényes UUID-t sem adó lista → senki;
 *   - éles futásban (NODE_ENV=production) az üres / hiányzó lista is → senki;
 *   - nem éles futásban (helyi fejlesztés, hamis bank) a hiányzó lista
 *     marad „mindenki" (a tesztek és a helyi próba így futnak).
 * A „senki" a konfigot NEM teszi hibássá: a kör él, a már elindult
 * kísérleteket lezárja; az új fizetés a stub-úton megy (élesben
 * ALLOW_STUB_PAYMENTS nélkül a kézi nyugtázás is zárva).
 * @returns {{lista:string[], zart:boolean}}
 */
function tesztFelhasznalok(env, kornyezet, eles, figyelmeztetesek) {
  const beallitva = nemUres(env.CIB_TESZT_FELHASZNALOK);
  if (kornyezet !== 'teszt') {
    if (beallitva) {
      // Élesben SOHA nem oszthat két útra: egy bent felejtett allowlist mellett
      // a listán kívüliek stubot kapnának — azaz fizetés nélkül nyugtázhatnának.
      figyelmeztetesek.push('CIB_TESZT_FELHASZNALOK be van állítva, de a környezet nem „teszt" — '
        + 'FIGYELMEN KÍVÜL marad (élesben mindenki a valódi CIB-utat kapja). Töröld az env-ből.');
    }
    return { lista: [], zart: false };
  }
  const lista = [];
  let rossz = 0;
  if (beallitva) {
    for (const resz of env.CIB_TESZT_FELHASZNALOK.split(',')) {
      const id = resz.trim().toLowerCase();
      if (!id) continue;
      if (UUID_RE.test(id)) { if (!lista.includes(id)) lista.push(id); } else rossz += 1;
    }
  }
  if (rossz) {
    figyelmeztetesek.push(`CIB_TESZT_FELHASZNALOK: ${rossz} érvénytelen (nem UUID) bejegyzés kihagyva.`);
  }
  const zart = lista.length === 0 && (beallitva || eles);
  return { lista, zart };
}

/** Az összes CIB-hez tartozó env egy (hash-elt) lenyomata — a gyorsítótár kulcsa. */
function envLenyomat(env) {
  const nevek = [...KOTELEZO_ENV, ...ELAVULT_ENV, ...EGYEB_ENV, ...HANGOLOK.map((h) => h[0]),
    ...LOGIKAI.map((l) => l[0]), 'NODE_ENV', 'WEB_BASE_URL'];
  const h = crypto.createHash('sha256');
  for (const n of nevek) h.update(`${n}\u0000${env[n] == null ? '\u0001' : String(env[n])}\u0000`);
  // A CIB_BEVEZETES a mai naphoz mért (2026-10-03, PR-5/B): a gyorsítótár
  // naponta újraold, így egy ma még jövőbeli dátum a napján magától érvényes.
  h.update(`nap\u0000${maiUtcNap()}`);
  return h.digest('hex');
}

const gyorsitotar = new Map();

function feloldas(env) {
  const okok = [];
  const figyelmeztetesek = [];
  const eles = env.NODE_ENV === 'production';

  const elavult = ELAVULT_ENV.filter((n) => nemUres(env[n]));
  if (elavult.length) {
    figyelmeztetesek.push(`Kivezetett vPOS-változó(k) beállítva: ${elavult.join(', ')} — a kód már nem `
      + 'olvassa őket, töröld az env-ből (a CIB-mód a CIB_PID/CIB_KEY_B64/… változókkal megy).');
  }

  const vanKotelezo = KOTELEZO_ENV.some((n) => nemUres(env[n]));
  if (!vanKotelezo) {
    const egyeb = [...EGYEB_ENV, ...HANGOLOK.map((h) => h[0])].filter((n) => nemUres(env[n]));
    if (egyeb.length) {
      figyelmeztetesek.push(`CIB-hangoló(k) beállítva (${egyeb.join(', ')}), de a CIB-konfiguráció hiányzik — hatástalan.`);
    }
    // ⚠️ A régi vPOS-pár (kulcs + kereskedő) mellett ma a stub ZÁRVA van
    // (isStub=false). Ha ezt „nincs"-nek látnánk, egy elfelejtett régi env a
    // kézi fizetés-nyugtázást NYITNÁ ki — ezért ez fail-closed „hibás".
    if (nemUres(env.CIB_API_KEY) && nemUres(env.CIB_MERCHANT_ID)) {
      okok.push('elavult_vpos_kulcsok');
      return { allapot: 'hibas', okok, figyelmeztetesek };
    }
    return { allapot: 'nincs', okok, figyelmeztetesek };
  }

  for (const n of KOTELEZO_ENV) if (!nemUres(env[n])) okok.push(`hianyzo:${n}`);

  const kornyezetNyers = nemUres(env.CIB_KORNYEZET) ? env.CIB_KORNYEZET.trim().toLowerCase() : '';
  const kornyezet = ['teszt', 'eles'].includes(kornyezetNyers) ? kornyezetNyers : null;
  if (kornyezetNyers && !kornyezet) okok.push('kornyezet_ervenytelen');

  let marketUrl = null;
  let customerUrl = null;
  if (nemUres(env.CIB_MARKET_URL)) {
    marketUrl = env.CIB_MARKET_URL.trim();
    okok.push(...bankUrlHibak(marketUrl, 'market_url_ervenytelen', kornyezet, eles));
  }
  if (nemUres(env.CIB_CUSTOMER_URL)) {
    customerUrl = env.CIB_CUSTOMER_URL.trim();
    okok.push(...bankUrlHibak(customerUrl, 'customer_url_ervenytelen', kornyezet, eles));
  }

  let returnUrl = null;
  let apiOrigin = null;
  if (nemUres(env.CIB_RETURN_URL)) {
    returnUrl = env.CIB_RETURN_URL.trim();
    if (returnUrlHibas(returnUrl, kornyezet, eles)) okok.push('return_url_ervenytelen');
    else apiOrigin = new URL(returnUrl).origin;
  }

  const hmacTitok = nemUres(env.CIB_HMAC_TITOK) ? env.CIB_HMAC_TITOK : null;
  if (hmacTitok && Buffer.byteLength(hmacTitok, 'utf8') < HMAC_MIN_BAJT) okok.push('hmac_titok_rovid');

  let kulcs = null;
  let ujjlenyomat = null;
  if (nemUres(env.CIB_PID) && nemUres(env.CIB_KEY_B64)) {
    const b64 = env.CIB_KEY_B64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      okok.push('kulcs_hibas');
    } else {
      try {
        kulcs = eki.loadKeyFromEnv({ CIB_PID: env.CIB_PID, CIB_KEY_B64: b64 });
        // A kulcs SHA-256-ja: az első 12 hexa jegy naplózható (a teszt- és
        // az éles kulcs így megkülönböztethető), a kulcs maga SOHA.
        const teljes = crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
        ujjlenyomat = teljes.slice(0, 12);
        if (nemUres(env.CIB_KEY_UJJLENYOMAT)) {
          const vart = env.CIB_KEY_UJJLENYOMAT.trim().toLowerCase();
          if (!/^[0-9a-f]{12,64}$/.test(vart)) okok.push('kulcs_ujjlenyomat_ervenytelen');
          else if (!teljes.startsWith(vart)) okok.push('kulcs_ujjlenyomat_elteres');
          if (kornyezet === 'eles' && ismertTesztKulcs(vart)) okok.push('teszt_kulcs_elesben');
        }
        if (kornyezet === 'eles' && ismertTesztKulcs(ujjlenyomat) && !okok.includes('teszt_kulcs_elesben')) {
          okok.push('teszt_kulcs_elesben');
        }
      } catch {
        // Az ok kódja elég — a kulcsfájl hibaüzenete sem kerül a naplóba.
        kulcs = null;
        okok.push('kulcs_hibas');
      }
    }
  }
  // A PID 4. karaktere a terminál devizája (T 9–10. o.: 0 = HUF). Minden
  // üzenetünk CUR=HUF-ot visz, így egy nem forintos (pl. EUR) terminál
  // kulcsával a fizetés csak az első banki hibánál derülne ki — inkább hibás
  // konfig és 503 (2026-09-29, 1. javítókör).
  if (kulcs && String(kulcs.pid).charAt(3) !== '0') okok.push('pid_nem_huf');

  // A 3DES-EDE-CBC egy jövőbeli Node/OpenSSL-frissítéssel legacy providerbe
  // kerülhet — akkor inkább 503, mint egy rejtélyes első banki hiba.
  if (!eki.selfTest()) okok.push('selftest_hiba');

  const tsIdozona = nemUres(env.CIB_TS_IDOZONA) ? env.CIB_TS_IDOZONA.trim() : ALAP_IDOZONA;
  if (!idozonaErvenyes(tsIdozona)) okok.push('idozona_ervenytelen');

  let bevezetes = CIB_BEVEZETES_ALAP;
  if (nemUres(env.CIB_BEVEZETES)) {
    const d = env.CIB_BEVEZETES.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) bevezetes = d;
    else figyelmeztetesek.push(`CIB_BEVEZETES érvénytelen (ÉÉÉÉ-HH-NN kell) — az alapérték (${CIB_BEVEZETES_ALAP}) marad.`);
  }
  // ⚠️ 2026-10-03 (PR-5/B): a lekérdező kör csak a `created_at >= bevezetes`
  // sorokhoz nyúl, a szívverést viszont a 0 soros kör is frissíti — egy
  // jövőbeli (elgépelt) dátum mellett a /pay tovább engedélyeztetett pénzt,
  // amit SEMMI nem zárt le (néma kikapcsolás). A DB a dátumot UTC-éjfélként
  // veti össze (Neon: GMT), ezért a mai UTC-naphoz mérünk. Hibás konfig:
  // 503 és hangos boot-hiba, nem csendes leállás.
  if (bevezetes > maiUtcNap()) okok.push('bevezetes_jovobeli');

  const web = webBaseUrl(env, eles, okok);
  if (kornyezet === 'eles' && returnUrl && apiOrigin && returnHostHibas(returnUrl, web)) {
    okok.push('return_url_nem_api_host');
  }
  const allowlist = tesztFelhasznalok(env, kornyezet, eles, figyelmeztetesek);
  const beall = {
    allapot: okok.length ? 'hibas' : 'teljes',
    okok,
    figyelmeztetesek,
    kornyezet,
    pid: kulcs ? kulcs.pid : null,
    ujjlenyomat,
    marketUrl,
    customerUrl,
    returnUrl,
    apiOrigin,
    webBaseUrl: web,
    tesztFelhasznalok: allowlist.lista,
    tesztAllowlistZart: allowlist.zart,
    hangolok: hangolok(env, figyelmeztetesek),
    tsIdozona,
    bevezetes,
    riasztasEmail: nemUres(env.CIB_RIASZTAS_EMAIL) ? env.CIB_RIASZTAS_EMAIL.trim() : ALAP_RIASZTAS_EMAIL,
  };
  const kritikus = [];
  for (const [nev, k, alap, hibasErtek] of LOGIKAI) {
    beall[k] = logikai(env, nev, alap, figyelmeztetesek, { hibasErtek: hibasErtek ?? alap, kritikus });
  }
  // A fail-closed döntések (2026-10-04) a konfigot nem teszik hibássá (a kör
  // él, a meglévő kísérleteket lezárja), de induláskor hibaszintű jelzést kapnak.
  beall.kritikusFigyelmeztetesek = kritikus;
  // A kulcs és a HMAC-titok NEM felsorolható: egy `console.log(beall)`, egy
  // JSON-naplósor vagy egy Sentry-kontextus így sem viszi ki őket.
  Object.defineProperty(beall, 'kulcs', { value: beall.allapot === 'teljes' ? kulcs : null, enumerable: false });
  Object.defineProperty(beall, 'hmacTitok', { value: beall.allapot === 'teljes' ? hmacTitok : null, enumerable: false });
  return beall;
}

/**
 * A CIB-konfiguráció teljes feloldása (gyorsítótárazva az env-lenyomatra —
 * a /pay és a nyugtázás gyakran kérdezi, a kulcs-parse és az önteszt ne
 * fusson minden kérésnél).
 * @param {NodeJS.ProcessEnv|Record<string,string>} env
 */
function cibBeallitasok(env = process.env) {
  const kulcs = envLenyomat(env);
  const meglevo = gyorsitotar.get(kulcs);
  if (meglevo) return meglevo;
  const b = Object.freeze(feloldas(env));
  if (gyorsitotar.size > 20) gyorsitotar.clear();
  gyorsitotar.set(kulcs, b);
  return b;
}

/** @returns {'nincs'|'teljes'|'hibas'} */
function cibKonfig(env = process.env) {
  return cibBeallitasok(env).allapot;
}

/**
 * Induláskori napló (index.js). CSAK az ujjlenyomatot, a környezetet és az
 * okok KÓDJAIT írja — kulcsot, HMAC-titkot, env-értéket soha.
 */
function naplozCibKonfigot({ env = process.env, konzol = console, sentry = null } = {}) {
  const b = cibBeallitasok(env);
  for (const f of b.figyelmeztetesek) {
    konzol.warn(`[CIB] ⚠️ ${f}`);
    try { if (sentry) sentry.captureMessage(`[CIB] ${f}`, 'warning'); } catch { /* no-op */ }
  }
  // 'nincs': ma ez a normál üzem — a „provider: cib (stub/teszt mód)" sor
  // már elmondja; külön sor és riasztás nem kell.
  if (b.allapot === 'nincs') return b;
  for (const f of b.kritikusFigyelmeztetesek || []) {
    const uzenet = `[CIB] 🚨 ${f}`;
    konzol.error(uzenet);
    try { if (sentry) sentry.captureMessage(uzenet, 'error'); } catch { /* no-op */ }
  }
  if (b.allapot === 'hibas') {
    const uzenet = `[CIB] 🚨 HIBÁS CIB EKI-KONFIGURÁCIÓ (${b.okok.join(', ')}) — a kártyás fizetés 503-at ad, `
      + 'a stub-fizetés NEM nyílik vissza, a kézi nyugtázás zárva. Javítsd a Railway env-et.';
    konzol.error(uzenet);
    try { if (sentry) sentry.captureMessage(uzenet, 'error'); } catch { /* no-op */ }
    return b;
  }
  const bankHost = (() => { try { return new URL(b.marketUrl).host; } catch { return '?'; } })();
  konzol.log(`[CIB] EKI-konfiguráció teljes — környezet: ${b.kornyezet}, PID: ${b.pid}, `
    + `kulcs-ujjlenyomat: ${b.ujjlenyomat}, bank: ${bankHost}, visszatérés: ${b.apiOrigin}`
    + `${b.tesztFelhasznalok.length ? `, teszt-allowlist: ${b.tesztFelhasznalok.length} fiók` : ''}`);
  if (b.tesztAllowlistZart) {
    // 2026-10-03 (PR-5/B): a fail-closed allowlist hangos — enélkül a teszt-
    // fiókok is némán a stub-utat kapnák, és senki nem tudná, miért.
    const uzenet = '[CIB] 🚨 CIB_TESZT_FELHASZNALOK üres vagy egyetlen érvényes user-id-t (UUID) sem tartalmaz — '
      + 'teszt-környezetben ilyenkor SENKI nem kapja a kártyás utat (mindenki a stub-fizetést látja). '
      + 'Add meg a teszt-fiókok user-id-jét (nem e-mail-címét) vesszővel elválasztva.';
    konzol.error(uzenet);
    try { if (sentry) sentry.captureMessage(uzenet, 'error'); } catch { /* no-op */ }
  }
  if (b.ujFizetesTiltva) {
    // 2026-10-03 (PR-5): a szünet szándékos üzemállapot, de ne felejtődjön bent.
    konzol.warn('[CIB] ⏸️ SZÜNET (CIB_UJ_FIZETES_TILTVA=true): új kártyás fizetés nem indul (503 CIB_PAUSED); '
      + 'a meglévő kísérleteket a kör befejezi. Ha a szünet véget ért, töröld a változót.');
  }
  leuritesEllenorzes(env, b, konzol, sentry);
  return b;
}

/**
 * Railway-leürítés (2026-09-29, 1. javítókör): a szabályos leállás a futó
 * zárást (MSGT32 + rögzítés + könyvelés) legfeljebb a zárási keret + 10 s-ig
 * várja — de csak akkor ér valamit, ha a Railway a SIGTERM és a SIGKILL között
 * legalább ennyit hagy (RAILWAY_DEPLOYMENT_DRAINING_SECONDS; alapból 0 → minden
 * deploy egy épp futó zárást close_unknown-ba tehet). Kódból a platform
 * beállítását kikényszeríteni nem lehet, ezért teljes CIB-konfignál minden
 * induláskor hangosan szólunk, ha a Railway-en hiányzik vagy kevés.
 */
function leuritesEllenorzes(env, b, konzol, sentry) {
  const railwayn = [env.RAILWAY_ENVIRONMENT, env.RAILWAY_ENVIRONMENT_NAME, env.RAILWAY_PROJECT_ID].some(nemUres);
  if (!railwayn) return;
  const kell = Math.ceil(((b.hangolok && b.hangolok.zarasIdokeretMs) || 45000) / 1000) + 10;
  const nyers = env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS;
  const van = nemUres(nyers) ? Number(nyers.trim()) : 0;
  if (Number.isFinite(van) && van >= kell) return;
  const uzenet = `[CIB] 🚨 RAILWAY_DEPLOYMENT_DRAINING_SECONDS=${nemUres(nyers) ? nyers.trim() : '(nincs)'} — `
    + `legalább ${kell} mp kell (javasolt: 60), különben egy deploy a futó kártyás zárást megszakítja, `
    + 'és a tétel kézi egyeztetésre (close_unknown) kerül. Állítsd be a Railway service-változók között.';
  konzol.error(uzenet);
  try { if (sentry) sentry.captureMessage(uzenet, 'warning'); } catch { /* no-op */ }
}

// ─────────────────────────────────────────────────────────────────────────
//  Kötött mezőértékek
// ─────────────────────────────────────────────────────────────────────────

/**
 * Új TRID: pontosan 16 számjegy, kriptográfiai véletlen (a bank „explicit
 * újravetésű" álvéletlent kér — a crypto.randomInt ennél erősebb). Két
 * 8 jegyű fél, nullával kitöltve: a vezető nulla is érvényes TRID.
 * Az egyediséget a payment_sessions PK garantálja; újrahasznosítás soha.
 */
function ujTrid() {
  const a = crypto.randomInt(0, 100000000);
  const b = crypto.randomInt(0, 100000000);
  return `${String(a).padStart(8, '0')}${String(b).padStart(8, '0')}`;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bitek = 0;
  let ertek = 0;
  let ki = '';
  for (const bajt of buf) {
    ertek = ((ertek << 8) | bajt) & 0xffff;
    bitek += 8;
    while (bitek >= 5) {
      ki += B32[(ertek >>> (bitek - 5)) & 31];
      bitek -= 5;
    }
  }
  if (bitek > 0) ki += B32[(ertek << (5 - bitek)) & 31];
  return ki;
}

/**
 * A banknak küldött vásárló-azonosító (UID, ≤11 alfanumerikus): HMAC-álnév
 * a feladó azonosítójából. Determinisztikus (ugyanaz a feladó ugyanazt
 * kapja), de nem e-mail, nem user-id és a titok nélkül nem visszafejthető —
 * a banknak személyes adatot nem adunk át. Nem tároljuk.
 */
function uidAlnev(shipperId, titok) {
  if (!nemUres(titok)) throw new CibProtokollHiba('Hiányzó HMAC-titok a UID-hez.');
  const mac = crypto.createHmac('sha256', titok).update(`uid:${shipperId}`).digest();
  return `G${base32(mac).slice(0, 10)}`;
}

/**
 * A TS (ÉÉÉÉHHNNÓÓPPMM) a DB órájából, a megadott időzónában — a hívó
 * INSERT-tranzakciójának kliensével, hogy a kísérlet és a TS egy időpontra
 * essen. A szerver órája és a konténer időzónája így nem számít.
 */
async function lekerTs(client, idozona = ALAP_IDOZONA) {
  const { rows } = await client.query(
    "SELECT to_char(NOW() AT TIME ZONE $1, 'YYYYMMDDHH24MISS') AS ts", [idozona],
  );
  const ts = rows[0] && rows[0].ts;
  if (!/^[0-9]{14}$/.test(ts || '')) throw new CibProtokollHiba('Érvénytelen TS a DB-ből.');
  return ts;
}

/** A naplóba csak a TRID vége (a 16 jegyű szám kártyaszámnak látszhat). */
function maszkoltTrid(trid) {
  return `…${String(trid || '').slice(-4)}`;
}

function ellenorizAlap({ pid, trid }) {
  if (!nemUres(pid)) throw new CibProtokollHiba('Hiányzó PID.');
  if (!TRID_RE.test(trid || '')) throw new CibProtokollHiba('Érvénytelen TRID.');
}
function ellenorizAmo(amo) {
  if (!Number.isInteger(amo) || amo <= 0 || amo > 99999999999) {
    throw new CibProtokollHiba('Érvénytelen összeg (pozitív egész forint kell).');
  }
  return String(amo);
}

/**
 * MSGT10 (inicializálás, szerver–szerver). CSAK az előírt mezők: a
 * CNAME/CADDR/CEMAIL-féle opcionális vásárlói adatokat SOHA nem küldjük.
 */
function msgt10Mezok({
  pid, trid, uid, amo, ts, url, extra01JobId,
}) {
  ellenorizAlap({ pid, trid });
  if (!/^[A-Za-z0-9]{1,11}$/.test(uid || '')) throw new CibProtokollHiba('Érvénytelen UID.');
  if (!/^[0-9]{14}$/.test(ts || '')) throw new CibProtokollHiba('Érvénytelen TS.');
  if (!nemUres(url)) throw new CibProtokollHiba('Hiányzó visszatérési URL.');
  const mezok = [
    ['PID', pid], ['TRID', trid], ['MSGT', '10'], ['UID', uid], ['AMO', ellenorizAmo(amo)],
    ['CUR', 'HUF'], ['TS', ts], ['AUTH', '0'], ['LANG', 'HU'], ['URL', url],
  ];
  if (extra01JobId !== undefined && extra01JobId !== null) {
    const rovid = String(extra01JobId).replace(/[^0-9A-Za-z]/g, '').slice(0, 8);
    if (rovid) mezok.push(['EXTRA01', `GF${rovid}`]);
  }
  return mezok;
}

/** MSGT20: a vásárló átirányítása a bank fizetőoldalára. */
function msgt20Mezok({ pid, trid }) {
  ellenorizAlap({ pid, trid });
  return [['PID', pid], ['TRID', trid], ['MSGT', '20']];
}

/** MSGT32: lekérdezés MEGERŐSÍTÉSSEL ÉS LEZÁRÁSSAL (a terhelés itt dől el). */
function msgt32Mezok({ pid, trid, amo }) {
  ellenorizAlap({ pid, trid });
  return [['PID', pid], ['TRID', trid], ['MSGT', '32'], ['AMO', ellenorizAmo(amo)]];
}

/** MSGT33: csak lekérdezés, nem zár (az RC=00 itt csak tájékoztató). */
function msgt33Mezok({ pid, trid, amo }) {
  ellenorizAlap({ pid, trid });
  return [['PID', pid], ['TRID', trid], ['MSGT', '33'], ['AMO', ellenorizAmo(amo)]];
}

/** A bank fizetőoldalának teljes URL-je a titkosított MSGT20-szal. */
function customerUrl(beallitasok, trid) {
  if (!beallitasok || !beallitasok.kulcs || !nemUres(beallitasok.customerUrl)) {
    throw new CibProtokollHiba('A CIB-konfiguráció nem teljes.');
  }
  return `${beallitasok.customerUrl}?${eki.ekiEncrypt(msgt20Mezok({ pid: beallitasok.pid, trid }), beallitasok.kulcs)}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Válasz-ellenőrzés a TÁROLT kísérlethez (a CRC nem MAC!)
// ─────────────────────────────────────────────────────────────────────────

const elteres = (mezo) => ({ ok: false, hiba: 'mezo_elteres', mezo });
const vagott = (v) => (typeof v === 'string' ? v.trim() : '');

function rcOlvas(mezok) {
  const rc = vagott(mezok.RC).toUpperCase();
  return /^[A-Z0-9]{2}$/.test(rc) ? rc : null;
}

function amoEgyezik(nyers, vart) {
  if (typeof nyers !== 'string' || !/^[0-9 .]{1,11}$/.test(nyers)) return false;
  const n = Number(nyers.trim());
  return Number.isFinite(n) && n === Number(vart);
}

/**
 * MSGT11 (a MSGT10 válasza): MSGT, PID, TRID és formailag érvényes RC.
 * Ha a bank AMO-t/CUR-t is ad, annak is egyeznie kell.
 * @param {Record<string,string>} mezok — az ekiDecrypt kimenete
 * @param {{payment_id:string, amount_huf:number, currency?:string}} session
 */
function ellenorizMsgt11(mezok, session, pid) {
  if (!mezok || typeof mezok !== 'object' || mezok.MSGT !== '11') return elteres('MSGT');
  if (mezok.PID !== pid) return elteres('PID');
  if (vagott(mezok.TRID) !== session.payment_id) return elteres('TRID');
  if (mezok.AMO !== undefined && !amoEgyezik(mezok.AMO, session.amount_huf)) return elteres('AMO');
  if (mezok.CUR !== undefined && vagott(mezok.CUR).toUpperCase() !== (session.currency || 'HUF')) return elteres('CUR');
  const rc = rcOlvas(mezok);
  if (!rc) return elteres('RC');
  return { ok: true, rc };
}

/**
 * MSGT31 (a MSGT32/33 válasza). A visszaadott adatok a kötelező banki
 * adatsor (TrID/RC/RT/AMO/ANUM) — a CNUM (maszkolt kártyaszám) SOHA nem
 * kerül bele, és innen sehova tovább.
 */
function ellenorizMsgt31(mezok, session, pid) {
  if (!mezok || typeof mezok !== 'object' || mezok.MSGT !== '31') return elteres('MSGT');
  if (mezok.PID !== pid) return elteres('PID');
  if (vagott(mezok.TRID) !== session.payment_id) return elteres('TRID');
  const rc = rcOlvas(mezok);
  if (!rc) return elteres('RC');
  // Az összeg a SIKERES (RC=00) válaszban kötelező és egyező — terhelést csak
  // arra az összegre fogadunk el, amit mi indítottunk. Nem-sikeres válasznál
  // (PR, TO, elutasítás) csak akkor ellenőrizzük, ha a bank elküldi: ha a
  // valódi bank ezekben nem ad AMO-t, a „mezőeltérés" három kör után
  // close_unknown-ba vinné a folyamatban lévő fizetést (2026-09-29, a PR-2
  // utóellenőrzése; a teszt-banknál mérendő).
  if ((rc === '00' || mezok.AMO !== undefined) && !amoEgyezik(mezok.AMO, session.amount_huf)) return elteres('AMO');
  const cur = mezok.CUR !== undefined ? vagott(mezok.CUR).toUpperCase() : (session.currency || 'HUF');
  if (cur !== (session.currency || 'HUF')) return elteres('CUR');
  const rt = typeof mezok.RT === 'string'
    ? mezok.RT.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 255) : null;
  const anumNyers = vagott(mezok.ANUM);
  const anum = /^[A-Za-z0-9]{1,6}$/.test(anumNyers) ? anumNyers : null;
  return {
    ok: true,
    adatok: {
      trid: session.payment_id, rc, rt, anum, amo: Number(session.amount_huf), cur,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Kimenet-osztályozás (a cibKliens.marketHivas eredményéből)
//
//  A kliens-eredmény: { kuldve, http, mezok, bankRc, hibaOsztaly }. A TÖRZS
//  a döntő: a titkosítatlan RC=Sxx/Dxx HTTP 200-zal is jöhet (mérve,
//  2026-09-29), a státuszkód csak kiegészítő adat.
// ─────────────────────────────────────────────────────────────────────────

/** @returns {'bank_S'|'bank_D'|null} */
function bankKodOsztaly(rc) {
  if (typeof rc !== 'string') return null;
  if (/^S\d{2}$/.test(rc)) return 'bank_S';
  if (/^D\d{2}$/.test(rc)) return 'bank_D';
  return null;
}

const SZALLITASI = ['nem_kuldott', 'idokeret', 'halozat'];

/** MSGT10 → MSGT11 (az állapotgép 2–3. lépése). */
function inditasKimenet(valasz, session, pid) {
  if (valasz.bankRc) {
    return {
      kimenet: 'sikertelen',
      ok: 'init_bank_S',
      bankRc: valasz.bankRc,
      // D04: túl sok kérés / nem engedélyezett → „a bank most foglalt" (503).
      foglalt: valasz.bankRc === 'D04',
      // Sxx: kulcs- vagy környezethiba gyanú → a megszakító számolja.
      megszakito: bankKodOsztaly(valasz.bankRc) === 'bank_S',
    };
  }
  if (!valasz.mezok) {
    if (valasz.hibaOsztaly === 'visszafejtes') {
      return { kimenet: 'sikertelen', ok: 'init_valasz_hibas', megszakito: true };
    }
    return { kimenet: 'sikertelen', ok: 'init_idokeret', hiba: valasz.hibaOsztaly, megszakito: true };
  }
  const e = ellenorizMsgt11(valasz.mezok, session, pid);
  if (!e.ok) return { kimenet: 'sikertelen', ok: 'init_valasz_hibas', mezo: e.mezo, megszakito: true };
  if (e.rc === '00') return { kimenet: 'kesz', rc: e.rc };
  if (e.rc === '02') return { kimenet: 'trid_foglalt', ok: 'trid_foglalt', rc: e.rc };
  return { kimenet: 'sikertelen', ok: 'init_rc01', rc: e.rc };
}

/** MSGT33 → MSGT31 (az állapotgép 7–9b. lépése). */
function lekerdezesKimenet(valasz, session, pid) {
  if (valasz.bankRc) {
    const o = bankKodOsztaly(valasz.bankRc);
    if (o === 'bank_S') return { kimenet: 'bank_s', bankRc: valasz.bankRc, megszakito: true };
    if (valasz.bankRc === 'D04') return { kimenet: 'visszalepes', bankRc: valasz.bankRc };
    return { kimenet: 'folyamatban', hiba: 'bank_D', bankRc: valasz.bankRc };
  }
  if (!valasz.mezok) {
    return {
      kimenet: 'folyamatban',
      hiba: valasz.hibaOsztaly || 'http',
      megszakito: SZALLITASI.includes(valasz.hibaOsztaly),
    };
  }
  const e = ellenorizMsgt31(valasz.mezok, session, pid);
  if (!e.ok) return { kimenet: 'mezo_elteres', mezo: e.mezo };
  const { rc } = e.adatok;
  if (rc === 'PR') return { kimenet: 'folyamatban', adatok: e.adatok };
  if (rc === '00') return { kimenet: 'engedelyezve', adatok: e.adatok };
  if (rc === 'TO') return { kimenet: 'lejart', ok: 'bank_to', adatok: e.adatok, rcCsoport: rcCsoport(rc) };
  if (rc === 'NT') return { kimenet: 'nem_talalt', adatok: e.adatok };
  return { kimenet: 'elutasitva', ok: 'bank_elutasitas', adatok: e.adatok, rcCsoport: rcCsoport(rc) };
}

// A MSGT32-re kapott S-kódok közül ezek a bizonyítottan FEL NEM DOLGOZOTT
// zárás jelei (2026-10-01, a CIB írásos válasza): „csak akkor tekinthető
// sikeresnek a tranzakció, ha a kapott MSGT32-es üzenetre teljes értékű
// választ adunk vissza. Előfordulhat, hogy az MSGT32-es üzenetre S05 választ
// adunk […] ha 10 percen belül nem kerül lezárásra MSGT32-es üzenettel, még
// visszautalásra kerülhet." Vagyis a lezárás NEM történt meg, a MSGT32-t a
// határidőn belül újra kell küldeni. ⚠️ A levél CSAK az S05-öt nevezi meg; az
// S04-et a SAJÁT döntésünk (a PR-4 feladatleírása) sorolja ugyanide — a bank
// ezt nem erősítette meg, a teszt-banknál mérendő. Pénzkockázata nincs: egy
// már kiszolgált MSGT32 ismétlésére a bank D05-öt ad (→ close_unknown, ember),
// kettős terhelés nem lehet (2026-10-01, a PR-4 1. javítóköre).
// Minden más S-kód (kulcs-, környezet-, formátumhiba) a zárásra kétes marad.
const ZARAS_UJRAKULDHETO_S = Object.freeze(['S04', 'S05']);

function zarasAlap(valasz, session, pid) {
  if (valasz.bankRc) {
    const rc = valasz.bankRc;
    if (ZARAS_UJRAKULDHETO_S.includes(rc)) return { kimenet: 'nem_feldolgozott', bankRc: rc, visszalepesMs: 30000 };
    if (bankKodOsztaly(rc) === 'bank_S') return { kimenet: 'ketes', ok: 'zaras_s', bankRc: rc };
    // D03 (hibás sorrend), D07 (adatformátum): a kérést NEM szolgálták ki.
    if (rc === 'D03' || rc === 'D07') return { kimenet: 'nem_feldolgozott', bankRc: rc, visszalepesMs: 30000 };
    // D04 (nem engedélyezett / rátakorlát): nem szolgálták ki, hosszabb várakozás.
    if (rc === 'D04') return { kimenet: 'nem_feldolgozott', bankRc: rc, visszalepesMs: 60000 };
    // D05: „a kéréstípus már ki lett szolgálva" — egy korábbi, válasz nélküli
    // MSGT32-t a bank FELDOLGOZOTT. Nem tudjuk, mi lett: ember dönt.
    if (rc === 'D05') return { kimenet: 'ketes', ok: 'zaras_d05', bankRc: rc };
    return { kimenet: 'ketes', ok: 'zaras_bank_d', bankRc: rc };
  }
  if (!valasz.mezok) {
    // Csak a kapcsolódás ELŐTTI hiba bizonyítja, hogy a kérés el sem ment.
    if (valasz.hibaOsztaly === 'nem_kuldott') return { kimenet: 'nem_feldolgozott', hiba: 'nem_kuldott', visszalepesMs: 30000 };
    if (valasz.hibaOsztaly === 'visszafejtes') return { kimenet: 'ketes', ok: 'zaras_mezo_elteres', hiba: 'visszafejtes' };
    return { kimenet: 'ketes', ok: 'zaras_valasz_nelkul', hiba: valasz.hibaOsztaly || 'http' };
  }
  const e = ellenorizMsgt31(valasz.mezok, session, pid);
  if (!e.ok) return { kimenet: 'ketes', ok: 'zaras_mezo_elteres', mezo: e.mezo };
  const { rc } = e.adatok;
  if (rc === '00') return { kimenet: 'siker', adatok: e.adatok };
  if (rc === 'TO') return { kimenet: 'lejart', ok: 'bank_to', adatok: e.adatok, rcCsoport: rcCsoport(rc) };
  if (rc === 'PR') return { kimenet: 'nem_feldolgozott', adatok: e.adatok, visszalepesMs: 30000 };
  return { kimenet: 'elutasitva', ok: 'bank_elutasitas', adatok: e.adatok, rcCsoport: rcCsoport(rc) };
}

/**
 * MSGT32 → MSGT31 (az állapotgép 13–17. lépése). Kimenetek:
 *   'siker'            → closed_ok (és CSAK ekkor könyvelünk)
 *   'lejart'           → expired (RC=TO: elkéstünk, a bank reverzált)
 *   'elutasitva'       → failed
 *   'nem_feldolgozott' → vissza authorized-ba, újrapróba `visszalepesMs` után
 *                        (D03/D04/D07, PR, a küldés előtti hiba, és 2026-10-01
 *                        óta az S05 — a bank szavára — meg az S04 — saját
 *                        döntésünkre, lásd ZARAS_UJRAKULDHETO_S) — legfeljebb 3
 *                        MSGT32, és csak a MSGT10-től számított határidőn belül
 *   'ketes'            → close_unknown — a MSGT32-t SOHA nem küldjük újra
 * Elutasított eredetű zárásnál (`eredete: 'declined'`) minden nem-siker
 * 'elutasitva': elutasított authorizációból terhelés nem lehet.
 */
function zarasKimenet(valasz, session, pid, { eredete = 'authorized' } = {}) {
  const alap = zarasAlap(valasz, session, pid);
  if (eredete === 'declined' && alap.kimenet !== 'siker') {
    return {
      ...alap,
      kimenet: 'elutasitva',
      ok: alap.kimenet === 'elutasitva' ? alap.ok : 'bank_elutasitas',
      eredetiKimenet: alap.kimenet,
    };
  }
  return alap;
}

module.exports = {
  // konfig
  cibKonfig,
  cibBeallitasok,
  naplozCibKonfigot,
  KOTELEZO_ENV,
  ELAVULT_ENV,
  OLVASOTT_ENV,
  CIB_BEVEZETES_ALAP,
  CIB_ELES_HOSTOK,
  ismertTesztKulcs,
  RETURN_UT,
  // mezők
  ujTrid,
  uidAlnev,
  lekerTs,
  maszkoltTrid,
  msgt10Mezok,
  msgt20Mezok,
  msgt32Mezok,
  msgt33Mezok,
  customerUrl,
  // ellenőrzés + osztályozás
  ellenorizMsgt11,
  ellenorizMsgt31,
  bankKodOsztaly,
  inditasKimenet,
  lekerdezesKimenet,
  zarasKimenet,
  ZARAS_UJRAKULDHETO_S,
  CibProtokollHiba,
  TRID_RE,
};
