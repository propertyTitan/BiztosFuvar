'use client';

// GoFuvar Header v2 — tiszta, 3 fő menüpont + profil dropdown.
//
// Struktúra:
//   [GoFuvar 🇭🇺🇬🇧] ——— [Fuvarok] [Útvonalak] [+ Hirdetés] ——— [🔔 2] [👤 Péter ▾]
//
// A profil dropdown tartalmazza a ritkábban használt oldalakat:
//   Profil, Saját fuvarjaim, Foglalásaim, Hirdetéseim, Licitjeim,
//   AI segéd, Admin (ha admin), Kijelentkezés.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentUser, clearCurrentUser } from '@/lib/auth';
import { api } from '@/api';
import { disconnectSocket, getSocket, joinUserRoom } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';
import { useTranslation, SUPPORTED_LOCALES } from '@/lib/i18n';

export default function SiteHeader() {
  const user = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const { t, locale, setLocale } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

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
    return () => { socket.off('notification:new', onNew); };
  }, [user?.id, toast]);

  // Kívülre kattintás → dropdown bezárás (user menü ÉS nyelvváltó külön)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
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
        {/* ── Nyelvváltó (egy gomb + dropdown) ──
            Emoji zászlók minden böngészőben nem egyformán jelennek meg
            (Samsung Internet régebbi verzió pl. "HU"/"GB" betűt rajzol),
            ezért egy kompakt gombot mutatunk a jelenlegi nyelv kódjával
            és egy kis nyílhegy. Kattintásra nyílik egy mini dropdown a
            többi nyelvvel. Ez minden képernyőméreten és témában működik. */}
        <div className="lang-switcher" ref={langRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setLangOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              transition: 'all 0.15s',
            }}
            aria-label="Nyelvváltó"
            aria-expanded={langOpen}
          >
            <span style={{ fontSize: 14 }}>
              {SUPPORTED_LOCALES.find((l) => l.code === locale)?.flag || '🌐'}
            </span>
            <span>{locale.toUpperCase()}</span>
            <span style={{ fontSize: 9, opacity: 0.8 }}>{langOpen ? '▲' : '▼'}</span>
          </button>

          {langOpen && (
            <div
              className="lang-switcher-menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                minWidth: 160,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                zIndex: 210,
                overflow: 'hidden',
              }}
            >
              {SUPPORTED_LOCALES.map((l) => {
                const active = l.code === locale;
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      setLocale(l.code);
                      setLangOpen(false);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      background: active ? 'var(--surface-hover)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: active ? 700 : 500,
                      color: 'var(--text)',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{l.flag}</span>
                    <span style={{ flex: 1 }}>{l.label}</span>
                    {active && <span style={{ color: 'var(--primary)' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Közép: 3 fő navigáció (csak bejelentkezve) ── */}
      {user && (
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Link href="/" style={navLinkStyle}>
            🏠 {t('nav.home')}
          </Link>
          <Link href="/sofor/fuvarok" style={navLinkStyle}>
            🎯 {t('nav.biddableJobs')}
          </Link>
          <Link href="/dashboard/utvonalak" style={navLinkStyle}>
            🛣️ {t('nav.fixedRoutes')}
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
              <span style={{ fontSize: 20 }}>🔔</span>
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: '#ef4444',
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
                <span style={{ fontSize: 10, opacity: 0.7 }}>{menuOpen ? '▲' : '▼'}</span>
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
                    <DropdownItem href="/" icon="🏠" label={t('nav.home')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/profil" icon="👤" label={t('nav.profile')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/sofor/sajat-fuvarok" icon="🚛" label={t('nav.myJobs')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/dashboard/foglalasaim" icon="📦" label={t('nav.myBookings')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/hirdeteseim" icon="📋" label={t('nav.myListings')} onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/sofor/licitjeim" icon="🏷️" label="Licitjeim" onClick={() => setMenuOpen(false)} />
                    <DropdownItem href="/ai-chat" icon="🤖" label={t('nav.aiAssistant')} onClick={() => setMenuOpen(false)} />
                    {user.role === 'admin' && (
                      <DropdownItem href="/admin" icon="🛡️" label="Admin" onClick={() => setMenuOpen(false)} />
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
                        color: 'var(--danger)',
                        fontWeight: 600,
                        transition: 'background 0.1s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--danger-light, #fee2e2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      🚪 {t('auth.logout')}
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
function DropdownItem({ href, icon, label, onClick }: { href: string; icon: string; label: string; onClick: () => void }) {
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
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover, #f1f5f9)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{icon}</span>
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
