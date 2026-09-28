// =====================================================================
//  SOCKET-ÁRADAT vs. DB-POOL — VALÓDI KAPCSOLATTAL (2026-09-28, audit P1, R2-5)
//
//  ⚠️ A HIBA: egyetlen hitelesített socket az EGÉSZ API-t leállíthatta. A
//  globális HTTP rate limit (index.js) a websocket-eseményekre nem hat, az
//  `io.use` csak a JWT-t nézi, a `job:join` pedig BÁRMILYEN stringre (akár
//  véletlen UUID-ra) lefuttatott egy lekérdezést — fojtás, duplikátum-szűrés
//  és függő-plafon nélkül. Néhány ezer esemény/mp korlátlanul sorba állt a
//  30 kapcsolatos poolon, és a `connectionTimeoutMillis` lejártával MINDEN
//  DB-kötött REST-kérés „timeout exceeded when trying to connect" → 500 lett.
//
//  Amit mérünk (valódi socket.io-kliens, valódi szerver, valódi pool):
//   (1) egy socket 2000 véletlen `job:join`-ja mellett a REST 200-at ad, a
//       lefutott fuvar-lekérdezések száma korlátos, a jogos belépés működik,
//       a kívülálló továbbra sem jut be;
//   (2) SOK socket együtt sem lépheti túl a folyamat-szintű plafont — ez az
//       OSZTÁLY-garancia (a socketenkénti korlát önmagában nem elég);
//   (3) a handshake is DB-t ér: egy fiók egyidejű socketjei plafonosak, és a
//       nyit-bont ciklus sem viszi el a poolt.
//
//  A Neon-körutat a mérő SZIMULÁLJA: a socket-eredetű lekérdezés a késleltetés
//  ALATT is fogja a pool-kapcsolatot (ahogy egy lassú körút élesben), és a
//  pool várakozási kerete a tesztben rövidebb — így a telítődés másodpercek
//  alatt kimérhető, nem kell hozzá több tízezer esemény.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

const http = require('http');
const { io: kliens } = require('socket.io-client');

const { app, db, createUser, createJob } = require('./helpers');
const { app: expressApp } = require('../src/index');
const realtime = require('../src/realtime');

// A socket-réteg lekérdezései — mind KIZÁRÓLAG a realtime.js-ből indulnak (a
// REST-hitelesítés más oszlopsorrendet kérdez, azt nem számoljuk).
const JOB_SQL = 'SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)';
const HANDSHAKE_SQL = 'SELECT token_version, email_verified, role FROM users WHERE id = $1';
const AKTIVITAS_SQL = ['UPDATE users SET last_seen_at = NOW() WHERE id = $1', 'total_active_seconds = total_active_seconds +'];
// A dokumentált plafon (SOCKET_DB_MAX_INFLIGHT, alap 4): a 30-as pool kis szelete.
const MAX_SOCKET_FUT = 5;
// Egy fiók egyidejű socketjei (SOCKET_MAX_PER_USER, alap 20).
const MAX_SOCKET_PER_USER = 20;

let szerver;
let io;
let cim;
let nyitott = [];
let eredetiKeret;
const eredetiQuery = db.query;

beforeAll(async () => {
  szerver = http.createServer(expressApp);
  await new Promise((r) => { szerver.listen(0, '127.0.0.1', r); });
  szerver.unref();
  io = realtime.init(szerver);
  cim = `http://127.0.0.1:${szerver.address().port}`;
  // Rövidebb pool-várakozás, hogy a telítődés gyorsan kimérhető legyen (élesben 5 s).
  eredetiKeret = db.pool.options.connectionTimeoutMillis;
  db.pool.options.connectionTimeoutMillis = 1500;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of nyitott.splice(0)) { try { s.close(); } catch { /* már zárt */ } }
  // A következő teszt tiszta poollal induljon: a lemaradt várakozók lecsengenek.
  await vi.waitFor(() => expect(db.pool.waitingCount).toBe(0), { timeout: 15000, interval: 50 });
  await varakoz(100);
});

