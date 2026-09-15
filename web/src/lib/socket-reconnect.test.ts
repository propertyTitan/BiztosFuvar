import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ listeners: new Map<string, Set<(...args: any[]) => void>>(), emit: vi.fn(), connected: true }));
vi.mock('socket.io-client', () => ({ io: () => ({
  get connected() { return mock.connected; },
  emit: mock.emit,
  on: (event: string, fn: (...args: any[]) => void) => {
    if (!mock.listeners.has(event)) mock.listeners.set(event, new Set());
    mock.listeners.get(event)!.add(fn);
  },
  off: (event: string, fn: (...args: any[]) => void) => mock.listeners.get(event)?.delete(fn),
  removeAllListeners: () => mock.listeners.clear(), disconnect: vi.fn(),
}) }));
import { subscribeJob, disconnectSocket } from './socket';
afterEach(() => { disconnectSocket(); vi.clearAllMocks(); mock.connected = true; });
const connect = () => mock.listeners.get('connect')?.forEach(fn => fn());

describe('P1-10: fuvar-szoba újracsatlakozás', () => {
  it('minden új kapcsolat visszalép és REST-frissítést kér, cleanup után egyik sem fut', () => {
    const snapshot = vi.fn();
    const off = subscribeJob('j1', { onReconnect: snapshot });
    expect(mock.emit).toHaveBeenCalledWith('job:join', 'j1');
    connect(); connect();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(mock.emit.mock.calls.filter(([name]) => name === 'job:join')).toHaveLength(3);
    off(); connect();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(mock.listeners.get('connect')?.size).toBe(0);
  });

  it('offline feliratkozás nem pufferel felesleges belépést; csatlakozáskor betölt', () => {
    mock.connected = false;
    const snapshot = vi.fn();
    subscribeJob('j2', { onReconnect: snapshot });
    expect(mock.emit).not.toHaveBeenCalled();
    mock.connected = true; connect();
    expect(mock.emit).toHaveBeenCalledWith('job:join', 'j2');
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('a térkép leválása nem lépteti ki az ugyanazt a fuvart figyelő oldalt', () => {
    const page = subscribeJob('j1', {});
    const map = subscribeJob('j1', {});
    map(); map();
    expect(mock.emit).not.toHaveBeenCalledWith('job:leave', 'j1');
    page();
    expect(mock.emit.mock.calls.filter(([name]) => name === 'job:leave')).toHaveLength(1);
  });
});
