// =====================================================================
//  SOCKET HANDSHAKE, SZOBA-ELHAGYÁS, KILAKOLTATÁS, JELENLÉT
//
//  Mit fed le, amit a `socket-szoba-jogosultsag.test.js` NEM:
//
//   (1) A HANDSHAKE token-ellenőrzésének HIBAÁGAI. A meglévő suite csak a
//       „van érvényes token" és a „nincs token" végleteket járja. Köztük van
//       az összes valós támadás- és élethelyzet: hamis aláírás, lejárt token,
//       TÖRÖLT felhasználó tokenje, és a jelszó-reset / force-logout utáni
//       `token_version` eltérés. Ezek MIND „vendég" kell legyenek — ha
//       bármelyik hitelesítettként megy át, a `user:<id>` szoba (értesítések,
//       chat-előnézet, fizetési gateway-link) és a `job:<id>` szoba (élő GPS,
//       fotó-URL-ek) nyílik meg annak, akit épp kizártunk.
//
//   (2) A SZEREPKÖR FORRÁSA. A realtime.js 38-45. sora külön kiemeli: a
//       szerep a DB-BŐL jön, nem a JWT-ből — mert az `isAdmin()` DB-ellenőrzés
//       NÉLKÜL enged be BÁRMELYIK fuvar szobájába. Ezt eddig semmi nem mérte:
//       egy saját kezűleg `role:'admin'`-ra írt (de érvényesen aláírt) token
//       elég lett volna. Itt a támadás alakjában mérjük.
//
//   (3) A SZOBÁK ELHAGYÁSA (`job:leave` / `feed:leave` / `user:leave`), a
//       KILAKOLTATÁS (`evictUserFromJob` — a leváltott szállító ne kapja az
//       ÚJ szállító GPS-ét) és a KÉNYSZERBONTÁS (`disconnectUser` —
//       force-logout / fiók-törlés a NYITOTT socketre is hasson).
//
//   (4) A JELENLÉT-NÉZET (`getPresence`): dedup, vendég-számlálás, szerepkör
//       — és hogy e-mail-cím NINCS benne (2026-08-11, 9. mérés A3).
//
//  MÓDSZER: valódi Socket.IO szerver + valódi kliens, szoba-TAGSÁGOT mérünk
//  (megkapja-e a kliens azt, amit nem szabadna). Kommenttel vagy átnevezéssel
//  egyik teszt sem elégíthető ki.
// =====================================================================
import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: kliens } = require('socket.io-client');

const { db, createUser, createJob } = require('./helpers');
const { app: expressApp } = require('../src/index');
const realtime = require('../src/realtime');

let szerver;
let cim;
/** Minden megnyitott kliens — az afterEach zárja őket (a jelenlét-teszt miatt fontos). */
let nyitottKliensek = [];

beforeAll(async () => {
  szerver = http.createServer(expressApp);
  await new Promise((r) => { szerver.listen(0, r); });
  szerver.unref();
  realtime.init(szerver);
  cim = `http://127.0.0.1:${szerver.address().port}`;
});

afterEach(async () => {
  for (const s of nyitottKliensek) { try { s.close(); } catch { /* már zárt */ } }
  nyitottKliensek = [];
  // A szerver-oldali disconnect aszinkron — a jelenlét-mérés csak akkor
  // indulhat tiszta lappal, ha a socketek tényleg lekerültek.
  await varakoz(120);
});

afterAll(async () => {
  await new Promise((r) => { szerver.close(r); });
});

const varakoz = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Csatlakozott kliens adott tokennel (null = vendég). */
function csatlakoz(token) {
  const s = kliens(cim, {
    auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false,
  });
  nyitottKliensek.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 4000);
  });
}

/** Megvárja, hogy az esemény MEGÉRKEZIK-e a megadott időn belül (null = nem jött). */
function varEsemenyt(socket, nev, ms = 500) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(nev, (adat) => { clearTimeout(t); resolve(adat ?? {}); });
  });
}

