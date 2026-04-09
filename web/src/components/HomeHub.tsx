'use client';

// Egységes kezdőoldal hub: a user szerepkörétől függően kártya-rácsot
// jelenít meg a főbb funkciókkal. Külön hook olvassa az olvasatlan
// értesítések számát, hogy a kártyán badge jelenjen meg.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

type Card = {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  badge?: number | null;
  color?: string;
};

const CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 24,
  borderRadius: 16,
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  textDecoration: 'none',
  color: 'inherit',
  position: 'relative',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
};

export default function HomeHub() {
  const user = useCurrentUser();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    api.unreadNotificationCount()
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }, [user]);

  if (!user) {
    return (
      <div style={{ maxWidth: 600, textAlign: 'center', padding: '40px 0' }}>
        <img src="/logo.svg?v=2" alt="GoFuvar" style={{ height: 64, marginBottom: 24 }} />
        <h1 style={{ marginTop: 0 }}>Üdvözlünk a GoFuvar platformon</h1>
        <p className="muted">
          Közösségi fuvartőzsde — lépj be, hogy használhasd az alkalmazást,
          és a szerepkörödnek megfelelő menüpontokat láthasd.
        </p>
        <Link href="/bejelentkezes" className="btn" style={{ marginTop: 16 }}>
          Belépés
        </Link>
      </div>
    );
  }

  // Egységes menü mindenkinek: bárki lehet feladó ÉS sofőr is, ezért egyetlen
  // kártya-rácsot mutatunk. Az egyes oldalak belül még el tudják dönteni,
  // hogy a user a konkrét fuvar feladója vagy sofőre-e.
  const cards: Card[] = [
    { href: '/sofor/fuvarok',           icon: '🎯',  title: 'Licitálható fuvarok',        subtitle: 'Nyitott hirdetések — tegyél ajánlatot', color: '#dbeafe' },
    { href: '/dashboard/utvonalak',     icon: '🛣️',  title: 'Fix áras fuvarok',           subtitle: 'Sofőri útvonalak, amelyekre helyet foglalhatsz', color: '#dcfce7' },
    { href: '/sofor/sajat-fuvarok',     icon: '🚛',  title: 'Fuvaraim',                   subtitle: 'Amiket TE teljesítesz sofőrként', color: '#fef3c7' },
    { href: '/dashboard/foglalasaim',   icon: '📦',  title: 'Foglalásaim',                subtitle: 'Amiket TE foglaltál egy fix áras útvonalon', color: '#e0e7ff' },
    { href: '/dashboard/uj-fuvar',      icon: '📝',  title: 'Új licites hirdetés',        subtitle: 'Hirdess meg fuvart, a sofőrök licitálnak rá', color: '#fce7f3' },
    { href: '/sofor/uj-utvonal',        icon: '➕',  title: 'Új fix áras útvonal',        subtitle: 'Hirdesd meg a saját utadat fix árakkal', color: '#f3e8ff' },
    { href: '/hirdeteseim',             icon: '📋',  title: 'Saját hirdetéseim',          subtitle: 'Minden általad feladott fuvar és útvonal', color: '#fde68a' },
    { href: '/sofor/licitjeim',         icon: '🏷️',  title: 'Licitjeim',                  subtitle: 'Ajánlataid egy helyen', color: '#bae6fd' },
    { href: '/ertesitesek',             icon: '🔔',  title: 'Értesítések',                subtitle: 'Minden, ami veled történik', badge: unread || null, color: '#ffe4e6' },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Szia, {user.full_name || user.email}! 👋</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Válassz egy menüpontot, amivel dolgozni szeretnél. Bármikor visszatérhetsz ide.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
          marginTop: 24,
        }}
      >
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              ...CARD_STYLE,
              borderTopWidth: 4,
              borderTopColor: c.color || 'var(--primary)',
              borderTopStyle: 'solid',
            }}
            className="home-hub-card"
          >
            <div
              style={{
                fontSize: 32,
                background: c.color || '#eff6ff',
                width: 56,
                height: 56,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {c.icon}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{c.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>{c.subtitle}</div>
            {c.badge ? (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: '3px 10px',
                  minWidth: 24,
                  textAlign: 'center',
                }}
              >
                {c.badge}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
