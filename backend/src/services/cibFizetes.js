// =====================================================================
//  CIB EKI — A KÁRTYÁS DÍJFIZETÉS FOLYAMATA (2026-09-29, CIB PR-2/B)
//
//  Egy payment_sessions sor = egy banki kísérlet, a payment_id maga a 16
//  jegyű TRID. A négyállapotú `state`-et továbbra is CSAK a payment_events
//  triggerei írják; a CIB-lépés a `cib_state` alállapotban él, amit KIZÁRÓLAG
//  ez a modul ír, mindig feltételes UPDATE-tel (várt állapot + bérlet).
//
//  A négy szabály, amire minden épül (mindegyik egy pénzbe kerülő hibamód
//  ellen):
//   1. EGYETLEN SIKERKRITÉRIUM: a MSGT32-re kapott, a DB-vel egyező MSGT31
//      RC=00. A MSGT33 RC=00 csak „authorized" — a könyvelés (paid_at,
//      kontakt, számla) CSAK a `closed_ok` UTÁN fut.
//   2. ELŐBB ÍRUNK, AZTÁN HÍVUNK: minden banki hívás előtt commitolt állapot
//      van (`initializing` a MSGT10, `closing` a MSGT32 előtt). Banki HTTP
//      soha nem fut DB-tranzakcióban vagy sorzár alatt.
//   3. PONTOSAN EGYSZERI ZÁRÁS: a zárási jog egy rövid tranzakció a
//      fuvarsorzár alatt, üzleti újraellenőrzéssel, egy részleges UNIQUE
//      index védelmében. A MSGT32-t csak bizonyítottan fel nem dolgozott
//      kérés után küldjük újra (2026-10-01 óta a bank szavára az S05 is
//      ilyen, az S04-et saját döntéssel soroljuk mellé); kétes kimenetnél
//      `close_unknown` + ember. Minden zárási ablak a MSGT10-től számított
//      határidőig tart (CIB_ZARAS_HATARIDO_MP), és az S05 utáni várakozást
//      egyetlen belépési pont (visszatérés, /pay, eredményoldal, admin
//      „Újraellenőrzés") sem kerülheti meg (2026-10-01, a PR-4 1. javítóköre).
//   4. NEM FIZETHETŐ ÜGYLETET NEM ZÁRUNK LE: a lemondott / közben kifizetett /
//      díjsávot vagy szállítót váltott fuvarnál a MSGT32 elmarad
//      (`not_closed`), a bank magától feloldja a zárolást.
//
//  Egy TRID-en egyszerre csak a DB-bérlet (cib_lease_*) birtokosa dolgozhat:
//  a visszatérés, a lekérdező kör és az admin „Újraellenőrzés" ugyanazt a
//  `feldolgoz` motort hívja. A bérlő-azonosító hívásonként egyedi, így egy
//  folyamaton belüli párhuzamos hívás sem kerülheti meg.
//
//  2026-10-03 (PR-5): a kétes (close_unknown) kísérlet automatikus
//  egyeztetése — az utolsó MSGT32 után CIB_EGYEZTETES_PERC perccel CSAK-OLVASÓ
//  MSGT33 dönt (TO → nem terhelt; két, ≥15 perc különbségű 00 ugyanazzal az
//  ANUM-mal egy kiment MSGT32 után → könyvelés; minden más → riasztás +
//  visszalépés — 2026-10-04, 1. javítókör), MSGT32 SOHA. Tartós riasztások
//  (előbb küld, aztán jelöl; a kör és a söprés pótolja), rendszerszintű
//  banki hiba-riasztás, szünet-kapcsoló, konfig nélküli admin-műveletek.
//
//  Kimaradt: MSGT37/70/74/78/80, a JÁRAT-foglalások CIB-ága.
// =====================================================================
const crypto = require('crypto');
const os = require('os');
const db = require('../db');
const p = require('./cibProtokoll');
const kliens = require('./cibKliens');
const eki = require('./ekiCrypt');
const { logPaymentEvent } = require('./feePayment');
const { calculateConnectionFee } = require('./connectionFee');
const { rcCsoport } = require('../data/cibRcCsoportok');
const realtime = require('../realtime');
// A levelező és az értesítő modult a hívás pillanatában olvassuk (a
// teszt-üzemi hiba-injektálás és a levél-elfogás ugyanazt a csatornát lássa).
const email = require('./email');
const notifications = require('./notifications');

// A payments.js a routes-ban él, és a CIB-konfigot olvassa — lusta betöltés
// a körkörös import ellen.
const confirmFeePayment = (...a) => require('../routes/payments').confirmFeePayment(...a);

// ─────────────────────────────────────────────────────────────────────────
//  Kötött értékek
// ─────────────────────────────────────────────────────────────────────────
// ⚠️ 2026-10-03 (PR-5): a bérlet eddig fix 3 perc volt — egy MSGT33/MSGT32
// közben elhalt folyamat sorát így csak 3 perc múlva vette át más, és egy
// ~6:30 után összeomlott tételnél a zárás a 9:30-as határidőn túlra csúszott.
// Most a leghosszabb banki hívás + tartalék (alapból 75 s, legfeljebb 90 s),
// és a zárás előtt, valamint a könyvelés előtt megújul (berletMp).
const BERLET_TARTALEK_MS = 30000;
const BERLET_MIN_MP = 60;
const SZIVVERES_MAX_MS = 2 * 60 * 1000;
const INDITAS_BLOKK_MP = 60; // ennél fiatalabb „initializing" mellett nincs új /pay
const INDITAS_ELHAGYOTT_MP = 120; // ennél régebbi „initializing" → abandoned
const ELSO_LEKERDEZES_MP = 90; // visszatérés nélkül ennyi után kérdezzük a bankot
// ⚠️ 2026-10-01: a jóváhagyástól (authorized_at) számolt 8 perces türelem
// kivezetve. A bank írásban: „10 perc a lezárási határidő, ami a kapott 10-es
// üzenet beérkezésétől számítódik" — a vásárló bankoldalon töltött ideje is
// benne van, így egy 5 perces fizetés után a régi türelem a MSGT10-től 13
// percig várt, a bank határidején túl. Minden zárási ablak a MSGT10-től
// számít (CIB_ZARAS_HATARIDO_MP, lásd zarasiHataridoLejart).
const MAX_ZARASI_KISERLET = 3;
const MEGSZAKITO_KUSZOB = 5;
const MEGSZAKITO_NYITVA_MS = 10 * 60 * 1000;
const MEGSZAKITO_RIASZTAS_MS = 30 * 60 * 1000;
const VISSZALEPES_ALAP_MS = 2 * 60 * 1000;
const VISSZALEPES_MAX_MS = 8 * 60 * 1000;
const EREDMENY_TOKEN_MP = 24 * 3600;
const ISMETLODO_HIBA_KUSZOB = 3; // NT / mezőeltérés ennyiszer egymás után → ember
const HOP_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HIBAS_VISSZATERES_NAPLO_MAX = 300; // a saját, de hibás MSGT21 napló-részlete
const VISSZATERES_NAPLO_MAX_TRID = 10; // TrID-enként legfeljebb ennyi MSGT21-naplósor
const VISSZATERES_RIASZTAS_KOZ_MS = 60 * 1000;
const SIKER_IRAS_KISERLET = 3; // a hiteles MSGT31 RC=00 rögzítése átmeneti DB-hiba után
// 2026-10-03 (PR-5) — ütemezés, egyeztetés, riasztás
const VISSZATERES_MIN_KOZ_MS = 5000; // a visszatérés utáni soron kívüli MSGT33 kalapálás-féke
const LEKERDEZES_TARTALEK_MS = 15000; // a visszatért vásárló utolsó MSGT33-ja: határidő − (HTTP-keret + ez)
const ZARAS_GYORS_UJRAPROBA_MP = 5; // a határidő közelében a fel nem dolgozott zárás rövidebb újrapróbája
const ALAP_EGYEZTETES_PERC = 25; // konfig nélkül — a cibProtokoll alapértéke
// 2026-10-04 (a PR-5 1. javítóköre, BLOKKOLÓ): a „lezárt" egyeztetéshez két,
// legalább ennyi perc különbségű 00 kell ugyanazzal az ANUM-mal.
const EGYEZTETES_MEGEROSITES_PERC = 15;
const EGYEZTETES_VISSZALEPES_ALAP_PERC = 15;
const EGYEZTETES_VISSZALEPES_MAX_PERC = 360;
const KONYVELES_RIASZTAS_KUSZOB = 3; // ennyi elbukott könyvelés (vagy a zárás óta 10 perc) → riasztás
const KONYVELES_RIASZTAS_PERC = 10;
const KONYVELES_VISSZALEPES_MAX_MP = 30 * 60;
const RENDSZERHIBA_KUSZOB = 3; // egymás utáni értelmetlen banki válasz (több TrID-en át)
const RENDSZERHIBA_RIASZTAS_MS = 30 * 60 * 1000;
const RIASZTAS_CLAIM_MP = 300; // a félbemaradt (elhalt) riasztás ennyi után újra küldhető
const EMLEKEZTETO_ORA = 24;
// A ki nem ment napi emlékeztető legkorábban ennyi perc múlva próbálkozik
// újra (2026-10-04): levélkiesés alatt eddig percenként ment Sentry-esemény.
const EMLEKEZTETO_UJRAPROBA_PERC = 60;
const ALAP_ZARAS_HATARIDO_MP = 570; // konfig nélkül (admin-műveletek) — a cibProtokoll alapértéke
// Az admin „lezarva" rendezésnél a bank szokásos RT-szövege RC=00-ra (C6).
const ADMIN_ALAP_RT = 'Tranzakció elfogadva';

const NEM_VEGSO = Object.freeze(['initializing', 'ready', 'redirected', 'authorized', 'closing', 'close_unknown']);
const BLOKKOLO = Object.freeze(['authorized', 'closing', 'close_unknown', 'closed_ok']);
// A végállapot → a meglévő fizetési út eseménye (event_type='webhook':
// „szolgáltató által hitelesített eredmény" — a 087-es trigger így zár).
const VEGALLAPOT_ESEMENY = Object.freeze({
  closed_ok: 'Succeeded',
  failed: 'Canceled',
  not_closed: 'Canceled',
  expired: 'Expired',
  abandoned: 'Expired',
  init_failed: 'Expired',
});

// Fix, banki szöveg nélküli válaszok (a bank hibaszövege és az err.message
// soha nem mehet a böngészőbe).
const HIBAK = Object.freeze({
  STATE_CHANGED: [409, 'A fizetési állapot időközben megváltozott. Frissítsd az oldalt.'],
  PAYMENT_RECONCILIATION_REQUIRED: [409, 'A korábbi fizetés állapotát vagy összegét előbb rendezni kell. Kérj segítséget az ügyfélszolgálattól; új fizetést nem indítottunk.'],
  CIB_PAYMENT_FINISHING: [409, 'A kártyás fizetésed épp lezárul — néhány másodperc múlva frissítsd az oldalt.'],
  CIB_PAYMENT_REVIEW: [409, 'A bank válaszát egyeztetjük. Ne fizess újra — legkésőbb 1 munkanapon belül rendezzük, és kétszer biztosan nem terhelünk.'],
  PAYMENT_STARTING: [409, 'A fizetés indítása már folyamatban van — várj néhány másodpercet.'],
  PAYMENT_RETRY_LIMIT: [429, 'Túl sok fizetési kísérlet ennél a fuvarnál. Próbáld újra később, vagy írj az info@gofuvar.hu címre.'],
  CIB_INIT_FAILED: [502, 'A bank most nem érhető el, nem történt terhelés. Próbáld újra pár perc múlva.'],
  CIB_BUSY: [503, 'A bank most túlterhelt, nem történt terhelés. Próbáld újra egy perc múlva.'],
  CIB_UNAVAILABLE: [503, 'A kártyás fizetés átmenetileg nem elérhető. Nem történt terhelés — próbáld újra később.'],
  PAYMENT_TEMPORARILY_UNAVAILABLE: [503, 'A kártyás fizetés átmenetileg szünetel. Nem történt terhelés — próbáld újra néhány perc múlva.'],
  // 2026-10-03 (PR-5, C2): a szünet-kapcsoló (CIB_UJ_FIZETES_TILTVA).
  CIB_PAUSED: [503, 'Az új kártyás fizetések átmenetileg szünetelnek. Nem történt terhelés — próbáld újra később.'],
  // 2026-10-01 (a CIB írásos válasza): az adattovábbítási nyilatkozat a
  // kártyás fizetéshez akkor is kötelező, ha vásárlói adatot nem küldünk.
  CIB_CONSENT_REQUIRED: [400, 'A bankkártyás fizetéshez el kell fogadnod a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.'],
});

function hibaValasz(kod) {
  const [http, error] = HIBAK[kod];
  return { http, body: { error, code: kod } };
}

// ─────────────────────────────────────────────────────────────────────────
//  Memóriabeli állapot (példányonként): szívverés, megszakító, D04-
//  visszalépés, leállás, háttérfeladatok.
// ─────────────────────────────────────────────────────────────────────────
const allapot = {
  utolsoTick: 0,
  leallas: false,
  // A folyamatban lévő CIB-MUNKA (indítás, feldolgozás egy TRID-en) —
  // nem csak a banki HTTP-hívás. A szabályos leállás ERRE vár (2026-09-29,
  // PR-2/C): a MSGT32 válasza után még a closed_ok rögzítése és a könyvelés
  // hátravan; ha közben jön a pool.end(), a bank lezárta a tranzakciót, a
  // sorunk viszont `closing`-ban marad → hamis `close_unknown`, ember kell.
  munka: 0,
  megszakito: { hibak: 0, nyitvaEddig: 0, utolsoRiasztas: 0 },
  visszalepes: { eddig: 0, ms: 0 },
  visszateresRiasztas: 0,
  // 2026-10-03 (PR-5): TrID-eken átívelő rendszerszintű banki hibaszámláló.
  rendszerhiba: { szam: 0, kodok: new Set(), utolsoRiasztas: 0 },
  // 2026-10-03 (PR-5/B): az azonosíthatatlan visszatérések számlálója (DB-be nem ír).
  szemetVisszateres: { osszes: 0, ablak: {}, utolsoNaplo: 0 },
  hatter: new Set(),
};

/**
 * A DB-bérlet hossza másodpercben: a leghosszabb banki hívás + tartalék
 * (2026-10-03, PR-5). A bérlet a zárás és a könyvelés előtt megújul, így egy
 * bérlet-szakasz legfeljebb egy banki hívást fed.
 * @param {object} [b] — cibBeallitasok()
 */
function berletMp(b = p.cibBeallitasok()) {
  const h = (b && b.hangolok) || {};
  const leghosszabb = Math.max(h.httpIdokeretMs || 30000, h.zarasIdokeretMs || 45000);
  return Math.max(BERLET_MIN_MP, Math.ceil((leghosszabb + BERLET_TARTALEK_MS) / 1000));
}

/** A lekérdező kör jelez: él. A /pay csak friss szívverés mellett indít. */
function szivveres() {
  allapot.utolsoTick = Date.now();
}
function szivveresFriss() {
  return Date.now() - allapot.utolsoTick < SZIVVERES_MAX_MS;
}
function utolsoSzivveres() {
  return allapot.utolsoTick;
}
function leallasFolyamatban() {
  return allapot.leallas;
}

/**
 * Egy CIB-munkaegység futtatása a számláló alatt (a leállás erre vár).
 * A számláló a hívás ELSŐ await-je előtt nő — egy szálon ez atomi a
 * `leallas` ellenőrzésével együtt.
 */
async function munkaban(fn) {
  allapot.munka += 1;
  try {
    return await fn();
  } finally {
    allapot.munka -= 1;
  }
}
function folyamatbanLevoMunka() {
  return allapot.munka;
}

function megszakitoNyitva() {
  return Date.now() < allapot.megszakito.nyitvaEddig;
}

/**
 * A megszakító számlálója: 5 egymás utáni hálózati / S-hiba (kimenő hálózat,
 * felcserélt kulcs, rossz környezet) után 10 percig nem engedélyeztetünk új
 * pénzt. A már jóváhagyott tételek zárása ez alatt is fut.
 * (2026-10-01, a CIB írásos válasza: IP-regisztráció nincs, a teszt- és az
 * éles végpont is a 443-as porton érhető el — ezek nem gyanúokok.)
 */
function megszakitoJelez(hibaE, ertelmesValasz) {
  const m = allapot.megszakito;
  if (!hibaE) {
    if (ertelmesValasz) m.hibak = 0;
    return;
  }
  m.hibak += 1;
  if (m.hibak < MEGSZAKITO_KUSZOB) return;
  m.nyitvaEddig = Date.now() + MEGSZAKITO_NYITVA_MS;
  m.hibak = 0;
  const uzenet = `[cib] 🚨 MEGSZAKÍTÓ NYITVA: ${MEGSZAKITO_KUSZOB} egymás utáni banki kapcsolati/S-hiba — `
    + '10 percig nem indul új kártyás fizetés (hálózat, kulcs vagy környezet gyanú)';
  console.error(uzenet);
  if (Date.now() - m.utolsoRiasztas > MEGSZAKITO_RIASZTAS_MS) {
    m.utolsoRiasztas = Date.now();
    sentry(uzenet, 'error');
    const b = p.cibBeallitasok();
    hatterben(() => email.sendCibRiasztasEmail({
      to: b.riasztasEmail || 'info@gofuvar.hu', trid: null, jobId: null, ok: 'megszakito',
    }), 'cib_megszakito');
  }
}

function visszalepesAktiv() {
  return Date.now() < allapot.visszalepes.eddig;
}
/** D04 (rátakorlát): globális visszalépés, ismételt D04-nél duplázva, legfeljebb 8 percig. */
function visszalepesInditasa() {
  const v = allapot.visszalepes;
  const ismetlodo = v.ms > 0;
  v.ms = v.ms ? Math.min(v.ms * 2, VISSZALEPES_MAX_MS) : VISSZALEPES_ALAP_MS;
  v.eddig = Date.now() + v.ms;
  console.warn(`[cib] D04 — a MSGT33-lekérdezések ${Math.round(v.ms / 1000)} mp-re szünetelnek`);
  // 2026-10-03 (PR-5): a tartós D04 (a visszalépés duplázódik) eddig csak egy
  // console.warn volt — közben minden jóváhagyott tétel lezáratlan maradt.
  if (ismetlodo) bankRendszerJel(true, 'D04 ismétlődik', { azonnal: true });
}

/**
 * Rendszerszintű banki hiba figyelése (2026-10-03, PR-5): a MSGT10/MSGT33-ra
 * kapott D-kód, az RC nélküli HTTP-hiba és a tartós D04 eddig néma volt — a
 * megszakító csak a hálózati / S-hibákat számolta, a /pay tovább indított
 * pénzt, amit a lekérdezés soha nem tudott jóváhagyottnak látni. TrID-eken
 * átívelő számláló: `kuszob` egymás utáni értelmetlen válasz (vagy egy
 * `azonnal` jel) → Sentry + riasztó levél, 30 percenként legfeljebb egyszer.
 * Értelmes (visszafejthető, egyező) válasz nullázza.
 * @param {boolean} hibaE
 * @param {string} [kod] — rövid, személyes adat nélküli címke (pl. „MSGT33 D06")
 */
function bankRendszerJel(hibaE, kod = '', { azonnal = false } = {}) {
  const r = allapot.rendszerhiba;
  if (!hibaE) {
    r.szam = 0;
    r.kodok.clear();
    return;
  }
  r.szam += 1;
  if (kod && r.kodok.size < 10) r.kodok.add(kod);
  if (!azonnal && r.szam < RENDSZERHIBA_KUSZOB) return;
  if (r.utolsoRiasztas && Date.now() - r.utolsoRiasztas < RENDSZERHIBA_RIASZTAS_MS) return;
  r.utolsoRiasztas = Date.now();
  const kodok = [...r.kodok].join(', ') || '?';
  const reszletek = `banki válasz: ${kodok}; egymás után: ${r.szam}`;
  const uzenet = `[cib] 🚨 RENDSZERSZINTŰ BANKI HIBA (${reszletek}) — a jóváhagyott kártyás tételek nem zárhatók le; `
    + 'nézd a CIB admin-naplót és a terminál beállításait.';
  console.error(uzenet);
  sentry(uzenet, 'error');
  r.szam = 0;
  r.kodok.clear();
  const b = p.cibBeallitasok();
  hatterben(() => email.sendCibRiasztasEmail({
    to: b.riasztasEmail || 'info@gofuvar.hu', trid: null, jobId: null, ok: 'bank_rendszerhiba', reszletek,
  }), 'cib_rendszerhiba');
}
function visszalepesVege() {
  allapot.visszalepes.ms = 0;
}

function sentry(uzenet, szint = 'error') {
  if (!process.env.SENTRY_DSN) return;
  try {
    require('@sentry/node').captureMessage(uzenet, { level: szint, tags: { csatorna: 'fizetes', hibamod: 'cib' } });
  } catch { /* a riasztás hibája nem érintheti a fizetést */ }
}

