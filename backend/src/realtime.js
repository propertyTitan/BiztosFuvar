// Socket.IO real-time réteg.
// Egyszerű room-alapú broadcast: a kliensek `job:<id>` szobába csatlakoznak.
const { Server } = require('socket.io');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    socket.on('job:join', (jobId) => {
      if (typeof jobId === 'string') socket.join(`job:${jobId}`);
    });
    socket.on('job:leave', (jobId) => {
      if (typeof jobId === 'string') socket.leave(`job:${jobId}`);
    });
  });

  return io;
}

function emitToJob(jobId, event, payload) {
  if (!io) return;
  io.to(`job:${jobId}`).emit(event, payload);
}

function emitGlobal(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}

module.exports = { init, emitToJob, emitGlobal };
