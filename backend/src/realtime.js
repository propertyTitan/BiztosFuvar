// Socket.IO real-time réteg.
// Room-alapú broadcast: `job:<id>` a fuvar-eseményeknek, `user:<id>` a
// személyes értesítéseknek.
//
// HITELESÍTÉS: a kliens a handshake `auth.token`-jében küldi a JWT-t.
// Token nélkül a kapcsolat él, de szobába nem lehet belépni — így idegen
// nem tud más user értesítéseire vagy más fuvar GPS-pingjeire feliratkozni.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');

let io = null;

function init(httpServer) {
  // Ugyanaz a CORS policy, mint az Express-nél — prod-ban a CORS_ORIGIN
  // env-ben felsorolt domainek, fejlesztéskor minden origin.
  const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : '*',
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    socket.data.user = null;
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        // Session-invalidáció a socketen is: a jelszó-reset (token_version++)
        // után a nyitott socket ne maradjon hitelesítve. Eltérő tv / hiányzó
        // user → vendégként kezeljük (szoba-join nélkül).
        const { rows } = await db.query(
          'SELECT token_version, email_verified, role FROM users WHERE id = $1', [payload.sub],
        );
        if (rows[0] && (rows[0].token_version ?? 0) === (payload.tv ?? 0)) {
          // ⚠️ A SZEREPKÖR A DB-BŐL, NEM A JWT-BŐL (2026-08-11). A REST-oldali
          // ikertestvérét (middleware/auth.js) épp ezért javítottuk: egy
          // LEFOKOZOTT admin a token lejártáig (1 nap) megtartotta a jogát. A
          // socketen ez nyitva maradt — és az `isAdmin()` DB-ellenőrzés nélkül
          // enged be BÁRMELYIK fuvar szobájába, ahonnan élő GPS, fotó-URL-ek és
          // nyers ajánlat-sorok jönnek. Az `email_verified` már a DB-ből jött:
          // az inkonzisztencia egyetlen függvényen belül volt.
          socket.data.user = { ...payload, role: rows[0].role };
          socket.data.emailVerified = !!rows[0].email_verified;
        }
      } catch {
        // Érvénytelen/lejárt token vagy DB-hiba → vendégként kezelve
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    const me = () => socket.data.user?.sub || null;
    const isAdmin = () => socket.data.user?.role === 'admin';

    // Aktivitás-mérés: a bejelentkezett kapcsolat kezdete. A socket
    // élettartama a proxy az "oldal használata"-ra. Disconnectkor a két
    // időpont különbségét hozzáadjuk a felhasználó összes aktív idejéhez.
    if (me()) {
      socket.data.connectedAt = Date.now();
      db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [me()]).catch(() => {});
    }
    socket.on('disconnect', () => {
      const uid = me();
      if (!uid || !socket.data.connectedAt) return;
      const seconds = Math.round((Date.now() - socket.data.connectedAt) / 1000);
      // Anomália-szűrés: 0 alatt (óra-ugrás) vagy 24h felett (ott-felejtett
      // tab / szerver-anomália) nem számoljuk az időt, csak a last_seen-t.
      if (seconds <= 0 || seconds > 86400) {
        db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [uid]).catch(() => {});
        return;
      }
      db.query(
        'UPDATE users SET total_active_seconds = total_active_seconds + $1, last_seen_at = NOW() WHERE id = $2',
        [seconds, uid],
      ).catch(() => {});
    });

    // Egy konkrét fuvar élő követési szobája — csak a fuvar felei vagy admin.
    // (A címzett publikus követése nem socketen, hanem a token-alapú
    // /tracking/:token REST végponton megy.)
    socket.on('job:join', async (jobId) => {
      if (typeof jobId !== 'string' || !me()) return;
      if (isAdmin()) return void socket.join(`job:${jobId}`);
      try {
        const { rows } = await db.query(
          'SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)',
          [jobId, me()],
        );
        if (rows.length) socket.join(`job:${jobId}`);
      } catch {
        // hibás UUID vagy DB-hiba → egyszerűen nem csatlakozik
      }
    });
    socket.on('job:leave', (jobId) => {
      if (typeof jobId === 'string') socket.leave(`job:${jobId}`);
    });

    // ── „feed" szoba: a piactér élő eseményei (új fuvar, azonnali fuvar,
    // mentés-kérés). ⚠️ 2026-08-09 (audit 3. kör): ezek KORÁBBAN `io.emit`-tel
    // MINDEN csatlakozott sockethez mentek — a be nem jelentkezett vendégekhez
    // is. Így egy böngészőkonzolból, fiók nélkül lehetett élőben gyűjteni a
    // feladók PONTOS felvételi/lerakodási címét és GPS-koordinátáit (a
    // mentés-kérésnél a bajba jutott helyzetét). A tartalom ugyanaz maradt,
    // de csak HITELESÍTETT kapcsolat kaphatja meg.
    // ⚠️ UGYANAZ A KAPU, MINT A REST-PÁRJÁN (2026-08-10). A `feed` payloadja
    // a `jobs:new` esemény, ami NYITOTT fuvarnál a HÁZSZÁMIG PONTOS címet és a
    // koordinátákat viszi — pontosan azt, amiért a `GET /jobs` megerősített
    // e-mailt követel. Enélkül a kapu megkerülhető: elég egy socketet nyitni.
    socket.on('feed:join', () => {
      if (me() && socket.data.emailVerified) socket.join('feed');
    });
    socket.on('feed:leave', () => {
      socket.leave('feed');
    });

    // Személyre szóló szoba — KIZÁRÓLAG a hitelesített saját azonosítóval.
    // A kliens által küldött userId-t nem vesszük figyelembe.
    socket.on('user:join', () => {
      if (me()) socket.join(`user:${me()}`);
    });
    socket.on('user:leave', () => {
      if (me()) socket.leave(`user:${me()}`);
    });
  });

  return io;
}