/** Saját kezűleg aláírt token — a helpers-é nem paraméterezhető. */
function tokent(payload, { titok = process.env.JWT_SECRET, opts = { expiresIn: '1h' } } = {}) {
  return jwt.sign(payload, titok, opts);
}

/**
 * Hitelesítettnek látja-e a szerver ezt a kapcsolatot?
 * A `user:join` KIZÁRÓLAG hitelesített socketet enged be a saját szobájába,
 * tehát ez a legpontosabb (és legkevésbé megkerülhető) próbája annak, hogy a
 * handshake usernek vagy vendégnek minősítette-e a kapcsolatot.
 */
async function hitelesitettE(socket, userId) {
  socket.emit('user:join');
  await varakoz(200);
  const figyelo = varEsemenyt(socket, 'notification:new');
  realtime.emitToUser(userId, 'notification:new', { title: 'proba' });
  return (await figyelo) !== null;
}

// =====================================================================
//  1) A HANDSHAKE HIBAÁGAI — mindegyik VENDÉG kell legyen
// =====================================================================
describe('Handshake: melyik tokennel NEM lehet hitelesített a socket', () => {
  it('HAMIS ALÁÍRÁSÚ token → vendég (nem elég dekódolni, ellenőrizni kell)', async () => {
    const user = await createUser({ role: 'shipper' });
    const hamis = tokent({ sub: user.id, role: 'shipper' }, { titok: 'egy-teljesen-mas-titok' });

    const s = await csatlakoz(hamis);
    expect(
      await hitelesitettE(s, user.id),
      'HAMIS ALÁÍRÁSÚ TOKENNEL HITELESÍTETT LETT A SOCKET.\n\n'
      + 'Ekkor bárki, aki ismer egy user-azonosítót, saját maga gyárthat\n'
      + 'tokent, és megkapja az illető ÖSSZES értesítését: chat-előnézetet,\n'
      + 'vita-leírást, admin-levelezést és a foglalás fizetési gateway-linkjét.\n'
      + 'A handshake-nek `jwt.verify`-t kell használnia (aláírás-ellenőrzéssel),\n'
      + 'nem `jwt.decode`-ot.',
    ).toBe(false);
  });

  it('LEJÁRT token → vendég', async () => {
    const user = await createUser({ role: 'shipper' });
    const lejart = tokent({ sub: user.id, role: 'shipper' }, { opts: { expiresIn: '-30s' } });

    const s = await csatlakoz(lejart);
    expect(
      await hitelesitettE(s, user.id),
      'LEJÁRT TOKENNEL HITELESÍTETT LETT A SOCKET — a munkamenet időbeli\n'
      + 'korlátja elveszett a real-time csatornán (a REST-en él).',
    ).toBe(false);
  });

  it('TÖRÖLT felhasználó tokenje → vendég', async () => {
    const user = await createUser({ role: 'shipper' });
    const token = user.token;
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);

    const s = await csatlakoz(token);
    expect(
      await hitelesitettE(s, user.id),
      'A TÖRÖLT FIÓK TOKENJE MÉG MINDIG HITELESÍT.\n\n'
      + 'A GDPR 17. cikk szerinti törlés után a nyitott/újranyitott fül\n'
      + 'tovább kapná a szobába érkező üzeneteket. A handshake-nek a DB-ből\n'
      + 'kell visszaigazolnia a felhasználó létezését, nem elég a token.',
    ).toBe(false);
  });

  it('ELAVULT token_version (jelszó-reset / force-logout) → vendég', async () => {
    const user = await createUser({ role: 'shipper' });
    // A régi token még tv=0-t hordoz; a DB-ben közben nőtt a verzió.
    const regiToken = tokent({ sub: user.id, role: 'shipper', tv: 0 });
    await db.query('UPDATE users SET token_version = 1 WHERE id = $1', [user.id]);

    const s = await csatlakoz(regiToken);
    expect(
      await hitelesitettE(s, user.id),
      'A JELSZÓ-RESET UTÁN A RÉGI TOKENNEL ÚJRA HITELESÍTHETŐ A SOCKET.\n\n'
      + 'Épp ez a lényege a token_version bumpnak: az ellopott tokennel nyitott\n'
      + 'fül ne kapja tovább az értesítéseket, az élő GPS-t és a feed pontos\n'
      + 'címeit. A REST-oldal (middleware/auth.js) ellenőrzi — a socketnek is\n'
      + 'kell.',
    ).toBe(false);
  });

  it('EGYEZŐ token_version → viszont hitelesített (a kapu nem túl szigorú)', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET token_version = 3 WHERE id = $1', [user.id]);
    const jo = tokent({ sub: user.id, role: 'shipper', tv: 3 });

    const s = await csatlakoz(jo);
    expect(
      await hitelesitettE(s, user.id),
      'AZ ÉRVÉNYES, FRISS TOKEN SEM HITELESÍT — a kapu túl szigorú, a\n'
      + 'jelszó-változtatás után senki nem kapna többé értesítést.',
    ).toBe(true);
  });
});