afterAll(async () => {
  db.pool.options.connectionTimeoutMillis = eredetiKeret;
  await new Promise((r) => { io.close(() => r()); });
});

const varakoz = (ms) => new Promise((r) => { setTimeout(r, ms); });

function csatlakoz(token) {
  const s = kliens(cim, {
    auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false,
  });
  nyitott.push(s);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

function varEsemenyt(socket, nev, ms = 800) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(nev, (adat) => { clearTimeout(t); resolve(adat ?? {}); });
  });
}

/** Igaz lesz-e a feltétel a határidőn belül (nem dob — a mérés folytatódik). */
async function varjIgaz(feltetel, ms) {
  const vege = Date.now() + ms;
  while (Date.now() < vege) {
    if (feltetel()) return true;
    await varakoz(25);
  }
  return feltetel();
}

const szerverOldali = (s) => io.sockets.sockets.get(s.id);

/**
 * A db.query mérője: megszámolja a socket-eredetű lekérdezéseket és az
 * EGYSZERRE futók csúcsát. `kesleltetes` ms-ig a pool-kapcsolatot is fogja.
 */
function mero({ kesleltetes = 0 } = {}) {
  const meres = {
    job: 0, handshake: 0, fut: 0, csucs: 0,
  };
  vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
    const s = String(sql);
    const jobE = s.includes(JOB_SQL);
    const handshakeE = s.includes(HANDSHAKE_SQL);
    const socketos = jobE || handshakeE || AKTIVITAS_SQL.some((a) => s.includes(a));
    if (!socketos) return eredetiQuery(sql, params);
    if (jobE) meres.job += 1;
    if (handshakeE) meres.handshake += 1;
    meres.fut += 1;
    meres.csucs = Math.max(meres.csucs, meres.fut);
    try {
      if (!kesleltetes) return await eredetiQuery(sql, params);
      const kapcsolat = await db.pool.connect();
      try {
        await varakoz(kesleltetes);
        return await kapcsolat.query(sql, params);
      } finally { kapcsolat.release(); }
    } finally { meres.fut -= 1; }
  });
  return meres;
}

// A REST-oldal tünete: a pool-várakozás miatt lassú, majd 500-as válaszok.
// (A lassúság ÉLESBEN is hiba: a web 15 s-os kerete előbb lejár, mint a DB-é.)
const REST_PLAFON_MS = 1000;
async function restKorok(user, db_ = 6) {
  const valaszok = await Promise.all(Array.from({ length: db_ }, async () => {
    const kezdet = Date.now();
    const r = await request(app).get('/auth/me').set('Authorization', `Bearer ${user.token}`);
    return { status: r.status, ms: Date.now() - kezdet };
  }));
  return {
    statuszok: valaszok.map((v) => v.status),
    leglassabb: Math.max(...valaszok.map((v) => v.ms)),
  };
}

function restEllenorzes({ statuszok, leglassabb }, uzenet) {
  expect.soft(statuszok, `${uzenet} — a REST 500-at adott.`).toEqual(Array(statuszok.length).fill(200));
  expect.soft(
    leglassabb,
    `${uzenet} — a leglassabb REST-válasz ${leglassabb} ms (plafon ${REST_PLAFON_MS} ms): `
    + 'a socket-lekérdezések elfoglalták a poolt, a REST a sorukban várt.',
  ).toBeLessThan(REST_PLAFON_MS);
}

