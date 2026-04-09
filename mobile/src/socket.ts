// Mobile Socket.IO kliens singleton.
// Ugyanaz a mintázat, mint a weben: a user login után join-ol a saját
// szobájába, és ott kapja az értesítéseket.
//
// FONTOS: profilváltáskor a `disconnectSocket()` hívandó, különben az
// előző felhasználó szobájában maradna az új session (az értesítések
// összekeverednének), és a `joinUserRoom` `on('connect')` listener-jei
// halmozódnának minden login-nal.
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';

let socket: Socket | null = null;
let joinedUserId: string | null = null;
let connectHandler: (() => void) | null = null;

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
  // Ha már ugyanebbe a szobába van bekötve, ne csináljunk duplán semmit.
  if (joinedUserId === userId) return;

  // Ha korábban más user szobájához volt kötve, töröljük a régi
  // `on('connect')` listener-t, hogy ne rejoinolja újra a régi szobát.
  if (connectHandler) {
    s.off('connect', connectHandler);
    connectHandler = null;
  }

  joinedUserId = userId;
  s.emit('user:join', userId);
  connectHandler = () => s.emit('user:join', userId);
  s.on('connect', connectHandler);
}

/**
 * Profilváltáskor vagy kijelentkezéskor hívandó. Leszedi a listener-eket,
 * kilép az aktuális szobából, és eldobja a socket instance-t, hogy a
 * következő `getSocket()` hívás teljesen friss kapcsolatot építsen.
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