/** Háttérfeladat, amire a leállás és a tesztek várni tudnak. Soha nem dob. */
function hatterben(fn, cimke) {
  const feladat = (async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cib] háttérfeladat hiba (${cimke}):`, err && err.message);
      sentry(`[cib] háttérfeladat hiba (${cimke})`);
    }
  })();
  allapot.hatter.add(feladat);
  feladat.finally(() => allapot.hatter.delete(feladat));
  return feladat;
}

async function varjHatterre() {
  for (let i = 0; i < 20 && allapot.hatter.size; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled([...allapot.hatter]);
  }
  // A levelek a feeNotifications-ben setImmediate-tel indulnak.
  await new Promise((r) => { setImmediate(r); });
  await new Promise((r) => { setImmediate(r); });
}

function hatterFeldolgoz(trid, forras) {
  return hatterben(() => feldolgoz(trid, forras), `feldolgoz:${forras}`);
}

function ujBerlo() {
  return `${process.env.RAILWAY_REPLICA_ID || os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const varj = (ms) => new Promise((r) => { setTimeout(r, ms); });

function webBase() {
  const b = p.cibBeallitasok();
  if (b.webBaseUrl) return b.webBaseUrl;
  try {
    return new URL(process.env.WEB_BASE_URL).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/** A web eredményoldala egy rögzített hibakóddal ('link' | 'azonositas'). */
function hibaOldalUrl(kod) {
  return `${webBase()}/fizetes/eredmeny?hiba=${kod === 'link' ? 'link' : 'azonositas'}`;
}

// A bank JÓVÁHAGYTA (MSGT33 RC=00), de mi nem zártuk le (MSGT32 nem ment ki,
// vagy bizonyítottan egyik sem ért a bankhoz): a kártyán zárolt összeg áll,
// amit a bank a határidő után felold — terhelés nincs. ⚠️ 2026-10-01 (a PR-4
// 1. javítóköre, BLOKKOLÓ): ez a kísérlet eddig „sikertelen"-ként jelent meg
// („A bank nem fogadta el a fizetést"), miközben a vásárló a bank oldalán épp
// sikert látott — dupla fizetéshez és panaszhoz vezet. A kijelzés „nem
// terhelt", az értesítés saját („nem_zart") szöveget kap.
// 2026-10-03 (PR-5/B): az admin „lejaratas" egy jóváhagyott (authorized /
// closing), MSGT32 nélküli kísérleten ugyanez — eddig a levél „nem zártuk le"
// volt, a pill és az eredményoldal viszont „sikertelen / a bank nem fogadta el".
const JOVAHAGYOTT_NEM_ZART = Object.freeze(['zarasi_hatarido', 'zaras_nem_kuldott', 'admin_lejaratas_jovahagyott']);

function jovahagyottNemZart(s) {
  const ok = s && s.cib_result && s.cib_result.ok;
  return s && s.cib_state === 'expired' && JOVAHAGYOTT_NEM_ZART.includes(ok);
}

// 2026-10-03 (PR-5, C5): a felületnek közölt „nem terhelt" okok. Az admin
// „nem_lezarva" rendezése és a bank automatikus visszafordítása után a
// kísérlet „nem_terhelt" — eddig az admin-rendezés „sikertelen"-t mutatott, a
// levél pedig azt írta, hogy „a fuvar közben megváltozott", ami hamis volt.
const NEM_TERHELT_OKOK = Object.freeze(['admin_nem_lezarva', 'bank_visszaforditotta']);

/** Egy CIB-kísérlet állapota a felhasználói felület nyelvén. */
function lekepez(s) {
  if (!s) return null;
  const ok = s.cib_result && s.cib_result.ok;
  // A banknál visszatérített könyvelési árva (admin): a kártyát végül nem
  // terheli a díj. A felület szótára ennél finomabbat nem ismer (C3).
  if (s.state === 'closed' && ok === 'admin_visszaterites') return 'nem_terhelt';
  if (s.state === 'needs_review' || s.cib_state === 'close_unknown') return 'ellenorzes';
  if (NEM_TERHELT_OKOK.includes(ok) && ['failed', 'expired'].includes(s.cib_state)) return 'nem_terhelt';
  switch (s.cib_state) {
    case 'closed_ok': return s.state === 'succeeded' ? 'sikeres' : 'feldolgozas';
    case 'expired': return jovahagyottNemZart(s) ? 'nem_terhelt' : 'sikertelen';
    case 'failed':
    case 'init_failed':
    case 'abandoned': return 'sikertelen';
    case 'not_closed': {
      const ok = s.cib_result && s.cib_result.ok;
      return ok === 'mar_fizetve' || ok === 'kupon' ? 'mar_fizetve' : 'nem_terhelt';
    }
    default: return 'feldolgozas';
  }
}

/** A felület szótára (a lekepez lehetséges kimenetei) — az admin-szűrő is ezt érti. */
const UI_ALLAPOTOK = Object.freeze(['feldolgozas', 'sikeres', 'sikertelen', 'nem_terhelt', 'mar_fizetve', 'ellenorzes']);

const sqlLista = (lista) => lista.map((x) => `'${x}'`).join(', ');

/**
 * A lekepez SQL-tükre (2026-10-03, PR-5/B): az admin-lista szűrője a felület
 * szótárával dolgozik (CibFizetesekAdmin ALLAPOT_NEV), és PONTOSAN azokat a
 * tételeket adja, amelyeknek a pillje az adott szót mutatja. Eddig a felület
 * a saját szavát küldte, a backend csak a nyers cib_state-et értette: minden
 * szűrő 400 volt, az „Egyeztetésre vár" jelvény soha nem jelent meg. A két
 * leképezés egyezését a cib-pr5-b2-utak őr minden kombinációra méri.
 * @param {string} a — a payment_sessions alias (csak azonosító)
 */
function lekepezSql(a) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error('Érvénytelen alias.');
  const ok = `(${a}.cib_result->>'ok')`;
  return `(CASE
    WHEN ${a}.state = 'closed' AND ${ok} = 'admin_visszaterites' THEN 'nem_terhelt'
    WHEN ${a}.state = 'needs_review' OR ${a}.cib_state = 'close_unknown' THEN 'ellenorzes'
    WHEN ${ok} IN (${sqlLista(NEM_TERHELT_OKOK)}) AND ${a}.cib_state IN ('failed', 'expired') THEN 'nem_terhelt'
    WHEN ${a}.cib_state = 'closed_ok' THEN CASE WHEN ${a}.state = 'succeeded' THEN 'sikeres' ELSE 'feldolgozas' END
    WHEN ${a}.cib_state = 'expired' THEN
      CASE WHEN ${ok} IN (${sqlLista(JOVAHAGYOTT_NEM_ZART)}) THEN 'nem_terhelt' ELSE 'sikertelen' END
    WHEN ${a}.cib_state IN ('failed', 'init_failed', 'abandoned') THEN 'sikertelen'
    WHEN ${a}.cib_state = 'not_closed' THEN
      CASE WHEN ${ok} IN ('mar_fizetve', 'kupon') THEN 'mar_fizetve' ELSE 'nem_terhelt' END
    ELSE 'feldolgozas'
  END)`;
}

/** A kötelező banki adatsor (TrID, RC, RT, AMO, ANUM) — CNUM soha. */
function adatsor(s) {
  const r = s.cib_result || {};
  const rc = typeof r.rc === 'string' ? r.rc : null;
  return {
    trid: s.payment_id,
    rc,
    rt: typeof r.rt === 'string' ? r.rt : null,
    amo: Number(s.amount_huf),
    cur: s.currency || 'HUF',
    anum: typeof r.anum === 'string' && r.anum ? r.anum : null,
    rc_csoport: rc && rc !== '00' ? rcCsoport(rc) : null,
    // C5: csak a közölt okok mennek ki, a belső kódok nem.
    ok: kozoltOk(s),
  };
}

/**
 * A felületnek közölt ok (C5). 2026-10-03 (PR-5/B): a visszatérített
 * könyvelési árva is kifejezett okot kap — a felület szótára ezt
 * „nem_terhelt"-re képezi, holott a bank TERHELT és mi visszatérítettünk;
 * az ok nélkül a felület csak az RC=00-ból következtethetne erre.
 */
function kozoltOk(s) {
  const ok = s && s.cib_result && s.cib_result.ok;
  if (NEM_TERHELT_OKOK.includes(ok)) return ok;
  if (s.state === 'closed' && ok === 'admin_visszaterites') return ok;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Eredmény-token (a publikus eredmény-oldalhoz, 24 óra)
// ─────────────────────────────────────────────────────────────────────────
function eredmenyToken(trid, lejarat = Math.floor(Date.now() / 1000) + EREDMENY_TOKEN_MP) {
  const b = p.cibBeallitasok();
  if (!b.hmacTitok) throw new p.CibProtokollHiba('A CIB-konfiguráció nem teljes.');
  const sig = crypto.createHmac('sha256', b.hmacTitok).update(`eredmeny:${trid}:${lejarat}`).digest('base64url');
  return `${trid}.${lejarat}.${sig}`;
}

function eredmenyTokenEllenoriz(token) {
  const b = p.cibBeallitasok();
  if (!b.hmacTitok || typeof token !== 'string' || token.length > 200) return null;
  const m = /^([0-9]{16})\.([0-9]{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const [, trid, lejaratSzoveg, sig] = m;
  const lejarat = Number(lejaratSzoveg);
  if (!Number.isSafeInteger(lejarat) || lejarat < Math.floor(Date.now() / 1000)) return null;
  // A KANONIKUS alakot hasonlítjuk (szöveg, nem a dekódolt bájtok): a 43.
  // base64url-karakter alsó bitjei a dekódolásnál elvesznek, így bájt-
  // összevetéssel egy módosított utolsó karakter is „érvényes" lenne.
  const vart = Buffer.from(crypto.createHmac('sha256', b.hmacTitok)
    .update(`eredmeny:${trid}:${lejarat}`).digest('base64url'));
  const kapott = Buffer.from(sig);
  if (kapott.length !== vart.length || !crypto.timingSafeEqual(kapott, vart)) return null;
  return trid;
}

// ─────────────────────────────────────────────────────────────────────────
//  Végállapot-események és értesítések
// ─────────────────────────────────────────────────────────────────────────

/**
 * A végállapot eseménye a meglévő úton (idempotens claim). Sikernél a
 * könyvelés, egyébként Canceled/Expired, CSENDESEN: a feladó értesítését a
 * CIB-ág maga küldi a pontos okkal (a „próbáld újra" nem mindig igaz).
 */
async function vegallapotEsemeny(trid, berlo = null) {
  const { rows } = await db.query('SELECT cib_state, state FROM payment_sessions WHERE payment_id = $1', [trid]);
  const s = rows[0];
  if (!s || s.state !== 'pending') return;
  const status = VEGALLAPOT_ESEMENY[s.cib_state];
  if (!status) return;
  if (status === 'Succeeded') {
    await konyvel(trid, berlo);
    return;
  }
  await confirmFeePayment(trid, status, { csendes: true });
}

const ERTESITES = Object.freeze({
  sikertelen: {
    type: 'payment_failed',
    title: '❌ A kártyás fizetés nem sikerült',
    body: (cim) => `A(z) "${cim}" fuvar kapcsolatfelvételi díjának kártyás fizetése nem sikerült — a kártyádat nem terheltük. Új fizetést a fuvar oldalán indíthatsz.`,
  },
  nem_terhelt: {
    type: 'payment_not_charged',
    title: 'ℹ️ A kártyádat nem terheltük',
    body: (cim) => `A(z) "${cim}" fuvar kártyás fizetését nem zártuk le, mert a fuvar közben megváltozott — a kártyádat nem terheltük, a zárolt összeget a bank feloldja.`,
  },
  // 2026-10-01 (a PR-4 1. javítóköre): a bank jóváhagyta, mi a lezárási
  // határidőn belül nem véglegesítettük (határidőn túli jóváhagyás, vagy a
  // MSGT32 egyszer sem ért a bankhoz). Sem „nem sikerült", sem „a fuvar
  // megváltozott" nem igaz rá.
  nem_zart: {
    type: 'payment_not_charged',
    title: 'ℹ️ A kártyádat nem terheltük',
    body: (cim) => `A(z) "${cim}" fuvar kártyás fizetését a bank jóváhagyta, de a lezárási határidőn belül nem tudtuk véglegesíteni — a kártyádat nem terheltük, a zárolt összeget a bank feloldja. Új fizetést a fuvar oldalán indíthatsz.`,
  },
  // 2026-10-01 (a PR-4 1. javítóköre): a bank jóváhagyta, de ugyanerre a
  // fuvarra egy MÁSIK kísérlet zárása (vagy annak egyeztetése) volt
  // folyamatban, ezért ezt nem zártuk le (masik_zaras). A „fuvar megváltozott"
  // indok itt hamis volt, és új fizetést sem ígérhetünk: a másik kísérlet
  // épp sikerülhet, vagy egyeztetés alatt állhat.
  masik_kiserlet: {
    type: 'payment_not_charged',
    title: 'ℹ️ Ezzel a kísérlettel nem terheltük a kártyádat',
    body: (cim) => `A(z) "${cim}" fuvar egyik kártyás fizetését a bank jóváhagyta, de nem zártuk le, mert ugyanerre a fuvarra egy másik fizetésed lezárása volt folyamatban — kétszer nem terhelünk. Ezzel a kísérlettel nem terheltük a kártyádat, a zárolt összeget a bank feloldja. A díj állapotát a fuvar oldalán látod.`,
  },
  // 2026-10-03 (PR-5/B): a bank által jóváhagyott összeg eltért a díjtól, ezért
  // nem zártuk le. A fuvar nem változott; új fizetést nem ígérünk (ugyanez
  // ismétlődhet) — a díj állapota a fuvar oldalán, a tételt az admin látja.
  osszeg_elteres: {
    type: 'payment_not_charged',
    title: 'ℹ️ A kártyádat nem terheltük',
    body: (cim) => `A(z) "${cim}" fuvar kártyás fizetését nem zártuk le, mert a bank által jóváhagyott összeg eltért a díjtól — a kártyádat nem terheltük, a zárolt összeget a bank feloldja. A díj állapotát a fuvar oldalán látod; ha elakadtál, írj az info@gofuvar.hu címre.`,
  },
  mar_fizetve: {
    type: 'payment_not_charged',
    title: 'ℹ️ A díj már rendezve volt — nem terheltünk kétszer',
    body: (cim) => `A(z) "${cim}" fuvar kapcsolatfelvételi díja már rendezve volt, ezért ezt a kártyás fizetést nem zártuk le — a zárolt összeget a bank feloldja.`,
  },
  // 2026-10-03 (PR-5, C5): az admin a bankkal egyeztetve „nem zárult le"-ként
  // rendezte a kétes kísérletet. A „fuvar megváltozott" indok itt hamis volt
  // (a fuvar változatlan; a zárás kimenete volt kétes, pl. összeomlás miatt).
  admin_nem_lezarva: {
    type: 'payment_not_charged',
    title: 'ℹ️ A kártyádat nem terheltük',
    body: (cim) => `A(z) "${cim}" fuvar kártyás fizetését nem tudtuk véglegesíteni — a bankkal egyeztetve a kártyádat nem terheltük; ha a bank zárolta az összeget, magától feloldja. Új fizetést a fuvar oldalán indíthatsz.`,
  },
  // 2026-10-03 (PR-5, C5): az automatikus egyeztetés szerint a bank a le nem
  // zárt jóváhagyást visszafordította (TO), vagy a zárás egyszer sem ért el
  // a bankhoz.
  bank_visszaforditotta: {
    type: 'payment_not_charged',
    title: 'ℹ️ A kártyádat nem terheltük',
    body: (cim) => `A(z) "${cim}" fuvar kártyás fizetését a bank nem véglegesítette, és a zárolást feloldotta — a kártyádat nem terheltük. Új fizetést a fuvar oldalán indíthatsz.`,
  },
  // 2026-10-03 (PR-5): a könyvelési árva (a bank terhelt, az ügylet közben nem
  // volt fizethető) díját az admin a banknál visszatérítette.
  visszateritve: {
    type: 'payment_refunded',
    title: 'ℹ️ A díjat visszatérítettük',
    body: (cim) => `A(z) "${cim}" fuvar kapcsolatfelvételi díját a bank terhelte, de a fuvar közben már nem volt fizethető, ezért a díjat visszatérítettük a kártyádra. A jóváírás ideje a bankodtól függ.`,
  },
});

// A kétes (close_unknown) kísérlet közbenső értesítése (2026-10-03, PR-5):
// eddig a feladó erről semmit nem kapott, csak az admin — aki a 3DS miatt
// bezárta a fület, a terhelésről a bankja SMS-éből tudott.
const EGYEZTETES_ERTESITES = Object.freeze({
  type: 'payment_review',
  title: 'ℹ️ A kártyás fizetésed egyeztetés alatt',
  body: (cim, trid) => `A(z) "${cim}" fuvar kártyás fizetésének lezárásáról a banktól nem kaptunk egyértelmű választ, ezért egyeztetjük. Ne fizess újra — kétszer biztosan nem terhelünk, és az eredményről értesítünk. TrID: ${trid}`,
});

// A socket a felület szótárát viszi (C3): a finomabb értesítés-típusok a
// felületen „nem_terhelt".
const ERTESITES_ALLAPOT = Object.freeze({
  nem_zart: 'nem_terhelt',
  osszeg_elteres: 'nem_terhelt',
  masik_kiserlet: 'nem_terhelt',
  admin_nem_lezarva: 'nem_terhelt',
  bank_visszaforditotta: 'nem_terhelt',
  visszateritve: 'nem_terhelt',
});

/**
 * A feladó értesítése egy sikertelen / nem terhelt kísérletről — pontosan
 * egyszer (cib_notified_at claim), és CSAK ha a kísérlet eljutott a bankig.
 * Ha a fuvart közben egy másik kísérlettel kifizette, nem zavarjuk (kivéve a
 * „mar_fizetve" magyarázatot: ő ténylegesen jóváhagyott egy második
 * fizetést, ami függő tételként látszhat a kártyáján).
 */
async function ertesitFeladot(trid, tipus) {
  // ⚠️ 2026-10-03 (PR-5): előbb a TARTÓS in-app értesítés, és csak utána a
  // cib_notified_at jelölése — eddig a claim jött előbb, egy közben elhalt
  // folyamat után a feladó soha nem kapott értesítést (a jelölés már állt).
  // Két párhuzamos hívó legfeljebb két in-app sort írhat; a levél a jelölést
  // megnyerő hívóé, így az pontosan egyszer megy ki.
  const { rows } = await db.query(
    `SELECT ps.payment_id, ps.job_id, ps.amount_huf, ps.currency, ps.cib_result,
            j.title, j.paid_at, j.shipper_id, u.email, u.full_name
       FROM payment_sessions ps JOIN jobs j ON j.id = ps.job_id JOIN users u ON u.id = j.shipper_id
      WHERE ps.payment_id = $1 AND ps.cib_notified_at IS NULL AND ps.cib_redirected_at IS NOT NULL`,
    [trid],
  );
  const s = rows[0];
  if (!s) return;
  const nemZavarjuk = s.paid_at && !['mar_fizetve', 'visszateritve'].includes(tipus);
  const r = s.cib_result || {};
  const cim = s.title || 'fuvar';
  const e = ERTESITES[tipus];
  if (!nemZavarjuk) {
    await notifications.createNotification({
      user_id: s.shipper_id,
      type: e.type,
      title: e.title,
      body: e.body(cim),
      link: `/dashboard/fuvar/${s.job_id}`,
    }).catch(() => {});
  }
  const { rowCount: jelolve } = await db.query(
    'UPDATE payment_sessions SET cib_notified_at = NOW() WHERE payment_id = $1 AND cib_notified_at IS NULL', [trid],
  );
  if (!jelolve || nemZavarjuk) return;
  if (s.email) {
    const bankiAdatok = {
      trid, rc: r.rc || null, rt: r.rt || null, amo: Number(s.amount_huf), cur: s.currency || 'HUF', anum: r.anum || null,
    };
    const csoport = tipus === 'sikertelen' ? (rcCsoport(r.rc) || 'kapcsolat') : null;
    hatterben(() => email.sendFeePaymentFailedEmail({
      to: s.email,
      shipperName: s.full_name,
      jobTitle: cim,
      jobId: s.job_id,
      bankiAdatok,
      rcCsoport: csoport,
      tipus,
    }), 'cib_sikertelen');
  }
  realtime.emitToUser(s.shipper_id, 'cib:eredmeny', { job_id: s.job_id, trid, allapot: ERTESITES_ALLAPOT[tipus] || tipus });
}

/**
 * A feladó értesítése, hogy a kísérlete egyeztetés alatt áll (close_unknown)
 * — kísérletenként egyszer, a végső értesítéstől (cib_notified_at) függetlenül
 * (2026-10-03, PR-5). Előbb a tartós in-app sor, utána a jelölés.
 */
async function ertesitEgyeztetesrol(trid) {
  const { rows } = await db.query(
    `SELECT ps.job_id, ps.amount_huf, ps.currency, ps.cib_result, j.title, j.paid_at, j.shipper_id, u.email, u.full_name
       FROM payment_sessions ps JOIN jobs j ON j.id = ps.job_id JOIN users u ON u.id = j.shipper_id
      WHERE ps.payment_id = $1 AND ps.state = 'pending' AND ps.cib_state = 'close_unknown'
        AND ps.cib_redirected_at IS NOT NULL
        AND NOT (COALESCE(ps.cib_result, '{}'::jsonb) ? 'egyeztetes_ertesites_at')`,
    [trid],
  );
  const s = rows[0];
  if (!s || s.paid_at) return;
  const cim = s.title || 'fuvar';
  await notifications.createNotification({
    user_id: s.shipper_id,
    type: EGYEZTETES_ERTESITES.type,
    title: EGYEZTETES_ERTESITES.title,
    body: EGYEZTETES_ERTESITES.body(cim, trid),
    link: `/dashboard/fuvar/${s.job_id}`,
  }).catch(() => {});
  const { rowCount } = await db.query(
    `UPDATE payment_sessions
        SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('egyeztetes_ertesites_at', NOW())
      WHERE payment_id = $1 AND NOT (COALESCE(cib_result, '{}'::jsonb) ? 'egyeztetes_ertesites_at')`,
    [trid],
  );
  if (!rowCount) return;
  if (s.email) {
    const r = s.cib_result || {};
    hatterben(() => email.sendFeePaymentFailedEmail({
      to: s.email,
      shipperName: s.full_name,
      jobTitle: cim,
      jobId: s.job_id,
      bankiAdatok: {
        trid, rc: r.rc || null, rt: r.rt || null, amo: Number(s.amount_huf), cur: s.currency || 'HUF', anum: r.anum || null,
      },
      rcCsoport: null,
      tipus: 'egyeztetes',
    }), 'cib_egyeztetes');
  }
  realtime.emitToUser(s.shipper_id, 'cib:eredmeny', { job_id: s.job_id, trid, allapot: 'ellenorzes' });
}

// A riasztás teendője az ok szerint (2026-10-03, PR-5): a könyvelési árvánál
// a régi „lezárva (ANUM-mal) / nem zárult le" utasítás lehetetlen lépés volt.
const RIASZTAS_TEENDO = Object.freeze({
  konyvelesi_arva: 'a bank terhelt, de az ügylet már nem fizethető — a díjat a banknál vissza kell téríteni, majd az adminban „Visszatérítve" művelettel lezárni.',
  konyvelesi_hiba: 'a bank lezárta (terhelt), de a könyvelés ismételten elbukik — a kör visszalépéssel újrapróbál; ha nem áll helyre, nézd a naplót, vagy az adminban „Könyvelés".',
  nt_ismetlodo: 'a bank a lekérdezésre ismételten nem találja a tranzakciót (saját hiba gyanú: PID, kulcs, összeg) — MSGT32 nem ment ki, terhelés nincs, a kísérlet a határidő után magától lezárul, a feladót nem blokkolja.',
  lekerdezes_mezo_elteres: 'a bank lekérdezésre adott válasza ismételten eltér a tárolt adatoktól (saját hiba gyanú) — MSGT32 nem ment ki, terhelés nincs, a kísérlet a határidő után magától lezárul, a feladót nem blokkolja.',
  // 2026-10-04 (a PR-5 1. javítóköre)
  egyeztetes_nem_dontheto: 'a kétes zárás csak-olvasó egyeztetése ellentmondó választ adott (TO-tól eltérő elutasító kód, mezőeltérés, eltérő ANUM, vagy TO egy D05-tel — „már kiszolgálva" — kétes kísérletre) — a kártya TERHELT LEHET. A fuvar fagyasztva, újrafizetés nem indul; egyeztess a bankkal (TrID), és az adminban (Fizetések → CIB) rendezd.',
  egyeztetes_iras_utkozes: 'az egyeztetés szerint a bank lezárta (TERHELT), de a tétel állapota közben megváltozott (pl. admin-rendezés), így az eredmény nem rögzíthető — ellenőrizd a tétel állapotát és a bankot; ha a díj nem könyvelődött, visszatérítés kell.',
});
const KETES_TEENDO = 'kétes zárás — a kontakt rejtve, a fuvar fagyasztva; MSGT32 újraküldés NINCS. Az utolsó MSGT32 után '
  + 'CIB_EGYEZTETES_PERC (alapból 25) perccel csak-olvasó MSGT33 dönt automatikusan (TO → nem terhelt, D05 után nem; két, legalább '
  + '15 perc különbségű 00 ugyanazzal az ANUM-mal → lezárt); ha az sem dönt, egyeztess a bankkal, és az '
  + 'adminban (Fizetések → CIB) rendezd.';

/**
 * Riasztás (kétes, könyvelési árva / hiba, MSGT33-anomália) — TrID-enként és
 * okonként EGYSZER: Sentry error + e-mail a CIB_RIASZTAS_EMAIL-re + admin
 * in-app. Csak a TrID és a fuvar azonosítója megy ki, személyes adat nem.
 *
 * ⚠️ 2026-10-03 (PR-5): TARTÓS. Eddig a „riasztas_at" claim jött előbb, a
 * küldés utána a háttérben — egy átmeneti DB-hiba vagy összeomlás a kettő
 * között örökre elnyelte a riasztást, a (NULL-ra parkolt) sort pedig a kör
 * soha nem vette fel újra. Most: rövid, lejáró foglalás (két párhuzamos hívó
 * ne küldjön kettőt) → Sentry + a TARTÓS admin in-app értesítés → CSAK
 * EZUTÁN a jelölés; a levél a jelölés után a háttérben megy (egy lassú vagy
 * kieső levelező ne tartsa vissza a bérlet alatt futó zárásokat — a kiesését
 * a sendEmail maga riasztja). A kör és a söprés (riasztasSopres) a jelöletlen
 * tételt újra riasztja. A régi (PR-5 előtti) sorokon a „riasztas_at" a sor
 * akkori okára szóló riasztást jelenti.
 * @returns {Promise<boolean>} ment-e ki most riasztás
 */
async function riaszt(trid, ok) {
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_result = COALESCE(cib_result, '{}'::jsonb)
              || jsonb_build_object('riasztas_folyamatban', jsonb_build_object('ok', $2::text, 'at', NOW()))
      WHERE payment_id = $1
        AND NOT (COALESCE(cib_result->'riasztva', '{}'::jsonb) ? $2::text)
        AND NOT (NOT (COALESCE(cib_result, '{}'::jsonb) ? 'riasztva') AND COALESCE(cib_result, '{}'::jsonb) ? 'riasztas_at'
                 AND cib_result->>'ok' IS NOT DISTINCT FROM $2::text)
        AND NOT (COALESCE(cib_result->'riasztas_folyamatban', 'null'::jsonb) @> jsonb_build_object('ok', $2::text)
                 AND (cib_result->'riasztas_folyamatban'->>'at')::timestamptz > NOW() - make_interval(secs => $3::int))
      RETURNING job_id`,
    [trid, ok, RIASZTAS_CLAIM_MP],
  );
  if (!rows[0]) return false;
  const jobId = rows[0].job_id;
  const teendo = RIASZTAS_TEENDO[ok] || KETES_TEENDO;
  const uzenet = `[cib] 🚨 KÁRTYÁS FIZETÉS: ${p.maszkoltTrid(trid)} (${ok}) — ${teendo}`;
  console.error(uzenet);
  sentry(uzenet, 'error');
  const b = p.cibBeallitasok();
  // ⚠️ 2026-10-04 (a PR-5 1. javítóköre): a createNotification hibánál nem
  // dob, hanem null-t ad — eddig a jelölés ilyenkor is megtörtént, és a
  // söprés a tartós nyom nélküli riasztást soha nem pótolta. Most csak akkor
  // jelölünk, ha legalább egy admin-értesítés tartósan létrejött (vagy nincs
  // admin, akinek szólhatna); különben a foglalás a lejártáig (5 perc) áll, és
  // utána a kör / a söprés újra riaszt.
  let tartos = false;
  try {
    const { rows: adminok } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
    if (!adminok.length) tartos = true;
    for (const a of adminok) {
      // eslint-disable-next-line no-await-in-loop
      const n = await notifications.createNotification({
        user_id: a.id,
        type: 'cib_review',
        title: '🚨 Kártyás fizetés: teendő',
        body: `TrID: ${trid} — fuvar: ${jobId || '?'} (${ok}). ${teendo}`,
        link: '/admin#fizetesek',
      }).catch(() => null);
      if (n) tartos = true;
    }
  } catch { /* az admin-értesítés hiánya nem akaszthatja meg a riasztást */ }
  if (!tartos) {
    console.error(`[cib] ${p.maszkoltTrid(trid)} (${ok}): az admin-riasztás nem rögzült — a söprés újraküldi`);
    return false;
  }
  await db.query(
    `UPDATE payment_sessions
        SET cib_result = (COALESCE(cib_result, '{}'::jsonb) - 'riasztas_folyamatban')
              || jsonb_build_object(
                   'riasztva', COALESCE(cib_result->'riasztva', '{}'::jsonb) || jsonb_build_object($2::text, NOW()),
                   'riasztas_at', COALESCE(cib_result->'riasztas_at', to_jsonb(NOW())))
      WHERE payment_id = $1`,
    [trid, ok],
  );
  hatterben(() => email.sendCibRiasztasEmail({
    to: b.riasztasEmail || 'info@gofuvar.hu', trid, jobId, ok,
  }), 'cib_riasztas');
  return true;
}

/** A kétes (close_unknown) kísérlet: riasztás + a feladó értesítése, mindkettő egyszer. */
async function ketesLett(trid, ok) {
  await riaszt(trid, ok || 'close_unknown');
  await ertesitEgyeztetesrol(trid);
}

// ─────────────────────────────────────────────────────────────────────────
//  Könyvelés (a closed_ok UTÁN, újrapróbálhatóan, MSGT32 NÉLKÜL)
// ─────────────────────────────────────────────────────────────────────────
async function konyvel(trid, berlo = null) {
  let hiba = null;
  try {
    // A díj-sor a TÉNYLEGESEN lezárt kísérletre mutasson (2026-09-29, 1.
    // javítókör): két fül esetén az A-fázis upsertje az UTOLJÁRA indított
    // TRID-et írta bele, így az escrow-, kifizetési és admin-nézetek a vesztes
    // (not_closed) kísérletet mutatták. Fuvaronként egy closed_ok lehet
    // (részleges UNIQUE index), a könyvelés maga a payment_sessions-ön át fut.
    await db.query(
      `UPDATE escrow_transactions e SET barion_payment_id = s.payment_id
         FROM payment_sessions s
        WHERE s.payment_id = $1 AND s.cib_state = 'closed_ok' AND e.job_id = s.job_id
          AND e.barion_payment_id IS DISTINCT FROM s.payment_id`,
      [trid],
    );
    await confirmFeePayment(trid, 'Succeeded', { cib: true });
  } catch (err) {
    hiba = err;
    console.error(`[cib] könyvelési hiba ${p.maszkoltTrid(trid)}:`, err && err.message);
  }
  const { rows } = await db.query('SELECT state, job_id, shipper_id, cib_result FROM payment_sessions WHERE payment_id = $1', [trid]);
  const s = rows[0];
  if (!s) return;
  if (s.state === 'succeeded') {
    await db.query(
      `UPDATE payment_sessions SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('booked_at', NOW()),
              cib_next_action_at = NULL
        WHERE payment_id = $1 AND NOT (COALESCE(cib_result, '{}'::jsonb) ? 'booked_at')`,
      [trid],
    );
    realtime.emitToUser(s.shipper_id, 'cib:eredmeny', { job_id: s.job_id, trid, allapot: 'sikeres' });
    return;
  }
  if (s.state === 'needs_review') {
    // Könyvelési árva: a bank terhelt, az ügylet közben (egy őrt megkerülő
    // úton) nem fizethetővé vált. Kézi visszatérítés kell.
    await db.query(
      `UPDATE payment_sessions SET cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"konyvelesi_arva"}'::jsonb,
              cib_next_action_at = NULL
        WHERE payment_id = $1`,
      [trid],
    );
    await riaszt(trid, 'konyvelesi_arva');
    return;
  }
  // Még pending (kivétel vagy egy párhuzamos claim): a kör újra könyvel —
  // MSGT32 NÉLKÜL. ⚠️ 2026-10-03 (PR-5): tartós hibánál eddig 30 mp-enként
  // ugyanaz a Sentry-zaj ment, riasztás (levél, admin) soha — miközben a
  // vásárlót a bank megterhelte. Most visszalépés (30 s × 2^(n−1), legfeljebb
  // 30 perc), és a 3. hibánál (vagy a zárás után 10 perccel) egyszer riaszt.
  const szam = Number((s.cib_result && s.cib_result.konyveles_hiba) || 0) + (hiba ? 1 : 0);
  const varakozasMp = Math.min(30 * 2 ** Math.max(0, szam - 1), KONYVELES_VISSZALEPES_MAX_MP);
  const { rows: frissitett } = await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = NOW() + make_interval(secs => $4::int),
            cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('konyveles_hiba', $2::int)
      WHERE payment_id = $1 AND cib_state = 'closed_ok' AND state = 'pending'
        AND ($3::text IS NULL OR cib_lease_owner = $3 OR cib_lease_owner IS NULL)
      RETURNING (cib_result->>'closed_at')::timestamptz < NOW() - make_interval(mins => $5::int) AS regi`,
    [trid, szam, berlo, varakozasMp, KONYVELES_RIASZTAS_PERC],
  );
  const regi = !!(frissitett[0] && frissitett[0].regi);
  if (hiba && (szam >= KONYVELES_RIASZTAS_KUSZOB || regi)) await riaszt(trid, 'konyvelesi_hiba');
}

// ─────────────────────────────────────────────────────────────────────────
//  INDÍTÁS: POST /jobs/:id/pay CIB-ága (kétfázisú)
// ─────────────────────────────────────────────────────────────────────────

/**
 * A-fázis: rövid tranzakció a fuvarsorzár alatt — őrök, takarítás, korlát,
 * új TRID + session + díj-sor. A MSGT10 NEM itt megy ki.
 */
async function aFazis({ b, jobId, shipperId }) {
  const client = await db.pool.connect();
  let lezarva = false;
  const utana = [];
  try {
    await client.query('BEGIN');
    const { rows: jr } = await client.query(
      `SELECT id, shipper_id, carrier_id, status, paid_at, fee_consent_at, connection_fee_huf,
              accepted_price_huf, suggested_price_huf
         FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    const job = jr[0];
    if (!job || job.shipper_id !== shipperId || job.status !== 'accepted' || job.paid_at || !job.fee_consent_at) {
      return { valasz: hibaValasz('STATE_CHANGED') };
    }
    // ⚠️ 2026-09-29 (PR-2 1. javítókör, BLOKKOLÓ): szállító nélküli fuvar
    // NEM fizethető. A CIB-úton az elfogadás nem hoz létre függő munkamenetet
    // (ami a stub-úton a fióktörlést blokkolta), így a szállító az elfogadás
    // és a /pay között törölheti a fiókját: a fuvar `accepted` marad
    // `carrier_id = NULL`-lal (ON DELETE SET NULL). Eddig ezt semmi nem
    // szűrte — a feladót megterheltük egy nem létező kapcsolatért.
    if (!job.carrier_id) return { valasz: hibaValasz('STATE_CHANGED') };
    const { rows: sessions } = await client.query(
      `SELECT *, (created_at > NOW() - make_interval(secs => $2::int)) AS friss
         FROM payment_sessions WHERE job_id = $1 ORDER BY payment_id FOR UPDATE`,
      [jobId, INDITAS_BLOKK_MP],
    );
    if (sessions.some((s) => s.state === 'succeeded')) return { valasz: hibaValasz('STATE_CHANGED') };
    if (sessions.some((s) => s.state === 'needs_review')) return { valasz: hibaValasz('PAYMENT_RECONCILIATION_REQUIRED') };
    const cibFuggo = sessions.filter((s) => s.state === 'pending' && s.cib_state);
    const zarul = cibFuggo.find((s) => ['authorized', 'closing', 'closed_ok'].includes(s.cib_state));
    if (zarul) {
      if (zarul.cib_state !== 'closing') utana.push(() => hatterFeldolgoz(zarul.payment_id, 'pay'));
      return { valasz: hibaValasz('CIB_PAYMENT_FINISHING') };
    }
    if (cibFuggo.some((s) => s.cib_state === 'close_unknown')) return { valasz: hibaValasz('CIB_PAYMENT_REVIEW') };
    if (cibFuggo.some((s) => s.cib_state === 'initializing' && s.friss)) return { valasz: hibaValasz('PAYMENT_STARTING') };

    // Korlát fuvaronként (ugyanazon feladó kísérletei): a foglalt-TRID miatti
    // automatikus újrapróbák nem számítanak.
    const { rows: [korlat] } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS ora,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int AS nap
         FROM payment_sessions
        WHERE job_id = $1 AND shipper_id = $2 AND cib_state IS NOT NULL
          AND COALESCE(cib_result->>'ok', '') <> 'trid_foglalt'`,
      [jobId, shipperId],
    );
    if (korlat.ora >= b.hangolok.maxInditasOrankent || korlat.nap >= b.hangolok.maxInditasNaponta) {
      return { valasz: hibaValasz('PAYMENT_RETRY_LIMIT') };
    }

    // Takarítás: a fel nem használt (ready) és a régi (legalább 60 s-os)
    // initializing kísérlet felülíródik. MSGT20 nem készült → nem terhelhető.
    for (const s of cibFuggo.filter((x) => x.cib_state === 'ready' || x.cib_state === 'initializing')) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `UPDATE payment_sessions SET cib_state = 'abandoned', cib_next_action_at = NULL,
                cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"felulirva"}'::jsonb,
                cib_lease_until = NULL, cib_lease_owner = NULL
          WHERE payment_id = $1`,
        [s.payment_id],
      );
      // eslint-disable-next-line no-await-in-loop
      await logPaymentEvent({
        paymentId: s.payment_id, status: 'Expired', eventType: 'webhook', jobId,
        totalAmount: Number(s.amount_huf), currency: s.currency || 'HUF',
        summary: `Expired: a CIB-kísérletet egy új fizetés felülírta — fuvar ${jobId}`, processed: true,
      }, client);
    }
    // A függő szimulált stub-session (szolgáltatóváltás) lezárul — a 090-es
    // feltételekkel: sikeres jelzés és bizonylat nélkül.
    await client.query(
      `UPDATE payment_sessions s SET state = 'closed', closed_reason = 'provider_switch', settled_at = NOW()
        WHERE s.job_id = $1 AND s.state = 'pending' AND s.is_simulated
          AND NOT EXISTS (SELECT 1 FROM payment_events e WHERE e.payment_id = s.payment_id AND e.status = 'Succeeded')
          AND NOT EXISTS (SELECT 1 FROM fee_payment_receipts r WHERE r.payment_id = s.payment_id)`,
      [jobId],
    );
    // Ismeretlen / valódi, nem CIB függő session → előbb egyeztetés (mint ma).
    const { rowCount: ismeretlen } = await client.query(
      `SELECT 1 FROM payment_sessions WHERE job_id = $1 AND state = 'pending' AND cib_state IS NULL`, [jobId],
    );
    const { rows: escrow } = await client.query('SELECT status FROM escrow_transactions WHERE job_id = $1', [jobId]);
    if (ismeretlen > 0 || (escrow[0] && escrow[0].status !== 'held')) {
      return { valasz: hibaValasz('PAYMENT_RECONCILIATION_REQUIRED') };
    }

    const fee = job.connection_fee_huf != null
      ? Number(job.connection_fee_huf)
      : calculateConnectionFee(job.accepted_price_huf || job.suggested_price_huf || 0);
    if (!(fee > 0)) return { valasz: hibaValasz('STATE_CHANGED') };

    // A TS a DB órájából, ugyanebben a tranzakcióban.
    const ts = await p.lekerTs(client, b.tsIdozona);
    let trid = null;
    for (let i = 0; i < 5 && !trid; i += 1) {
      const jelolt = p.ujTrid();
      // A CIB felé történő adattovábbítási nyilatkozat időpontja (2026-10-01,
      // a bank írásos válasza: a hozzájárulás kötelező) a kísérleten, a DB
      // órájából — a hívó (a /pay) a nyilatkozat nélkül ide el sem jut.
      // eslint-disable-next-line no-await-in-loop
      const ins = await client.query(
        `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, currency,
                                       provider, is_simulated, state, cib_state, cib_next_action_at, cib_result)
         VALUES ($1, $2, $3, $4, $5, 'HUF', 'cib', FALSE, 'pending', 'initializing',
                 NOW() + make_interval(secs => $6::int),
                 $7::jsonb || jsonb_build_object('hozzajarulas_at', NOW()))
         ON CONFLICT (payment_id) DO NOTHING RETURNING payment_id`,
        [jelolt, jobId, shipperId, job.carrier_id, fee, INDITAS_ELHAGYOTT_MP, JSON.stringify({ ts })],
      );
      if (ins.rowCount) trid = jelolt;
    }
    if (!trid) throw new Error('Nem sikerült egyedi TRID-et foglalni.');
    // A díj-sor a mostani kísérletre mutat. A banki link egyszer használatos
    // — sehol nem tároljuk (barion_gateway_url NULL).
    await client.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, barion_gateway_url, carrier_share_huf, platform_share_huf)
       VALUES ($1, $2, 'held', $3, NULL, 0, $2)
       ON CONFLICT (job_id) DO UPDATE SET
         amount_huf = EXCLUDED.amount_huf, barion_payment_id = EXCLUDED.barion_payment_id,
         barion_gateway_url = NULL, carrier_share_huf = 0,
         platform_share_huf = EXCLUDED.platform_share_huf, held_at = NOW()`,
      [jobId, fee, trid],
    );
    await client.query('UPDATE jobs SET connection_fee_huf = $1 WHERE id = $2 AND connection_fee_huf IS NULL', [fee, jobId]);
    // Az üzenet a COMMIT ELŐTT épül: egy szabálytalan mező ne hagyjon árva
    // „initializing" sort.
    const mezok = p.msgt10Mezok({
      pid: b.pid,
      trid,
      uid: p.uidAlnev(shipperId, b.hmacTitok),
      amo: fee,
      ts,
      url: b.returnUrl,
      extra01JobId: b.extra01 ? jobId : undefined,
    });
    await client.query('COMMIT');
    lezarva = true;
    return {
      trid, fee, mezok, session: { payment_id: trid, amount_huf: fee, currency: 'HUF' },
    };
  } finally {
    if (!lezarva) await client.query('ROLLBACK').catch(() => {});
    client.release();
    for (const f of utana) f();
  }
}

/** Egy kísérlet lezárása banki terhelés nélkül (abandoned / init_failed). */
async function inditasiVegallapot(trid, uj, varAllapot, ok, tobb = {}) {
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = $2, cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb
      WHERE payment_id = $1 AND cib_state = $3 AND state = 'pending'`,
    [trid, uj, varAllapot, JSON.stringify({ ok, ...tobb })],
  );
  if (rowCount) await vegallapotEsemeny(trid).catch((err) => console.error('[cib] végállapot-esemény hiba:', err && err.message));
  return rowCount > 0;
}

/**
 * A kártyás díjfizetés indítása. Visszaad: `{ http, body }` — hibánál csak
 * kód és fix magyar szöveg, banki szöveg és belső hiba soha.
 *
 * Az `adatkezelesiHozzajarulas` a feladó nyilatkozata a CIB felé történő
 * adattovábbításról (2026-10-01): a route már a DB-írások ELŐTT ellenőrzi,
 * itt másodszor is — egy új hívó se indíthasson nélküle banki kísérletet.
 */
/** Szünetel-e az új kártyás fizetés (CIB_UJ_FIZETES_TILTVA, fail-closed)? */
function ujFizetesSzunetel() {
  const b = p.cibBeallitasok();
  return b.allapot === 'teljes' && !!b.ujFizetesTiltva;
}

async function inditCibDijFizetes({
  entityType = 'job', entityId, shipperId, adatkezelesiHozzajarulas,
}) {
  if (entityType !== 'job') return hibaValasz('CIB_UNAVAILABLE');
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes') return hibaValasz('CIB_UNAVAILABLE');
  // 2026-10-03 (PR-5, C2): a szünet-kapcsoló alatt új engedélyeztetés nem
  // indul; a meglévő kísérleteket a kör és a zárás befejezi.
  // ⚠️ 2026-10-04 (a PR-5 2. javítóköre): a szünet a nyilatkozat ELŐTT dönt —
  // ha a route kuponra engedte át a kérést, de a kupon a beváltásig elfogyott,
  // eddig 400 CIB_CONSENT_REQUIRED jött a szerződés szerinti 503 CIB_PAUSED
  // helyett. Banki kísérlet nyilatkozat nélkül így sem indul.
  if (b.ujFizetesTiltva) return hibaValasz('CIB_PAUSED');
  if (adatkezelesiHozzajarulas !== true) return hibaValasz('CIB_CONSENT_REQUIRED');
  // Nem engedélyeztetünk pénzt, ha nincs, ami lezárja (a lekérdező kör ezen
  // a példányon nem fut), vagy ha a bank-kapcsolat épp rossz.
  if (allapot.leallas || !szivveresFriss() || megszakitoNyitva()) return hibaValasz('PAYMENT_TEMPORARILY_UNAVAILABLE');
  return munkaban(() => inditas({ b, entityId, shipperId }));
}

async function inditas({ b, entityId, shipperId }) {
  const kezd = Date.now();
  for (let kiserlet = 1; kiserlet <= 3; kiserlet += 1) {
    // Leállás közben (SIGTERM) új engedélyeztetés nem indul — az RC=02 utáni
    // újrapróba sem (2026-09-29, PR-2/C): a lezárni képes példány épp
    // megszűnik, egy most jóváhagyott tranzakció a következő példányra várna.
    if (kiserlet > 1 && allapot.leallas) return hibaValasz('PAYMENT_TEMPORARILY_UNAVAILABLE');
    // eslint-disable-next-line no-await-in-loop
    const a = await aFazis({ b, jobId: entityId, shipperId });
    if (a.valasz) return a.valasz;
    const maradek = b.hangolok.inditasOsszkeretMs - (Date.now() - kezd);
    if (maradek <= 0) {
      // eslint-disable-next-line no-await-in-loop
      await inditasiVegallapot(a.trid, 'init_failed', 'initializing', 'init_idokeret');
      return hibaValasz('CIB_INIT_FAILED');
    }
    // B-fázis: a MSGT10 zár és tranzakció NÉLKÜL.
    // eslint-disable-next-line no-await-in-loop
    const v = await kliens.marketHivas({
      beallitasok: b, mezok: a.mezok, idokeretMs: Math.min(b.hangolok.httpIdokeretMs, maradek),
    });
    const k = p.inditasKimenet(v, a.session, b.pid);
    megszakitoJelez(!!k.megszakito, !!v.mezok);
    // 2026-10-03 (PR-5): a MSGT10-re kapott D-kód (pl. kötelező mező, nem
    // engedélyezett üzenettípus az éles terminálon) eddig néma volt.
    // A D04 (a bank most foglalt) önmagában nem rendszerhiba: csak számít.
    if (k.bankRc === 'D04') bankRendszerJel(true, 'MSGT10 D04');
    else if (k.bankRc && p.bankKodOsztaly(k.bankRc) === 'bank_D') bankRendszerJel(true, `MSGT10 ${k.bankRc}`, { azonnal: true });
    else if (v.hibaOsztaly === 'http') bankRendszerJel(true, 'MSGT10 HTTP-hiba RC nélkül');
    else if (v.mezok) bankRendszerJel(false);
    if (k.kimenet === 'kesz') {
      // eslint-disable-next-line no-await-in-loop
      return keszreAllit({ b, trid: a.trid, fee: a.fee });
    }
    // eslint-disable-next-line no-await-in-loop
    await inditasiVegallapot(a.trid, 'init_failed', 'initializing', k.ok || 'init_bank_S',
      k.rc || k.bankRc ? { bank_rc: k.rc || k.bankRc } : {});
    if (k.kimenet === 'trid_foglalt' && kiserlet < 3) continue;
    console.warn(`[cib] MSGT10 sikertelen ${p.maszkoltTrid(a.trid)}: ${k.ok}${k.bankRc ? ` (${k.bankRc})` : ''}`);
    return hibaValasz(k.foglalt ? 'CIB_BUSY' : 'CIB_INIT_FAILED');
  }
  return hibaValasz('CIB_INIT_FAILED');
}

/** MSGT11 RC=00 után: ready + egyszer használatos hop-link. */
async function keszreAllit({ b, trid, fee }) {
  const token = crypto.randomBytes(32).toString('base64url');
  // A fuvarnak a banki hívás UTÁN is fizethetőnek kell lennie (közben
  // lemondhatták / kuponnal fizethették — a MSGT10 alatt nincs zár), és
  // szállítója is kell legyen (2026-09-29, 1. javítókör: a szállító
  // fióktörlése a MSGT10 alatt is bekövetkezhet).
  const { rowCount } = await db.query(
    `UPDATE payment_sessions s
        SET cib_state = 'ready', cib_hop_hash = $2,
            cib_hop_expires_at = NOW() + make_interval(secs => $3::int),
            cib_next_action_at = NOW() + make_interval(secs => $3::int + 5)
      WHERE s.payment_id = $1 AND s.cib_state = 'initializing' AND s.state = 'pending'
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id AND j.status = 'accepted' AND j.paid_at IS NULL
                     AND j.carrier_id IS NOT NULL)
        AND ${testverZar('s', 4)}`,
    [trid, sha256(token), b.hangolok.hopTtlMp, BLOKKOLO],
  );
  if (!rowCount) {
    await inditasiVegallapot(trid, 'abandoned', 'initializing', 'nem_fizetheto');
    return hibaValasz('STATE_CHANGED');
  }
  const url = `${b.apiOrigin}/payments/cib/tovabb/${token}`;
  return {
    http: 200,
    body: {
      provider: 'cib', trid, fee_huf: fee, redirect_url: url, gateway_url: url, is_stub: false, reused: false,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  HOP: GET /payments/cib/tovabb/:token → a bank fizetőoldala (MSGT20)
// ─────────────────────────────────────────────────────────────────────────
/**
 * SQL-feltétel: a kísérlet fuvarjának nincs MÁSIK, épp záruló / kétes /
 * lezárt (de nem könyvelt) vagy felülvizsgálandó kísérlete (2026-10-03,
 * PR-5). A /pay ezt már szűrte, a hop és a kész-állapot nem: egy közben
 * jóváhagyott testvér mellett a vásárló egy fölösleges második banki
 * zárolást nyitott (a MSGT32 a zárási jog miatt úgysem ment volna ki).
 * A `$n` paraméter a BLOKKOLO állapotlista.
 */
function testverZar(alias, n) {
  return `NOT EXISTS (SELECT 1 FROM payment_sessions o
     WHERE o.job_id = ${alias}.job_id AND o.payment_id <> ${alias}.payment_id
       AND ((o.state = 'pending' AND o.cib_state = ANY($${n}::text[])) OR o.state = 'needs_review'))`;
}

async function hopFelhasznal(token) {
  const web = webBase();
  const ismeretlen = { status: 303, location: `${web}/fizetes/eredmeny?hiba=link` };
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes' || typeof token !== 'string' || !HOP_TOKEN_RE.test(token)) return ismeretlen;
  const hash = sha256(token);
  // Szállító nélküli fuvarra (a szállító közben törölte a fiókját) nem
  // visszük a bankhoz a vásárlót (2026-09-29, 1. javítókör). A szünet-kapcsoló
  // alatt (2026-10-03, PR-5) a még fel nem használt link sem nyit új banki
  // zárolást.
  const { rows } = b.ujFizetesTiltva ? { rows: [] } : await db.query(
    `UPDATE payment_sessions s
        SET cib_state = 'redirected', cib_redirected_at = NOW(),
            cib_next_action_at = NOW() + make_interval(secs => $2::int)
      WHERE s.cib_hop_hash = $1 AND s.cib_state = 'ready' AND s.state = 'pending'
        AND s.cib_hop_expires_at > NOW()
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id AND j.status = 'accepted' AND j.paid_at IS NULL
                     AND j.carrier_id IS NOT NULL)
        AND ${testverZar('s', 3)}
      RETURNING payment_id, job_id`,
    [hash, ELSO_LEKERDEZES_MP, BLOKKOLO],
  );
  if (rows[0]) {
    const url = p.customerUrl(b, rows[0].payment_id);
    await kliens.naploz({
      trid: rows[0].payment_id, irany: 'bongeszo_ki', msgt: 20, endpoint: 'customer', raw: url.slice(url.indexOf('?') + 1),
    }).catch((err) => console.error('[cib] MSGT20 naplózás hiba:', err && err.message));
    return { status: 302, location: url };
  }
  // Felhasznált, lejárt vagy már nem fizethető link: a böngésző a
  // fuvaroldalra kerül, és a banki oldal NEM töltődik újra.
  const { rows: regi } = await db.query(
    `SELECT payment_id, job_id, cib_state, (cib_hop_expires_at <= NOW()) AS lejart
       FROM payment_sessions WHERE cib_hop_hash = $1`,
    [hash],
  );
  if (!regi[0] || !regi[0].job_id) return ismeretlen;
  if (regi[0].cib_state === 'ready') {
    let ok = 'nem_fizetheto';
    if (regi[0].lejart) ok = 'hop_lejart';
    else if (b.ujFizetesTiltva) ok = 'szunet';
    await inditasiVegallapot(regi[0].payment_id, 'abandoned', 'ready', ok);
  }
  return { status: 303, location: `${web}/dashboard/fuvar/${regi[0].job_id}?fizetes=link-lejart` };
}

// ─────────────────────────────────────────────────────────────────────────
//  VISSZATÉRÉS: GET /payments/cib/vissza?<nyers MSGT21>
// ─────────────────────────────────────────────────────────────────────────
const VISSZATERHETO = Object.freeze(['redirected', 'authorized', 'closing', 'closed_ok', 'close_unknown',
  'failed', 'expired', 'not_closed']);

/**
 * A böngésző visszatérése. A NYERS query-t fejtjük vissza (a req.query a
 * '+'-t szóközzé alakítaná) — nem-bankValasz módban: a böngészőben a
 * titkosítatlan RC=Sxx szöveg nem banki ítélet, hanem érvénytelen üzenet.
 * Hamis / idegen / ismeretlen üzenetre semmit nem dolgozunk fel.
 * @returns {Promise<{status:number, location?:string}>}
 */
async function visszateres(originalUrl) {
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes') return { status: 404 };
  const web = webBase();
  const hibas = { status: 303, location: `${web}/fizetes/eredmeny?hiba=azonositas` };
  const i = typeof originalUrl === 'string' ? originalUrl.indexOf('?') : -1;
  const raw = i >= 0 ? originalUrl.slice(i + 1) : '';
  // ⚠️ 2026-10-03 (PR-5/B): ez egy PUBLIKUS, hitelesítés nélküli végpont. Az
  // azonosíthatatlan kérés (szemét, idegen kulcs, ismeretlen TrID) eddig
  // MINDEN alkalommal tartós cib_messages sort írt, 13 hónapos megőrzéssel —
  // egy IP-ről percenként 60 sor, néhány IP-vel napi több tíz MB, ami a
  // Neon-tárkvótát és vele MINDEN írást (a fizetésekét is) veszélyeztette.
  // Most csak a sajátként azonosított kísérlet kerül a naplóba (a bank
  // kivizsgálásához az kell); a többi memória-számláló + ritkított napló.
  const ervenytelen = async (osztaly, trid = null) => {
    if (trid && await sajatKiserlet(trid)) {
      await naplozVisszaterest(trid, kanonikusVisszateres(raw) || raw.slice(0, HIBAS_VISSZATERES_NAPLO_MAX), osztaly);
    } else {
      szemetVisszateres(osztaly);
    }
    if (Date.now() - allapot.visszateresRiasztas >= VISSZATERES_RIASZTAS_KOZ_MS) {
      allapot.visszateresRiasztas = Date.now();
      sentry('[cib] érvénytelen banki visszatérés (MSGT21)', 'warning');
    }
  };
  if (!raw || raw.length > 4000) {
    await ervenytelen('visszafejtes');
    return hibas;
  }
  let mezok;
  try {
    mezok = eki.ekiDecrypt(raw, b.kulcs);
  } catch {
    await ervenytelen('visszafejtes');
    return hibas;
  }
  const trid = typeof mezok.TRID === 'string' ? mezok.TRID.trim() : '';
  if (mezok.MSGT !== '21' || mezok.PID !== b.pid || !p.TRID_RE.test(trid)) {
    await ervenytelen('mezo_elteres', p.TRID_RE.test(trid) ? trid : null);
    return hibas;
  }
  const { rows } = await db.query(
    `UPDATE payment_sessions SET cib_returned_at = COALESCE(cib_returned_at, NOW())
      WHERE payment_id = $1 AND provider = 'cib' AND cib_state = ANY($2::text[])
      RETURNING payment_id`,
    [trid, VISSZATERHETO],
  );
  if (!rows[0]) {
    await ervenytelen('mezo_elteres', trid);
    return hibas;
  }
  // A banki adatsor kanonikus alakja (PID + CRYPTO + DATA): a vásárló által
  // hozzáfűzött paraméter nem kerül a naplóba; ugyanaz az üzenet TrID-enként
  // egyszer (a visszajátszás nem hízlalja a táblát).
  await naplozVisszaterest(trid, kanonikusVisszateres(raw) || raw, null);
  // Az első MSGT33 azonnal megy (a köz a motorban véd a visszajátszás ellen).
  hatterFeldolgoz(trid, 'visszateres');
  return { status: 303, location: `${web}/fizetes/eredmeny?e=${encodeURIComponent(eredmenyToken(trid))}` };
}

/** Létező, saját CIB-kísérlet-e a TrID (csak ilyenhez írunk banki naplót)? */
async function sajatKiserlet(trid) {
  const { rowCount } = await db.query(
    "SELECT 1 FROM payment_sessions WHERE payment_id = $1 AND provider = 'cib' AND cib_state IS NOT NULL", [trid],
  );
  return rowCount > 0;
}

/**
 * A visszatérő query banki része, a bank sorrendjében: PID, CRYPTO, DATA (a
 * nyers, kódolt DATA-val). Hiányos üzenetnél null.
 */
function kanonikusVisszateres(raw) {
  const mezok = {};
  for (const resz of String(raw || '').replace(/^\?/, '').split('&')) {
    const j = resz.indexOf('=');
    if (j < 1) continue;
    const nev = resz.slice(0, j).toUpperCase();
    if (['PID', 'CRYPTO', 'DATA'].includes(nev) && !(nev in mezok)) mezok[nev] = resz.slice(j + 1);
  }
  if (!mezok.PID || !mezok.CRYPTO || !mezok.DATA) return null;
  return `PID=${mezok.PID}&CRYPTO=${mezok.CRYPTO}&DATA=${mezok.DATA}`;
}

/**
 * MSGT21-naplósor egy SAJÁT kísérlethez — ugyanaz az üzenet TrID-enként
 * egyszer, és TrID-enként legfeljebb VISSZATERES_NAPLO_MAX_TRID sor.
 */
async function naplozVisszaterest(trid, raw, hibaOsztaly) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n, BOOL_OR(raw = $2) AS azonos FROM cib_messages
        WHERE payment_id = $1 AND direction = 'bongeszo_be' AND msgt = 21`,
      [trid, raw],
    );
    if (rows[0].azonos || rows[0].n >= VISSZATERES_NAPLO_MAX_TRID) return;
    await kliens.naploz({
      trid, irany: 'bongeszo_be', msgt: 21, endpoint: 'vissza', raw, hibaOsztaly,
    });
  } catch (err) {
    console.error('[cib] MSGT21 naplózás hiba:', err && err.message);
  }
}

/**
 * Az azonosíthatatlan visszatérés csak SZÁMLÁLÓ (memória) + percenként
 * legfeljebb egy összesítő naplósor — DB-írás nincs.
 */
function szemetVisszateres(osztaly) {
  const sz = allapot.szemetVisszateres;
  sz.osszes += 1;
  sz.ablak[osztaly] = (sz.ablak[osztaly] || 0) + 1;
  if (Date.now() - sz.utolsoNaplo >= VISSZATERES_RIASZTAS_KOZ_MS) {
    console.warn(`[cib] azonosíthatatlan visszatérés(ek) az utolsó összesítés óta: ${JSON.stringify(sz.ablak)} `
      + `(az indulás óta összesen ${sz.osszes}) — nem naplózzuk a DB-be`);
    sz.utolsoNaplo = Date.now();
    sz.ablak = {};
  }
}

/** Az indulás óta érkezett azonosíthatatlan visszatérések száma (megfigyelés, teszt). */
function szemetVisszateresek() {
  return allapot.szemetVisszateres.osszes;
}

// ─────────────────────────────────────────────────────────────────────────
//  EREDMÉNY: GET /payments/cib/eredmeny?e=<token> (publikus, token-kapus)
// ─────────────────────────────────────────────────────────────────────────
async function eredmenyAllapot(token) {
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes') return null;
  const trid = eredmenyTokenEllenoriz(token);
  if (!trid) return null;
  const { rows } = await db.query(
    `SELECT ps.*, j.status AS job_status, j.paid_at AS job_paid_at,
            (ps.cib_last_query_at IS NULL OR ps.cib_last_query_at < NOW() - make_interval(secs => $2::int)
              -- 2026-10-03 (PR-5): a visszatérés után az első lekérdezés soron
              -- kívüli (a motor 5 mp-es kalapálás-fékkel kezeli).
              OR (ps.cib_returned_at IS NOT NULL AND ps.cib_last_query_at < ps.cib_returned_at)
              OR (ps.cib_returned_at IS NOT NULL AND ps.cib_next_action_at <= NOW())) AS lekerdezheto,
            (ps.cib_next_action_at IS NULL OR ps.cib_next_action_at <= NOW()) AS esedekes,
            EXISTS (SELECT 1 FROM payment_sessions o WHERE o.job_id = ps.job_id
                     AND ((o.state = 'pending' AND o.cib_state = ANY($3::text[])) OR o.state = 'needs_review')) AS blokkolt,
            GREATEST(ps.created_at, ps.settled_at, ps.cib_last_query_at, ps.cib_returned_at, ps.cib_redirected_at) AS frissult
       FROM payment_sessions ps LEFT JOIN jobs j ON j.id = ps.job_id
      WHERE ps.payment_id = $1 AND ps.provider = 'cib' AND ps.cib_state IS NOT NULL`,
    [trid, Math.round(b.hangolok.lekerdezesKozMs / 1000), BLOKKOLO],
  );
  const s = rows[0];
  if (!s) return null;
  const allapotSzo = lekepez(s);
  // Az eredmény-oldal 3 s-onként kérdez: a banki lekérdezést a TRID-enkénti
  // köz, a zárást és a könyvelést a sor saját ütemezése (cib_next_action_at)
  // fékezi. ⚠️ 2026-09-29 (1. javítókör): eddig a closed_ok (és az
  // authorized) sor MINDEN hívásra háttérmunkát indított — egy tartós
  // könyvelési hiba alatt 3 s-onként újrakönyvelt (VIES, Neon), egy D03 utáni
  // zárást pedig a 30–60 s-os visszalépés előtt megismételt.
  if (allapotSzo === 'feldolgozas' && s.state === 'pending'
      && ((s.cib_state === 'redirected' && s.lekerdezheto)
        || (['authorized', 'closed_ok'].includes(s.cib_state) && s.esedekes))) {
    hatterFeldolgoz(trid, 'eredmeny');
  }
  const ujraFizetheto = ['sikertelen', 'nem_terhelt'].includes(allapotSzo)
    && s.job_status === 'accepted' && !s.job_paid_at && !s.blokkolt;
  return {
    allapot: allapotSzo,
    ...adatsor(s),
    job_id: s.job_id,
    ujra_fizetheto: ujraFizetheto,
    frissult: s.frissult ? new Date(s.frissult).toISOString() : null,
  };
}

/** A fuvar díja (a /pay A-fázisával azonos képlet). */
function fuvarDij(job) {
  return job.connection_fee_huf != null
    ? Number(job.connection_fee_huf)
    : calculateConnectionFee(job.accepted_price_huf || job.suggested_price_huf || 0);
}

/** Elérte-e a feladó ennél a fuvarnál az indítási korlátot (az A-fázis számlálása)? */
async function inditasiKorlatElerve(jobId, shipperId, b) {
  const { rows: [korlat] } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS ora,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int AS nap
       FROM payment_sessions
      WHERE job_id = $1 AND shipper_id = $2 AND cib_state IS NOT NULL
        AND COALESCE(cib_result->>'ok', '') <> 'trid_foglalt'`,
    [jobId, shipperId],
  );
  return korlat.ora >= b.hangolok.maxInditasOrankent || korlat.nap >= b.hangolok.maxInditasNaponta;
}

/**
 * GET /jobs/:id/fee-payment — a fuvar kártyás díjfizetésének állapota a
 * FELADÓNAK (a szállító soha nem kapja: a feladó fizetési munkamenete).
 *
 * 2026-10-03 (PR-5, C3/C4): `pay_blocked_reason` — null | 'masik_kiserlet_
 * folyamatban' | 'probalkozasi_limit' | 'szunetel' | 'nem_fizetheto' — és
 * `kupon_elerheto`. A nem végső CIB-kísérlet akkor is látszik (és blokkol),
 * ha a feladó útja közben stub lett (allowlist-változás) vagy a CIB-konfig
 * hiányzik: eddig a felület ilyenkor fizetést kínált, ami 409-re futott.
 */
async function dijFizetesAllapot(job) {
  const paymentProvider = require('./paymentProvider');
  let ut;
  try {
    ut = paymentProvider.fizetesiUt(job.shipper_id);
  } catch {
    ut = 'hibas';
  }
  const { rows } = await db.query(
    `SELECT * FROM payment_sessions WHERE job_id = $1 AND cib_state IS NOT NULL
      ORDER BY created_at DESC, payment_id DESC LIMIT 5`,
    [job.id],
  );
  const nyitott = rows.find((s) => s.state === 'pending' && (NEM_VEGSO.includes(s.cib_state) || s.cib_state === 'closed_ok'));
  const blokkolt = rows.some((s) => (s.state === 'pending' && BLOKKOLO.includes(s.cib_state)) || s.state === 'needs_review');
  // A legújabb, a vásárlónak érdemi eredményű kísérlet. A jóváhagyott, de le
  // nem zárt kísérletnek nincs saját RC-je (a MSGT33 00-ját nem a
  // végeredményként tároljuk) — 2026-10-01 (a PR-4 1. javítóköre): eddig egy
  // RÉGEBBI, RC-vel elutasított kísérlet takarta el, és a kártya annak az
  // „elutasítás" szövegét mutatta a friss, jóváhagyott fizetés helyett.
  const utolso = rows.find((s) => (s.cib_result && typeof s.cib_result.rc === 'string') || jovahagyottNemZart(s)
      || NEM_TERHELT_OKOK.includes(s.cib_result && s.cib_result.ok))
    || rows.find((s) => ['failed', 'expired', 'not_closed', 'closed_ok'].includes(s.cib_state));
  const fizetheto = job.status === 'accepted' && !job.paid_at && !!job.carrier_id;
  const kupon = fizetheto && !blokkolt
    ? await require('./gamification').vanFelhasznalhatoKupon(job.shipper_id, fuvarDij(job))
    : false;
  let tiltas = null;
  if (!fizetheto) tiltas = 'nem_fizetheto';
  else if (blokkolt) tiltas = 'masik_kiserlet_folyamatban';
  else if (!kupon) {
    // A kupon a bankot nem érinti: alatta se a szünet, se a korlát nem számít.
    if (ut !== 'cib' && nyitott) tiltas = 'masik_kiserlet_folyamatban';
    else if (ut === 'hibas') tiltas = 'szunetel';
    else if (ut === 'cib') {
      const b = p.cibBeallitasok();
      if (b.ujFizetesTiltva) tiltas = 'szunetel';
      else if (await inditasiKorlatElerve(job.id, job.shipper_id, b)) tiltas = 'probalkozasi_limit';
    }
  }
  return {
    provider_kind: ut === 'stub' ? 'stub' : 'cib',
    can_pay: tiltas === null,
    pay_blocked_reason: tiltas,
    kupon_elerheto: kupon,
    open_attempt: nyitott ? {
      trid: nyitott.payment_id,
      started_at: new Date(nyitott.created_at).toISOString(),
      allapot: lekepez(nyitott),
    } : null,
    last_result: utolso ? { ...adatsor(utolso), allapot: lekepez(utolso) } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  A FELDOLGOZÓ MOTOR (visszatérés / kör / eredmény-oldal / admin)
// ─────────────────────────────────────────────────────────────────────────

async function berletFelszabadit(trid, berlo) {
  await db.query(
    `UPDATE payment_sessions SET cib_lease_until = NULL, cib_lease_owner = NULL
      WHERE payment_id = $1 AND cib_lease_owner = $2`,
    [trid, berlo],
  );
}

/**
 * A bérlet megújítása egy sor feldolgozása ELŐTT (a lekérdező kör sorosan
 * halad, 2026-09-29, 1. javítókör). Csak akkor sikerül, ha a bérlő még mi
 * vagyunk (senki nem vette át és nem engedte el közben), és a sor még függő.
 * @returns {Promise<object|null>} a FRISS sor (db_most-tal), vagy null
 */
async function berletMegujit(trid, berlo) {
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_lease_until = NOW() + make_interval(secs => $3::int)
      WHERE payment_id = $1 AND cib_lease_owner = $2 AND state = 'pending' AND cib_state IS NOT NULL
      RETURNING *, NOW() AS db_most`,
    [trid, berlo, berletMp()],
  );
  return rows[0] || null;
}

/**
 * Egy TRID feldolgozása a bérlet birtokában. Ha más dolgozik rajta (élő
 * bérlet), azonnal kilép. Soha nem fut belőle két példány egy TRID-en.
 */
async function feldolgoz(trid, forras = 'kulso') {
  if (allapot.leallas) return { kihagyva: 'leallas' };
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes' || !p.TRID_RE.test(String(trid || ''))) return { kihagyva: 'konfig' };
  // A bérlettől a felszabadításig egy munkaegység: a leállás megvárja.
  return munkaban(() => feldolgozBerlettel(trid, forras));
}

async function feldolgozBerlettel(trid, forras) {
  const berlo = ujBerlo();
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_lease_until = NOW() + make_interval(secs => $3::int), cib_lease_owner = $2
      WHERE payment_id = $1 AND provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL
        AND (cib_lease_until IS NULL OR cib_lease_until < NOW())
      RETURNING *, NOW() AS db_most`,
    [trid, berlo, berletMp()],
  );
  if (!rows[0]) return { kihagyva: 'berelt' };
  const sor = rows[0];
  try {
    // ⚠️ 2026-10-01 (a PR-4 1. javítóköre): egy jóváhagyott (zárandó) vagy
    // lezárt (könyvelendő) sor SAJÁT ütemezése (cib_next_action_at) előtt
    // ezen a — kívülről indítható — úton nem dolgozunk. A publikus
    // visszatérés (a MSGT21 visszajátszása) és a /pay „zárul" ága eddig
    // megkerülte az S05/S04/D03 utáni várakozást: két visszajátszás néhány
    // ms alatt elküldte a maradék két MSGT32-t, és a javítható S05-ből kézi
    // ügy (close_unknown) lett. A lekérdező kör eleve csak esedékes sort vesz
    // fel; a `redirected` sor (az első MSGT33) a saját TRID-enkénti közével
    // fékez, ezért arra ez a feltétel nem vonatkozik.
    // 2026-10-03 (PR-5): a kétes sor is: az automatikus egyeztetés
    // visszalépését (csak-olvasó MSGT33) a visszajátszott visszatérés és az
    // admin sem húzhatja előre.
    if (['authorized', 'closed_ok', 'close_unknown'].includes(sor.cib_state) && sor.cib_next_action_at
      && new Date(sor.cib_next_action_at).getTime() > new Date(sor.db_most).getTime()) {
      return { kihagyva: 'nem_esedekes' };
    }
    await lepes(sor, berlo, forras, { maradekKeres: 1, megszakitva: false });
  } finally {
    await berletFelszabadit(trid, berlo).catch(() => {});
  }
  return { kesz: true };
}

/** Egy sor következő lépése a CIB-állapota szerint. A hívó birtokolja a bérletet. */
async function lepes(sor, berlo, forras, ctx) {
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes') return;
  switch (sor.cib_state) {
    case 'initializing': return initializingLepes(sor, berlo);
    case 'ready': return readyLepes(sor, berlo);
    case 'redirected': return redirectedLepes(sor, berlo, b, ctx || { maradekKeres: 1 });
    case 'authorized': return zar(sor, berlo, b);
    case 'closing': return closingLepes(sor, berlo, b);
    case 'close_unknown': return closeUnknownLepes(sor, berlo, b, ctx || { maradekKeres: 1 });
    case 'closed_ok': return konyvel(sor.payment_id, berlo);
    default: return vegallapotPotlas(sor, berlo);
  }
}

/**
 * A feladónak járó értesítés típusa egy sikertelen / nem terhelt végállapotú
 * kísérletre — ugyanaz a döntés, mint az élő utakon (zar, rendezes,
 * egyeztetés, lejáratás). `null`: nem jár értesítés (a bankig sem jutott).
 */
function ertesitesTipusa(s) {
  const ok = s.cib_result && s.cib_result.ok;
  switch (s.cib_state) {
    case 'failed': return ok === 'admin_nem_lezarva' ? 'admin_nem_lezarva' : 'sikertelen';
    case 'expired':
      if (ok === 'bank_visszaforditotta') return 'bank_visszaforditotta';
      return JOVAHAGYOTT_NEM_ZART.includes(ok) ? 'nem_zart' : 'sikertelen';
    case 'not_closed':
      if (ok === 'mar_fizetve' || ok === 'kupon') return 'mar_fizetve';
      if (ok === 'masik_zaras') return 'masik_kiserlet';
      if (ok === 'amo_elteres') return 'osszeg_elteres';
      return 'nem_terhelt';
    default: return null;
  }
}

/**
 * Végállapotú, de még függő sor (összeomlás a végállapot rögzítése és az
 * esemény / értesítés között): az esemény ÉS — ha még nem ment — a feladó
 * értesítése. ⚠️ 2026-10-04 (a PR-5 1. javítóköre, I8): eddig csak az
 * esemény futott le újra, így a feladó, akinek „az eredményről értesítünk"-et
 * ígértünk (kétes, egyeztetés), soha nem kapott értesítést. Az értesítés a
 * cib_notified_at claimen át pontosan egyszer megy.
 */
async function vegallapotPotlas(sor, berlo) {
  let hiba = null;
  try {
    await vegallapotEsemeny(sor.payment_id, berlo);
  } catch (err) {
    hiba = err;
  }
  const tipus = sor.cib_notified_at ? null : ertesitesTipusa(sor);
  if (tipus) {
    await ertesitFeladot(sor.payment_id, tipus).catch((err) => console.error('[cib] értesítés hiba:', err && err.message));
  }
  if (hiba) throw hiba;
}

async function kovetkezo(trid, berlo, kifejezes, parameterek = []) {
  await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = ${kifejezes}
      WHERE payment_id = $1 AND cib_lease_owner = $2`,
    [trid, berlo, ...parameterek],
  );
}

async function initializingLepes(sor, berlo) {
  // Az indító folyamat elhalt (2 percnél régebbi initializing): MSGT20 nem
  // készült, a TRID nem terhelhető — banki hívás nélkül zárjuk.
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'abandoned', cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"init_idokeret"}'::jsonb
      WHERE payment_id = $1 AND cib_state = 'initializing' AND cib_lease_owner = $2
        AND created_at < NOW() - make_interval(secs => $3::int)`,
    [sor.payment_id, berlo, INDITAS_ELHAGYOTT_MP],
  );
  if (rowCount) return vegallapotEsemeny(sor.payment_id, berlo);
  return kovetkezo(sor.payment_id, berlo, `created_at + make_interval(secs => $3::int + 5)`, [INDITAS_ELHAGYOTT_MP]);
}

async function readyLepes(sor, berlo) {
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'abandoned', cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"hop_lejart"}'::jsonb
      WHERE payment_id = $1 AND cib_state = 'ready' AND cib_lease_owner = $2
        AND cib_hop_expires_at <= NOW()`,
    [sor.payment_id, berlo],
  );
  if (rowCount) return vegallapotEsemeny(sor.payment_id, berlo);
  return kovetkezo(sor.payment_id, berlo, `cib_hop_expires_at + INTERVAL '5 seconds'`);
}

/**
 * Egy lekérdezés-eredmény rögzítése a várt állapotból (redirected), a
 * lekérdezés-számlálóval együtt. `uj` null → az állapot marad.
 *
 * Az `authorized_at` a DB órájából jön (2026-09-29, 1. javítókör) — egy
 * alkalmazás-órából írt időbélyeg óraeltérésnél félrevezető lenne. 2026-10-01
 * óta a zárási ablakok nem ebből, hanem a MSGT10 idejéből számolnak
 * (zarasiHataridoLejart); az authorized_at az admin-nézet adata maradt.
 */
async function lekerdezesIras(trid, berlo, {
  uj = null, eredmeny = {}, kovetkezoKif = null, kovetkezoParam = [], kerdesIdo = null,
}) {
  // 2026-10-03 (PR-5): a `kerdesIdo` (a MSGT33 küldésének DB-ideje, ms) lesz a
  // cib_last_query_at. Ha a vásárló a kérdés UTÁN tért vissza (a kör kérdése
  // közben érkezett a MSGT21), a válasz még a visszatérés előtti banki
  // állapotot tükrözheti: a következő lekérdezés legkésőbb 5 mp múlva (és a
  // motor a visszatérés utáni első lekérdezést soron kívül engedi). Eddig a
  // kör 60 mp-es köze mögé szorult — határidő közelében a jóváhagyott fizetés
  // lezáratlan maradt.
  const k = 5 + kovetkezoParam.length;
  const kif = kovetkezoKif || 'NULL';
  const params = [trid, berlo, uj, JSON.stringify(eredmeny), ...kovetkezoParam,
    kerdesIdo == null ? null : kerdesIdo / 1000];
  const { rowCount } = await db.query(
    `UPDATE payment_sessions
        SET cib_state = COALESCE($3::text, cib_state),
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb
              || CASE WHEN $3::text = 'authorized' THEN jsonb_build_object('authorized_at', NOW()) ELSE '{}'::jsonb END,
            cib_last_query_at = COALESCE(to_timestamp($${k}::double precision), NOW()),
            cib_query_count = cib_query_count + 1,
            cib_next_action_at = CASE
              WHEN $3::text IS NULL AND $${k}::double precision IS NOT NULL AND cib_returned_at IS NOT NULL
                   AND cib_returned_at > to_timestamp($${k}::double precision)
                THEN LEAST(COALESCE(${kif}, 'infinity'::timestamptz),
                           NOW() + make_interval(secs => ${VISSZATERES_MIN_KOZ_MS / 1000}))
              ELSE ${kif} END
      WHERE payment_id = $1 AND cib_state = 'redirected' AND cib_lease_owner = $2`,
    params,
  );
  return rowCount > 0;
}

/**
 * A kísérlet időpontjai a DB órájával (ms-ban): a mostani idő, a zárási
 * határidő (a MSGT10 kimenő naplósorától, ennek hiányában a létrehozástól,
 * ahogy a zarasiHataridoLejart is — 2026-10-03, PR-5) és az automatikus
 * egyeztetés ideje. Konfig nélkül az alapértékek.
 *
 * ⚠️ 2026-10-04 (a PR-5 1. javítóköre, BLOKKOLÓ): az egyeztetés horgonya az
 * UTOLSÓ kimenő MSGT32 (ennek hiányában a zárás küldési ideje, majd a
 * MSGT10). A bank a le nem zárt jóváhagyást a JÓVÁHAGYÁSHOZ képest ~9–10,5
 * perccel fordítja vissza (mérve), addig a MSGT33 00-t ad az ANUM-mal — egy
 * 9:20-kor jóváhagyott, 9:30-kor zárni próbált kísérletre a MSGT10 + 20 perc
 * gyakorlatilag tartalék nélküli volt. A jóváhagyás mindig megelőzi a
 * MSGT32-t, így az utolsó MSGT32-től mért idő a jóváhagyástól mért alsó
 * becslés.
 */
async function idopontok(trid, b) {
  const h = (b && b.hangolok) || {};
  const { rows } = await db.query(
    `SELECT EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS most,
            EXTRACT(EPOCH FROM COALESCE(
              (SELECT MIN(m.created_at) FROM cib_messages m
                WHERE m.payment_id = ps.payment_id AND m.direction = 'ki' AND m.msgt = 10),
              ps.created_at)) * 1000 AS horgony,
            EXTRACT(EPOCH FROM COALESCE(
              (SELECT MAX(m.created_at) FROM cib_messages m
                WHERE m.payment_id = ps.payment_id AND m.direction = 'ki' AND m.msgt = 32),
              ps.cib_close_sent_at)) * 1000 AS zaras_horgony,
            EXTRACT(EPOCH FROM (ps.cib_result->'egyeztetes_elso_00'->>'at')::timestamptz) * 1000 AS elso00
       FROM payment_sessions ps WHERE ps.payment_id = $1`,
    [trid],
  );
  const most = rows[0] ? Number(rows[0].most) : Date.now();
  const horgony = rows[0] ? Number(rows[0].horgony) : 0;
  const zarasHorgony = rows[0] && rows[0].zaras_horgony != null ? Number(rows[0].zaras_horgony) : horgony;
  const elso00 = rows[0] && rows[0].elso00 != null ? Number(rows[0].elso00) : null;
  return {
    most,
    hatarido: horgony + (h.zarasHataridoMp || ALAP_ZARAS_HATARIDO_MP) * 1000,
    egyeztetes: Math.max(horgony, zarasHorgony) + (h.egyeztetesPerc || ALAP_EGYEZTETES_PERC) * 60000,
    // Az egyeztetés első 00-ja után a megerősítő lekérdezés legkorábbi ideje.
    megerositesTol: elso00 == null ? null : elso00 + EGYEZTETES_MEGEROSITES_PERC * 60000,
  };
}

/**
 * Van-e a kísérletre (adott zárási kísérletre) KIMENŐ MSGT32-naplósor? A
 * kliens a kérést CSAK a write-ahead sor után küldi: ha nincs sor, a MSGT32
 * bizonyítottan el sem ment (2026-10-03, PR-5).
 */
async function kimenoZarasVan(trid, kiserlet = null) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM cib_messages
      WHERE payment_id = $1 AND direction = 'ki' AND msgt = 32
        AND ($2::int IS NULL OR close_attempt = $2::int)
      LIMIT 1`,
    [trid, kiserlet],
  );
  return rowCount > 0;
}

