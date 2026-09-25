import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connectSocket } = require('socket.io-client');
const { app, expressApp, db, createUser, createJob } = require('./helpers');
const realtime = require('../src/realtime');
let server, io, address;
const clients = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

beforeAll(async () => {
  server = http.createServer(expressApp); io = realtime.init(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { vi.restoreAllMocks(); clients.splice(0).forEach(socket => socket.close()); });
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });

function tokenFor(user) {
  const exp = Math.floor(Date.now() / 1000) + 2;
  return { exp, token: jwt.sign({ sub: user.id, role: user.role, tv: 0, exp }, process.env.JWT_SECRET) };
}
function connect(token) {
  const socket = connectSocket(address, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('socket connect timeout')), 4000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
  });
}

it('A02: a nyitott user/job/feed kapcsolat a JWT természetes lejáratakor bontódik, privát eseményt többé nem kap', async () => {
  const user = await createUser();
  const job = await createJob({ shipperId: user.id });
  const { token } = tokenFor(user);
  const socket = await connect(token), id = socket.id;
  const seen = [];
  socket.on('notification:new', value => seen.push(value));
  socket.on('tracking:ping', value => seen.push(value));
  socket.on('jobs:new', value => seen.push(value));
  socket.emit('user:join'); socket.emit('job:join', job.id); socket.emit('feed:join');
  await vi.waitFor(() => {
    const rooms = io.sockets.sockets.get(id)?.rooms;
    expect(rooms?.has(`user:${user.id}`)).toBe(true);
    expect(rooms?.has(`job:${job.id}`)).toBe(true);
    expect(rooms?.has('feed')).toBe(true);
  });
  realtime.emitToUser(user.id, 'notification:new', { body: 'még érvényes' });
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await vi.waitFor(() => expect(socket.connected).toBe(false), { timeout: 3000 });
  expect(io.sockets.sockets.has(id)).toBe(false);
  expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  seen.length = 0;
  realtime.emitToUser(user.id, 'notification:new', { body: 'lejárat utáni személyes értesítés' });
  realtime.emitToJob(job.id, 'tracking:ping', { lat: 47, lng: 19 });
  realtime.emitToFeed('jobs:new', { pickup_address: 'Privát cím' });
  await wait(80);
  expect(seen).toEqual([]);
  // A felhasználó másik, még érvényes sessionje változatlanul működik.
  const fresh = await connect(user.token);
  fresh.emit('user:join');
  await vi.waitFor(() => expect(io.sockets.sockets.get(fresh.id)?.rooms.has(`user:${user.id}`)).toBe(true));
});

it('a DB-handshake alatt lejáró token nem kap későn hitelesített kapcsolatot', async () => {
  const user = await createUser();
  const { token, exp } = tokenFor(user);
  const captured = gate(), resume = gate(), query = db.query;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (String(sql).includes('SELECT token_version, email_verified, role FROM users') && args[0]?.[0] === user.id) {
      captured.resolve(); await resume.promise;
    }
    return result;
  });
  const connecting = connect(token); await captured.promise;
  await wait(Math.max(0, exp * 1000 - Date.now()) + 30); resume.resolve();
  const socket = await connecting;
  expect(io.sockets.sockets.get(socket.id)?.data.user).toBeNull();
  socket.emit('user:join'); await wait(40);
  expect(io.sockets.sockets.get(socket.id)?.rooms.has(`user:${user.id}`)).toBe(false);
});

it('lejárat közben függő job:join nem támasztja fel a már bontott szobajogot', async () => {
  const user = await createUser(), job = await createJob({ shipperId: user.id });
  const { token } = tokenFor(user);
  const socket = await connect(token), id = socket.id;
  const serverSocket = io.sockets.sockets.get(id);
  const captured = gate(), resume = gate(), query = db.query;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (String(sql).includes('SELECT 1 FROM jobs WHERE id = $1 AND') && args[0]?.[0] === job.id) {
      captured.resolve(); await resume.promise;
    }
    return result;
  });
  socket.emit('job:join', job.id); await captured.promise;
  try { await vi.waitFor(() => expect(socket.connected).toBe(false), { timeout: 3000 }); }
  finally { resume.resolve(); }
  await wait(40);
  expect(serverSocket.rooms.has(`job:${job.id}`)).toBe(false);
  expect(serverSocket.data.user).toBeNull();
});
