import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, seenOffer } = require('./helpers');
const http = require('http');
const { io: connectSocket } = require('socket.io-client');
const realtime = require('../src/realtime');
const auth = user => ['Authorization', `Bearer ${user.token}`];
let io, address;
const sockets = [];

beforeAll(async () => {
  const server = http.createServer(require('../src/index').app);
  io = realtime.init(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  address = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.restoreAllMocks();
});
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });

async function socketFor(user) {
  const socket = connectSocket(address, { auth: { token: user.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  socket.emit('user:join', user.id);
  await vi.waitFor(() => expect(io.sockets.sockets.get(socket.id).rooms.has(`user:${user.id}`)).toBe(true));
  return socket;
}

async function barrier(socket, user) {
  const arrived = new Promise(resolve => socket.once('test:barrier', resolve));
  realtime.emitToUser(user.id, 'test:barrier', {});
  await arrived;
}

it.each(['shipper-counter', 'carrier-counter', 'accept', 'accept-counter'])('%s: a nyitott szállítói oldal saját csatornán frissül, privát adatok nélkül', async action => {
  const shipper = await createUser(), carrier = await createUser({ role: 'carrier' });
  const outsider = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  const placeBid = user => request(app).post(`/jobs/${job.id}/bids`).set(...auth(user))
    .send({ amount_huf: 15000, return_policy: 'included', expected_job_terms_revision: job.terms_revision });
  const bid = await placeBid(carrier);
  expect(bid.status).toBe(201);
  expect((await placeBid(outsider)).status).toBe(201);
  if (action === 'accept-counter') {
    expect((await request(app).post(`/bids/${bid.body.id}/counter`).set(...auth(shipper)).send({ amount: 14000 })).status).toBe(200);
  }

  const socket = await socketFor(carrier), otherSocket = await socketFor(outsider);
  const updates = [], otherUpdates = [], privateEvents = [], otherPrivateEvents = [];
  socket.on('job:updated', data => updates.push(data));
  otherSocket.on('job:updated', data => otherUpdates.push(data));
  socket.on('test:private', data => privateEvents.push(data));
  otherSocket.on('test:private', data => otherPrivateEvents.push(data));
  // Az elutasított belépési kísérlet befejezését várjuk, nem időzítéssel találgatunk.
  const checked = new Promise(resolve => {
    const original = db.query;
    vi.spyOn(db, 'query').mockImplementation(async (sql, ...args) => {
      const result = await original(sql, ...args);
      if (String(sql).includes('SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)')
          && args[0]?.[0] === job.id) resolve();
      return result;
    });
  });
  socket.emit('job:join', job.id);
  await checked;
  expect(io.sockets.sockets.get(socket.id).rooms.has(`job:${job.id}`)).toBe(false);
  realtime.emitToJob(job.id, 'test:private', { secret: 'csak a résztvevőknek' });
  await barrier(socket, carrier);
  expect(privateEvents).toEqual([]);

  const counter = action.endsWith('-counter') && action !== 'accept-counter';
  const actor = action === 'carrier-counter' || action === 'accept-counter' ? carrier : shipper;
  const response = await request(app).post(`/bids/${bid.body.id}/${counter ? 'counter' : action}`)
    .set(...auth(actor)).send(counter ? { amount: 14000 } : await seenOffer(bid.body.id));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  await barrier(socket, carrier);
  await barrier(otherSocket, outsider);
  expect(updates).toEqual([{ job_id: job.id }]);
  expect(otherUpdates).toEqual([]);

  if (!counter) {
    // Az elfogadás utáni újracsatlakozás már jogosult, a többi ajánlattevőé nem.
    socket.emit('job:join', job.id);
    await vi.waitFor(() => expect(io.sockets.sockets.get(socket.id).rooms.has(`job:${job.id}`)).toBe(true));
    realtime.emitToJob(job.id, 'test:private', { secret: 'csak a résztvevőknek' });
    await barrier(socket, carrier);
    await barrier(otherSocket, outsider);
    expect(privateEvents).toEqual([{ secret: 'csak a résztvevőknek' }]);
    expect(otherPrivateEvents).toEqual([]);
  }
});