// =====================================================================
//  2) A SZEREPKÖR A DB-BŐL JÖN, NEM A JWT-BŐL
// =====================================================================
describe('Az admin-jog forrása a DB, nem a token', () => {
  it('JWT-ben hamisított role:"admin" NEM nyit ki idegen fuvar-szobát', async () => {
    const tamado = await createUser({ role: 'shipper' }); // a DB-ben NEM admin
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    // ÉRVÉNYESEN aláírt token — csak a `role` claim hazudik.
    const adminnakHazudo = tokent({ sub: tamado.id, role: 'admin', email: tamado.email });

    const s = await csatlakoz(adminnakHazudo);
    s.emit('job:join', job.id);
    await varakoz(250);

    const figyelo = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 47.4979, lng: 19.0402 });

    expect(
      await figyelo,
      'A TOKENBE ÍRT role:"admin" MEGNYITOTTA AZ IDEGEN FUVAR SZOBÁJÁT.\n\n'
      + 'Az isAdmin() ág DB-ellenőrzés NÉLKÜL lép be BÁRMELYIK fuvar\n'
      + 'szobájába — onnan jön az élő GPS, a felvételi/kézbesítési fotók URL-je\n'
      + 'és a nyers ajánlat-sor. A szerepkört a DB-ből kell olvasni\n'
      + '(realtime.js: `role: rows[0].role`), különben bárki adminná írja\n'
      + 'magát a saját tokenjében.',
    ).toBeNull();
  });

  it('a jelenlét-nézet is a DB szerepkörét mutatja, nem a tokenét', async () => {
    const user = await createUser({ role: 'carrier' });
    const hazudo = tokent({ sub: user.id, role: 'admin', email: user.email });
    await csatlakoz(hazudo);
    await varakoz(150);

    const sor = realtime.getPresence().users.find((u) => u.id === user.id);
    expect(sor, 'a csatlakozott felhasználó nem jelent meg a jelenlét-nézetben').toBeTruthy();
    expect(
      sor.role,
      'A JELENLÉT-NÉZET A TOKENBŐL VETTE A SZEREPKÖRT — az admin-panel\n'
      + 'by_role bontása így tetszőlegesen hamisítható, és „adminként" mutatna\n'
      + 'egy közönséges felhasználót.',
    ).toBe('carrier');
  });

  it('a VALÓDI (DB-beli) admin viszont beléphet bármelyik fuvar szobájába', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    const s = await csatlakoz(admin.token);
    s.emit('job:join', job.id);
    await varakoz(250);

    const figyelo = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 1, lng: 2 });
    expect(
      await figyelo,
      'A VALÓDI ADMIN sem lát rá a fuvar élő szobájára — a vita-kivizsgálás\n'
      + '(admin-panel „A felek chatje" / követés) így használhatatlan lenne.',
    ).not.toBeNull();
  });
});