/** Rendszerszintű banki hiba-jelzés egy MSGT33-kimenetből (2026-10-03, PR-5). */
function lekerdezesRendszerJel(k, v) {
  if (k.kimenet === 'folyamatban' && ['bank_D', 'http', 'visszafejtes'].includes(k.hiba)) {
    bankRendszerJel(true, `MSGT33 ${k.bankRc || (k.hiba === 'http' ? `HTTP ${v.http || '?'}` : k.hiba)}`);
  } else if (v.mezok) {
    bankRendszerJel(false);
  }
}

async function redirectedLepes(sor, berlo, b, ctx) {
  const trid = sor.payment_id;
  const r = sor.cib_result || {};
  const most = new Date(sor.db_most || Date.now()).getTime();
  const koz = b.hangolok.lekerdezesKozMs;
  // MSGT33-anomália (ismétlődő NT / mezőeltérés, MSGT32 nélkül): a
  // határidőig vár, utána nem terheltként zárul.
  if (r.anomalia) return anomaliaLepes(sor, berlo, b);

  // Mikor kérdezhetünk? A TrID-enkénti köz (a D04 ellen) — de a vásárló
  // visszatérése (MSGT21) utáni ELSŐ lekérdezés soron kívüli, csak egy 5 mp-es
  // kalapálás-fékkel (2026-10-03, PR-5: eddig a kör 90 s után már kérdezett,
  // és a visszatérés utáni MSGT33-at a 60 s-os köz akár ~90 s-ig visszatartotta
  // — határidő közelében a jóváhagyott fizetés lezáratlan maradt). A
  // visszajátszott visszatérés nem kalapál: a cib_returned_at az első
  // visszatéréskor rögzül, utána a soron kívüliség egyszer él.
  const visszatert = !!sor.cib_returned_at;
  const utolso = sor.cib_last_query_at ? new Date(sor.cib_last_query_at).getTime() : null;
  const soronKivul = visszatert && (utolso === null || utolso < new Date(sor.cib_returned_at).getTime());
  const fek = soronKivul ? Math.min(VISSZATERES_MIN_KOZ_MS, koz) : koz;
  let cel = null;
  if (utolso !== null && utolso > most - fek) cel = utolso + fek;
  if (visszalepesAktiv()) cel = Math.max(cel || 0, allapot.visszalepes.eddig);
  if (cel !== null && visszatert) {
    // A visszatért (jóváhagyó) vásárló lekérdezését sem a köz, sem a globális
    // D04-visszalépés nem tolhatja a zárási határidőn túlra: legkésőbb a
    // határidő − (HTTP-keret + tartalék) pillanatban egyszer kérdezünk
    // (2026-10-03, PR-5; az 5 mp-es fék ekkor is él).
    const h = await idopontok(trid, b);
    const korlat = h.hatarido - (b.hangolok.httpIdokeretMs + LEKERDEZES_TARTALEK_MS);
    if ((utolso === null || utolso < korlat) && korlat < cel) {
      cel = Math.max(korlat, (utolso || 0) + VISSZATERES_MIN_KOZ_MS);
    }
  }
  if (cel !== null && cel > most) {
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [cel / 1000]);
  }
  if (ctx.megszakitva || ctx.maradekKeres <= 0) return null; // a következő tickre marad
  ctx.maradekKeres -= 1;

  const kerdesIdo = most;
  const v = await kliens.marketHivas({
    beallitasok: b,
    mezok: p.msgt33Mezok({ pid: b.pid, trid, amo: Number(sor.amount_huf) }),
    idokeretMs: b.hangolok.httpIdokeretMs,
  });
  const k = p.lekerdezesKimenet(v, sor, b.pid);
  megszakitoJelez(!!k.megszakito, !!v.mezok);
  lekerdezesRendszerJel(k, v);
  const kozMp = Math.ceil(koz / 1000);
  const helyiLejart = sor.cib_redirected_at
    && new Date(sor.cib_redirected_at).getTime() < most - b.hangolok.kiserletMaxPerc * 60000;
  const eredmenyAdat = (a, forrasKod) => ({
    rc: a.rc, rt: a.rt, anum: a.anum, amo: a.amo, cur: a.cur, forras: forrasKod,
  });
  // A helyi határidő után lejárt: egy ennyire régi, le nem zárt jóváhagyást a
  // bank már reverzált, lezárni pedig soha nem fogjuk.
  const helyiHataridoLejart = async () => {
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'expired',
      eredmeny: { ok: 'helyi_hatarido', forras: 'helyi' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
      kerdesIdo,
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  };

  if (k.kimenet === 'engedelyezve') {
    visszalepesVege();
    // A MSGT33 00 ANUM-ja és RT-je is megmarad (2026-10-03, PR-5): egy
    // későbbi kétes zárásnál az admin és az egyeztetés ebből is dolgozhat. A
    // banki adatsor (rc/rt/anum) továbbra is CSAK a zárásból jön.
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'authorized',
      eredmeny: {
        msgt33_rc: '00', msgt33_anum: k.adatok.anum || null, msgt33_rt: k.adatok.rt || null, zaras_eredete: 'authorized',
      },
      kovetkezoKif: 'NOW()',
      kerdesIdo,
    });
    if (!ok) return null;
    return zar(await friss(trid), berlo, b);
  }
  if (k.kimenet === 'elutasitva') {
    visszalepesVege();
    if (b.sikertelenLezaras) {
      // A GYFK algoritmusa szerint az elutasított authorizációt is MSGT32-vel
      // zárjuk — a zárási jog (fuvarsorzár + index) alatt.
      const ok = await lekerdezesIras(trid, berlo, {
        uj: 'authorized',
        eredmeny: {
          ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_elutasitas', zaras_eredete: 'declined',
        },
        kovetkezoKif: 'NOW()',
        kerdesIdo,
      });
      if (!ok) return null;
      return zar(await friss(trid), berlo, b);
    }
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'failed',
      eredmeny: { ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_elutasitas' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
      kerdesIdo,
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  if (k.kimenet === 'lejart') {
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'expired',
      eredmeny: { ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_to' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
      kerdesIdo,
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  if (k.kimenet === 'visszalepes') {
    visszalepesInditasa();
    // Tartós D04 mellett is lejár a helyi határidő (2026-09-29, 1. javítókör):
    // eddig ez az ág a határidőt nem nézte, így a sor soha nem lett expired.
    if (helyiLejart) return helyiHataridoLejart();
    await lekerdezesIras(trid, berlo, {
      kovetkezoKif: 'to_timestamp($5::double precision)', kovetkezoParam: [allapot.visszalepes.eddig / 1000], kerdesIdo,
    });
    return null;
  }
  if (k.kimenet === 'bank_s') {
    const uzenet = `[cib] 🚨 a bank titkosítatlan ${k.bankRc} hibát adott a MSGT33-ra — valószínűleg rossz kulcs vagy környezet`;
    console.error(uzenet);
    sentry(uzenet, 'error');
    ctx.megszakitva = true;
  }
  if (k.kimenet === 'mezo_elteres' || k.kimenet === 'nem_talalt') {
    // A CRC nem MAC: egy a DB-vel nem egyező válaszra NEM építünk.
    const kulcs = k.kimenet === 'mezo_elteres' ? 'mezo_elteres_szam' : 'nt_szam';
    const szam = Number((sor.cib_result && sor.cib_result[kulcs]) || 0) + 1;
    if (k.kimenet === 'mezo_elteres') sentry(`[cib] CIB_MEZO_ELTERES a MSGT31-ben (${k.mezo}): ${p.maszkoltTrid(trid)}`, 'error');
    if (szam >= ISMETLODO_HIBA_KUSZOB) {
      // ⚠️ 2026-10-03 (PR-5): eddig close_unknown lett — MSGT32 nélkül is. Az
      // indexelt kétes állapot a feladót egy munkanapig blokkolta („ne fizess
      // újra"), egy másik kísérlet zárása mellett pedig minden körben 23505-tel
      // elszállt (a sor soha nem lett végállapotú). Egy redirected kísérletre
      // MSGT32 soha nem ment ki, a bank nem terhelhet: a határidőig nem
      // kérdezünk, utána nem terheltként zárul (anomaliaLepes); a riasztás
      // egyszer megy (saját hiba gyanú), a feladó közben újra fizethet.
      const anomalia = k.kimenet === 'mezo_elteres' ? 'lekerdezes_mezo_elteres' : 'nt_ismetlodo';
      const h = await idopontok(trid, b);
      const ok = await lekerdezesIras(trid, berlo, {
        eredmeny: { [kulcs]: szam, anomalia },
        kovetkezoKif: 'to_timestamp($5::double precision)',
        kovetkezoParam: [(Math.max(h.hatarido, h.most) + 5000) / 1000],
      });
      if (ok) await riaszt(trid, anomalia);
      return null;
    }
    await lekerdezesIras(trid, berlo, {
      eredmeny: { [kulcs]: szam },
      kovetkezoKif: 'NOW() + make_interval(secs => $5::int)',
      kovetkezoParam: [kozMp],
      kerdesIdo,
    });
    return null;
  }
  // Folyamatban (PR), hálózati / D-hiba vagy S-hiba: a helyi határidő után
  // lejárt.
  if (helyiLejart) return helyiHataridoLejart();
  // Egy HITELES PR-válasz (2026-09-29, 1. javítókör) megszakítja az „egymás
  // utáni" NT- és mezőeltérés-sorozatot, és a D04-visszalépést is alapra
  // állítja: a terv 3 EGYMÁS UTÁNI hibát kér, eddig a szórványos hibák is
  // összeadódtak (és close_unknown-ba vitték a kísérletet), a visszalépés
  // pedig egy PR-hullám után is tovább duplázódott.
  const nullazas = {};
  if (k.adatok) {
    visszalepesVege();
    if (r.nt_szam) nullazas.nt_szam = 0;
    if (r.mezo_elteres_szam) nullazas.mezo_elteres_szam = 0;
  }
  await lekerdezesIras(trid, berlo, {
    eredmeny: nullazas,
    kovetkezoKif: 'NOW() + make_interval(secs => $5::int)',
    kovetkezoParam: [kozMp],
    kerdesIdo,
  });
  return null;
}

/**
 * Az ismétlődő MSGT33-anomáliájú (MSGT32 nélküli) kísérlet: a zárási
 * határidőig vár (nem kérdez), utána nem terheltként (expired) zárul —
 * terhelés MSGT32 nélkül nem lehet, a bank a jóváhagyást visszafordítja
 * (2026-10-03, PR-5).
 */
async function anomaliaLepes(sor, berlo, b) {
  const trid = sor.payment_id;
  const h = await idopontok(trid, b);
  if (h.most < h.hatarido) {
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [(h.hatarido + 5000) / 1000]);
  }
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'expired', cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', cib_result->>'anomalia')
      WHERE payment_id = $1 AND cib_state = 'redirected' AND state = 'pending' AND cib_lease_owner = $2`,
    [trid, berlo],
  );
  if (rowCount) await vegeSikertelen(trid, berlo, 'sikertelen');
  return null;
}

async function friss(trid) {
  const { rows } = await db.query('SELECT *, NOW() AS db_most FROM payment_sessions WHERE payment_id = $1', [trid]);
  return rows[0];
}

/** Sikertelen végállapot után: esemény + (egyszer) a feladó értesítése. */
async function vegeSikertelen(trid, berlo, tipus) {
  await vegallapotEsemeny(trid, berlo).catch((err) => console.error('[cib] végállapot-esemény hiba:', err && err.message));
  await ertesitFeladot(trid, tipus).catch((err) => console.error('[cib] értesítés hiba:', err && err.message));
}

/**
 * Egy zárási kísérlet NAPLÓZOTT bejövő válasza (a cib_messages write-ahead
 * naplójából), a `kliens.marketHivas` eredményének alakjában — hogy
 * ugyanaz az ellenőrzés (`zarasKimenet`: MSGT, PID, TRID, AMO) fusson rajta,
 * mint élőben. `null`: erre a kísérletre nincs bejövő sor (a válasz nem ért
 * vissza, vagy a naplózása is elbukott).
 */
async function naplozottZarasValasz(trid, kiserlet, b) {
  const { rows } = await db.query(
    `SELECT raw, http_status, error_class FROM cib_messages
      WHERE payment_id = $1 AND direction = 'be' AND endpoint = 'market' AND close_attempt = $2
      ORDER BY id DESC LIMIT 1`,
    [trid, kiserlet],
  );
  const n = rows[0];
  if (!n) return null;
  const v = {
    kuldve: true, http: n.http_status, mezok: null, bankRc: null, hibaOsztaly: null,
  };
  if (!n.raw) {
    v.hibaOsztaly = n.error_class || 'http';
    return v;
  }
  try {
    v.mezok = eki.ekiDecrypt(n.raw, b.kulcs, { bankValasz: true });
  } catch (err) {
    if (err instanceof eki.EkiBankHiba) {
      v.bankRc = err.rc;
      v.hibaOsztaly = p.bankKodOsztaly(err.rc);
    } else {
      v.hibaOsztaly = 'visszafejtes';
    }
  }
  return v;
}

async function closingLepes(sor, berlo, b) {
  // A zárás közben elhalt folyamat (összeomlás, deploy) vagy a rögzítésnél
  // elbukott DB-írás: a bérlet lejárt, a sor `closing`-ban maradt.
  // MSGT32 SOHA újra — de a döntéshez előbb a bizonyítékot nézzük.
  const trid = sor.payment_id;
  const hatarMp = Math.ceil((b.hangolok.zarasIdokeretMs + 60000) / 1000);
  const { rows } = await db.query(
    `SELECT cib_close_attempts, cib_result, amount_huf, currency, payment_id,
            (cib_close_sent_at < NOW() - make_interval(secs => $3::int)) AS lejart
       FROM payment_sessions WHERE payment_id = $1 AND cib_state = 'closing' AND cib_lease_owner = $2`,
    [trid, berlo, hatarMp],
  );
  const s = rows[0];
  if (!s) return null;
  if (!s.lejart) return kovetkezo(trid, berlo, 'cib_close_sent_at + make_interval(secs => $3::int)', [hatarMp]);
  const eredete = (s.cib_result && s.cib_result.zaras_eredete) === 'declined' ? 'declined' : 'authorized';

  // (1) 2026-09-29, 1. javítókör: ha erre a zárási kísérletre a bank válasza
  // a write-ahead naplóban megvan (a folyamat a válasz UTÁN halt el, vagy a
  // rögzítés egy átmeneti DB-hibán bukott el), ugyanazzal az ellenőrzéssel
  // alkalmazzuk, mint élőben: egy hiteles, DB-vel egyező RC=00 → closed_ok,
  // ember nélkül. A napló olvasásának hibája TOVÁBBDOB: a sor closing-ban
  // marad, és a következő kör újra próbálja (nem lesz belőle hamis kétes).
  const v = await naplozottZarasValasz(trid, s.cib_close_attempts, b);
  if (v) {
    const kim = p.zarasKimenet(v, s, b.pid, { eredete });
    console.warn(`[cib] ${p.maszkoltTrid(trid)}: a megszakadt zárás kimenete a banki naplóból: ${kim.kimenet}`);
    return zarasEredmeny({
      trid, berlo, k: s.cib_close_attempts, kim, b,
    });
  }
  // (2) Elutasított eredetű zárás (a MSGT33 már elutasítást adott): egy
  // elutasított authorizációból terhelés nem lehet — közvetlenül failed,
  // riasztás és kézi rendezés nélkül (a zarasKimenet is így dönt élőben).
  if (eredete === 'declined') {
    const { rowCount } = await db.query(
      `UPDATE payment_sessions SET cib_state = 'failed', cib_next_action_at = NOW() + INTERVAL '30 seconds',
              cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"zaras_elmaradt":"zaras_valasz_nelkul"}'::jsonb
        WHERE payment_id = $1 AND cib_state = 'closing' AND cib_lease_owner = $2`,
      [trid, berlo],
    );
    if (rowCount) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  // (3) ⚠️ 2026-10-03 (PR-5): a KIMENŐ naplósor hiánya bizonyítja, hogy a
  // MSGT32 el sem ment (a kliens a kérést csak a write-ahead sor után
  // küldi) — a folyamat a zárási claim és a napló-INSERT között halt el.
  // Eddig ebből is kétes (close_unknown + riasztás + fagyasztás) lett, az
  // admin pedig „lezarva"-ként könyvelhetett egy el sem küldött zárást. Most:
  // „nem küldött" — a határidőn belül vissza authorized-ba (újrazárás), utána
  // expired („nem zárt"), riasztás nélkül.
  if (!(await kimenoZarasVan(trid, s.cib_close_attempts))) {
    return zarasEredmeny({
      trid,
      berlo,
      k: s.cib_close_attempts,
      kim: { kimenet: 'nem_feldolgozott', hiba: 'nem_kuldott', visszalepesMs: ZARAS_GYORS_UJRAPROBA_MP * 1000 },
      b,
    });
  }
  // (4) Kiment, de nincs bizonyíték → kétes; az automatikus egyeztetés
  // (closeUnknownLepes) az utolsó MSGT32 után CIB_EGYEZTETES_PERC perccel dönt.
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'close_unknown', cib_next_action_at = NOW(),
            cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"zaras_valasz_nelkul"}'::jsonb
      WHERE payment_id = $1 AND cib_state = 'closing' AND cib_lease_owner = $2`,
    [trid, berlo],
  );
  if (rowCount) await ketesLett(trid, 'zaras_valasz_nelkul');
  return null;
}

