import { afterEach, expect, it, vi } from 'vitest';
import { disconnectSocket, getSocket, joinUserRoom, refreshSocketAuth, subscribeFeed, subscribeJob } from './socket';

const state = vi.hoisted(() => ({ created: [] as any[] }));
vi.mock('socket.io-client', () => ({ io: (_url: string, options: any) => {
  const handlers = new Map<string, Set<Function>>();
  const socket = {
    connected: true, sendBuffer: [] as any[], receiveBuffer: [] as any[], token: null as string | null,
    emit: vi.fn(),
    on: (event: string, fn: Function) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: Function) => handlers.get(event)?.delete(fn),
    removeAllListeners: () => handlers.clear(),
    disconnect: vi.fn(() => { socket.connected = false; }),
    connect: vi.fn(() => {
      options.auth((auth: any) => { socket.token = auth.token; });
      socket.connected = true;
      handlers.get('connect')?.forEach(fn => fn());
    }),
  };
  options.auth((auth: any) => { socket.token = auth.token; });
  state.created.push(socket); return socket;
} }));
afterEach(() => { disconnectSocket(); localStorage.clear(); state.created.length = 0; });

it('azonos fiók új tokenje tiszta pufferrel újra belép a user/feed/job szobákba', () => {
  localStorage.setItem('gofuvar_token', 'old-a');
  joinUserRoom('a');
  const feedOff = subscribeFeed({});
  const reload = vi.fn(); const jobOff = subscribeJob('job-a', { onReconnect: reload });
  const socket = state.created[0];
  socket.sendBuffer.push({ type: 2, data: ['job:join', 'obsolete'] });
  socket.receiveBuffer.push(['notification:new', { body: 'régi' }]);
  socket.emit.mockClear();
  localStorage.setItem('gofuvar_token', 'new-a');
  refreshSocketAuth();
  expect(socket.token).toBe('new-a');
  expect(socket.sendBuffer).toEqual([]); expect(socket.receiveBuffer).toEqual([]);
  expect(socket.emit).toHaveBeenCalledWith('user:join', 'a');
  expect(socket.emit).toHaveBeenCalledWith('feed:join');
  expect(socket.emit).toHaveBeenCalledWith('job:join', 'job-a');
  expect(reload).toHaveBeenCalledOnce();
  refreshSocketAuth(); expect(socket.connect).toHaveBeenCalledOnce();
  feedOff(); jobOff();
});

it('fiókhatárkor a régi kapcsolat és függő csomagjai eldobódnak, B új példányt kap', () => {
  localStorage.setItem('gofuvar_token', 'a'); joinUserRoom('a');
  const old = state.created[0];
  old.sendBuffer.push({ type: 2, data: ['private-write', 'a'] });
  old.receiveBuffer.push(['notification:new', { body: 'Anna titka' }]);
  disconnectSocket();
  localStorage.setItem('gofuvar_token', 'b'); joinUserRoom('b');
  expect(getSocket()).not.toBe(old);
  expect(old.connected).toBe(false);
  expect(old.sendBuffer).toEqual([]); expect(old.receiveBuffer).toEqual([]);
  expect(state.created[1].emit).toHaveBeenCalledTimes(1);
  expect(state.created[1].emit).toHaveBeenCalledWith('user:join', 'b');
});