/**
 * Egy felhasználó KILAKOLTATÁSA egy fuvar élő szobájából.
 *
 * ⚠️ 2026-08-10 (adatáramlási audit): a `job:join` a BELÉPÉSKOR ellenőrzi a
 * jogosultságot, de kilakoltatás sehol nem volt — egy megnyitott fül pedig
 * a lezárásig bent marad a szobában. Így a LEVÁLTOTT szállító (díjmentes
 * újraválasztás, `POST /jobs/:id/reopen`) tovább kapta az ÚJ szállító élő
 * GPS-pingjeit és a felvételi/kézbesítési fotók URL-jeit — egy fuvarból,
 * amihez már semmi köze.
 *
 * A jogosultság megszűnésekor tehát aktívan ki kell tenni a szobából; a
 * kliens újracsatlakozáskor úgyis újra átesik az ellenőrzésen.
 *
 * @param {string} userId — akinek megszűnt a jogosultsága
 * @param {string} jobId
 */
async function evictUserFromJob(userId, jobId) {
  if (!io || !userId || !jobId) return;
  try {
    const szoba = `job:${jobId}`;
    for (const socket of await io.in(szoba).fetchSockets()) {
      if (socket.data?.user?.sub === userId) socket.leave(szoba);
    }
  } catch (err) {
    console.error('[realtime] kilakoltatás hiba:', err.message);
  }
}

/**
 * Egy felhasználó ÖSSZES nyitott socketjének bontása.
 *
 * ⚠️ 2026-08-10 (adatáramlási audit): a socket hitelesítése CSAK a
 * handshake-kor fut. A `POST /admin/users/:id/force-logout` (token_version
 * bump) és a fiók-törlés a REST-et lezárja, a NYITOTT SOCKETET nem — a
 * kitiltott vagy törölt felhasználó tovább kapta a `user:<id>` szobájába
 * érkező értesítéseket (bennük mások neve, chat-előnézet), és bent maradt a
 * `feed`-ben is, ahol a pontos címek mennek.
 *
 * @param {string} userId
 */
async function disconnectUser(userId) {
  if (!io || !userId) return;
  try {
    for (const socket of await io.fetchSockets()) {
      if (socket.data?.user?.sub === userId) socket.disconnect(true);
    }
  } catch (err) {
    console.error('[realtime] socket-bontás hiba:', err.message);
  }
}

function emitToJob(jobId, event, payload) {
  if (!io) return;
  io.to(`job:${jobId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

// Valóban mindenkinek szóló, SZEMÉLYES ADATOT NEM tartalmazó jelzés
// (pl. „ez a fuvar már elkelt" — csak azonosítók). Ha a payloadban cím, GPS,
// név, telefonszám vagy fizetési link van, NE ezt használd: `emitToFeed`
// (hitelesített) vagy `emitToUser` (címzett) a helyes.
function emitGlobal(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}

// Piactér-feed: csak a HITELESÍTETT, `feed:join`-nal belépett kapcsolatok.
function emitToFeed(event, payload) {
  if (!io) return;
  io.to('feed').emit(event, payload);
}

// Élő jelenlét — ki van ÉPPEN az oldalon. A forrás az aktív Socket.IO
// kapcsolatok halmaza (a web akkor nyit socketet, amikor az oldalt
// használják), így ez valós idejű, nem becsült érték. Nem tárolunk külön
// állapotot: minden hívásnál az `io` aktuális socketjeiből számolunk.
//   - online_users: különböző BEJELENTKEZETT userök száma
//   - total_connections: összes élő socket (több fül = több kapcsolat)
//   - anonymous: token nélküli (vendég) kapcsolatok
//   - by_role: bejelentkezett userök szerepkör szerint
//   - users: dedup-olt lista (admin-only végponton megy ki)
function getPresence() {
  if (!io) {
    return { online_users: 0, total_connections: 0, anonymous: 0, by_role: {}, users: [] };
  }
  const byUser = new Map();
  let anonymous = 0;
  let total = 0;
  for (const [, socket] of io.sockets.sockets) {
    total += 1;
    const u = socket.data.user;
    if (!u || !u.sub) { anonymous += 1; continue; }
    const cur = byUser.get(u.sub) || { id: u.sub, role: u.role || 'ismeretlen', email: u.email || null, connections: 0 };
    cur.connections += 1;
    byUser.set(u.sub, cur);
  }
  const users = [...byUser.values()];
  const by_role = users.reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; return acc; }, {});
  return { online_users: users.length, total_connections: total, anonymous, by_role, users };
}

module.exports = {
  init, emitToJob, emitToUser, emitGlobal, emitToFeed, getPresence,
  evictUserFromJob, disconnectUser,
};