/**
 * A kétes (close_unknown) kísérlet AUTOMATIKUS EGYEZTETÉSE (2026-10-03, PR-5).
 * Eddig a sor parkolt (cib_next_action_at = NULL), és csak admin mozdította
 * — a bank szerint viszont a határidő utáni CSAK-OLVASÓ MSGT33 eldönti:
 * a le nem zárt jóváhagyásra TO jön, a lezárt tétel végig 00-t ad az
 * ANUM-jával.
 *   - MSGT32 egyszer sem ment ki (nincs kimenő naplósor): terhelés nem lehet;
 *     a határidő után banki hívás nélkül „nem terhelt";
 *   - az UTOLSÓ kimenő MSGT32 + CIB_EGYEZTETES_PERC előtt: csak riasztás + a
 *     feladó értesítése (egyszer-egyszer), banki hívás nincs;
 *   - utána MSGT33: TO → „nem terhelt" (a fuvar újra fizethető); 00 + egyező
 *     AMO + ANUM → az ELSŐ csak feljegyzés, és legalább 15 perccel később egy
 *     MEGERŐSÍTŐ 00 ugyanazzal az ANUM-mal → lezárt, könyvelés (a nem
 *     fizethető ügylet könyvelési árva + riasztás lesz, csendben soha);
 *     minden más → visszalépés (15 perc × 2^n, legfeljebb 6 óra).
 *
 * ⚠️ 2026-10-04 (a PR-5 1. javítóköre, BLOKKOLÓ):
 *   (1) eddig BÁRMELY elutasító kód (02, 05, 96, R0…) „nem terhelt"-et
 *       jelentett — egy FELDOLGOZOTT (terhelt) MSGT32 után, amelynek válasza
 *       elveszett, egy technikai MSGT33-kód a fuvart újra fizethetővé tette,
 *       és a feladó „nem terheltük" levelet kapott: KÉT terhelt TrID egy
 *       díjra. A banki dokumentáció szerint a reverzál jele a TO; minden más
 *       kód (elutasított eredetű zárás kivételével) nem dönt — riasztás +
 *       visszalépés, a fuvar fagyva marad;
 *   (2) eddig egyetlen 00 könyvelt — de a le nem zárt jóváhagyásra is 00 jön,
 *       amíg a bank nem reverzál. Most az első 00 után legalább 15 perccel
 *       egy megerősítő 00 kell ugyanazzal az ANUM-mal (a reverzál addigra
 *       mérhetően lezajlik); eltérő ANUM → riasztás, ember dönt.
 * MSGT32 ITT SOHA nem megy ki.
 */
