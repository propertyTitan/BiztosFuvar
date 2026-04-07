// Socket.IO kliens singleton a böngészőhöz.
// A backend `realtime.js`-e a `job:<id>` szobákat használja.
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

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
