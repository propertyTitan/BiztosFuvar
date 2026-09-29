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
//      kérés után küldjük újra; kétes kimenetnél `close_unknown` + ember.
//   4. NEM FIZETHETŐ ÜGYLETET NEM ZÁRUNK LE: a lemondott / közben kifizetett /
//      díjsávot vagy szállítót váltott fuvarnál a MSGT32 elmarad
//      (`not_closed`), a bank magától feloldja a zárolást.
//
//  Egy TRID-en egyszerre csak a DB-bérlet (cib_lease_*) birtokosa dolgozhat:
//  a visszatérés, a lekérdező kör és az admin „Újraellenőrzés" ugyanazt a
//  `feldolgoz` motort hívja. A bérlő-azonosító hívásonként egyedi, így egy
//  folyamaton belüli párhuzamos hívás sem kerülheti meg.
//
//  Kimaradt (5. fázis, a bank írásos válasza után): MSGT37/70/74/78/80,
//  automatikus close_unknown-egyeztetés, a JÁRAT-foglalások CIB-ága.
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
const BERLET_PERC = 3; // a leghosszabb banki hívás (45 s) + könyvelés többszöröse
const SZIVVERES_MAX_MS = 2 * 60 * 1000;
const INDITAS_BLOKK_MP = 60; // ennél fiatalabb „initializing" mellett nincs új /pay
const INDITAS_ELHAGYOTT_MP = 120; // ennél régebbi „initializing" → abandoned
const ELSO_LEKERDEZES_MP = 90; // visszatérés nélkül ennyi után kérdezzük a bankot
const ZARAS_TURELEM_PERC = 8; // a 10–15 perces banki ablakon belül
const MAX_ZARASI_KISERLET = 3;
const MEGSZAKITO_KUSZOB = 5;
const MEGSZAKITO_NYITVA_MS = 10 * 60 * 1000;
const MEGSZAKITO_RIASZTAS_MS = 30 * 60 * 1000;
const VISSZALEPES_ALAP_MS = 2 * 60 * 1000;
const VISSZALEPES_MAX_MS = 8 * 60 * 1000;
const EREDMENY_TOKEN_MP = 24 * 3600;
const ISMETLODO_HIBA_KUSZOB = 3; // NT / mezőeltérés ennyiszer egymás után → ember
const HOP_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

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
  megszakito: { hibak: 0, nyitvaEddig: 0, utolsoRiasztas: 0 },
  visszalepes: { eddig: 0, ms: 0 },
  hatter: new Set(),
};

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

function megszakitoNyitva() {
  return Date.now() < allapot.megszakito.nyitvaEddig;
}

/**
 * A megszakító számlálója: 5 egymás utáni hálózati / S-hiba (IP-allowlist,
 * port, felcserélt kulcs) után 10 percig nem engedélyeztetünk új pénzt.
 * A már jóváhagyott tételek zárása ez alatt is fut.
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
    + '10 percig nem indul új kártyás fizetés (IP-allowlist, port, kulcs vagy környezet gyanú)';
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
  v.ms = v.ms ? Math.min(v.ms * 2, VISSZALEPES_MAX_MS) : VISSZALEPES_ALAP_MS;
  v.eddig = Date.now() + v.ms;
  console.warn(`[cib] D04 — a MSGT33-lekérdezések ${Math.round(v.ms / 1000)} mp-re szünetelnek`);
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

/** Egy CIB-kísérlet állapota a felhasználói felület nyelvén. */
function lekepez(s) {
  if (!s) return null;
  if (s.state === 'needs_review' || s.cib_state === 'close_unknown') return 'ellenorzes';
  switch (s.cib_state) {
    case 'closed_ok': return s.state === 'succeeded' ? 'sikeres' : 'feldolgozas';
    case 'failed':
    case 'expired':
    case 'init_failed':
    case 'abandoned': return 'sikertelen';
    case 'not_closed': {
      const ok = s.cib_result && s.cib_result.ok;
      return ok === 'mar_fizetve' || ok === 'kupon' ? 'mar_fizetve' : 'nem_terhelt';
    }
    default: return 'feldolgozas';
  }
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
  };
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
  mar_fizetve: {
    type: 'payment_not_charged',
    title: 'ℹ️ A díj már rendezve volt — nem terheltünk kétszer',
    body: (cim) => `A(z) "${cim}" fuvar kapcsolatfelvételi díja már rendezve volt, ezért ezt a kártyás fizetést nem zártuk le — a zárolt összeget a bank feloldja.`,
  },
});