// =====================================================================
//  3) A SZOBÁK ELHAGYÁSA
// =====================================================================
describe('Kilépés a szobákból', () => {
  it('job:leave után nem érkezik több fuvar-esemény', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'in_progress', paid: true });

    const s = await csatlakoz(felado.token);
    s.emit('job:join', job.id);
    await varakoz(250);

    // 1) Bizonyítjuk, hogy tényleg bent van (különben a 2. lépés hamis zöld).
    const elso = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 1, lng: 1 });
    expect(await elso, 'a résztvevő be sem lépett a szobába — a teszt nem mérne semmit').not.toBeNull();

    // 2) Kilép — innentől semmit nem kaphat.
    s.emit('job:leave', job.id);
    await varakoz(200);
    const masodik = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 2, lng: 2 });

    expect(
      await masodik,
      'A job:leave NEM LÉPTET KI a szobából.\n\n'
      + 'A kliens akkor küldi, amikor a felhasználó elhagyja a fuvar oldalát —\n'
      + 'ha nem hat, a böngésző a háttérben tovább kapja az élő GPS-pozíciót és\n'
      + 'a fotó-URL-eket, ráadásul a fül élettartamáig gyűlik a felesleges\n'
      + 'helyadat (adattakarékosság).',
    ).toBeNull();
  });

  it('feed:leave után nem érkezik több piactér-esemény', async () => {
    const user = await createUser({ role: 'carrier' });
    const s = await csatlakoz(user.token);
    s.emit('feed:join');
    await varakoz(200);

    const elso = varEsemenyt(s, 'jobs:new');
    realtime.emitToFeed('jobs:new', { id: 'a' });
    expect(await elso, 'a megerősített fiók be sem lépett a feedbe').not.toBeNull();

    s.emit('feed:leave');
    await varakoz(200);
    const masodik = varEsemenyt(s, 'jobs:new');
    realtime.emitToFeed('jobs:new', { id: 'b', pickup_address: 'Budapest, Váci út 1.' });

    expect(
      await masodik,
      'A feed:leave NEM LÉPTET KI a piactér-szobából — a kilépett/oldalt\n'
      + 'elhagyó kliens tovább kapja az új fuvarok HÁZSZÁMIG PONTOS címét.',
    ).toBeNull();
  });

  it('user:leave után nem érkezik több személyes értesítés', async () => {
    const user = await createUser({ role: 'shipper' });
    const s = await csatlakoz(user.token);
    expect(await hitelesitettE(s, user.id), 'be sem lépett a saját szobájába').toBe(true);

    s.emit('user:leave');
    await varakoz(200);
    const figyelo = varEsemenyt(s, 'notification:new');
    realtime.emitToUser(user.id, 'notification:new', { title: 'Új üzenet', body: 'privát' });

    expect(
      await figyelo,
      'A user:leave NEM LÉPTET KI a személyes szobából — a kijelentkezés után\n'
      + 'nyitva maradt fül tovább kapná a felhasználó értesítéseit.',
    ).toBeNull();
  });

  it('szemét (nem string) jobId nem bontja meg a kapcsolatot', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'in_progress', paid: true });
    const s = await csatlakoz(felado.token);

    // Rossz típus + nem létező/hibás alakú azonosító (a kliens állapota
    // elavulhat: régi fül, félbemaradt navigáció).
    s.emit('job:join', { jobId: job.id });
    s.emit('job:join', 'nem-egy-uuid');
    s.emit('job:leave', 12345);
    await varakoz(300);

    expect(s.connected, 'a szemét paraméter BONTOTTA a socketet').toBe(true);
    // …és a kapcsolat utána is használható a jogos szobára
    s.emit('job:join', job.id);
    await varakoz(250);
    const figyelo = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 3, lng: 3 });
    expect(
      await figyelo,
      'A HIBÁS AZONOSÍTÓ UTÁN A SOCKET HASZNÁLHATATLAN LETT — egy elgépelt\n'
      + 'vagy elavult fuvar-azonosító nem béníthatja meg a kapcsolatot a\n'
      + 'munkamenet hátralévő részére.',
    ).not.toBeNull();
  });
});