async function closeUnknownLepes(sor, berlo, b, ctx) {
  const trid = sor.payment_id;
  const r = sor.cib_result || {};
  const h = await idopontok(trid, b);
  if (!(await kimenoZarasVan(trid))) {
    if (h.most >= h.hatarido) return egyeztetesNemTerhelt(trid, berlo, { egyeztetes_forras: 'zaras_nem_ment_ki' });
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [(h.hatarido + 5000) / 1000]);
  }
  await ketesLett(trid, r.ok || 'close_unknown');
  if (h.most < h.egyeztetes) {
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [h.egyeztetes / 1000]);
  }
  // A megerősítő lekérdezés legkorábban az első 00 + 15 perc (a DB órájával).
  const elso = r.egyeztetes_elso_00 && typeof r.egyeztetes_elso_00 === 'object' ? r.egyeztetes_elso_00 : null;
  if (elso && h.megerositesTol != null && h.most < h.megerositesTol) {
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [h.megerositesTol / 1000]);
  }
  if (visszalepesAktiv()) {
    return kovetkezo(trid, berlo, 'to_timestamp($3::double precision)', [allapot.visszalepes.eddig / 1000]);
  }
  if (ctx.megszakitva || ctx.maradekKeres <= 0) return null; // a következő tickre marad
  ctx.maradekKeres -= 1;

  const v = await kliens.marketHivas({
    beallitasok: b,
    mezok: p.msgt33Mezok({ pid: b.pid, trid, amo: Number(sor.amount_huf) }),
    idokeretMs: b.hangolok.httpIdokeretMs,
  });
  const k = p.lekerdezesKimenet(v, sor, b.pid);
  megszakitoJelez(!!k.megszakito, !!v.mezok);
  lekerdezesRendszerJel(k, v);
  if (k.kimenet === 'bank_s') ctx.megszakitva = true;
  // TO: a banki dokumentáció szerinti reverzál-jel. Az elutasító kód CSAK
  // elutasított eredetű zárásnál dönt (elutasított authorizációból terhelés
  // nem lehet) — egy jóváhagyott, feldolgozott MSGT32 után egy technikai
  // MSGT33-kód nem bizonyítja, hogy a kártyát nem terheltük.
  // ⚠️ 2026-10-04 (a PR-5 2. javítóköre): ha a kétes állapot oka D05 („a
  // kéréstípus már ki lett szolgálva" — a bank egy korábbi MSGT32-t
  // FELDOLGOZOTT), a TO ennek ellentmond: nem „nem terhelt", ember dönt (egy
  // automatikus feloldás után a feladó újra fizethetne egy terhelt díjat).
  const d05 = r.ok === 'zaras_d05';
  if ((k.kimenet === 'lejart' && !d05) || (k.kimenet === 'elutasitva' && r.zaras_eredete === 'declined')) {
    const a = k.adatok;
    return egyeztetesNemTerhelt(trid, berlo, {
      rc: a.rc, rt: a.rt, anum: a.anum, amo: a.amo, cur: a.cur, forras: '33_egyeztetes',
    });
  }
  if (k.kimenet === 'engedelyezve' && k.adatok.anum) {
    if (!elso) return egyeztetesElso00(trid, berlo, k.adatok);
    if (elso.anum === k.adatok.anum) return egyeztetesLezarva(trid, berlo, k.adatok);
  }
  if (k.kimenet === 'visszalepes') visszalepesInditasa();
  // Nem eldönthető (PR, NT, D-kód, hálózat, mezőeltérés, ANUM nélküli 00,
  // nem-TO elutasító kód, eltérő ANUM). Ami ellentmond a kétes zárásnak (a
  // bank válasza nem lehet „nem terhelt" és nem is megerősített „lezárt"),
  // arról ember dönt: riasztás TrID-enként és okonként egyszer (a napi
  // emlékeztetőt a söprés küldi); a fuvar fagyva, újrafizetés nincs.
  const ellentmondo = (k.kimenet === 'lejart' && d05) || k.kimenet === 'elutasitva' || k.kimenet === 'mezo_elteres'
    || (k.kimenet === 'engedelyezve' && (!k.adatok.anum || (elso && elso.anum !== k.adatok.anum)));
  if (ellentmondo) {
    console.error(`[cib] ${p.maszkoltTrid(trid)}: az egyeztetés nem dönthető (${k.kimenet}${k.adatok && k.adatok.rc ? `:${k.adatok.rc}` : ''}) — ember dönt`);
    await riaszt(trid, 'egyeztetes_nem_dontheto');
  }
  const proba = Number(r.egyeztetes_proba || 0) + 1;
  const perc = Math.min(EGYEZTETES_VISSZALEPES_ALAP_PERC * 2 ** (proba - 1), EGYEZTETES_VISSZALEPES_MAX_PERC);
  const kimenet = `${k.kimenet}${(k.adatok && k.adatok.rc) || k.bankRc ? `:${(k.adatok && k.adatok.rc) || k.bankRc}` : ''}`;
  await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = NOW() + make_interval(mins => $3::int),
            cib_last_query_at = NOW(), cib_query_count = cib_query_count + 1,
            cib_result = COALESCE(cib_result, '{}'::jsonb)
              || jsonb_build_object('egyeztetes_proba', $4::int, 'egyeztetes_kimenet', $5::text)
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND cib_lease_owner = $2`,
    [trid, berlo, perc, proba, kimenet],
  );
  return null;
}

/**
 * Egyeztetés: az ELSŐ 00 + ANUM — még NEM könyvelünk (2026-10-04, a PR-5 1.
 * javítóköre): a le nem zárt jóváhagyásra is 00 jön, amíg a bank nem
 * reverzál. Feljegyezzük, és legalább 15 perc múlva megerősítő lekérdezés jön.
 */
async function egyeztetesElso00(trid, berlo, a) {
  await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = NOW() + make_interval(mins => $3::int),
            cib_last_query_at = NOW(), cib_query_count = cib_query_count + 1,
            cib_result = COALESCE(cib_result, '{}'::jsonb)
              || jsonb_build_object('egyeztetes_elso_00', jsonb_build_object('anum', $4::text, 'rt', $5::text, 'at', NOW()))
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending' AND cib_lease_owner = $2
        AND NOT (COALESCE(cib_result, '{}'::jsonb) ? 'egyeztetes_elso_00')`,
    [trid, berlo, EGYEZTETES_MEGEROSITES_PERC, a.anum, a.rt || null],
  );
  console.log(`[cib] ${p.maszkoltTrid(trid)}: az egyeztetés első 00-ja feljegyezve — megerősítés ${EGYEZTETES_MEGEROSITES_PERC} perc múlva`);
  return null;
}