/**
 * A feladó értesítése egy sikertelen / nem terhelt kísérletről — pontosan
 * egyszer (cib_notified_at claim), és CSAK ha a kísérlet eljutott a bankig.
 * Ha a fuvart közben egy másik kísérlettel kifizette, nem zavarjuk (kivéve a
 * „mar_fizetve" magyarázatot: ő ténylegesen jóváhagyott egy második
 * fizetést, ami függő tételként látszhat a kártyáján).
 */
async function ertesitFeladot(trid, tipus) {
  const { rows } = await db.query(
    `WITH claim AS (
       UPDATE payment_sessions SET cib_notified_at = NOW()
        WHERE payment_id = $1 AND cib_notified_at IS NULL AND cib_redirected_at IS NOT NULL
        RETURNING payment_id, job_id, amount_huf, currency, cib_result
     )
     SELECT claim.*, j.title, j.paid_at, j.shipper_id, u.email, u.full_name
       FROM claim JOIN jobs j ON j.id = claim.job_id JOIN users u ON u.id = j.shipper_id`,
    [trid],
  );
  const s = rows[0];
  if (!s) return;
  if (s.paid_at && tipus !== 'mar_fizetve') return;
  const r = s.cib_result || {};
  const cim = s.title || 'fuvar';
  const e = ERTESITES[tipus];
  await notifications.createNotification({
    user_id: s.shipper_id,
    type: e.type,
    title: e.title,
    body: e.body(cim),
    link: `/dashboard/fuvar/${s.job_id}`,
  }).catch(() => {});
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
  realtime.emitToUser(s.shipper_id, 'cib:eredmeny', { job_id: s.job_id, trid, allapot: tipus === 'sikertelen' ? 'sikertelen' : tipus });
}

/**
 * Riasztás (close_unknown / könyvelési árva) — TRID-enként EGYSZER:
 * Sentry error + e-mail a CIB_RIASZTAS_EMAIL-re + admin in-app. Csak a
 * TrID és a fuvar azonosítója megy ki, személyes adat nem.
 */
async function riaszt(trid, ok) {
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('riasztas_at', NOW())
      WHERE payment_id = $1 AND NOT (COALESCE(cib_result, '{}'::jsonb) ? 'riasztas_at')
      RETURNING job_id`,
    [trid],
  );
  if (!rows[0]) return;
  const jobId = rows[0].job_id;
  const uzenet = `[cib] 🚨 KÉZI EGYEZTETÉS KELL: ${p.maszkoltTrid(trid)} (${ok}) — a kontakt rejtve, a fuvar fagyasztva; `
    + 'MSGT32 újraküldés NINCS. Admin → Fizetések → CIB.';
  console.error(uzenet);
  sentry(uzenet, 'error');
  const b = p.cibBeallitasok();
  hatterben(() => email.sendCibRiasztasEmail({
    to: b.riasztasEmail || 'info@gofuvar.hu', trid, jobId, ok,
  }), 'cib_riasztas');
  try {
    const { rows: adminok } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 10`);
    for (const a of adminok) {
      // eslint-disable-next-line no-await-in-loop
      await notifications.createNotification({
        user_id: a.id,
        type: 'cib_review',
        title: '🚨 Kártyás fizetés kézi egyeztetést igényel',
        body: `TrID: ${trid} — fuvar: ${jobId || '?'} (${ok}). A bankkal egyeztetve az adminban rendezd.`,
        link: '/admin#fizetesek',
      }).catch(() => {});
    }
  } catch { /* az admin-értesítés hiánya nem akaszthatja meg a riasztást */ }
}

