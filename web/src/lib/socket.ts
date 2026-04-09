// Socket.IO kliens singleton a böngészőhöz.
// A backend `realtime.js`-e a `job:<id>` szobákat használja.
//
// FONTOS: profilváltáskor hívjuk meg a `disconnectSocket()`-et, hogy az
// előző user szobái / listener-jei NE maradjanak bent a következő
// sessionban. Korábban a `joinUserRoom` minden hívásnál újabb `connect`
// handler-t adott a socket-re — profilok váltogatásakor ezek halmozódtak,
// és az új user az előző nevében is rejoinolt a régi szobába.
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let joinedUserId: string | null = null;
let connectHandler: (() => void) | null = null;

export function getSocket(): Socket {
  if (typeof window === 'undefined') {
    throw new Error('A Socket.IO csak a böngészőben használható.');
  }
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

/**
 * A belépett user saját szobájához csatlakoztatja a socket-et — ide
 * érkeznek a neki szóló értesítések.
 */
export function joinUserRoom(userId: string) {
  const s = getSocket();
  if (joinedUserId === userId) return;

  // Régi connect listener törlése, ha van — különben a következő
  // reconnect-nél MINDKÉT user szobájába újra beiratkozna.
  if (connectHandler) {
    s.off('connect', connectHandler);
    connectHandler = null;
  }

  joinedUserId = userId;
  s.emit('user:join', userId);
  connectHandler = () => s.emit('user:join', userId);
  s.on('connect', connectHandler);
}

export function leaveUserRoom(userId: string) {
  const s = getSocket();
  s.emit('user:leave', userId);
}

/**
 * Kijelentkezéskor / profilváltáskor hívandó. Leszedi a listener-eket,
 * kilép az aktuális user szobájából, és eldobja a socket instance-t.
 */
export function disconnectSocket() {
  if (!socket) return;
  if (connectHandler) {
    socket.off('connect', connectHandler);
    connectHandler = null;
  }
  if (joinedUserId) {
    socket.emit('user:leave', joinedUserId);
    joinedUserId = null;
  }
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/**
 * Egy konkrét fuvar real-time eseményeire iratkozik fel.
 * Visszatér egy `unsubscribe` függvénnyel.
 */
export function subscribeJob(
  jobId: string,
  handlers: {
    onTrackingPing?: (p: { lat: number; lng: number; speed_kmh?: number; ts?: number }) => void;
    onPickedUp?: (data: any) => void;
    onDelivered?: (data: any) => void;
    onAccepted?: (data: any) => void;
  },
): () => void {
  const s = getSocket();
  s.emit('job:join', jobId);

  const ping     = (p: any) => handlers.onTrackingPing?.(p);
  const picked   = (p: any) => handlers.onPickedUp?.(p);
  const delivd   = (p: any) => handlers.onDelivered?.(p);
  const accepted = (p: any) => handlers.onAccepted?.(p);

  s.on('tracking:ping',   ping);
  s.on('job:picked_up',   picked);
  s.on('job:delivered',   delivd);
  s.on('job:accepted',    accepted);

  return () => {
    s.emit('job:leave', jobId);
    s.off('tracking:ping',   ping);
    s.off('job:picked_up',   picked);
    s.off('job:delivered',   delivd);
    s.off('job:accepted',    accepted);
  };
}
