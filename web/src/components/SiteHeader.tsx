'use client';

// Role-érzékeny fejléc és navigáció.
// - Kijelentkezett: csak Belépés
// - Feladó: Főoldal + Új fuvar + Útba eső sofőrök + Fuvaraim + Foglalásaim
// - Sofőr: Főoldal + Licitálható + Útvonalaim + Licitjeim + Saját fuvaraim
// - Mindkettő: értesítés ikon olvasatlan számlálóval + AI segéd link
//
// FONTOS: a menülinkek Next.js `<Link>`-ek (nem plain `<a>`-k), hogy
// kliensoldali soft navigation történjen. Plain `<a>`-val a böngésző
// teljes reload-ot csinál, és a lassú backend alatt "első kattintásra
// a régi oldal látszik, másodikra megjelenik az új" típusú hibát okoz.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';
import { api } from '@/api';
import { disconnectSocket, getSocket, joinUserRoom } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';

export default function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const [unread, setUnread] = useState(0);

  // Értesítés számláló + valós idejű BUBORÉK (toast) a bejövő értesítésekhez.
  //
  // A `notification:new` event-re minden beérkező notifikációt toast-ként
  // is megjelenítünk — így a user NEM csak a harang számlálóján lát
  // változást, hanem rögtön egy felpattanó zöld/kék/piros buborékot is.
  //
  // A `[user?.id]` deps azt biztosítja, hogy profilváltáskor a listener
  // újra feliratkozik az új user szobájára.
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
    const onNew = (n: any) => {
      setUnread((c) => c + 1);
      // A notif típusa alapján döntjük el a kind-et: fizetéses events
      // zöldek (sikeres), elutasításoké pirosak, a többi simán info.
      const kind: 'success' | 'error' | 'info' =
        n?.type === 'booking_paid' || n?.type === 'booking_confirmed'
          ? 'success'
          : n?.type === 'booking_rejected'
          ? 'error'
          : 'info';
      toast[kind](n?.title || 'Új értesítés', n?.body || undefined);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [user?.id, toast]);

  function logout() {
    clearCurrentUser();
    // Bontsuk a WebSocket-et, hogy a régi user szobája/listener-jei
    // ne maradjanak bent a következő sessionban (profilváltás).
    disconnectSocket();
    router.push('/bejelentkezes');
  }

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="GoFuvar – Főoldal">
        {/* Inline fehér logó a sötétkék headerre */}
        <img src="/logo-white.svg?v=2" alt="GoFuvar" style={{ height: 40, width: 'auto', display: 'block' }} />
      </Link>
      <nav>
        {!user && <Link href="/bejelentkezes">Belépés</Link>}

        {user && (
          <>
            <Link href="/">Főoldal</Link>
            <Link href="/sofor/fuvarok">Licitálható fuvarok</Link>
            <Link href="/dashboard/utvonalak">Fix áras fuvarok</Link>
            <Link href="/sofor/sajat-fuvarok">Saját fuvarjaim</Link>
            <Link href="/dashboard/foglalasaim">Foglalásaim</Link>
            <Link href="/hirdeteseim">Saját hirdetéseim</Link>
          </>
        )}

        {user?.role === 'admin' && <Link href="/admin">Admin</Link>}

        {user && (
          <>
            <Link
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
            </Link>
            <Link
              href="/profil"
              style={{ marginLeft: 16, fontSize: 13, opacity: 0.85, textDecoration: 'none' }}
              title="Profil szerkesztése"
            >
              👤 {user.full_name || user.email}
            </Link>
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