/** Egyeztetés: a bank nem terhelt (visszafordította, vagy MSGT32 nem ment ki). */
async function egyeztetesNemTerhelt(trid, berlo, adat = {}) {
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'expired', cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_last_query_at = CASE WHEN $3::jsonb ? 'rc' THEN NOW() ELSE cib_last_query_at END,
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb || jsonb_build_object('egyeztetve_at', NOW())
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending' AND cib_lease_owner = $2`,
    [trid, berlo, JSON.stringify({ ...adat, ok: 'bank_visszaforditotta' })],
  );
  if (!rowCount) return null;
  console.log(`[cib] ${p.maszkoltTrid(trid)}: az egyeztetés szerint nem terhelt (bank_visszaforditotta), MSGT32 nélkül`);
  await vegeSikertelen(trid, berlo, 'bank_visszaforditotta');
  return null;
}

/**
 * Egyeztetés: a bank a (kiment) MSGT32-t feldolgozta — a csak-olvasó MSGT33
 * 00-t ad egyező AMO-val és ANUM-mal. Pontosan úgy könyvelünk, mint egy
 * hiteles zárás után (I4: a sor ugyanaz a kétes sor, a részleges UNIQUE
 * index második zárást nem enged).
 */
async function egyeztetesLezarva(trid, berlo, a) {
  await berletMegujit(trid, berlo);
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'closed_ok', cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_last_query_at = NOW(),
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb
              || jsonb_build_object('closed_at', NOW(), 'egyeztetve_at', NOW())
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending' AND cib_lease_owner = $2`,
    [trid, berlo, JSON.stringify({
      rc: a.rc, rt: a.rt, anum: a.anum, amo: a.amo, cur: a.cur, forras: '33_egyeztetes', ok: 'egyeztetes_lezarva',
    })],
  );
  if (!rowCount) {
    // 2026-10-04 (a PR-5 2. javítóköre): a megerősítő MSGT33 alatt lejárt a
    // bérlet, és egy másik munkás UGYANEZZEL az eredménnyel (ANUM) már
    // lezárta — ez nem ütközés, a díj rendben van; eddig az admin „terhelt,
    // nem rögzíthető, téríts vissza" riasztást kapott egy rendben lévő tételről.
    const { rows: most } = await db.query(
      `SELECT state, cib_state, cib_result->>'anum' AS anum FROM payment_sessions WHERE payment_id = $1`, [trid],
    );
    const m = most[0];
    if (m && m.cib_state === 'closed_ok' && ['pending', 'succeeded'].includes(m.state) && m.anum === a.anum) {
      console.log(`[cib] ${p.maszkoltTrid(trid)}: az egyeztetés eredményét egy másik munkás már rögzítette (azonos ANUM)`);
      return null;
    }
    // A bank TERHELT, de a sor közben kikerült a kétes állapotból (pl. egy
    // versenyző admin-rendezés) — a banki bizonyíték nem veszhet el némán.
    const uzenet = `[cib] 🚨 ${p.maszkoltTrid(trid)}: az egyeztetés szerint a bank lezárta (terhelt), `
      + 'de a tétel állapota közben megváltozott — az eredmény nem rögzíthető, ember dönt';
    console.error(uzenet);
    sentry(uzenet, 'error');
    await riaszt(trid, 'egyeztetes_iras_utkozes');
    return null;
  }
  console.log(`[cib] ✅ ${p.maszkoltTrid(trid)}: az egyeztetés szerint a bank lezárta (closed_ok), MSGT32 nélkül`);
  await konyvel(trid, berlo);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  PONTOSAN EGYSZERI ZÁRÁS
// ─────────────────────────────────────────────────────────────────────────

/**
 * A bankhoz IS ELJUTHATOTT MSGT32-k száma: a zárási claimek
 * (cib_close_attempts) mínusz a bizonyítottan ki sem mentek
 * (cib_result.zaras_nem_kuldott — a kapcsolódás előtti hiba vagy a kimenő
 * napló hibája; 2026-10-01, a PR-4 1. javítóköre). Hiányzó számláló = 0, így
 * a régi sorokra a korábbi, óvatos viselkedés marad (minden claim számít).
 * @param {object} sor — payment_sessions sor
 * @returns {number}
 */
function kikuldottZarasok(sor) {
  const r = (sor && sor.cib_result) || {};
  const nemKuldott = Number.isSafeInteger(Number(r.zaras_nem_kuldott)) ? Math.max(0, Number(r.zaras_nem_kuldott)) : 0;
  return Math.max(0, Number((sor && sor.cib_close_attempts) || 0) - nemKuldott);
}

/**
 * Lejárt-e (vagy `tartalekMp` múlva lejár-e) a kísérlet zárási határideje?
 *
 * 2026-10-01 (a CIB írásos válasza): „10 perc a lezárási határidő, ami a
 * kapott 10-es üzenet beérkezésétől számítódik." A helyi ablak ennél 30 mp-cel
 * rövidebb (CIB_ZARAS_HATARIDO_MP, alap 570 mp). A HORGONY a MSGT10 kimenő
 * write-ahead naplósora (a cib_messages `clock_timestamp`-je a küldés előtti
 * pillanatban — a bank beérkezéséhez ez a legközelebbi tárolt időpont),
 * ennek hiányában a kísérlet létrehozása (az A-fázis tranzakciója, = a TS).
 * Mindkettő a DB órája, és mindkettő a bank beérkezése ELŐTT van: a helyi
 * határidő legfeljebb korábbra eshet, soha nem későbbre. Az összevetés is a
 * DB órájával megy, nem az alkalmazáséval — 2026-10-01 (a PR-4 1. javítóköre)
 * óta a `clock_timestamp()`-pel: a zárási jog tranzakciójában a NOW() a
 * tranzakció KEZDETE, egy FOR UPDATE-várakozás után már a múlt — a határidő
 * így a várakozás idejével később járt volna le.
 * Hiányzó sor: lejártnak számít (fail-closed — ismeretlen kísérletre MSGT32
 * nem megy).
 * @param {{query:Function}} kliens — a pool vagy egy nyitott tranzakció kliense
 * @param {string} trid
 * @param {object} b — cibBeallitasok()
 * @param {number} [tartalekMp] — egy ütemezett újrapróba ennyi mp múlva menne ki
 * @returns {Promise<boolean>}
 */
async function zarasiHataridoLejart(kliens, trid, b, tartalekMp = 0) {
  const { rows } = await kliens.query(
    `SELECT clock_timestamp() + make_interval(secs => $3::int) >= COALESCE(
              (SELECT MIN(m.created_at) FROM cib_messages m
                WHERE m.payment_id = ps.payment_id AND m.direction = 'ki' AND m.msgt = 10),
              ps.created_at) + make_interval(secs => $2::int) AS lejart
       FROM payment_sessions ps WHERE ps.payment_id = $1`,
    [trid, b.hangolok.zarasHataridoMp, Math.max(0, Math.ceil(tartalekMp))],
  );
  return !rows[0] || rows[0].lejart !== false;
}

/**
 * A zárási jog (Tx1): fuvarsor FOR UPDATE → a fuvar összes sessionje FOR
 * UPDATE → üzleti újraellenőrzés → authorized → closing (a részleges UNIQUE
 * index védelmében). Külső hívás nincs benne.
 * @returns {Promise<{eredmeny:'zarhato', kiserlet:number, eredete:string}
 *   | {eredmeny:'var'} | {eredmeny:'nem_zarhato', ok:string, uj:string} | {eredmeny:'nem_sajat'}>}
 */
