import { afterEach, afterAll, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const http = require('http');
const { io: connectSocket } = require('socket.io-client');
const realtime = require('../src/realtime');
const auth = u => ['Authorization', `Bearer ${u.token}`];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let server, io, address;
const sockets = [];
beforeAll(async () => {
  server = http.createServer(require('../src/index').app);
  io = realtime.init(server);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref(); address = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of sockets.splice(0)) s.close();
});
afterAll(async () => {
  await new Promise(r => io.close(r));
});
function socketFor(user) {
  const socket = connectSocket(address, { auth: { token: user.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connection timed out')), 4000);
    socket.once('connect', () => { clearTimeout(t); resolve(socket); });
    socket.once('connect_error', e => { clearTimeout(t); reject(e); });
  });
}
async function offer(job, carrier, amount) {
  const res = await request(app).post(`/jobs/${job.id}/bids`).set(...auth(carrier)).send({ amount_huf: amount, return_policy: 'included' });
  expect(res.status, JSON.stringify(res.body)).toBe(201); return res.body;
}
async function accept(bid, shipper) {
  const res = await request(app).post(`/bids/${bid.id}/accept`).set(...auth(shipper)).send(await seenOffer(bid.id));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

it.each([false, true])('socket: carrier replacement revokes GPS access, delayed join=%s', async delayed => {
  const shipper = await createUser(), oldCarrier = await createUser({ role: 'carrier' }), nextCarrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding', paid: true });
  await accept(await offer(job, oldCarrier, 15000), shipper);
  const socket = await socketFor(oldCarrier);
  const room = `job:${job.id}`, captured = gate(), resume = gate();
  const query = db.query;
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (delayed && !paused && String(sql).includes('SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)') && args[0]?.[0] === job.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  const evicted = gate(), realEvict = realtime.evictUserFromJob;
  vi.spyOn(realtime, 'evictUserFromJob').mockImplementation(async (...args) => { await realEvict(...args); evicted.resolve(); });
  socket.emit('job:join', job.id);
  if (delayed) await captured.promise;
  else await vi.waitFor(() => expect(io.sockets.sockets.get(socket.id).rooms.has(room)).toBe(true));
  try {
    const reopened = await request(app).post(`/jobs/${job.id}/reopen`).set(...auth(shipper)).send({});
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    await evicted.promise;
    await accept(await offer(job, nextCarrier, 17000), shipper);
  } finally { resume.resolve(); }
  // Barrier: the delayed room handler has consumed its old SQL result.
  await new Promise(r => setTimeout(r, 30));
  const received = [];
  socket.on('tracking:ping', data => received.push(data));
  const ping = await request(app).post(`/jobs/${job.id}/location`).set(...auth(nextCarrier)).send({ lat: 47.481234, lng: 19.051234 });
  expect(ping.status).toBe(200);
  await new Promise(r => setTimeout(r, 80));
  const freshAccess = await request(app).get(`/jobs/${job.id}/location/last`).set(...auth(oldCarrier));
  expect(freshAccess.status).toBe(403);
  expect(received, 'A leváltott szállító megkapta az új szállító pontos GPS-adatát.').toHaveLength(0);
});

it.each(['force-logout', 'role-change', 'account-delete'])('socket: %s revokes a handshake waiting on its old user snapshot', async operation => {
  const admin = await createUser({ role: 'admin' }), user = await createUser({ role: operation === 'role-change' ? 'admin' : 'shipper' });
  const query = db.query, captured = gate(), resume = gate();
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (!paused && String(sql).includes('SELECT token_version, email_verified, role FROM users') && args[0]?.[0] === user.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  const disconnected = gate(), realDisconnect = realtime.disconnectUser;
  vi.spyOn(realtime, 'disconnectUser').mockImplementation(async (...args) => { await realDisconnect(...args); disconnected.resolve(); });
  const connecting = socketFor(user);
  await captured.promise;
  try {
    const logout = operation === 'force-logout'
      ? await request(app).post(`/admin/users/${user.id}/force-logout`).set(...auth(admin)).send({})
      : operation === 'role-change'
        ? await request(app).patch(`/admin/users/${user.id}`).set(...auth(admin)).send({ role: 'shipper' })
        : await request(app).delete(`/admin/users/${user.id}`).set(...auth(admin));
    expect(logout.status).toBe(200); await disconnected.promise;
    expect((await request(app).get('/auth/me').set(...auth(user))).status).toBe(401);
  } finally { resume.resolve(); }
  const socket = await connecting;
  socket.emit('user:join');
  await new Promise(r => setTimeout(r, 40));
  const received = [];
  socket.on('notification:new', data => received.push(data));
  if (operation === 'account-delete') realtime.emitToUser(user.id, 'notification:new', { title: 'Késői tesztértesítés' });
  else await require('../src/services/notifications').createNotification({ user_id: user.id, type: 'audit_probe', title: 'Privát tesztértesítés', body: 'Kijelentkeztetés utáni magánüzenet.' });
  await new Promise(r => setTimeout(r, 80));
  expect(received, 'Kijelentkeztetés után a régi tokennel kezdett socket privát értesítést kapott.').toHaveLength(0);
  expect(io.sockets.sockets.get(socket.id)?.data.user).toBeFalsy();
});

it('job:leave érvényteleníti a függő belépést, az új belépés később működik', async () => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });
  const socket = await socketFor(carrier), captured = gate(), resume = gate();
  const query = db.query;
  let paused = false;
  vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
    const result = await query(sql, ...args);
    if (!paused && String(sql).includes('SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)') && args[0]?.[0] === job.id) {
      paused = true; captured.resolve(); await resume.promise;
    }
    return result;
  });
  socket.emit('job:join', job.id); await captured.promise;
  const left = new Promise(r => io.sockets.sockets.get(socket.id).once('job:leave', r));
  socket.emit('job:leave', job.id); await left; resume.resolve();
  await new Promise(r => setTimeout(r, 30));
  expect(io.sockets.sockets.get(socket.id).rooms.has(`job:${job.id}`)).toBe(false);
  socket.emit('job:join', job.id);
  await vi.waitFor(() => expect(io.sockets.sockets.get(socket.id).rooms.has(`job:${job.id}`)).toBe(true));
});