// ─────────────────────────────────────────────────────────────────────────
//  Könyvelés (a closed_ok UTÁN, újrapróbálhatóan, MSGT32 NÉLKÜL)
// ─────────────────────────────────────────────────────────────────────────
async function konyvel(trid, berlo = null) {
  let hiba = null;
  try {
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
  // Még pending (kivétel vagy egy párhuzamos claim): a kör 30 s múlva újra
  // könyvel — MSGT32 NÉLKÜL.
  const szam = Number((s.cib_result && s.cib_result.konyveles_hiba) || 0) + (hiba ? 1 : 0);
  await db.query(
    `UPDATE payment_sessions SET cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || jsonb_build_object('konyveles_hiba', $2::int)
      WHERE payment_id = $1 AND cib_state = 'closed_ok' AND state = 'pending'
        AND ($3::text IS NULL OR cib_lease_owner = $3 OR cib_lease_owner IS NULL)`,
    [trid, szam, berlo],
  );
  if (hiba && szam >= 3) sentry(`[cib] a banki zárás sikeres, de a könyvelés ${szam}. alkalommal is elbukott: ${p.maszkoltTrid(trid)}`);
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
      // eslint-disable-next-line no-await-in-loop
      const ins = await client.query(
        `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, currency,
                                       provider, is_simulated, state, cib_state, cib_next_action_at, cib_result)
         VALUES ($1, $2, $3, $4, $5, 'HUF', 'cib', FALSE, 'pending', 'initializing',
                 NOW() + make_interval(secs => $6::int), $7::jsonb)
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
 */
async function inditCibDijFizetes({ entityType = 'job', entityId, shipperId }) {
  if (entityType !== 'job') return hibaValasz('CIB_UNAVAILABLE');
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes') return hibaValasz('CIB_UNAVAILABLE');
  // Nem engedélyeztetünk pénzt, ha nincs, ami lezárja (a lekérdező kör ezen
  // a példányon nem fut), vagy ha a bank-kapcsolat épp rossz.
  if (allapot.leallas || !szivveresFriss() || megszakitoNyitva()) return hibaValasz('PAYMENT_TEMPORARILY_UNAVAILABLE');

  const kezd = Date.now();
  for (let kiserlet = 1; kiserlet <= 3; kiserlet += 1) {
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
  // lemondhatták / kuponnal fizethették — a MSGT10 alatt nincs zár).
  const { rowCount } = await db.query(
    `UPDATE payment_sessions s
        SET cib_state = 'ready', cib_hop_hash = $2,
            cib_hop_expires_at = NOW() + make_interval(secs => $3::int),
            cib_next_action_at = NOW() + make_interval(secs => $3::int + 5)
      WHERE s.payment_id = $1 AND s.cib_state = 'initializing' AND s.state = 'pending'
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id AND j.status = 'accepted' AND j.paid_at IS NULL)`,
    [trid, sha256(token), b.hangolok.hopTtlMp],
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
async function hopFelhasznal(token) {
  const web = webBase();
  const ismeretlen = { status: 303, location: `${web}/fizetes/eredmeny?hiba=link` };
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes' || typeof token !== 'string' || !HOP_TOKEN_RE.test(token)) return ismeretlen;
  const hash = sha256(token);
  const { rows } = await db.query(
    `UPDATE payment_sessions s
        SET cib_state = 'redirected', cib_redirected_at = NOW(),
            cib_next_action_at = NOW() + make_interval(secs => $2::int)
      WHERE s.cib_hop_hash = $1 AND s.cib_state = 'ready' AND s.state = 'pending'
        AND s.cib_hop_expires_at > NOW()
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id AND j.status = 'accepted' AND j.paid_at IS NULL)
      RETURNING payment_id, job_id`,
    [hash, ELSO_LEKERDEZES_MP],
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
    await inditasiVegallapot(regi[0].payment_id, 'abandoned', 'ready', regi[0].lejart ? 'hop_lejart' : 'nem_fizetheto');
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
  const naplozHibat = async (trid, osztaly) => {
    await kliens.naploz({
      trid, irany: 'bongeszo_be', msgt: 21, endpoint: 'vissza', raw: raw.slice(0, 4000), hibaOsztaly: osztaly,
    }).catch(() => {});
    console.warn(`[cib] érvénytelen visszatérés (${osztaly})`);
    sentry('[cib] érvénytelen banki visszatérés (MSGT21)', 'warning');
  };
  if (!raw || raw.length > 4000) {
    await naplozHibat(null, 'visszafejtes');
    return hibas;
  }
  let mezok;
  try {
    mezok = eki.ekiDecrypt(raw, b.kulcs);
  } catch {
    await naplozHibat(null, 'visszafejtes');
    return hibas;
  }
  const trid = typeof mezok.TRID === 'string' ? mezok.TRID.trim() : '';
  if (mezok.MSGT !== '21' || mezok.PID !== b.pid || !p.TRID_RE.test(trid)) {
    await naplozHibat(p.TRID_RE.test(trid) ? trid : null, 'mezo_elteres');
    return hibas;
  }
  const { rows } = await db.query(
    `UPDATE payment_sessions SET cib_returned_at = COALESCE(cib_returned_at, NOW())
      WHERE payment_id = $1 AND provider = 'cib' AND cib_state = ANY($2::text[])
      RETURNING payment_id`,
    [trid, VISSZATERHETO],
  );
  if (!rows[0]) {
    await naplozHibat(null, 'mezo_elteres');
    return hibas;
  }
  await kliens.naploz({
    trid, irany: 'bongeszo_be', msgt: 21, endpoint: 'vissza', raw,
  }).catch(() => {});
  // Az első MSGT33 azonnal megy (a köz a motorban véd a visszajátszás ellen).
  hatterFeldolgoz(trid, 'visszateres');
  return { status: 303, location: `${web}/fizetes/eredmeny?e=${encodeURIComponent(eredmenyToken(trid))}` };
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
            (ps.cib_last_query_at IS NULL OR ps.cib_last_query_at < NOW() - make_interval(secs => $2::int)) AS lekerdezheto,
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
  if (allapotSzo === 'feldolgozas' && s.state === 'pending'
      && ((['redirected', 'authorized'].includes(s.cib_state) && s.lekerdezheto) || s.cib_state === 'closed_ok')) {
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

/**
 * GET /jobs/:id/fee-payment — a fuvar kártyás díjfizetésének állapota a
 * FELADÓNAK (a szállító soha nem kapja: a feladó fizetési munkamenete).
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
  const utolso = rows.find((s) => s.cib_result && typeof s.cib_result.rc === 'string')
    || rows.find((s) => ['failed', 'expired', 'not_closed', 'closed_ok'].includes(s.cib_state));
  return {
    provider_kind: ut === 'stub' ? 'stub' : 'cib',
    can_pay: job.status === 'accepted' && !job.paid_at && !blokkolt && ut !== 'hibas',
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
 * Egy TRID feldolgozása a bérlet birtokában. Ha más dolgozik rajta (élő
 * bérlet), azonnal kilép. Soha nem fut belőle két példány egy TRID-en.
 */
async function feldolgoz(trid, forras = 'kulso') {
  if (allapot.leallas) return { kihagyva: 'leallas' };
  const b = p.cibBeallitasok();
  if (b.allapot !== 'teljes' || !p.TRID_RE.test(String(trid || ''))) return { kihagyva: 'konfig' };
  const berlo = ujBerlo();
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_lease_until = NOW() + make_interval(mins => $3::int), cib_lease_owner = $2
      WHERE payment_id = $1 AND provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL
        AND (cib_lease_until IS NULL OR cib_lease_until < NOW())
      RETURNING *, NOW() AS db_most`,
    [trid, berlo, BERLET_PERC],
  );
  if (!rows[0]) return { kihagyva: 'berelt' };
  try {
    await lepes(rows[0], berlo, forras, { maradekKeres: 1, megszakitva: false });
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
    case 'close_unknown': return closeUnknownLepes(sor, berlo);
    case 'closed_ok': return konyvel(sor.payment_id, berlo);
    default: return vegallapotEsemeny(sor.payment_id, berlo);
  }
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
 */