async function zarasiJog(trid, berlo, b) {
  const client = await db.pool.connect();
  let lezarva = false;
  try {
    await client.query('BEGIN');
    const { rows: s0 } = await client.query('SELECT job_id FROM payment_sessions WHERE payment_id = $1', [trid]);
    const jobId = s0[0] && s0[0].job_id;
    if (!jobId) return { eredmeny: 'nem_sajat' };
    const { rows: jr } = await client.query(
      `SELECT id, status, paid_at, connection_fee_huf, carrier_id, shipper_id, NOW() AS most
         FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    const { rows: sessions } = await client.query(
      'SELECT * FROM payment_sessions WHERE job_id = $1 ORDER BY payment_id FOR UPDATE', [jobId],
    );
    const sor = sessions.find((s) => s.payment_id === trid);
    if (!sor || sor.state !== 'pending' || sor.cib_state !== 'authorized' || sor.cib_lease_owner !== berlo) {
      return { eredmeny: 'nem_sajat' };
    }
    const job = jr[0];
    const r = sor.cib_result || {};
    const eredete = r.zaras_eredete === 'declined' ? 'declined' : 'authorized';
    const masok = sessions.filter((s) => s.payment_id !== trid);
    const masikFizetett = masok.some((s) => ['succeeded', 'needs_review'].includes(s.state)
      || (s.state === 'pending' && s.cib_state === 'closed_ok'));
    // „Másik zár": egy másik TRID zárási sora (closing / close_unknown) — és
    // 2026-10-01 óta egy másik TRID FÜGGŐ ÚJRAPRÓBÁJA is (authorized, de már
    // ment rá MSGT32). Az S05 után a bank szerint egy MSGT33 sikert is
    // mutathat, a tétel pedig a határidőn belül még lezárható: amíg az az
    // újrapróba él, egy második TRID MSGT32-je kettős terhelés lehetne.
    const masikZar = masok.some((s) => s.state === 'pending'
      && (['closing', 'close_unknown'].includes(s.cib_state)
        || (s.cib_state === 'authorized' && Number(s.cib_close_attempts) > 0)));
    // A MSGT10-től számított zárási határidő (a DB órájával).
    const hataridoLejart = await zarasiHataridoLejart(client, trid, b);
    // 2026-10-01 (a PR-4 1. javítóköre): „volt zárás" = a bankhoz IS ELJUTHATOTT
    // MSGT32. A claim (cib_close_attempts) már a küldés ELŐTT nő; a
    // bizonyítottan ki sem ment kérés (kapcsolódás előtti hiba, kimenő
    // naplóhiba) nem számít — eddig egy ilyen után a határidőn túl fölösleges
    // close_unknown + riasztás + kézi munka lett, holott a bank nem zárhatott.
    const voltZaras = kikuldottZarasok(sor) > 0;

    let ok = null;
    if (!job) ok = 'nem_fizetheto';
    else if (job.paid_at) ok = Number(job.connection_fee_huf) === 0 ? 'kupon' : 'mar_fizetve';
    else if (masikFizetett) ok = 'mar_fizetve';
    else if (job.status !== 'accepted') ok = 'nem_fizetheto';
    // ⚠️ 2026-09-29 (1. javítókör, BLOKKOLÓ): a szállító fióktörlése után a
    // fuvar carrier_id-je NULL — és ha a kísérlet is szállító nélkül
    // született, a lenti összevetés NULL === NULL-t látott, és lezártuk.
    else if (!job.carrier_id) ok = 'nem_fizetheto';
    else if (job.carrier_id !== sor.carrier_id || job.shipper_id !== sor.shipper_id) ok = 'szallito_valtozott';
    else if (Number(job.connection_fee_huf) !== Number(sor.amount_huf)) ok = 'dijsav_valtozott';
    else if (r.amo != null && Number(r.amo) !== Number(sor.amount_huf)) ok = 'amo_elteres';

    // 2026-10-01: a határidő után zárási claim NINCS. Ha erre a kísérletre már
    // ment MSGT32 (S05/S04, D03… után függő újrapróba), a bank szerint a tétel
    // „még visszautalásra kerülhet" — nem tudjuk biztosan, mi lett: ember
    // egyeztet (close_unknown + riasztás, a hívó küldi).
    if (!ok && hataridoLejart && voltZaras) ok = 'zaras_hatarido';
    if (!ok && masikZar) {
      // Egy másik TRID épp zár (vagy kétes, vagy az újrapróbája függ). Az
      // elutasított eredetű kísérlet (2026-09-29, 1. javítókör) nem vár:
      // elutasított authorizációból terhelés nem lehet, a MSGT32 csak a GYFK
      // szerinti rendrakás — a terv 9b lépése szerint enélkül közvetlenül
      // failed. A jóváhagyott vár, de legfeljebb a SAJÁT zárási határidejéig
      // (2026-10-01: a MSGT10-től, nem a jóváhagyástól számított 8 percig) —
      // utána a bank úgyis visszautal, MSGT32 nélkül feladjuk.
      if (eredete === 'declined' || hataridoLejart) ok = 'masik_zaras';
      else return { eredmeny: 'var' };
    }
    // Erre a kísérletre még nem ment MSGT32, és a határidő lejárt: a bank a
    // jóváhagyást lezárás nélkül visszautalja (terhelés nincs) → expired.
    if (!ok && hataridoLejart) ok = 'zarasi_hatarido';

    if (ok) {
      // Nem zárható: MSGT32 NINCS. Az elutasított eredetű kísérlet „failed"
      // (a MSGT33 adataival); a határidőn túl jóváhagyott „expired"; a már
      // zárási kísérletet kapott, határidőn túli „close_unknown" (riasztással,
      // a hívó küldi); a többi jóváhagyott „not_closed".
      let uj = 'not_closed';
      if (eredete === 'declined') uj = 'failed';
      else if (ok === 'zarasi_hatarido') uj = 'expired';
      else if (ok === 'zaras_hatarido') uj = 'close_unknown';
      const eredmeny = eredete === 'declined' ? { zaras_elmaradt: ok } : { ok };
      try {
        await client.query(
          `UPDATE payment_sessions
              SET cib_state = $3::text,
                  cib_next_action_at = CASE WHEN $3::text = 'close_unknown' THEN NOW() ELSE NOW() + INTERVAL '30 seconds' END,
                  cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb
            WHERE payment_id = $1 AND cib_state = 'authorized' AND cib_lease_owner = $2`,
          [trid, berlo, uj, JSON.stringify(eredmeny)],
        );
      } catch (err) {
        // 23505: a close_unknown-t a fuvaronkénti egy-zárási index nem engedi
        // (egy másik TRID közben zárási sort kapott) — a sor marad, és a kör
        // 30 s múlva újra dönt. MSGT32 a határidő után így sem megy ki.
        // 2026-10-01 (a PR-4 1. javítóköre): ez a sor addig riasztás nélkül,
        // csendben keringett — pedig ugyanúgy kétes (kiment rá MSGT32), mint
        // amit kétesre írtunk volna. A hívó egyszer riaszt (TRID-claim).
        if (err && err.code === '23505') {
          return { eredmeny: 'var', riasztas: ok === 'zaras_hatarido' ? 'zaras_hatarido_utkozes' : null };
        }
        throw err;
      }
      await client.query('COMMIT');
      lezarva = true;
      return { eredmeny: 'nem_zarhato', ok, uj };
    }

    let upd;
    try {
      upd = await client.query(
        // A bérlet a MSGT32 előtt megújul (2026-10-03, PR-5): egy bérlet-
        // szakasz így legfeljebb egy banki hívást fed (berletMp).
        `UPDATE payment_sessions
            SET cib_state = 'closing', cib_close_sent_at = NOW(), cib_close_attempts = cib_close_attempts + 1,
                cib_next_action_at = NOW() + make_interval(secs => $3::int),
                cib_lease_until = NOW() + make_interval(secs => $5::int)
          WHERE payment_id = $1 AND cib_state = 'authorized' AND cib_lease_owner = $2
            AND cib_close_attempts < $4
          RETURNING cib_close_attempts`,
        [trid, berlo, Math.ceil((b.hangolok.zarasIdokeretMs + 60000) / 1000), MAX_ZARASI_KISERLET, berletMp(b)],
      );
    } catch (err) {
      // 23505: egy másik TRID ugyanezen a fuvaron már zárási sort kapott.
      if (err && err.code === '23505') return { eredmeny: 'var' };
      throw err;
    }
    if (!upd.rowCount) return { eredmeny: 'nem_sajat' };
    await client.query('COMMIT');
    lezarva = true;
    return { eredmeny: 'zarhato', kiserlet: upd.rows[0].cib_close_attempts, eredete };
  } finally {
    if (!lezarva) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** A zárás (authorized sorra): claim → MSGT32 egyszer → kimenet. */
async function zar(sor, berlo, b) {
  if (!sor || allapot.leallas) return null; // leállás közben új zárási claim nincs
  const trid = sor.payment_id;
  const jog = await zarasiJog(trid, berlo, b);
  if (jog.eredmeny === 'nem_sajat') return null;
  if (jog.eredmeny === 'var') {
    await kovetkezo(trid, berlo, "NOW() + INTERVAL '30 seconds'");
    // A határidőn túli, kétesre nem írható sor (23505) — egyszer riaszt.
    if (jog.riasztas) await riaszt(trid, jog.riasztas);
    return null;
  }
  if (jog.eredmeny === 'nem_zarhato') {
    console.log(`[cib] ${p.maszkoltTrid(trid)}: nem zárható (${jog.ok}) → ${jog.uj}, MSGT32 nélkül`);
    // 2026-10-01: a határidőn túli, már zárási kísérletet kapott tétel kétes
    // — ember egyeztet a bankkal (riasztás TRID-enként egyszer).
    if (jog.uj === 'close_unknown') {
      await ketesLett(trid, jog.ok);
      return null;
    }
    let tipus = 'nem_terhelt';
    if (jog.uj === 'failed') tipus = 'sikertelen';
    else if (jog.ok === 'mar_fizetve' || jog.ok === 'kupon') tipus = 'mar_fizetve';
    // ⚠️ 2026-10-01 (a PR-4 1. javítóköre, BLOKKOLÓ): a határidőn túl
    // JÓVÁHAGYOTT, ezért le nem zárt kísérlet (expired / zarasi_hatarido) nem
    // „sikertelen" („a bank nem fogadta el") és nem „a fuvar megváltozott": a
    // bank jóváhagyta, mi nem véglegesítettük, a zárolást a bank feloldja.
    else if (JOVAHAGYOTT_NEM_ZART.includes(jog.ok)) tipus = 'nem_zart';
    // Ugyanígy a „másik kísérlet zár" miatt le nem zárt jóváhagyott tétel:
    // a fuvar nem változott, és új fizetést sem ígérhetünk.
    else if (jog.ok === 'masik_zaras') tipus = 'masik_kiserlet';
    // 2026-10-03 (PR-5/B): a bank más összeget hagyott jóvá — a fuvar nem
    // változott, a „fuvar közben megváltozott" indok itt hamis volt.
    else if (jog.ok === 'amo_elteres') tipus = 'osszeg_elteres';
    await vegeSikertelen(trid, berlo, tipus);
    return null;
  }

  // A MSGT32 — a zár UTÁN, egyszer.
  const k = jog.kiserlet;
  const v = await kliens.marketHivas({
    beallitasok: b,
    mezok: p.msgt32Mezok({ pid: b.pid, trid, amo: Number(sor.amount_huf) }),
    idokeretMs: b.hangolok.zarasIdokeretMs,
    zarasiKiserlet: k,
  });
  const kim = p.zarasKimenet(v, sor, b.pid, { eredete: jog.eredete });
  // 2026-10-01 (a PR-4 1. javítóköre): a MSGT32-re kapott S05/S04 a bank
  // szerint a zárásnál előforduló, újraküldendő válasz — nem kulcs- vagy
  // környezethiba. Eddig a megszakítóba számított: két feladó S05-sorozata
  // után 10 percig nem indult új fizetés, „kulcs vagy környezet gyanú"
  // riasztással. Semleges: nem növel és nem is nulláz.
  const ujrakuldhetoS = p.ZARAS_UJRAKULDHETO_S.includes(v.bankRc);
  megszakitoJelez(!ujrakuldhetoS && ['nem_kuldott', 'idokeret', 'halozat', 'bank_S'].includes(v.hibaOsztaly), !!v.mezok);
  return zarasEredmeny({
    trid, berlo, k, kim, b,
  });
}

/**
 * A hiteles MSGT31 RC=00 rögzítése (closing → closed_ok) — átmeneti DB-hibára
 * néhányszor újrapróbálva (2026-09-29, 1. javítókör). A feltételes UPDATE
 * idempotens: a kísérletszám köti a válaszhoz. Eddig egyetlen elbukott írás
 * után a sor `closing`-ban maradt, és a bérlet lejárta után hamis
 * close_unknown + kézi rendezés lett belőle, pedig a bank lezárt.
 * @returns {Promise<boolean>} a sor MOST closed_ok (akár egy korábbi,
 *   válasz nélkül commitolt írásból)
 */
async function zarasSikerIras(trid, k, adatok) {
  let utolsoHiba = null;
  for (let i = 0; i < SIKER_IRAS_KISERLET; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (i > 0) await varj(250 * i);
    try {
      // Egy késői, hiteles 00 ugyanarra a kísérletre a close_unknown-ból is
      // elfogadható (18. átmenet). A closed_at a DB órájából.
      // eslint-disable-next-line no-await-in-loop
      const { rowCount } = await db.query(
        `UPDATE payment_sessions
            SET cib_state = 'closed_ok', cib_next_action_at = NOW() + INTERVAL '30 seconds',
                cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb || jsonb_build_object('closed_at', NOW())
          WHERE payment_id = $1 AND cib_close_attempts = $2 AND cib_state IN ('closing', 'close_unknown')`,
        [trid, k, JSON.stringify(adatok)],
      );
      if (rowCount) return true;
      // Egy előző, a kliensnek hibát jelző, de commitolt írás után a sor már
      // closed_ok ugyanarra a kísérletre — az is siker.
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await db.query(
        'SELECT cib_state, cib_close_attempts FROM payment_sessions WHERE payment_id = $1', [trid],
      );
      return !!(rows[0] && rows[0].cib_state === 'closed_ok' && Number(rows[0].cib_close_attempts) === Number(k));
    } catch (err) {
      utolsoHiba = err;
      console.error(`[cib] a zárás rögzítése elbukott (${i + 1}/${SIKER_IRAS_KISERLET}) ${p.maszkoltTrid(trid)}:`, err && err.message);
    }
  }
  throw utolsoHiba;
}

/**
 * Egy MSGT32-kimenet alkalmazása a `closing` sorra — élőben (a zár után) és
 * a megszakadt zárás helyreállításakor (a naplózott válaszból) UGYANÍGY.
 * @param {{trid:string, berlo:string, k:number, kim:object, b?:object}} o
 */
async function zarasEredmeny({
  trid, berlo, k, kim, b = p.cibBeallitasok(),
}) {
  if (kim.kimenet === 'siker') {
    const ok = await zarasSikerIras(trid, k, {
      rc: kim.adatok.rc, rt: kim.adatok.rt, anum: kim.adatok.anum, amo: kim.adatok.amo, cur: kim.adatok.cur,
      forras: '32', ok: null,
    });
    if (!ok) {
      sentry(`[cib] sikeres MSGT31, de a sor már nem zárható állapotban: ${p.maszkoltTrid(trid)}`, 'error');
      return null;
    }
    console.log(`[cib] ✅ ${p.maszkoltTrid(trid)}: lezárva (closed_ok)`);
    // A könyvelés saját bérlet-szakaszt kap (2026-10-03, PR-5).
    if (berlo) await berletMegujit(trid, berlo).catch(() => {});
    await konyvel(trid, berlo);
    return null;
  }
  const zarasIras = async (uj, eredmeny, kovetkezoKif = "NOW() + INTERVAL '30 seconds'") => {
    const { rowCount } = await db.query(
      `UPDATE payment_sessions
          SET cib_state = $3, cib_next_action_at = ${kovetkezoKif},
              cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb
        WHERE payment_id = $1 AND cib_close_attempts = $2 AND cib_state = 'closing'`,
      [trid, k, uj, JSON.stringify(eredmeny)],
    );
    return rowCount > 0;
  };
  const adat = kim.adatok ? {
    rc: kim.adatok.rc, rt: kim.adatok.rt, anum: kim.adatok.anum, amo: kim.adatok.amo, cur: kim.adatok.cur, forras: '32',
  } : {};

  if (kim.kimenet === 'lejart' || kim.kimenet === 'elutasitva') {
    const uj = kim.kimenet === 'lejart' ? 'expired' : 'failed';
    const eredmeny = kim.adatok
      ? { ...adat, ok: kim.ok || 'bank_elutasitas' }
      : { ok: kim.ok || 'bank_elutasitas', zaras_bank_rc: kim.bankRc || null, zaras_hiba: kim.hiba || null };
    if (await zarasIras(uj, eredmeny)) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  if (kim.kimenet === 'nem_feldolgozott') {
    // A bizonyítottan fel nem dolgozott zárás (D03/D04/D07, PR, a küldés
    // előtti hiba, és 2026-10-01 óta a bank szavára az S05, saját döntéssel
    // az S04 — lásd p.ZARAS_UJRAKULDHETO_S): vissza
    // authorized-ba, és rövid várakozás után ÚJ zárási claim. Az újrapróba
    // csak akkor ütemeződik, ha a MSGT10-től számított határidő előtt
    // kimehet (2026-10-01: eddig a jóváhagyástól számított 8 perc döntött) —
    // egy határidőn túli MSGT32-re a bank már nem zár.
    let mp = Math.ceil((kim.visszalepesMs || 30000) / 1000);
    let hataridoElott = !(await zarasiHataridoLejart(db, trid, b, mp));
    // 2026-10-03 (PR-5): a fix 30/60 mp-es várakozás a határidő közelében
    // (pl. egy 9:10-kor kapott S05 után) eddig azonnal kézi ügyet (close_unknown)
    // csinált, pedig egy rövidebb újrapróba még a bank 600 mp-ébe fért volna.
    if (!hataridoElott && mp > ZARAS_GYORS_UJRAPROBA_MP) {
      mp = ZARAS_GYORS_UJRAPROBA_MP;
      hataridoElott = !(await zarasiHataridoLejart(db, trid, b, mp));
    }
    // 2026-10-01 (a PR-4 1. javítóköre): a bizonyítottan KI SEM MENT MSGT32-k
    // számlálója (kikuldottZarasok). Az írás a kísérletszámhoz és a closing
    // állapothoz kötött (zarasIras), így egy kísérlet egyszer számít.
    const { rows: nk } = await db.query(
      "SELECT COALESCE(cib_result->>'zaras_nem_kuldott', '0') AS n FROM payment_sessions WHERE payment_id = $1", [trid],
    );
    const nemKuldottSzam = (Number.parseInt(nk[0] && nk[0].n, 10) || 0) + (kim.hiba === 'nem_kuldott' ? 1 : 0);
    const szamlalo = nemKuldottSzam > 0 ? { zaras_nem_kuldott: nemKuldottSzam } : {};
    // 2026-10-04 (a PR-5 2. javítóköre): a ki sem ment zárásnak nincs banki
    // kódja — az előző kísérlet tárolt kódját (pl. S05) nem írjuk felül
    // null-lal (az admin-nézetből eltűnt a valódi utolsó banki válasz).
    const bankRcMezo = kim.bankRc ? { zaras_bank_rc: kim.bankRc } : (kim.hiba === 'nem_kuldott' ? {} : { zaras_bank_rc: null });
    if (k < MAX_ZARASI_KISERLET && hataridoElott) {
      await zarasIras('authorized', { ...bankRcMezo, ...szamlalo }, `NOW() + make_interval(secs => ${mp})`);
      return null;
    }
    // Egyetlen MSGT32 sem jutott el a bankhoz: a bank a jóváhagyást lezárás
    // nélkül, a határidő után visszautalja — terhelés nincs, ember sem kell
    // (expired, „nem zárt" értesítéssel). Ha akár egy is eljuthatott, kétes.
    if (nemKuldottSzam >= k) {
      const ok = hataridoElott ? 'zaras_nem_kuldott' : 'zarasi_hatarido';
      if (await zarasIras('expired', { ok, ...szamlalo })) await vegeSikertelen(trid, berlo, 'nem_zart');
      return null;
    }
    const ok = k < MAX_ZARASI_KISERLET ? 'zaras_hatarido' : 'zaras_nem_feldolgozott';
    // A kétes sor a kör teendő-listáján marad (2026-10-03, PR-5: eddig NULL
    // — parkolt, és egy elveszett riasztás után soha nem került elő).
    if (await zarasIras('close_unknown', { ok, ...bankRcMezo, ...szamlalo }, 'NOW()')) {
      await ketesLett(trid, ok);
    }
    return null;
  }
  // Kétes: időtúllépés / bontás a küldés után, 5xx RC nélkül, D05, S-hiba,
  // visszafejtési vagy mezőeltérés. MSGT32 SOHA újra.
  if (await zarasIras('close_unknown', { ok: kim.ok || 'zaras_valasz_nelkul', zaras_bank_rc: kim.bankRc || null }, 'NOW()')) {
    await ketesLett(trid, kim.ok || 'zaras_valasz_nelkul');
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────────────────────────────────

/**
 * „Újraellenőrzés": a következő lépés a köz tiszteletben tartásával esedékes.
 * A `jobId` az admin-naplóhoz kell (2026-09-29, 1. javítókör).
 *
 * ⚠️ 2026-10-03 (PR-5/B): a válasz megmondja, MI TÖRTÉNIK. Eddig a
 * felülvizsgálandó (needs_review) és a végállapotú tételre is {ok:true} ment,
 * a felület pedig „Újraellenőrzés ütemezve"-t mutatott — miközben semmi nem
 * ütemeződött (az admin azt hihette, a rendszer magától rendezi). Most ezekre
 * 409 CIB_NO_AUTOMATIC_STEP a teendővel; függő tételre az időpont és egy
 * igaz mondat (kétesnél: csak-olvasó egyeztetés, MSGT32 soha).
 * @returns {Promise<null|{http:number, body:object, jobId:string|null}>}
 */
async function ujraellenorzes(trid) {
  const b = p.cibBeallitasok();
  const kozMp = Math.ceil(((b.hangolok && b.hangolok.lekerdezesKozMs) || 60000) / 1000);
  // ⚠️ 2026-10-01 (a PR-4 1. javítóköre): egy jóváhagyott (zárandó) sor saját
  // várakozását (S05/S04 → 30 s, D04 → 60 s) az admin sem húzhatja előre —
  // egy azonnali MSGT32 egy zárási kísérletet égetne el (a 3-ból), D04-nél a
  // banki rátakorlátba futva. A GREATEST a NULL-t kihagyja, így a többi
  // állapotra a korábbi viselkedés marad.
  // 2026-10-03 (PR-5): a kétes sorra is — az automatikus egyeztetés maga dönt
  // (az egyeztetési idő előtt csak újraütemez, a visszalépést nem húzza előre).
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_next_action_at = GREATEST(NOW(), COALESCE(cib_last_query_at + make_interval(secs => $2::int), NOW()),
                                          CASE WHEN cib_state IN ('authorized', 'close_unknown') THEN cib_next_action_at END)
      WHERE payment_id = $1 AND provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL
      RETURNING cib_next_action_at <= NOW() AS esedekes, cib_next_action_at, cib_state, job_id`,
    [trid, kozMp],
  );
  if (!rows[0]) {
    const { rows: van } = await db.query(
      'SELECT job_id, state, cib_state FROM payment_sessions WHERE payment_id = $1 AND cib_state IS NOT NULL', [trid],
    );
    if (!van[0]) return null;
    const felulvizsgalando = van[0].state === 'needs_review';
    return {
      http: 409,
      body: {
        error: felulvizsgalando
          ? 'Ez a tétel felülvizsgálatra vár (a bank terhelt, de a díj nem volt könyvelhető): automatikus banki '
            + 'lekérdezés nincs. A bankkal egyeztetve a „Kézi rendezés" (visszatérítés vagy könyvelés) zárja le.'
          : 'Ez a kísérlet már végállapotban van — nincs automatikus lépés, amit újra lehetne futtatni.',
        code: 'CIB_NO_AUTOMATIC_STEP',
      },
      jobId: van[0].job_id || null,
    };
  }
  const r = rows[0];
  const most = r.esedekes && b.allapot === 'teljes';
  if (most) hatterFeldolgoz(trid, 'admin');
  const ido = r.cib_next_action_at ? new Date(r.cib_next_action_at) : null;
  const idoSzoveg = ido ? ido.toLocaleString('hu-HU', { timeZone: b.tsIdozona || 'Europe/Budapest' }) : null;
  let uzenet;
  if (b.allapot !== 'teljes') {
    uzenet = 'A CIB-konfiguráció nem teljes — a banki lépés csak a konfiguráció helyreállítása után fut.';
  } else if (r.cib_state === 'close_unknown') {
    uzenet = most
      ? 'Az egyeztetés (csak-olvasó banki lekérdezés, zárás nélkül) most fut a háttérben — az eredmény pár másodperc múlva a részleteknél látszik.'
      : `Az egyeztetés (csak-olvasó banki lekérdezés, zárás nélkül) legkorábban ekkor fut: ${idoSzoveg}. Előtte a bank még nem ad végleges választ.`;
  } else {
    uzenet = most
      ? 'A következő banki lépés most fut a háttérben — az eredmény pár másodperc múlva a részleteknél látszik.'
      : `A következő banki lépés legkorábban ekkor fut: ${idoSzoveg} (a lekérdezési köz / a bank kérte várakozás miatt).`;
  }
  return {
    http: 200,
    body: {
      ok: true, utemezve: true, azonnal: most, kovetkezo_at: ido ? ido.toISOString() : null, uzenet,
    },
    jobId: r.job_id || null,
  };
}

/**
 * Admin-rendezés egy kétes (close_unknown) kísérletre, a bankkal egyeztetve.
 *
 * ⚠️ 2026-09-29 (1. javítókör): „lezarva" CSAK akkor, ha a zárás (MSGT32)
 * ténylegesen kiment (cib_close_attempts > 0). A lekérdezésből (háromszori
 * NT vagy mezőeltérés) kétessé vált kísérletet a bank MSGT32 nélkül
 * biztosan reverzálta — „lezarva"-ként fizetés nélküli kontakt-felfedés és
 * számla lenne belőle, egyetlen admin-tévedésen múlva. 2026-10-01 (a PR-4 1.
 * javítóköre): a bizonyítottan ki sem ment MSGT32 (zaras_nem_kuldott) sem
 * számít kimentnek (kikuldottZarasok).
 * @returns {Promise<{http:number, body:object, jobId?:string|null}>}
 */
async function rendezes(trid, {
  eredmeny, indoklas, anum, rt,
}, adminId) {
  if (!['lezarva', 'nem_lezarva'].includes(eredmeny)) {
    return { http: 400, body: { error: 'Az eredmény „lezarva" vagy „nem_lezarva" lehet.', code: 'INVALID_VALUE' } };
  }
  if (typeof indoklas !== 'string' || indoklas.trim().length < 10 || indoklas.trim().length > 2000) {
    return { http: 400, body: { error: 'Az indoklás 10–2000 karakter legyen.', code: 'INVALID_VALUE' } };
  }
  if (eredmeny === 'lezarva' && (typeof anum !== 'string' || !/^[A-Za-z0-9]{1,6}$/.test(anum))) {
    return { http: 400, body: { error: 'A lezárt tranzakcióhoz a banki engedélyszám (ANUM) kötelező.', code: 'INVALID_VALUE' } };
  }
  // C6 (2026-10-03, PR-5): a „lezarva" után a kötelező banki adatsor RT-je is
  // kitöltött — amit az admin a banktól kapott, vagy a bank szokásos szövege.
  if (rt !== undefined && rt !== null && rt !== ''
    && (typeof rt !== 'string' || rt.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(rt))) {
    return { http: 400, body: { error: 'Az RT legfeljebb 255 karakteres szöveg lehet.', code: 'INVALID_VALUE' } };
  }
  const lezarva = eredmeny === 'lezarva';
  const adat = lezarva
    ? {
      forras: 'admin',
      rc: '00',
      rt: typeof rt === 'string' && rt.trim() ? rt.trim() : ADMIN_ALAP_RT,
      anum,
      admin_id: adminId,
      admin_indoklas: indoklas.trim(),
      ok: 'admin_lezarva',
    }
    : {
      forras: 'admin', admin_id: adminId, admin_indoklas: indoklas.trim(), ok: 'admin_nem_lezarva',
    };
  // ⚠️ 2026-10-03 (PR-5): a „lezarva" a KIMENŐ MSGT32-naplósort is
  // megköveteli — a számláló a küldés ELŐTT nő, egy a claim és a napló között
  // elhalt folyamat után az el sem küldött zárás is „kimentnek" látszott.
  const { rows: rendezett } = await db.query(
    `UPDATE payment_sessions
        SET cib_state = $2, cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb
              || CASE WHEN $4::boolean THEN jsonb_build_object('closed_at', NOW()) ELSE '{}'::jsonb END,
            cib_lease_until = NULL, cib_lease_owner = NULL
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending'
        AND (cib_lease_until IS NULL OR cib_lease_until < NOW())
        AND (NOT $4::boolean
          OR (cib_close_attempts > COALESCE(NULLIF(cib_result->>'zaras_nem_kuldott', '')::int, 0)
              AND EXISTS (SELECT 1 FROM cib_messages m WHERE m.payment_id = payment_sessions.payment_id
                           AND m.direction = 'ki' AND m.msgt = 32)))
      RETURNING job_id`,
    [trid, lezarva ? 'closed_ok' : 'failed', JSON.stringify(adat), lezarva],
  );
  if (!rendezett[0]) {
    // ⚠️ 2026-10-04 (a PR-5 1. javítóköre): élő bérlet alatt (az automatikus
    // egyeztetés épp kérdezi a bankot) nem rendezünk — eddig az admin
    // „nem_lezarva" egy futó, 00-t (terhelést) hozó egyeztetés eredményét
    // némán felülírta, és a feladót újrafizetésre hívtuk.
    const { rowCount: berelt } = await db.query(
      `SELECT 1 FROM payment_sessions WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending'
          AND cib_lease_until IS NOT NULL AND cib_lease_until > NOW()`,
      [trid],
    );
    if (berelt) {
      return { http: 409, body: { error: 'A tételen épp dolgozik a rendszer (banki egyeztetés) — próbáld újra egy perc múlva.', code: 'CIB_ROW_BUSY' } };
    }
    if (lezarva) {
      const { rowCount: zarasNelkul } = await db.query(
        `SELECT 1 FROM payment_sessions ps WHERE ps.payment_id = $1 AND ps.cib_state = 'close_unknown' AND ps.state = 'pending'
            AND (ps.cib_close_attempts <= COALESCE(NULLIF(ps.cib_result->>'zaras_nem_kuldott', '')::int, 0)
              OR NOT EXISTS (SELECT 1 FROM cib_messages m WHERE m.payment_id = ps.payment_id
                              AND m.direction = 'ki' AND m.msgt = 32))`,
        [trid],
      );
      if (zarasNelkul) {
        return {
          http: 409,
          body: {
            error: 'Ehhez a kísérlethez zárási kérés (MSGT32) nem ment ki — a bank nem terhelhetett, csak „nem_lezarva" rendezhető.',
            code: 'CIB_CLOSE_NOT_SENT',
          },
        };
      }
    }
    return { http: 409, body: { error: 'Csak függő, kétes (close_unknown) kísérlet rendezhető.', code: 'STATE_CHANGED' } };
  }
  if (lezarva) await konyvel(trid);
  else await vegeSikertelen(trid, null, 'admin_nem_lezarva');
  const { rows } = await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid]);
  return { http: 200, body: { ok: true, allapot: lekepez(rows[0]) }, jobId: rendezett[0].job_id || null };
}

