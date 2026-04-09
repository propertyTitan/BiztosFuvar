'use client';

// Role-érzékeny fejléc és navigáció.
// - Kijelentkezett: csak Belépés
// - Feladó: Irányítópult + Új fuvar + Kijelentkezés
// - Sofőr: Fuvarok + Saját fuvarok + Kijelentkezés
// - Admin: Admin + Kijelentkezés
import { useRouter } from 'next/navigation';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';

export default function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();

  function logout() {
    clearCurrentUser();
    router.push('/bejelentkezes');
  }

  return (
    <header className="site-header">
      <a href="/" className="brand">BiztosFuvar</a>
      <nav>
        {!user && <a href="/bejelentkezes">Belépés</a>}

        {user?.role === 'shipper' && (
          <>
            <a href="/dashboard">Irányítópult</a>
            <a href="/dashboard/uj-fuvar">Új fuvar</a>
            <a href="/dashboard/utvonalak">Útba eső sofőrök</a>
          </>
        )}

        {user?.role === 'carrier' && (
          <>
            <a href="/sofor/fuvarok">Elérhető fuvarok</a>
            <a href="/sofor/licitjeim">Licitjeim</a>
            <a href="/sofor/sajat-fuvarok">Saját fuvaraim</a>
            <a href="/sofor/utvonalaim">Útvonalaim</a>
          </>
        )}

        {user?.role === 'admin' && <a href="/admin">Admin</a>}

        {user && (
          <>
            <span style={{ opacity: 0.7, marginLeft: 24, fontSize: 13 }}>
              {user.email}
            </span>
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