describe('Socket-áradat: a DB-pool a REST-é marad', () => {
  it('egy socket 2000 véletlen job:join-ja: REST él, a lekérdezés-szám korlátos, a jogos belépés működik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const idegen = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const aradat = await csatlakoz(felado.token);
    const jogos = await csatlakoz(felado.token); // ugyanaz a fiók, másik fül
    const kivulallo = await csatlakoz(idegen.token);
    const meres = mero({ kesleltetes: 100 });

    // Folyamatos áradat: 10 × 200 esemény, 50 ms-onként (egy löket után a
    // pool-sor lecsengene — élesben a támadó nem áll meg).
    const aradatVege = (async () => {
      for (let k = 0; k < 10; k += 1) {
        for (let i = 0; i < 200; i += 1) aradat.emit('job:join', randomUUID());
        await varakoz(50);
      }
    })();
    await varakoz(220);
    // Az áradat KÖZBEN: a jogos fül a saját fuvarjába lép, a kívülálló ugyanoda próbál.
    jogos.emit('job:join', job.id);
    kivulallo.emit('job:join', job.id);
    const rest = await restKorok(felado);
    await aradatVege;

    restEllenorzes(
      rest,
      'A SOCKET-ÁRADAT ELVITTE A DB-POOLT.\n\n'
      + 'Egyetlen hitelesített socket job:join-jai korlátlanul sorba álltak a\n'
      + 'poolon; a connectionTimeoutMillis lejártával minden DB-kötött REST-kérés\n'
      + '„timeout exceeded when trying to connect" → 500. A socket-eredetű\n'
      + 'lekérdezéseknek folyamat-szintű plafon kell (a pool kis szelete)',
    );

    const belepett = await varjIgaz(() => !!szerverOldali(jogos)?.rooms.has(`job:${job.id}`), 6000);
    expect.soft(belepett, 'A JOGOS belépés az áradat alatt/után sem sikerült — a korlát túl széles.').toBe(true);
    const jogosFigyelo = varEsemenyt(jogos, 'tracking:ping');
    const kivulFigyelo = varEsemenyt(kivulallo, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 47.5, lng: 19.05 });
    expect.soft(await jogosFigyelo, 'a feladó nem kapta meg a saját fuvarja élő eseményét').not.toBeNull();
    expect.soft(await kivulFigyelo, 'a KÍVÜLÁLLÓ bejutott más fuvarjának szobájába').toBeNull();

    expect.soft(
      meres.job,
      `2000 véletlen azonosítóból ${meres.job} lekérdezés lett — a job:join-nak `
      + 'socketenkénti fojtás, függő-plafon és olcsó előszűrés kell a DB-munka előtt.',
    ).toBeLessThan(200);
    expect.soft(
      meres.csucs,
      `Egyszerre ${meres.csucs} socket-lekérdezés futott/várt a poolon (plafon: ${MAX_SOCKET_FUT}).`,
    ).toBeLessThanOrEqual(MAX_SOCKET_FUT);
  });

  it('nem-UUID, már meglévő tagság és függő duplikátum: nincs lekérdezés', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'in_progress', paid: true });
    const s = await csatlakoz(felado.token);
    const meres = mero({ kesleltetes: 60 });

    for (let i = 0; i < 300; i += 1) s.emit('job:join', `nem-uuid-${i}`);
    for (let i = 0; i < 50; i += 1) s.emit('job:join', job.id); // függő duplikátumok
    await varjIgaz(() => !!szerverOldali(s)?.rooms.has(`job:${job.id}`), 3000);
    for (let i = 0; i < 50; i += 1) s.emit('job:join', job.id); // már bent van
    await varakoz(300);

    expect.soft(szerverOldali(s)?.rooms.has(`job:${job.id}`), 'a jogos belépés elmaradt').toBe(true);
    expect.soft(
      meres.job,
      `${meres.job} fuvar-lekérdezés futott 400 eseményre — a nem-UUID azonosító, a már `
      + 'meglévő tagság és az ugyanarra az azonosítóra függő belépés nem érheti a poolt.',
    ).toBe(1);
    expect.soft(s.connected, 'a jogos (duplikált) belépések miatt bontottuk a socketet').toBe(true);
  });

  it('SOK socket együtt sem lépi túl a folyamat-szintű plafont (osztály-garancia)', async () => {
    const userek = await Promise.all(Array.from({ length: 10 }, () => createUser({ role: 'carrier' })));
    const socketek = [];
    for (const u of userek) {
      socketek.push(await csatlakoz(u.token), await csatlakoz(u.token));
    }
    const meres = mero({ kesleltetes: 100 });

    // Socketenként 30 belépés: egyenként a socketenkénti keret ALATT marad —
    // csak a folyamat-szintű plafon foghatja meg az összegüket (600).
    for (const s of socketek) for (let i = 0; i < 30; i += 1) s.emit('job:join', randomUUID());
    await varakoz(150);
    restEllenorzes(
      await restKorok(userek[0]),
      'Sok socket együttes áradata elvitte a poolt — a socketenkénti korlát\n'
      + 'önmagában nem elég, folyamat-szintű plafon kell',
    );
    expect.soft(
      meres.csucs,
      `Egyszerre ${meres.csucs} socket-lekérdezés futott/várt (plafon: ${MAX_SOCKET_FUT}).`,
    ).toBeLessThanOrEqual(MAX_SOCKET_FUT);
  });

  it('egy fiók sok socketje sem tölti meg a közös sort — MÁS fiók jogos belépése átmegy', async () => {
    const tamado = await createUser({ role: 'carrier' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'in_progress', paid: true });
    const socketek = [];
    for (let i = 0; i < MAX_SOCKET_PER_USER; i += 1) socketek.push(await csatlakoz(tamado.token));
    const jogos = await csatlakoz(felado.token);
    mero({ kesleltetes: 100 });

    // Socketenként 30 (a socketenkénti keret alatt) — együtt 600 függő belépés egy fiókról.
    for (const s of socketek) for (let i = 0; i < 30; i += 1) s.emit('job:join', randomUUID());
    await varakoz(100);
    jogos.emit('job:join', job.id);

    const belepett = await varjIgaz(() => !!szerverOldali(jogos)?.rooms.has(`job:${job.id}`), 6000);
    expect(
      belepett,
      'EGYETLEN FIÓK socketjei megtöltötték a közös várólistát, és egy MÁSIK fiók\n'
      + 'jogos szoba-belépése eldobódott — az élő követés némán megszűnt. A függő\n'
      + 'belépéseket fiókonként is plafonozni kell, hogy egy fiók ne sajátíthassa ki a sort.',
    ).toBe(true);
  });

  it('egy fiók legfeljebb N egyidejű socketje hitelesül — a többi DB-munka nélkül vendég', async () => {
    const user = await createUser({ role: 'shipper' });
    const masik = await createUser({ role: 'shipper' });
    const meres = mero();

    const kliensek = await Promise.all(Array.from({ length: 40 }, () => csatlakoz(user.token)));
    await varakoz(100);
    const hitelesitett = kliensek.filter((s) => szerverOldali(s)?.data.user?.sub === user.id).length;

    expect.soft(
      hitelesitett,
      `${hitelesitett} egyidejű hitelesített socket egy fiókon — a handshake DB-t ér, `
      + `fiókonként legfeljebb ${MAX_SOCKET_PER_USER} lehet.`,
    ).toBeLessThanOrEqual(MAX_SOCKET_PER_USER);
    expect.soft(hitelesitett, 'a plafon alatt a socketek hitelesüljenek').toBeGreaterThan(0);
    expect.soft(
      meres.handshake,
      `${meres.handshake} handshake-lekérdezés 40 socketre — a plafon FELETT nem kell DB-munka.`,
    ).toBeLessThanOrEqual(MAX_SOCKET_PER_USER);
    // Más fiók hitelesítése közben is működik.
    const s2 = await csatlakoz(masik.token);
    await varakoz(50);
    expect.soft(szerverOldali(s2)?.data.user?.sub, 'egy másik fiók socketje nem hitelesült').toBe(masik.id);
  });

  it('a nyit-bont ciklus (handshake-áradat) sem viszi el a poolt', async () => {
    const user = await createUser({ role: 'shipper' });
    const meres = mero({ kesleltetes: 100 });

    const hullamok = (async () => {
      for (let hullam = 0; hullam < 4; hullam += 1) {
        const kliensek = Array.from({ length: 60 }, () => kliens(cim, {
          auth: { token: user.token }, transports: ['websocket'], forceNew: true, reconnection: false,
        }));
        await varakoz(60);
        for (const k of kliensek) k.close();
      }
    })();
    await varakoz(90);
    const rest = await restKorok(user);
    await hullamok;
    restEllenorzes(rest, 'A handshake-áradat alatt');
    expect.soft(
      meres.csucs,
      `Egyszerre ${meres.csucs} socket-lekérdezés (handshake) futott/várt (plafon: ${MAX_SOCKET_FUT}).`,
    ).toBeLessThanOrEqual(MAX_SOCKET_FUT);
  });
});

