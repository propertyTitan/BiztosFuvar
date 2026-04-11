// Socket.IO real-time réteg.
// Egyszerű room-alapú broadcast: a kliensek `job:<id>` szobába csatlakoznak.
const { Server } = require('socket.io');

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

  io.on('connection', (socket) => {
    // Egy konkrét fuvar élő követési szobája
    socket.on('job:join', (jobId) => {
      if (typeof jobId === 'string') socket.join(`job:${jobId}`);
    });
    socket.on('job:leave', (jobId) => {
      if (typeof jobId === 'string') socket.leave(`job:${jobId}`);
    });

    // Személyre szóló szoba – az értesítések ide érkeznek. A kliens a
    // bejelentkezés után emit-eli a saját user id-ját.
    socket.on('user:join', (userId) => {
      if (typeof userId === 'string') socket.join(`user:${userId}`);
    });
    socket.on('user:leave', (userId) => {
      if (typeof userId === 'string') socket.leave(`user:${userId}`);
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