const KEZI_MUVELETEK = Object.freeze(['konyveles', 'lejaratas', 'visszaterites']);
const LEJARATHATO = Object.freeze(['initializing', 'ready', 'redirected', 'authorized', 'closing']);

const keziHiba = (http, error, code) => ({ http, body: { error, code } });

/**
 * KONFIG NÉLKÜL IS ELÉRHETŐ admin-műveletek (2026-10-03, PR-5): a
 * vészvisszaállás (a CIB_* sorok törlése) vagy egy provider-váltás után a
 * függő kísérletek árván maradtak — a kör, az „Újraellenőrzés" és a
 * visszatérés is teljes konfigot kér, a rendezés csak a kétesre futott, így a
 * már terhelt (closed_ok) díj soha nem könyvelődött, a fuvar örökre fagyott.
 * Egyik művelet sem hív bankot, és egyik sem küld MSGT32-t.
 *   konyveles     — closed_ok, könyveletlen: a könyvelés (paid_at, kontakt,
 *                   bizonylat) a meglévő, hiteles banki adatsorral;
 *   lejaratas     — a zárási határidőn TÚLI initializing/ready/redirected/
 *                   authorized/closing: ha MSGT32 nem ment ki (nincs kimenő
 *                   naplósor), expired (a bank visszafordítja); ha kiment,
 *                   kétes (close_unknown) — onnan a rendezés dönt;
 *   visszaterites — könyvelési árva (needs_review): a banknál visszatérített
 *                   díj lezárása indoklással és banki hivatkozással.
 * Élő bérlet alatt (a rendszer épp dolgozik a tételen) 409.
 * @returns {Promise<{http:number, body:object, jobId?:string|null}>}
 */
async function keziRendezes(trid, { muvelet, indoklas, banki_hivatkozas: hivatkozas }, adminId) {
  if (!KEZI_MUVELETEK.includes(muvelet)) {
    return keziHiba(400, 'A művelet „konyveles", „lejaratas" vagy „visszaterites" lehet.', 'INVALID_VALUE');
  }
  if (typeof indoklas !== 'string' || indoklas.trim().length < 10 || indoklas.trim().length > 2000) {
    return keziHiba(400, 'Az indoklás 10–2000 karakter legyen.', 'INVALID_VALUE');
  }
  if (hivatkozas !== undefined && hivatkozas !== null && hivatkozas !== ''
    && (typeof hivatkozas !== 'string' || !/^[A-Za-z0-9 ./_-]{1,100}$/.test(hivatkozas))) {
    return keziHiba(400, 'A banki hivatkozás legfeljebb 100 karakter (betű, szám, szóköz, . / _ -).', 'INVALID_VALUE');
  }
  const { rows } = await db.query(
    `SELECT *, (cib_lease_until IS NOT NULL AND cib_lease_until > NOW()) AS berelt
       FROM payment_sessions WHERE payment_id = $1 AND provider = 'cib' AND cib_state IS NOT NULL`,
    [trid],
  );
  const s = rows[0];
  if (!s) return keziHiba(404, 'Nem található', 'NOT_FOUND');
  const admin = {
    admin_id: adminId, admin_indoklas: indoklas.trim(), admin_muvelet: muvelet,
    ...(hivatkozas ? { banki_hivatkozas: hivatkozas } : {}),
  };
  const valtozott = keziHiba(409, 'A tétel állapota ehhez a művelethez nem megfelelő. Frissítsd az oldalt.', 'STATE_CHANGED');
  const berelt = keziHiba(409, 'A tételen épp dolgozik a rendszer — próbáld újra egy perc múlva.', 'CIB_ROW_BUSY');
  const vege = async () => {
    const { rows: u } = await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid]);
    return { http: 200, body: { ok: true, allapot: lekepez(u[0]) }, jobId: s.job_id || null };
  };
  // ⚠️ 2026-10-04 (a PR-5 2. javítóköre): a bérletet eddig csak a fenti
  // SELECT nézte — a SELECT és az UPDATE között egy munkás (a kör) átvehette
  // a sort. Az UPDATE-ek most maguk is bérlet-feltételesek, és ha emiatt nem
  // írnak, CIB_ROW_BUSY a válasz (mint a rendezésnél).
  const BERLET_SZABAD = '(cib_lease_until IS NULL OR cib_lease_until < NOW())';
  const nemIrt = async () => {
    const { rowCount: most } = await db.query(
      'SELECT 1 FROM payment_sessions WHERE payment_id = $1 AND cib_lease_until IS NOT NULL AND cib_lease_until > NOW()', [trid],
    );
    return most ? berelt : valtozott;
  };

  if (muvelet === 'konyveles') {
    if (s.state !== 'pending' || s.cib_state !== 'closed_ok') return valtozott;
    if (s.berelt) return berelt;
    const { rowCount } = await db.query(
      `UPDATE payment_sessions SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('admin_konyveles', $2::jsonb)
        WHERE payment_id = $1 AND state = 'pending' AND cib_state = 'closed_ok' AND ${BERLET_SZABAD}`,
      [trid, JSON.stringify(admin)],
    );
    if (!rowCount) return nemIrt();
    await konyvel(trid);
    return vege();
  }

  if (muvelet === 'lejaratas') {
    if (s.state !== 'pending' || !LEJARATHATO.includes(s.cib_state)) return valtozott;
    if (s.berelt) return berelt;
    const b = p.cibBeallitasok();
    const bh = b.hangolok ? b : { hangolok: { zarasHataridoMp: ALAP_ZARAS_HATARIDO_MP } };
    if (!(await zarasiHataridoLejart(db, trid, bh))) {
      return keziHiba(409, 'A zárási határidő (a MSGT10 után 9 perc 30 mp) még nem járt le — a bank még lezárhatja.', 'CIB_DEADLINE_NOT_PASSED');
    }
    if (await kimenoZarasVan(trid)) {
      // Kiment MSGT32: kétes — a rendezés (a bankkal egyeztetve) dönt.
      try {
        const { rowCount } = await db.query(
          `UPDATE payment_sessions SET cib_state = 'close_unknown', cib_next_action_at = NOW(),
                  cib_lease_until = NULL, cib_lease_owner = NULL,
                  cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', 'admin_ketes', 'admin', $2::jsonb)
            WHERE payment_id = $1 AND state = 'pending' AND cib_state = $3 AND ${BERLET_SZABAD}`,
          [trid, JSON.stringify(admin), s.cib_state],
        );
        if (!rowCount) return nemIrt();
      } catch (err) {
        if (err && err.code === '23505') return valtozott;
        throw err;
      }
      await ketesLett(trid, 'admin_ketes');
      return vege();
    }
    const jovahagyott = ['authorized', 'closing'].includes(s.cib_state);
    const { rowCount } = await db.query(
      `UPDATE payment_sessions SET cib_state = 'expired', cib_next_action_at = NOW() + INTERVAL '30 seconds',
              cib_lease_until = NULL, cib_lease_owner = NULL,
              cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('ok', $4::text, 'admin', $2::jsonb)
        WHERE payment_id = $1 AND state = 'pending' AND cib_state = $3 AND ${BERLET_SZABAD}`,
      [trid, JSON.stringify(admin), s.cib_state, jovahagyott ? 'admin_lejaratas_jovahagyott' : 'admin_lejaratas'],
    );
    if (!rowCount) return nemIrt();
    // A jóváhagyott (authorized/closing) kísérlet „nem zárt"; a többi a
    // vásárló szemében sikertelen. Az indítás előtti (MSGT20 nélküli)
    // kísérletről értesítés nem megy (a vásárló a bankig sem jutott).
    await vegeSikertelen(trid, null, jovahagyott ? 'nem_zart' : 'sikertelen');
    return vege();
  }

  // visszaterites
  if (s.state !== 'needs_review' || s.cib_state !== 'closed_ok') return valtozott;
  const { rowCount } = await db.query(
    `UPDATE payment_sessions
        SET state = 'closed', closed_reason = 'admin_visszaterites', settled_at = NOW(),
            cib_next_action_at = NULL, cib_lease_until = NULL, cib_lease_owner = NULL,
            cib_result = COALESCE(cib_result, '{}'::jsonb)
              || jsonb_build_object('ok', 'admin_visszaterites', 'visszaterites', $2::jsonb || jsonb_build_object('at', NOW()))
      WHERE payment_id = $1 AND state = 'needs_review' AND cib_state = 'closed_ok'`,
    [trid, JSON.stringify(admin)],
  );
  if (!rowCount) return valtozott;
  // A pénzügyi nyom: külön esemény (a 087-es trigger az 'admin' típust nem
  // dolgozza fel, az állapotot a fenti UPDATE írja — mint a kupon-lezárás).
  await logPaymentEvent({
    paymentId: trid,
    status: 'Refunded',
    eventType: 'admin',
    jobId: s.job_id,
    totalAmount: Number(s.amount_huf),
    currency: s.currency || 'HUF',
    summary: `Refunded: a könyvelési árva díját az admin a banknál visszatérítette — fuvar ${s.job_id || '?'}`,
    processed: true,
  });
  await ertesitFeladot(trid, 'visszateritve').catch((err) => console.error('[cib] értesítés hiba:', err && err.message));
  return vege();
}

/** A rendezetlen (emberi teendős) CIB-tételek SQL-feltétele. */
const RENDEZETLEN_SQL = `((state = 'pending' AND cib_state = 'close_unknown') OR state = 'needs_review'
   OR (state = 'pending' AND cib_state = 'closed_ok'
       AND (COALESCE((cib_result->>'konyveles_hiba')::int, 0) >= ${KONYVELES_RIASZTAS_KUSZOB}
            OR (cib_result->>'closed_at')::timestamptz < NOW() - make_interval(mins => ${KONYVELES_RIASZTAS_PERC}))))`;

function rendezetlenOk(s) {
  const r = s.cib_result || {};
  if (s.state === 'needs_review') return 'konyvelesi_arva';
  if (s.cib_state === 'closed_ok') return 'konyvelesi_hiba';
  return r.ok || 'close_unknown';
}

/**
 * Riasztás-söprés (a lekérdező körből, 2026-10-03, PR-5):
 *   1. a parkoló (NULL teendő-idejű) kétes sorok visszakerülnek a körbe —
 *      a régi kód a close_unknown-t parkoltatta, egy elveszett riasztás után
 *      a tétel soha nem került elő;
 *   2. a riasztás nélküli rendezetlen tételek (kétes, könyvelési árva,
 *      tartós könyvelési hiba) riasztást kapnak;
 *   3. napi összesítő emlékeztető a 24 óránál régebben riasztott, még
 *      rendezetlen tételekről — egy levél, tételenként naponta legfeljebb egyszer.
 * Csak a bevezetés (CIB_BEVEZETES) utáni sorokhoz nyúl.
 */
async function riasztasSopres() {
  const b = p.cibBeallitasok();
  const bevezetes = b.bevezetes || p.CIB_BEVEZETES_ALAP;
  const hibak = [];
  const { rowCount: ebresztve } = await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = NOW()
      WHERE provider = 'cib' AND state = 'pending' AND cib_state = 'close_unknown'
        AND cib_next_action_at IS NULL AND created_at >= $1::date`,
    [bevezetes],
  );
  const { rows } = await db.query(
    `SELECT payment_id, state, cib_state, cib_result FROM payment_sessions
      WHERE provider = 'cib' AND cib_state IS NOT NULL AND created_at >= $1::date AND ${RENDEZETLEN_SQL}
      ORDER BY created_at LIMIT 100`,
    [bevezetes],
  );
  let riasztva = 0;
  for (const s of rows) {
    const ok = rendezetlenOk(s);
    try {
      // A riaszt maga dönt (okonként egyszer; a már riasztott sorra no-op).
      // eslint-disable-next-line no-await-in-loop
      if (await riaszt(s.payment_id, ok)) riasztva += 1;
    } catch (err) {
      hibak.push(err);
    }
  }
  // ⚠️ 2026-10-04 (a PR-5 2. javítóköre): a próbálkozás a küldés ELŐTT
  // jelölődik (claim: két példány sem küld kettőt), és a ki nem ment
  // emlékeztető legkorábban EMLEKEZTETO_UJRAPROBA_PERC múlva próbálkozik újra
  // — egy napokig tartó levélkiesés alatt eddig PERCENKÉNT ment napló,
  // Sentry-esemény és levélkísérlet (a Sentry-kvóta elfogyásával a többi
  // fizetési riasztás is elveszett volna).
  const { rows: regiek } = await db.query(
    `UPDATE payment_sessions
        SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('emlekezteto_probalkozas_at', NOW())
      WHERE payment_id IN (
        SELECT payment_id FROM payment_sessions
         WHERE provider = 'cib' AND cib_state IS NOT NULL AND created_at >= $1::date AND ${RENDEZETLEN_SQL}
           AND cib_result ? 'riasztas_at'
           AND COALESCE((cib_result->>'emlekezteto_at')::timestamptz, (cib_result->>'riasztas_at')::timestamptz)
               < NOW() - make_interval(hours => $2::int)
           AND (NOT (cib_result ? 'emlekezteto_probalkozas_at')
                OR (cib_result->>'emlekezteto_probalkozas_at')::timestamptz < NOW() - make_interval(mins => $3::int))
         ORDER BY created_at LIMIT 50
         FOR UPDATE SKIP LOCKED)
      RETURNING payment_id, job_id, state, cib_state, created_at`,
    [bevezetes, EMLEKEZTETO_ORA, EMLEKEZTETO_UJRAPROBA_PERC],
  );
  regiek.sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
  if (regiek.length) {
    const allapotKod = (s) => (s.state === 'needs_review' ? 'needs_review' : s.cib_state);
    const reszletek = regiek.map((s) => `${s.payment_id} (${allapotKod(s)})`).join(', ');
    // ⚠️ 2026-10-04 (a PR-5 1. javítóköre): a naplóba és a Sentrybe csak a
    // MASZKOLT TrID megy (a 16 jegyű szám kártyaszámnak látszhat — a Sentry
    // kártyaszám-szűrője elnyelné, és a változó üzenet minden nap új issue-t
    // nyitna); a teljes lista csak a levélbe kerül.
    const maszkolt = regiek.map((s) => `${p.maszkoltTrid(s.payment_id)} (${allapotKod(s)})`).join(', ');
    const uzenet = `[cib] ⏰ ${regiek.length} kártyás tétel több mint ${EMLEKEZTETO_ORA} órája rendezetlen: ${maszkolt}`;
    console.error(uzenet);
    sentry(`[cib] ⏰ kártyás tételek több mint ${EMLEKEZTETO_ORA} órája rendezetlenek`, 'warning');
    let kiment = false;
    try {
      // A sendEmail a végleges kiesésnél null-t ad (és maga riaszt).
      kiment = (await email.sendCibRiasztasEmail({
        to: b.riasztasEmail || 'info@gofuvar.hu', trid: null, jobId: null, ok: 'napi_emlekezteto', reszletek,
      })) != null;
    } catch (err) {
      hibak.push(err);
    }
    // A ki nem ment emlékeztető nem jelölődik: a következő esedékes söprés
    // (EMLEKEZTETO_UJRAPROBA_PERC múlva) újra küldi (eddig a levél kiesése
    // után 24 órára kimaradt).
    if (kiment) {
      await db.query(
        `UPDATE payment_sessions SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('emlekezteto_at', NOW())
          WHERE payment_id = ANY($1::text[])`,
        [regiek.map((s) => s.payment_id)],
      );
    }
  }
  if (hibak.length) throw hibak[0];
  return { ebresztve, riasztva, emlekeztetve: regiek.length };
}

/**
 * Induláskori (és napi) ellenőrzés (2026-10-03, PR-5): ha a CIB EKI-gépezet
 * NEM él (a konfig hiányos / hibás, vagy a provider nem CIB), de maradt nem
 * végső kártyás kísérlet, azt semmi nem zárja le — a kör nem fut, a
 * visszatérés 404, a fuvarok fagyva, a már terhelt díj könyveletlen.
 * Hangos hiba + Sentry + riasztó levél, állapotonkénti darabszámmal. A
 * teendő: a CIB-konfig visszaállítása, vagy a konfig nélküli admin-műveletek.
 * @returns {Promise<{osszes:number, allapotok:Record<string,number>}>}
 */
async function arvaKiserletekEllenorzese() {
  const paymentProvider = require('./paymentProvider');
  // ⚠️ 2026-10-04 (a PR-5 1. javítóköre): élő konfignál is van árva — a kör
  // és a riasztás-söprés csak a CIB_BEVEZETES utáni sorokhoz nyúl, így egy az
  // élesítéskor (recept: CIB_BEVEZETES = aznap) bent maradt, korábbi nem
  // végső kísérletet (kétes, könyveletlen, felülvizsgálandó) semmi nem látott,
  // a fuvar pedig fagyva maradt. Ilyenkor csak a bevezetés előtti sorokat
  // számoljuk.
  const el = paymentProvider.usesCibEki();
  const bevezetes = el ? (p.cibBeallitasok().bevezetes || p.CIB_BEVEZETES_ALAP) : null;
  const { rows } = await db.query(
    `SELECT CASE WHEN state = 'needs_review' THEN 'needs_review' ELSE cib_state END AS allapot, COUNT(*)::int AS n
       FROM payment_sessions
      WHERE provider = 'cib' AND cib_state IS NOT NULL AND state IN ('pending', 'needs_review')
        AND ($1::date IS NULL OR created_at < $1::date)
      GROUP BY 1 ORDER BY 1`,
    [bevezetes],
  );
  const allapotok = Object.fromEntries(rows.map((r) => [r.allapot, r.n]));
  const osszes = rows.reduce((o, r) => o + r.n, 0);
  if (!osszes) return { osszes, allapotok };
  let konfig;
  try { konfig = p.cibKonfig(); } catch { konfig = '?'; }
  const reszletek = rows.map((r) => `${r.allapot}: ${r.n}`).join(', ');
  const uzenet = el
    ? `[CIB] 🚨 ${osszes} nem végső kártyás kísérlet a CIB_BEVEZETES (${bevezetes}) ELŐTTRŐL (${reszletek}) — `
      + 'a lekérdező kör ezekhez nem nyúl, semmi nem zárja le őket. Rendezd őket az adminban (Fizetések → CIB: '
      + 'könyvelés / lejáratás / rendezés / visszatérítés), vagy állítsd korábbra a CIB_BEVEZETES-t.'
    : `[CIB] 🚨 A CIB EKI nem működik (konfig: ${konfig}, provider: ${paymentProvider.name()}), de ${osszes} `
      + `nem végső kártyás kísérlet maradt (${reszletek}) — ezeket semmi nem zárja le. Állítsd vissza a CIB-konfigot, `
      + 'vagy rendezd őket az adminban (Fizetések → CIB: könyvelés / lejáratás / rendezés / visszatérítés).';
  console.error(uzenet);
  sentry(uzenet, 'error');
  const b = p.cibBeallitasok();
  try {
    await email.sendCibRiasztasEmail({
      to: b.riasztasEmail || 'info@gofuvar.hu', trid: null, jobId: null, ok: 'arva_kiserletek', reszletek,
    });
  } catch (err) {
    console.error('[CIB] riasztó levél hiba:', err && err.message);
  }
  return { osszes, allapotok };
}

// ─────────────────────────────────────────────────────────────────────────
//  Leállás
// ─────────────────────────────────────────────────────────────────────────

/**
 * SIGTERM: nincs új bérlet, új zárási claim, új MSGT10 és új MSGT32; a
 * futó CIB-MUNKÁT (nem csak a banki HTTP-hívást, hanem az eredmény
 * rögzítését és a könyvelést is) megvárjuk a megadott ideig.
 *
 * ⚠️ 2026-09-29 (PR-2/C): eddig csak a futó HTTP-hívások számlálóját
 * figyeltük — a MSGT32 válasza után a leállás azonnal elengedett, a
 * `closed_ok` rögzítése a már lezárt poolba ütközött volna.
 */
async function leallitas({ varakozasMs = 0 } = {}) {
  allapot.leallas = true;
  const hatar = Date.now() + varakozasMs;
  while ((kliens.futoHivasokSzama() > 0 || allapot.munka > 0) && Date.now() < hatar) {
    // eslint-disable-next-line no-await-in-loop
    await varj(25);
  }
}

/**
 * Az erőszakos kilépés időkerete SIGTERM-kor (index.js): futó CIB-munka
 * mellett a zárási keret + 10 s (alapból 55 s — a Railway-en ehhez
 * RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60 kell), egyébként a megszokott 10 s.
 */
function leallasiKeretMs() {
  if (kliens.futoHivasokSzama() > 0 || allapot.munka > 0) {
    const b = p.cibBeallitasok();
    return ((b.hangolok && b.hangolok.zarasIdokeretMs) || 45000) + 10_000;
  }
  return 10_000;
}

/** CSAK TESZTHEZ: a memóriabeli állapot alaphelyzetbe. */
function __resetCibAllapotForTests() {
  allapot.utolsoTick = 0;
  allapot.leallas = false;
  allapot.megszakito = { hibak: 0, nyitvaEddig: 0, utolsoRiasztas: 0 };
  allapot.visszalepes = { eddig: 0, ms: 0 };
  allapot.visszateresRiasztas = 0;
  allapot.rendszerhiba = { szam: 0, kodok: new Set(), utolsoRiasztas: 0 };
  allapot.szemetVisszateres.ablak = {};
  allapot.szemetVisszateres.utolsoNaplo = 0;
}

/** CSAK TESZTHEZ: a D04-visszalépés lejár, a duplázó számláló marad. */
function __visszalepesVegeForTests() {
  allapot.visszalepes.eddig = 0;
}

module.exports = {
  // indítás + böngészős út
  inditCibDijFizetes,
  ujFizetesSzunetel,
  hopFelhasznal,
  visszateres,
  szemetVisszateresek,
  hibaOldalUrl,
  eredmenyAllapot,
  eredmenyToken,
  dijFizetesAllapot,
  // motor
  feldolgoz,
  lepes,
  berletFelszabadit,
  berletMegujit,
  ujBerlo,
  // admin
  ujraellenorzes,
  rendezes,
  keziRendezes,
  // üzemeltetés (2026-10-03, PR-5)
  riasztasSopres,
  arvaKiserletekEllenorzese,
  berletMp,
  lekepez,
  lekepezSql,
  UI_ALLAPOTOK,
  adatsor,
  // állapot
  szivveres,
  szivveresFriss,
  utolsoSzivveres,
  leallasFolyamatban,
  leallitas,
  leallasiKeretMs,
  munkaban,
  folyamatbanLevoMunka,
  varjHatterre,
  hibaValasz,
  __resetCibAllapotForTests,
  __visszalepesVegeForTests,
  BLOKKOLO,
  RIASZTAS_TEENDO,
};