// =====================================================================
//  4) KILAKOLTATÁS ÉS KÉNYSZERBONTÁS
// =====================================================================
describe('evictUserFromJob — a jogosultság megszűnésekor kitesszük a szobából', () => {
  it('a leváltott szállító NEM kapja tovább a fuvar élő eseményeit', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const s = await csatlakoz(szallito.token);
    s.emit('job:join', job.id);
    await varakoz(250);
    const elso = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 1, lng: 1 });
    expect(await elso, 'a szállító be sem lépett — a teszt nem mérne semmit').not.toBeNull();

    await realtime.evictUserFromJob(szallito.id, job.id);

    const masodik = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 2, lng: 2 });
    expect(
      await masodik,
      'A KILAKOLTATÁS HATÁSTALAN.\n\n'
      + 'A szállító-csere (díjmentes újraválasztás) után a LEVÁLTOTT szállító\n'
      + 'nyitott füle tovább kapja az ÚJ szállító élő GPS-pingjeit és a\n'
      + 'felvételi/kézbesítési fotók URL-jeit — egy fuvarból, amihez már\n'
      + 'semmi köze. A belépéskori ellenőrzés ezt nem fogja meg: a socket a\n'
      + 'fül bezárásáig bent marad.',
    ).toBeNull();
  });

  it('CSAK a megnevezett felhasználót teszi ki — a feladó bent marad', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const sFelado = await csatlakoz(felado.token);
    const sSzallito = await csatlakoz(szallito.token);
    sFelado.emit('job:join', job.id);
    sSzallito.emit('job:join', job.id);
    await varakoz(300);

    await realtime.evictUserFromJob(szallito.id, job.id);

    const feladoFigyelo = varEsemenyt(sFelado, 'tracking:ping');
    const szallitoFigyelo = varEsemenyt(sSzallito, 'tracking:ping');
    realtime.emitToJob(job.id, 'tracking:ping', { lat: 5, lng: 5 });

    expect(
      await feladoFigyelo,
      'A KILAKOLTATÁS MINDENKIT KITETT A SZOBÁBÓL.\n\n'
      + 'A feladó élő követése némán megszűnne minden szállító-cserénél —\n'
      + 'a `socket.data.user.sub === userId` szűrés nélkül a védelem túl széles.',
    ).not.toBeNull();
    expect(await szallitoFigyelo, 'a leváltott szállító mégis bent maradt').toBeNull();
  });

  it('a kilakoltatás CSAK a megadott fuvar szobájára hat, a másikra nem', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const jobA = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });
    const jobB = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    const s = await csatlakoz(szallito.token);
    s.emit('job:join', jobA.id);
    s.emit('job:join', jobB.id);
    await varakoz(300);

    // Csak az „A" fuvarról váltják le.
    await realtime.evictUserFromJob(szallito.id, jobA.id);

    const bFigyelo = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(jobB.id, 'tracking:ping', { lat: 9, lng: 9 });
    expect(
      await bFigyelo,
      'AZ EGYIK FUVARRÓL VALÓ LEVÁLTÁS AZ ÖSSZES TÖBBIRŐL IS KITETTE.\n\n'
      + 'Egy párhuzamosan futó, jogos fuvar élő követése szűnne meg némán\n'
      + '(a szállítónak több fuvarja is lehet egyszerre). A kilakoltatásnak a\n'
      + 'SZOBÁRA kell szűkítenie (io.in(szoba)), nem az összes socketre.',
    ).not.toBeNull();

    const aFigyelo = varEsemenyt(s, 'tracking:ping');
    realtime.emitToJob(jobA.id, 'tracking:ping', { lat: 8, lng: 8 });
    expect(await aFigyelo, 'az „A" fuvarból mégsem lett kitéve').toBeNull();
  });
});

