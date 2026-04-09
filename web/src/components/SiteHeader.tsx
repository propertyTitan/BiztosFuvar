'use client';

// Role-érzékeny fejléc és navigáció.
// - Kijelentkezett: csak Belépés
// - Feladó: Főoldal + Új fuvar + Útba eső sofőrök + Fuvaraim + Foglalásaim
// - Sofőr: Főoldal + Licitálható + Útvonalaim + Licitjeim + Saját fuvaraim
// - Mindkettő: értesítés ikon olvasatlan számlálóval + AI segéd link
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';
import { api } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';

export default function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  // Értesítés számláló: load + real-time
  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    api.unreadNotificationCount()
      .then((r) => setUnread(r.count))
      .catch(() => {});
    joinUserRoom(user.id);
    const socket = getSocket();
    const onNew = () => setUnread((c) => c + 1);
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [user]);

  function logout() {
    clearCurrentUser();
    router.push('/bejelentkezes');
  }

  return (
    <header className="site-header">
      <a href="/" className="brand">BiztosFuvar</a>
      <nav>
        {!user && <a href="/bejelentkezes">Belépés</a>}

        {user && <a href="/">Főoldal</a>}

        {user?.role === 'shipper' && (
          <>
            <a href="/dashboard/uj-fuvar">Új fuvar</a>
            <a href="/dashboard/utvonalak">Útba eső sofőrök</a>
            <a href="/dashboard">Fuvaraim</a>
            <a href="/dashboard/foglalasaim">Foglalásaim</a>
          </>
        )}

        {user?.role === 'carrier' && (
          <>
            <a href="/sofor/fuvarok">Licitálható fuvarok</a>
            <a href="/sofor/utvonalaim">Útvonalaim</a>
            <a href="/sofor/licitjeim">Licitjeim</a>
            <a href="/sofor/sajat-fuvarok">Saját fuvaraim</a>
          </>
        )}

        {user?.role === 'admin' && <a href="/admin">Admin</a>}

        {user && (
          <>
            <a
              href="/ertesitesek"
              style={{ position: 'relative', marginLeft: 16 }}
              title="Értesítések"
            >
              🔔
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: -12,
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: '2px 6px',
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </a>
            <span style={{ opacity: 0.7, marginLeft: 16, fontSize: 13 }}>{user.email}</span>
            <button
              type="button"
              onClick={logout}
              style={{
                marginLeft: 16,
                background: 'transparent',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.4)',
                padding: '4px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Kijelentkezés
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
