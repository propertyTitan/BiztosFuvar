// Mobile Socket.IO kliens singleton.
// Ugyanaz a mintázat, mint a weben: a user login után join-ol a saját
// szobájába, és ott kapja az értesítéseket.
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';

let socket: Socket | null = null;

function getBaseUrl(): string {
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    (Constants?.expoConfig?.extra as any)?.apiUrl ||
    'http://localhost:4000'
  );
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getBaseUrl(), {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

export function joinUserRoom(userId: string) {
  const s = getSocket();
  s.emit('user:join', userId);
  s.on('connect', () => s.emit('user:join', userId));
}