describe('disconnectUser — a force-logout a NYITOTT socketre is hat', () => {
  it('bontja a felhasználó kapcsolatát, és utána nem kap értesítést', async () => {
    const user = await createUser({ role: 'shipper' });
    const s = await csatlakoz(user.token);
    expect(await hitelesitettE(s, user.id), 'be sem lépett a saját szobájába').toBe(true);

    const bontasVart = new Promise((resolve) => { s.once('disconnect', () => resolve(true)); });
    await realtime.disconnectUser(user.id);
    const bontott = await Promise.race([bontasVart, varakoz(800).then(() => false)]);

    expect(
      bontott,
      'A FORCE-LOGOUT / FIÓK-TÖRLÉS NEM BONTJA A NYITOTT SOCKETET.\n\n'
      + 'A socket hitelesítése CSAK a handshake-kor fut: a REST-oldalt a\n'
      + 'token_version bump lezárja, a már nyitott fül viszont tovább kapja a\n'
      + '`user:<id>` szoba tartalmát (mások neve, chat-előnézet) és bent marad\n'
      + 'a `feed`-ben is, ahol a pontos címek mennek.',
    ).toBe(true);

    const figyelo = varEsemenyt(s, 'notification:new');
    realtime.emitToUser(user.id, 'notification:new', { title: 'utólagos' });
    expect(await figyelo, 'a bontás után is kapott értesítést').toBeNull();
  });

  it('CSAK a megnevezett felhasználót bontja — a többiek kapcsolata él', async () => {
    const kitiltott = await createUser({ role: 'shipper' });
    const masik = await createUser({ role: 'carrier' });
    const sKitiltott = await csatlakoz(kitiltott.token);
    const sMasik = await csatlakoz(masik.token);
    expect(await hitelesitettE(sMasik, masik.id), 'a másik user be sem lépett').toBe(true);

    await realtime.disconnectUser(kitiltott.id);
    await varakoz(250);

    expect(sKitiltott.connected, 'a kitiltott felhasználó socketje él maradt').toBe(false);
    expect(
      sMasik.connected,
      'EGY FELHASZNÁLÓ KITILTÁSA MINDENKIT KILÉPTETETT.\n\n'
      + 'A `sub === userId` szűrés nélkül egyetlen admin-művelet (force-logout,\n'
      + 'fiók-törlés) az egész oldal real-time rétegét ledobná — némán, mert a\n'
      + 'kliens újracsatlakozik és a felhasználó csak „akadozást" látna.',
    ).toBe(true);

    const figyelo = varEsemenyt(sMasik, 'notification:new');
    realtime.emitToUser(masik.id, 'notification:new', { title: 'él' });
    expect(await figyelo, 'a másik user a bontás után nem kap értesítést').not.toBeNull();
  });
});

