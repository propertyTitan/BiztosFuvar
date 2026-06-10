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

module.exports = { init, emitToJob, emitToUser, emitGlobal };
