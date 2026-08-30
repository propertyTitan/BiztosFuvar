// =====================================================================
//  SOCKET-ÚJRAKÖTÉS BELÉPÉSKOR — GF-016/017 gyökere (2026-08-30)
//
//  A Manus-tünet: a chat-üzenet és az értesítés a másik félnél csak teljes
//  újratöltés után jelent meg. A gyökérok: a Socket.IO `auth` callbackje
//  csak CONNECT-kor fut — ha a socket a belépés ELŐTT nyílt (token nélkül,
//  pl. a landingen), a handshake tokentelen marad, a szerver a `user:join`-t
//  helyesen eldobja, és MINDEN user-szobás esemény (chat, értesítés,
//  fizetési visszaigazolás) némán elveszik a következő újratöltésig.
//
//  A javítás: a setCurrentUser (belépés) újraköti a socketet. Ez a teszt
//  azt tartja, hogy a hívás ott VAN — ha valaki kiveszi, az élő frissítés
//  osztálya némán visszahal, és ezt semmilyen más teszt nem fogná meg.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const refreshSocketAuth = vi.fn();
vi.mock('./socket', () => ({ refreshSocketAuth: (...a: unknown[]) => refreshSocketAuth(...a) }));

import { setCurrentUser, type CurrentUser } from './auth';

const user: CurrentUser = { id: 'u-1', email: 'a@teszt.hu', role: 'shipper' };

beforeEach(() => {
  window.localStorage.clear();
  refreshSocketAuth.mockClear();
});

describe('setCurrentUser → socket-újrakötés', () => {
  it('belépéskor meghívódik a refreshSocketAuth', () => {
    setCurrentUser(user, 'friss-token');
    expect(
      refreshSocketAuth,
      'A setCurrentUser már nem köti újra a socketet — a belépés előtt nyitott '
      + '(token nélküli) kapcsolaton a szerver a user:join-t eldobja, és a chat '
      + '+ értesítések élő frissítése a teljes újratöltésig halott (GF-016/017).',
    ).toHaveBeenCalledTimes(1);
  });

  it('a token ELŐBB kerül a localStorage-ba, mint a socket-újrakötés', () => {
    // A refreshSocketAuth a tárolt tokent teszi a handshake-be — ha a hívás
    // sorrendje megfordulna, a régi (üres) tokennel kötne újra.
    let tokenAmikorHivtak: string | null = null;
    refreshSocketAuth.mockImplementation(() => {
      tokenAmikorHivtak = window.localStorage.getItem('gofuvar_token');
    });
    setCurrentUser(user, 'friss-token');
    expect(tokenAmikorHivtak).toBe('friss-token');
  });
});
