'use client';

// GoFuvar Header v2 — tiszta, 3 fő menüpont + profil dropdown.
//
// Struktúra:
//   [GoFuvar 🇭🇺🇬🇧] ——— [Fuvarok] [Útvonalak] [+ Hirdetés] ——— [🔔 2] [👤 Péter ▾]
//
// A profil dropdown tartalmazza a ritkábban használt oldalakat:
//   Profil, Saját fuvarjaim, Foglalásaim, Hirdetéseim, Licitjeim,
//   AI segéd, Admin (ha admin), Kijelentkezés.
import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Home, Target, Route, User, Truck, Shield,
  Bell, BellRing, Bot, LogOut, ChevronDown, Package,
} from 'lucide-react';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';
import { api } from '@/api';
import { disconnectSocket, getSocket, joinUserRoom } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';
import { useTranslation } from '@/lib/i18n';

export default function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Értesítés számláló + toast
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
    joinUserRoom(user.id);
    const socket = getSocket();
    const onNew = (n: any) => {
      setUnread((c) => c + 1);
      const kind: 'success' | 'error' | 'info' =
        n?.type === 'booking_paid' || n?.type === 'booking_confirmed' ? 'success'
        : n?.type === 'booking_rejected' ? 'error' : 'info';
      toast[kind](n?.title || 'Új értesítés', n?.body || undefined);
    };
    socket.on('notification:new', onNew);
    // Az értesítések oldal olvasottra állításakor a badge azonnal frissül
    // (eddig F5-ig a régi számot mutatta — stale UI fix)
    const onRead = () => {
      api.unreadNotificationCount().then((r) => setUnread(r.count)).catch(() => {});
    };
    window.addEventListener('gofuvar:notifications-read', onRead);
    return () => {
      socket.off('notification:new', onNew);
      window.removeEventListener('gofuvar:notifications-read', onRead);
    };
  }, [user?.id, toast]);

  // Aktív mód (Sofőr/Feladó) követése — a HomeHub mód-váltója írja a
  // localStorage-t és eseményt szór (BUG-034: mindenhol látszódjon)
  const [activeMode, setActiveMode] = useState<'driver' | 'shipper' | null>(null);
  useEffect(() => {
    const readMode = () => {
      const m = window.localStorage.getItem('gofuvar_mode');
      setActiveMode(m === 'driver' || m === 'shipper' ? m : 'shipper');
    };
    if (user) readMode(); else setActiveMode(null);
    window.addEventListener('gofuvar:mode-change', readMode);
    return () => window.removeEventListener('gofuvar:mode-change', readMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Kívülre kattintás → user-menü dropdown bezárás
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function logout() {
    clearCurrentUser();
    disconnectSocket();
    setMenuOpen(false);
    router.push('/bejelentkezes');
  }

  const initial = (user?.full_name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="site-header">
      {/* ── Bal oldal: Logo + nyelvváltó ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/" className="brand" aria-label="GoFuvar">
          <img src="/logo-white.svg?v=2" alt="GoFuvar" style={{ height: 36, width: 'auto', display: 'block' }} />
        </Link>
        {/* Nyelvváltó ELREJTVE (2026-07-02): a fordítás csak ~3 komponensre
            készült el, EN-re váltva a 31 oldal magyar maradt — becsapós.
            Az i18n-infrastruktúra (LocaleContext, hu/en szótárak) érintetlen;
            a külföldi terjeszkedésnél (SK→RO→PL) a kész fordítással együtt
            kerül vissza a gomb. */}
      </div>

      {/* ── Közép: 3 fő navigáció (csak bejelentkezve) ── */}
      {user && (
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* BUG-034 (részleges): az aktív mód a főoldalon kívül is
              látszódjon — kattintásra a főoldali mód-váltóhoz visz */}
          {activeMode && (
            <Link
              href="/"
              title="Aktív mód — a főoldalon válthatsz"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 999, fontSize: 12,
                fontWeight: 700, textDecoration: 'none', marginRight: 4,
                background: 'rgba(255,255,255,0.18)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)', whiteSpace: 'nowrap',
              }}
            >
              {/* UI-ikon szabály: lucide, nem emoji (CLAUDE.md, PR #75) */}
              {activeMode === 'driver'
                ? <><Truck size={13} /> Sofőr mód</>
                : <><Package size={13} /> Feladó mód</>}
            </Link>
          )}
          <Link href="/" style={navLinkStyle}>
            <Home size={15} /> {t('nav.home')}
          </Link>
          <Link href="/sofor/fuvarok" style={navLinkStyle}>
            <Target size={15} /> {t('nav.biddableJobs')}
          </Link>
          <Link href="/dashboard/utvonalak" style={navLinkStyle}>
            <Route size={15} /> {t('nav.fixedRoutes')}
          </Link>
        </nav>
      )}

      {/* ── Jobb oldal: értesítés + profil dropdown ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!user && (
          <Link
            href="/bejelentkezes"
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              transition: 'all 0.15s',
            }}
          >
            {t('auth.login')}
          </Link>
        )}

        {user && (
          <>
            {/* 🔔 Értesítés ikon */}
            <Link
              href="/ertesitesek"
              style={{
                position: 'relative',
                padding: '6px 10px',
                borderRadius: 8,
                transition: 'all 0.15s',
                textDecoration: 'none',
              }}
              title={t('nav.notifications')}
            >
              <Bell size={20} color="#fff" style={{ display: 'block' }} />
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: 'var(--danger-strong)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 800,
                    borderRadius: 999,
                    padding: '1px 5px',
                    minWidth: 16,
                    textAlign: 'center',
                    border: '2px solid var(--primary)',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            {/* 👤 Profil dropdown */}
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 12px 5px 5px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: menuOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  color: '#fff',
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  {initial}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.full_name?.split(' ')[0] || user.email?.split('@')[0]}
                </span>
                <ChevronDown size={14} style={{ opacity: 0.8, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)' }} />
              </button>

              {/* Dropdown menü */}
              {menuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 8,
                    width: 240,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                    zIndex: 200,
                    overflow: 'hidden',
                    animation: 'gofuvar-fade-in 0.15s ease-out',
                  }}
                >
                  {/* User info fejléc */}
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{user.full_name || user.email}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{user.email}</div>
                  </div>

                  {/* Menüpontok */}
                  <div style={{ padding: '6px 0' }}>
                    <DropdownItem href="/" icon={<Home size={16} />} label={t('nav.home')} onClick={() => setMenuOpen(false)} />
                    {/* Mobilon a fő nav (Fuvarok / Útvonalak) rejtve van — itt
                        érhető el, hogy keskeny képernyőn se vesszen el. */}
                    <div className="only-mobile-menu">
                      <DropdownItem href="/sofor/fuvarok" icon={<Target size={16} />} label={t('nav.biddableJobs')} onClick={() => setMenuOpen(false)} />
                      <DropdownItem href="/dashboard/utvonalak" icon={<Route size={16} />} label={t('nav.fixedRoutes')} onClick={() => setMenuOpen(false)} />
                    </div>
                    <DropdownItem href="/profil" icon={<User size={16} />} label={t('nav.profile')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/fuvarjaim" icon={<Truck size={16} />} label="Fuvarjaim" onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/sofor/ertesitok" icon={<BellRing size={16} />} label="Útvonal-figyelők" onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/ai-chat" icon={<Bot size={16} />} label={t('nav.aiAssistant')} onClick={() => setMenuOpen(false)} />

                    {user.role === 'admin' && (
                      <DropdownItem href="/admin" icon={<Shield size={16} />} label="Admin" onClick={() => setMenuOpen(false)} />
                    )}
                  </div>

                  {/* Kijelentkezés */}
                  <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                    <button
                      type="button"
                      onClick={logout}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 16px',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: 'var(--danger-text)',
                        fontWeight: 600,
                        transition: 'background 0.1s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--danger-light, var(--danger-light))')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <LogOut size={16} /> {t('auth.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

// Dropdown menüpont komponens
function DropdownItem({ href, icon, label, onClick }: { href: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        textDecoration: 'none',
        color: 'var(--text)',
        fontSize: 13,
        fontWeight: 500,
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover, var(--surface-hover))')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>{icon}</span>
      {label}
    </Link>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.9)',
  padding: '7px 14px',
  borderRadius: 8,
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 13,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};