// =====================================================================
//  5) JELENLÉT-NÉZET
// =====================================================================
describe('getPresence — az admin élő jelenlét-nézete', () => {
  it('a felhasználót EGYSZER számolja akkor is, ha több füle van; a vendéget külön', async () => {
    const elotte = realtime.getPresence();

    const a = await createUser({ role: 'shipper' });
    const b = await createUser({ role: 'carrier' });
    await csatlakoz(a.token);
    await csatlakoz(a.token); // ugyanaz a user, második fül
    await csatlakoz(b.token);
    await csatlakoz(null);    // vendég
    await varakoz(200);

    const p = realtime.getPresence();
    expect(
      p.online_users - elotte.online_users,
      'A JELENLÉT-NÉZET A SOCKETEKET SZÁMOLJA, NEM AZ EMBEREKET.\n'
      + 'Két megnyitott fül két „online felhasználónak" látszana, az admin\n'
      + 'számai pedig felfelé hazudnának.',
    ).toBe(2);
    expect(p.total_connections - elotte.total_connections, 'az összes kapcsolat száma nem stimmel').toBe(4);
    expect(
      p.anonymous - elotte.anonymous,
      'A VENDÉG (token nélküli) KAPCSOLAT NEM A VENDÉG-SZÁMLÁLÓBA KERÜLT.',
    ).toBe(1);

    const sorA = p.users.find((u) => u.id === a.id);
    expect(sorA, 'a felhasználó nem szerepel a jelenlét-listában').toBeTruthy();
    expect(sorA.connections, 'a felhasználó fülei nincsenek összegezve').toBe(2);
    expect(p.by_role.shipper, 'a szerep szerinti bontás nem tartalmazza a feladót').toBeGreaterThanOrEqual(1);
    expect(p.by_role.carrier, 'a szerep szerinti bontás nem tartalmazza a szállítót').toBeGreaterThanOrEqual(1);
  });

  it('NINCS e-mail-cím a jelenlét-válaszban (adatminimalizálás)', async () => {
    const user = await createUser({ role: 'shipper' });
    await csatlakoz(user.token);
    await varakoz(150);

    const sor = realtime.getPresence().users.find((u) => u.id === user.id);
    expect(sor, 'a felhasználó nem jelent meg a jelenlét-nézetben').toBeTruthy();
    expect(
      JSON.stringify(sor),
      'E-MAIL-CÍM KERÜLT VISSZA A JELENLÉT-NÉZETBE (2026-08-11, 9. mérés A3).\n\n'
      + 'Ez a végpont másodpercenként lekérdezhető, és NEM hagy naplónyomot —\n'
      + 'miközben ugyanaz az adat a GET /admin/users-en naplózott. A nagyobb\n'
      + 'frissességű hozzáférés hagyná a kevesebb nyomot. A nézet célja a\n'
      + 'DARABSZÁM; azonosítani a (naplózott) részletnézeten kell.',
    ).not.toContain('@');
    expect(Object.keys(sor).sort(), 'új mező került a jelenlét-sorba — tudatos döntés kell')
      .toEqual(['connections', 'id', 'role']);
  });
});