describe('socketDbKorlat — egységszinten', () => {
  it('plafon, korlátos sor, csendes eldobás, okafogyott tétel kihagyása, előny a handshake-nek', async () => {
    const { createSocketDbKorlat } = require('../src/utils/socketDbKorlat');
    const korlat = createSocketDbKorlat({ maxInFlight: 2, maxQueue: 3 });
    const kapuk = [];
    let fut = 0;
    let csucs = 0;
    const lassu = (ertek) => () => new Promise((resolve) => {
      fut += 1; csucs = Math.max(csucs, fut);
      kapuk.push(() => { fut -= 1; resolve(ertek); });
    });
    const eredmeny = (p) => p.then((v) => ({ ok: v }), (e) => ({ hiba: e.code }));

    const a = eredmeny(korlat.run(lassu('a')));
    const b = eredmeny(korlat.run(lassu('b')));
    let cOkafogyott = false;
    const c = eredmeny(korlat.run(lassu('c'), { ervenyes: () => !cOkafogyott }));
    const d = eredmeny(korlat.run(lassu('d')));
    const e = eredmeny(korlat.run(lassu('e')));
    // A sor tele (c, d, e): a normál tétel eldobódik, a handshake kiszorítja a legfrissebbet.
    const f = eredmeny(korlat.run(lassu('f')));
    const h = eredmeny(korlat.run(lassu('h'), { elsobbseg: true }));
    // Az elhagyható tétel terhelés alatt nem is kerül sorba.
    const x = eredmeny(korlat.run(lassu('x'), { elhagyhato: true }));
    // A „c" közben okafogyottá válik (bontott socket): lekérdezés nélkül esik ki.
    cOkafogyott = true;

    expect(await f).toEqual({ hiba: 'SOCKET_DB_ELDOBVA' });
    expect(await e).toEqual({ hiba: 'SOCKET_DB_ELDOBVA' });
    expect(await x).toEqual({ hiba: 'SOCKET_DB_ELDOBVA' });
    while (kapuk.length || fut) {
      await varakoz(5);
      kapuk.shift()?.();
    }
    expect(await a).toEqual({ ok: 'a' });
    expect(await b).toEqual({ ok: 'b' });
    expect(await h).toEqual({ ok: 'h' });
    expect(await c).toEqual({ hiba: 'SOCKET_DB_ELDOBVA' });
    expect(await d).toEqual({ ok: 'd' });
    expect(csucs).toBe(2);
    // Szinkron kivétel sem szabadulhat el: a hívó hibaágán landol.
    expect(await eredmeny(korlat.run(() => { throw new Error('szinkron'); }))).toEqual({ hiba: undefined });
    expect(korlat.allapot()).toMatchObject({ fut: 0, sor: 0 });
  });
});
