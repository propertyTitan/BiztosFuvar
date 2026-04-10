'use client';

// Értesítések oldal – a user minden értesítése időrendben.
// Új értesítés real-time érkezik a Socket.IO `notification:new` eventen
// keresztül, és rögtön a lista tetejére kerül.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export default function ErtesitesekOldal() {
  const user = useCurrentUser();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api.listNotifications();
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    load();
    joinUserRoom(user.id);
    const socket = getSocket();
    const onNew = (notif: Notification) => {
      setItems((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)]);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [user]);

  async function markRead(n: Notification) {
    if (n.read_at) return;
    try {
      await api.markNotificationRead(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
    } catch {}
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    } catch {}
  }

  if (!user) return <p>Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.</p>;

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Értesítések {unreadCount > 0 && <span className="price">({unreadCount})</span>}</h1>
        {unreadCount > 0 && (
          <button className="btn btn-secondary" onClick={markAll}>
            Összes olvasva
          </button>
        )}
      </div>

      {loading && <p>Betöltés…</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          Hiba: {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="card">
          <p className="muted">Még nincs értesítésed.</p>
        </div>
      )}

      {items.map((n) => {
        const content = (
          <div
            className="card"
            onClick={() => markRead(n)}
            style={{
              cursor: 'pointer',
              marginTop: 12,
              background: n.read_at ? 'var(--surface)' : 'var(--surface)',
              borderLeft: n.read_at ? '4px solid transparent' : '4px solid var(--primary)',
              boxShadow: n.read_at ? 'none' : '0 0 0 1px var(--primary)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{n.title}</div>
                {n.body && (
                  <div className="muted" style={{ marginTop: 4, color: 'var(--text)' }}>{n.body}</div>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}>
                {new Date(n.created_at).toLocaleString('hu-HU')}
              </div>
            </div>
          </div>
        );
        return n.link ? (
          <Link
            key={n.id}
            href={n.link}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            {content}
          </Link>
        ) : (
          <div key={n.id}>{content}</div>
        );
      })}
    </div>
  );
}