async function lekerdezesIras(trid, berlo, {
  uj = null, eredmeny = {}, kovetkezoKif = null, kovetkezoParam = [],
}) {
  const params = [trid, berlo, uj, JSON.stringify(eredmeny), ...kovetkezoParam];
  const { rowCount } = await db.query(
    `UPDATE payment_sessions
        SET cib_state = COALESCE($3::text, cib_state),
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb,
            cib_last_query_at = NOW(), cib_query_count = cib_query_count + 1,
            cib_next_action_at = ${kovetkezoKif || 'NULL'}
      WHERE payment_id = $1 AND cib_state = 'redirected' AND cib_lease_owner = $2`,
    params,
  );
  return rowCount > 0;
}

async function redirectedLepes(sor, berlo, b, ctx) {
  const trid = sor.payment_id;
  const most = new Date(sor.db_most || Date.now()).getTime();
  const koz = b.hangolok.lekerdezesKozMs;
  // TRID-enkénti köz (a D04 ellen): a visszajátszott visszatérés sem kérdez
  // gyakrabban.
  if (sor.cib_last_query_at && new Date(sor.cib_last_query_at).getTime() > most - koz) {
    return kovetkezo(trid, berlo, 'cib_last_query_at + make_interval(secs => $3::int)', [Math.ceil(koz / 1000)]);
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
  const kozMp = Math.ceil(koz / 1000);
  const helyiLejart = sor.cib_redirected_at
    && new Date(sor.cib_redirected_at).getTime() < most - b.hangolok.kiserletMaxPerc * 60000;
  const eredmenyAdat = (a, forrasKod) => ({
    rc: a.rc, rt: a.rt, anum: a.anum, amo: a.amo, cur: a.cur, forras: forrasKod,
  });

  if (k.kimenet === 'engedelyezve') {
    visszalepesVege();
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'authorized',
      eredmeny: { msgt33_rc: '00', authorized_at: new Date().toISOString(), zaras_eredete: 'authorized' },
      kovetkezoKif: 'NOW()',
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
          ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_elutasitas', zaras_eredete: 'declined', authorized_at: new Date().toISOString(),
        },
        kovetkezoKif: 'NOW()',
      });
      if (!ok) return null;
      return zar(await friss(trid), berlo, b);
    }
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'failed',
      eredmeny: { ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_elutasitas' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  if (k.kimenet === 'lejart') {
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'expired',
      eredmeny: { ...eredmenyAdat(k.adatok, '33'), msgt33_rc: k.adatok.rc, ok: 'bank_to' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  if (k.kimenet === 'visszalepes') {
    visszalepesInditasa();
    await lekerdezesIras(trid, berlo, {
      kovetkezoKif: 'to_timestamp($5::double precision)', kovetkezoParam: [allapot.visszalepes.eddig / 1000],
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
    // A CRC nem MAC: egy a DB-vel nem egyező válaszra NEM építünk. Ha
    // ismétlődik (rossz AMO/TRID/PID nálunk), ember nézzen rá.
    const kulcs = k.kimenet === 'mezo_elteres' ? 'mezo_elteres_szam' : 'nt_szam';
    const szam = Number((sor.cib_result && sor.cib_result[kulcs]) || 0) + 1;
    if (k.kimenet === 'mezo_elteres') sentry(`[cib] CIB_MEZO_ELTERES a MSGT31-ben (${k.mezo}): ${p.maszkoltTrid(trid)}`, 'error');
    if (szam >= ISMETLODO_HIBA_KUSZOB) {
      const ok = await lekerdezesIras(trid, berlo, {
        uj: 'close_unknown',
        eredmeny: { [kulcs]: szam, ok: k.kimenet === 'mezo_elteres' ? 'zaras_mezo_elteres' : 'nt_ismetlodo' },
      });
      if (ok) await riaszt(trid, k.kimenet === 'mezo_elteres' ? 'zaras_mezo_elteres' : 'nt_ismetlodo');
      return null;
    }
    await lekerdezesIras(trid, berlo, {
      eredmeny: { [kulcs]: szam },
      kovetkezoKif: 'NOW() + make_interval(secs => $5::int)',
      kovetkezoParam: [kozMp],
    });
    return null;
  }
  // Folyamatban (PR), hálózati / D-hiba vagy S-hiba: a helyi határidő után
  // lejárt — egy ennyire régi, le nem zárt jóváhagyást a bank már reverzált,
  // lezárni pedig soha nem fogjuk.
  if (helyiLejart) {
    const ok = await lekerdezesIras(trid, berlo, {
      uj: 'expired',
      eredmeny: { ok: 'helyi_hatarido', forras: 'helyi' },
      kovetkezoKif: "NOW() + INTERVAL '30 seconds'",
    });
    if (ok) await vegeSikertelen(trid, berlo, 'sikertelen');
    return null;
  }
  await lekerdezesIras(trid, berlo, {
    kovetkezoKif: 'NOW() + make_interval(secs => $5::int)',
    kovetkezoParam: [kozMp],
  });
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

async function closingLepes(sor, berlo, b) {
  // A zárás közben elhalt folyamat (összeomlás, deploy): a bérlet lejárt, a
  // MSGT32-re nem jött (vagy nem rögzült) válasz → kétes. MSGT32 SOHA újra.
  const { rowCount } = await db.query(
    `UPDATE payment_sessions SET cib_state = 'close_unknown', cib_next_action_at = NULL,
            cib_result = COALESCE(cib_result, '{}'::jsonb) || '{"ok":"zaras_valasz_nelkul"}'::jsonb
      WHERE payment_id = $1 AND cib_state = 'closing' AND cib_lease_owner = $2
        AND cib_close_sent_at < NOW() - make_interval(secs => $3::int)`,
    [sor.payment_id, berlo, Math.ceil((b.hangolok.zarasIdokeretMs + 60000) / 1000)],
  );
  if (rowCount) return riaszt(sor.payment_id, 'zaras_valasz_nelkul');
  return kovetkezo(sor.payment_id, berlo, 'cib_close_sent_at + make_interval(secs => $3::int)',
    [Math.ceil((b.hangolok.zarasIdokeretMs + 60000) / 1000)]);
}

async function closeUnknownLepes(sor, berlo) {
  // A belépéskor egyszer riaszt (claim), utána parkol: csak admin mozdítja.
  await riaszt(sor.payment_id, (sor.cib_result && sor.cib_result.ok) || 'close_unknown');
  await kovetkezo(sor.payment_id, berlo, 'NULL');
}

// ─────────────────────────────────────────────────────────────────────────
//  PONTOSAN EGYSZERI ZÁRÁS
// ─────────────────────────────────────────────────────────────────────────

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
    const masikZar = masok.some((s) => s.state === 'pending' && ['closing', 'close_unknown'].includes(s.cib_state));

    let ok = null;
    if (!job) ok = 'nem_fizetheto';
    else if (job.paid_at) ok = Number(job.connection_fee_huf) === 0 ? 'kupon' : 'mar_fizetve';
    else if (masikFizetett) ok = 'mar_fizetve';
    else if (job.status !== 'accepted') ok = 'nem_fizetheto';
    else if (job.carrier_id !== sor.carrier_id || job.shipper_id !== sor.shipper_id) ok = 'szallito_valtozott';
    else if (Number(job.connection_fee_huf) !== Number(sor.amount_huf)) ok = 'dijsav_valtozott';
    else if (r.amo != null && Number(r.amo) !== Number(sor.amount_huf)) ok = 'amo_elteres';

    if (!ok && masikZar) {
      // Egy másik TRID épp zár (vagy kétes): várunk; 8 perc után feladjuk
      // (a bank a zárolást magától feloldja).
      const authorizedAt = r.authorized_at ? new Date(r.authorized_at).getTime() : NaN;
      const most = new Date(job.most).getTime();
      if (Number.isFinite(authorizedAt) && most - authorizedAt > ZARAS_TURELEM_PERC * 60000) ok = 'masik_zaras';
      else return { eredmeny: 'var' };
    }

    if (ok) {
      // Nem fizethető: MSGT32 NINCS. Az elutasított eredetű kísérlet
      // „failed" (a MSGT33 adataival), a jóváhagyott „not_closed".
      const uj = eredete === 'declined' ? 'failed' : 'not_closed';
      const eredmeny = eredete === 'declined' ? { zaras_elmaradt: ok } : { ok };
      await client.query(
        `UPDATE payment_sessions SET cib_state = $3, cib_next_action_at = NOW() + INTERVAL '30 seconds',
                cib_result = COALESCE(cib_result, '{}'::jsonb) || $4::jsonb
          WHERE payment_id = $1 AND cib_state = 'authorized' AND cib_lease_owner = $2`,
        [trid, berlo, uj, JSON.stringify(eredmeny)],
      );
      await client.query('COMMIT');
      lezarva = true;
      return { eredmeny: 'nem_zarhato', ok, uj };
    }

    let upd;
    try {
      upd = await client.query(
        `UPDATE payment_sessions
            SET cib_state = 'closing', cib_close_sent_at = NOW(), cib_close_attempts = cib_close_attempts + 1,
                cib_next_action_at = NOW() + make_interval(secs => $3::int)
          WHERE payment_id = $1 AND cib_state = 'authorized' AND cib_lease_owner = $2
            AND cib_close_attempts < $4
          RETURNING cib_close_attempts`,
        [trid, berlo, Math.ceil((b.hangolok.zarasIdokeretMs + 60000) / 1000), MAX_ZARASI_KISERLET],
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
    return null;
  }
  if (jog.eredmeny === 'nem_zarhato') {
    console.log(`[cib] ${p.maszkoltTrid(trid)}: nem fizethető a jóváhagyáskor (${jog.ok}) → ${jog.uj}, MSGT32 nélkül`);
    let tipus = 'nem_terhelt';
    if (jog.uj === 'failed') tipus = 'sikertelen';
    else if (jog.ok === 'mar_fizetve' || jog.ok === 'kupon') tipus = 'mar_fizetve';
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
  megszakitoJelez(['nem_kuldott', 'idokeret', 'halozat', 'bank_S'].includes(v.hibaOsztaly), !!v.mezok);

  if (kim.kimenet === 'siker') {
    // Egy késői, hiteles 00 ugyanarra a kísérletre a close_unknown-ból is
    // elfogadható (18. átmenet) — a kísérletszám köti a válaszhoz.
    const { rowCount } = await db.query(
      `UPDATE payment_sessions
          SET cib_state = 'closed_ok', cib_next_action_at = NOW() + INTERVAL '30 seconds',
              cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb
        WHERE payment_id = $1 AND cib_close_attempts = $2 AND cib_state IN ('closing', 'close_unknown')`,
      [trid, k, JSON.stringify({
        rc: kim.adatok.rc, rt: kim.adatok.rt, anum: kim.adatok.anum, amo: kim.adatok.amo, cur: kim.adatok.cur,
        forras: '32', ok: null, closed_at: new Date().toISOString(),
      })],
    );
    if (!rowCount) {
      sentry(`[cib] sikeres MSGT31, de a sor már nem zárható állapotban: ${p.maszkoltTrid(trid)}`, 'error');
      return null;
    }
    console.log(`[cib] ✅ ${p.maszkoltTrid(trid)}: lezárva (closed_ok)`);
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
    const authorizedAt = sor.cib_result && sor.cib_result.authorized_at ? new Date(sor.cib_result.authorized_at).getTime() : Date.now();
    const turelemben = Date.now() - authorizedAt < ZARAS_TURELEM_PERC * 60000;
    if (k < MAX_ZARASI_KISERLET && turelemben) {
      const mp = Math.ceil((kim.visszalepesMs || 30000) / 1000);
      await zarasIras('authorized', { zaras_bank_rc: kim.bankRc || null }, `NOW() + make_interval(secs => ${mp})`);
      return null;
    }
    if (await zarasIras('close_unknown', { ok: 'zaras_nem_feldolgozott', zaras_bank_rc: kim.bankRc || null }, 'NULL')) {
      await riaszt(trid, 'zaras_nem_feldolgozott');
    }
    return null;
  }
  // Kétes: időtúllépés / bontás a küldés után, 5xx RC nélkül, D05, S-hiba,
  // visszafejtési vagy mezőeltérés. MSGT32 SOHA újra.
  if (await zarasIras('close_unknown', { ok: kim.ok || 'zaras_valasz_nelkul', zaras_bank_rc: kim.bankRc || null }, 'NULL')) {
    await riaszt(trid, kim.ok || 'zaras_valasz_nelkul');
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────────────────────────────────

/** „Újraellenőrzés": a következő lépés a köz tiszteletben tartásával esedékes. */
async function ujraellenorzes(trid) {
  const b = p.cibBeallitasok();
  const kozMp = Math.ceil(((b.hangolok && b.hangolok.lekerdezesKozMs) || 60000) / 1000);
  const { rows } = await db.query(
    `UPDATE payment_sessions
        SET cib_next_action_at = GREATEST(NOW(), COALESCE(cib_last_query_at + make_interval(secs => $2::int), NOW()))
      WHERE payment_id = $1 AND provider = 'cib' AND state = 'pending' AND cib_state IS NOT NULL
        AND cib_state <> 'close_unknown'
      RETURNING cib_next_action_at <= NOW() AS esedekes`,
    [trid, kozMp],
  );
  if (!rows[0]) {
    const { rowCount } = await db.query('SELECT 1 FROM payment_sessions WHERE payment_id = $1 AND cib_state IS NOT NULL', [trid]);
    return rowCount ? { ok: true } : null;
  }
  if (rows[0].esedekes && b.allapot === 'teljes') hatterFeldolgoz(trid, 'admin');
  return { ok: true };
}

/**
 * Admin-rendezés egy kétes (close_unknown) kísérletre, a bankkal egyeztetve.
 * @returns {Promise<{http:number, body:object}>}
 */
async function rendezes(trid, { eredmeny, indoklas, anum }, adminId) {
  if (!['lezarva', 'nem_lezarva'].includes(eredmeny)) {
    return { http: 400, body: { error: 'Az eredmény „lezarva" vagy „nem_lezarva" lehet.', code: 'INVALID_VALUE' } };
  }
  if (typeof indoklas !== 'string' || indoklas.trim().length < 10 || indoklas.trim().length > 2000) {
    return { http: 400, body: { error: 'Az indoklás 10–2000 karakter legyen.', code: 'INVALID_VALUE' } };
  }
  if (eredmeny === 'lezarva' && (typeof anum !== 'string' || !/^[A-Za-z0-9]{1,6}$/.test(anum))) {
    return { http: 400, body: { error: 'A lezárt tranzakcióhoz a banki engedélyszám (ANUM) kötelező.', code: 'INVALID_VALUE' } };
  }
  const lezarva = eredmeny === 'lezarva';
  const adat = lezarva
    ? {
      forras: 'admin', rc: '00', anum, admin_id: adminId, admin_indoklas: indoklas.trim(), closed_at: new Date().toISOString(), ok: 'admin',
    }
    : {
      forras: 'admin', admin_id: adminId, admin_indoklas: indoklas.trim(), ok: 'admin',
    };
  const { rowCount } = await db.query(
    `UPDATE payment_sessions
        SET cib_state = $2, cib_next_action_at = NOW() + INTERVAL '30 seconds',
            cib_result = COALESCE(cib_result, '{}'::jsonb) || $3::jsonb,
            cib_lease_until = NULL, cib_lease_owner = NULL
      WHERE payment_id = $1 AND cib_state = 'close_unknown' AND state = 'pending'`,
    [trid, lezarva ? 'closed_ok' : 'failed', JSON.stringify(adat)],
  );
  if (!rowCount) {
    return { http: 409, body: { error: 'Csak függő, kétes (close_unknown) kísérlet rendezhető.', code: 'STATE_CHANGED' } };
  }
  if (lezarva) await konyvel(trid);
  else await vegeSikertelen(trid, null, 'nem_terhelt');
  const { rows } = await db.query('SELECT * FROM payment_sessions WHERE payment_id = $1', [trid]);
  return { http: 200, body: { ok: true, allapot: lekepez(rows[0]) } };
}

// ─────────────────────────────────────────────────────────────────────────
//  Leállás
// ─────────────────────────────────────────────────────────────────────────

/**
 * SIGTERM: nincs új bérlet, új zárási claim és új MSGT32; a futó banki
 * hívásokat (egy MSGT32-t) megvárjuk a megadott ideig.
 */
async function leallitas({ varakozasMs = 0 } = {}) {
  allapot.leallas = true;
  const hatar = Date.now() + varakozasMs;
  while (kliens.futoHivasokSzama() > 0 && Date.now() < hatar) {
    // eslint-disable-next-line no-await-in-loop
    await varj(25);
  }
}

/** CSAK TESZTHEZ: a memóriabeli állapot alaphelyzetbe. */
function __resetCibAllapotForTests() {
  allapot.utolsoTick = 0;
  allapot.leallas = false;
  allapot.megszakito = { hibak: 0, nyitvaEddig: 0, utolsoRiasztas: 0 };
  allapot.visszalepes = { eddig: 0, ms: 0 };
}

module.exports = {
  // indítás + böngészős út
  inditCibDijFizetes,
  hopFelhasznal,
  visszateres,
  eredmenyAllapot,
  eredmenyToken,
  dijFizetesAllapot,
  // motor
  feldolgoz,
  lepes,
  berletFelszabadit,
  ujBerlo,
  // admin
  ujraellenorzes,
  rendezes,
  lekepez,
  adatsor,
  // állapot
  szivveres,
  szivveresFriss,
  utolsoSzivveres,
  leallasFolyamatban,
  leallitas,
  varjHatterre,
  hibaValasz,
  __resetCibAllapotForTests,
  BERLET_PERC,
  BLOKKOLO,
};