// =====================================================================
//  6) AKTIVITÁS-MÉRÉS (a socket élettartama)
// =====================================================================
describe('Aktivitás-mérés a socket élettartamából', () => {
  it('a csatlakozás frissíti a last_seen_at-ot, a bontás növeli az aktív időt', async () => {
    const user = await createUser({ role: 'shipper' });
    const { rows: elotte } = await db.query(
      'SELECT last_seen_at, total_active_seconds FROM users WHERE id = $1', [user.id],
    );
    expect(elotte[0].last_seen_at, 'friss user-nek nem lehet last_seen_at-je').toBeNull();

    const s = await csatlakoz(user.token);
    await varakoz(1600); // > 1 másodperc, hogy kerekítés után is mérhető legyen
    s.close();

    // A DB-írás fire-and-forget a disconnect után — pollozunk rá.
    let sor;
    for (let i = 0; i < 20; i += 1) {
      await varakoz(100);
      const { rows } = await db.query(
        'SELECT last_seen_at, total_active_seconds FROM users WHERE id = $1', [user.id],
      );
      sor = rows[0];
      if (Number(sor.total_active_seconds) > 0) break;
    }

    expect(
      sor.last_seen_at,
      'A last_seen_at NEM FRISSÜLT — az admin „utoljára aktív" oszlopa és az\n'
      + 'alvó-fiók retenciós kör is ezen az adaton ül.',
    ).not.toBeNull();
    expect(
      Number(sor.total_active_seconds),
      'AZ AKTÍV IDŐ NEM NŐTT a socket bontásakor.\n\n'
      + 'Az admin-panel „becsült összes aktív idő" oszlopa a socket-élettartam\n'
      + 'összege — enélkül minden felhasználó némán 0 percet mutatna.',
    ).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================================
//  7) INICIALIZÁLATLAN REAL-TIME RÉTEG
//
//  A modul szerződése, hogy `init()` nélkül is hívható: a szolgáltatások
//  (notifications, instantJobs) emitelnek, és ezeket olyan folyamat is
//  betöltheti, ami socket-réteget nem indít (karbantartó szkript, egységteszt,
//  illetve a boot és az init közötti ablak). Ha a guardok elvesznek, ott
//  TypeError dől ki — a hívó művelet (értesítés kiírása, fuvar-létrehozás)
//  bukik el egy real-time apróság miatt.
// =====================================================================
describe('init() nélkül a modul nem dob és nem hazudik jelenlétet', () => {
  it('az emit-ek csendben elnyelődnek, a getPresence nullákat ad', async () => {
    vi.resetModules();
    const friss = await import('../src/realtime.js');

    // Ugyanebben a pillanatban az INICIALIZÁLT példány élő kapcsolatot lát —
    // ez bizonyítja, hogy tényleg külön, init-eletlen modulpéldányt kaptunk.
    const user = await createUser({ role: 'shipper' });
    await csatlakoz(user.token);
    await varakoz(150);
    expect(realtime.getPresence().total_connections, 'az inicializált példány sem lát kapcsolatot').toBeGreaterThan(0);

    expect(() => friss.emitToJob('a', 'e', {}), 'emitToJob init nélkül dobott').not.toThrow();
    expect(() => friss.emitToUser('a', 'e', {}), 'emitToUser init nélkül dobott').not.toThrow();
    expect(() => friss.emitToFeed('e', {}), 'emitToFeed init nélkül dobott').not.toThrow();
    expect(() => friss.emitGlobal('e', {}), 'emitGlobal init nélkül dobott').not.toThrow();
    await expect(friss.evictUserFromJob('a', 'b'), 'evictUserFromJob init nélkül dobott').resolves.toBeUndefined();
    await expect(friss.disconnectUser('a'), 'disconnectUser init nélkül dobott').resolves.toBeUndefined();

    expect(
      friss.getPresence(),
      'INIT NÉLKÜL A getPresence NEM A SEMLEGES NULLÁKAT ADJA — az admin\n'
      + 'jelenlét-végpontja 500-zal szállna el, vagy egy másik példány\n'
      + 'kapcsolatait mutatná.',
    ).toEqual({
      online_users: 0, total_connections: 0, anonymous: 0, by_role: {}, users: [],
    });
  });
});

// =====================================================================
//  8) A SOCKET-RÉTEG CORS-HÁZIRENDJE
//
//  ⚠️ EZ A LEGUTOLSÓ BLOKK: újrainicializálja a modul `io`-ját, tehát a
//  korábbi kapcsolatokat „elveszíti". Utána azonnal visszaáll a fájl saját
//  szerverére.
// =====================================================================
describe('Socket-CORS: élesben csak a felsorolt origin-ek', () => {
  it('a CORS_ORIGIN env szűkíti az engedélyezett origin-eket (nem marad csillag)', () => {
    const eredeti = process.env.CORS_ORIGIN;
    let io2;
    try {
      process.env.CORS_ORIGIN = 'https://gofuvar.hu, https://www.gofuvar.hu';
      io2 = realtime.init(http.createServer());
      expect(
        io2.opts.cors.origin,
        'AZ ÉLES CORS-LISTA NEM ÉRVÉNYESÜL A SOCKET-RÉTEGEN.\n\n'
        + 'A REST-oldal (index.js) és a Socket.IO transzport KÜLÖN CORS-t\n'
        + 'használ. Ha itt csillag marad, egy idegen oldal a látogató nevében\n'
        + 'nyithat socketet, és a `feed`/`user:<id>` szobák tartalmát\n'
        + '(pontos címek, értesítések) a saját JavaScriptjével olvassa.',
      ).toEqual(['https://gofuvar.hu', 'https://www.gofuvar.hu']);
      expect(io2.opts.cors.credentials).toBe(true);
    } finally {
      if (io2) io2.close();
      if (eredeti === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = eredeti;
      realtime.init(szerver); // vissza a fájl saját szerverére
    }
  });
});
