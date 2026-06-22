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

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    socket.data.user = null;
    if (token) {
      try {
        socket.data.user = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        // Érvénytelen/lejárt token → vendégként kezelve, szoba-join nélkül
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

function emitToJob(jobId, event, payload) {
  if (!io) return;
  io.to(`job:${jobId}`).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitGlobal(event, payload) {
  if (!io) return;
  io.emit(event, payload);
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

module.exports = { init, emitToJob, emitToUser, emitGlobal, getPresence };
