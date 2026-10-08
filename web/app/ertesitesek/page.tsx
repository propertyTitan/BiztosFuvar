'use client';

// Értesítések oldal – a user minden értesítése időrendben.
// Új értesítés real-time érkezik a Socket.IO `notification:new` eventen
// keresztül, és rögtön a lista tetejére kerül.
//
// 2026-10-08 (UX-átvizsgálás A22): mobilon a másodpercre pontos, nem
// tördelődő dátum a hely ~40%-át vitte el, a szöveg ~150 px-es oszlopba
// szorult (a lap 12–22 ezer px hosszú lett). Most: a relatív idő a cím
// ALATT áll (a teljes időpont a <time title>-ben), a törzs legfeljebb 3
// sor, az olvasatlant egy 8 px-es pont + félkövér cím jelzi (nem
// keretgyűrű), az ikon a típusból jön (lucide), és szállító módban az üres
// állapot az elérhető fuvarokra visz.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { readStoredMode, useCurrentUser } from '@/lib/auth';
import {ListSkeleton, EmptyState, Loading } from '@/components/StateView';
import {
  BellOff, Bell, CreditCard, Scale, Handshake, MessageCircle, PackageCheck,
  ShieldAlert, Star, Tag, Truck, XCircle, Megaphone,
} from 'lucide-react';
import { relativIdo, teljesDatumIdo } from '@/lib/idopont';
import { cimEmojiNelkul, ertesitesIkon, type ErtesitesIkon } from '@/lib/ertesitesek';

const IKONOK: Record<ErtesitesIkon, ReactNode> = {
  ajanlat: <Tag size={18} aria-hidden />,
  megallapodas: <Handshake size={18} aria-hidden />,
  fizetes: <CreditCard size={18} aria-hidden />,
  uton: <Truck size={18} aria-hidden />,
  kezbesitve: <PackageCheck size={18} aria-hidden />,
  uzenet: <MessageCircle size={18} aria-hidden />,
  ertekeles: <Star size={18} aria-hidden />,
  vita: <Scale size={18} aria-hidden />,
  lemondas: <XCircle size={18} aria-hidden />,
  figyelmeztetes: <ShieldAlert size={18} aria-hidden />,
  admin: <Megaphone size={18} aria-hidden />,
  altalanos: <Bell size={18} aria-hidden />,
};

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
  // Első rendernél a user még null (localStorage-ből töltődik) — várjuk meg,
  // különben bejelentkezett usernek is felvillan a "Lépj be" üzenet.
  const [mounted, setMounted] = useState(false);
  const [szallitoMod, setSzallitoMod] = useState(false);
  useEffect(() => {
    setMounted(true);
    try { setSzallitoMod(readStoredMode() === 'driver'); } catch { /* nincs tárolt mód */ }
  }, []);

  const [tobbVan, setTobbVan] = useState(false);
  const [regebbiTolt, setRegebbiTolt] = useState(false);
  async function load() {
    try {
      const data = await api.listNotifications();
      setItems(data);
      setTobbVan(data.length >= 100);
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

  // Régebbiek betöltése (2026-09-11, C2): kurzor = a legrégebbi betöltött created_at
  async function regebbiek() {
    if (items.length === 0) return;
    setRegebbiTolt(true);
    try {
      const utolso = items[items.length - 1].created_at;
      const data = await api.listNotifications(utolso);
      setItems((prev) => [...prev, ...data.filter((d) => !prev.some((p) => p.id === d.id))]);
      setTobbVan(data.length >= 100);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRegebbiTolt(false);
    }
  }

  async function markRead(n: Notification) {
    if (n.read_at) return;
    try {
      await api.markNotificationRead(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      // A fejléc harang-számlálója is frissüljön (stale UI fix)
      window.dispatchEvent(new Event('gofuvar:notifications-read'));
    } catch {}
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
      window.dispatchEvent(new Event('gofuvar:notifications-read'));
    } catch {}
  }

  if (!mounted) return <Loading />;
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

      {loading && <ListSkeleton rows={5} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          Hiba: {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          icon={<BellOff size={28} aria-hidden />}
          title="Még nincs értesítésed"
          description="Itt jelennek meg az ajánlataid, fuvarjaid és üzeneteid eseményei — élőben, frissítés nélkül."
          cta={szallitoMod
            ? <Link className="btn" href="/sofor/fuvarok">Elérhető fuvarok</Link>
            : <Link className="btn" href="/dashboard/uj-fuvar">Adj fel egy fuvart</Link>}
        />
      )}

      {items.map((n) => {
        const olvasatlan = !n.read_at;
        const content = (
          <div
            className="card"
            data-olvasatlan={olvasatlan ? 'igen' : undefined}
            onClick={() => markRead(n)}
            style={{
              cursor: 'pointer',
              marginTop: 12,
              padding: '14px 16px',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(37,99,235,0.10)', color: 'var(--primary)',
              }}
            >
              {IKONOK[ertesitesIkon(n.type)]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {olvasatlan && (
                  <span
                    aria-label="Olvasatlan"
                    role="img"
                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, alignSelf: 'center' }}
                  />
                )}
                <div style={{ fontWeight: olvasatlan ? 700 : 600, fontSize: 16, overflowWrap: 'anywhere' }}>
                  {cimEmojiNelkul(n.title)}
                </div>
              </div>
              <time
                dateTime={n.created_at}
                title={teljesDatumIdo(n.created_at)}
                className="muted"
                style={{ display: 'block', fontSize: 12, marginTop: 2 }}
              >
                {relativIdo(n.created_at)}
              </time>
              {n.body && (
                <div
                  style={{
                    marginTop: 6, color: 'var(--text)', fontSize: 14, lineHeight: 1.5,
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', overflowWrap: 'anywhere',
                  }}
                >
                  {n.body}
                </div>
              )}
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
      {tobbVan && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={regebbiek} disabled={regebbiTolt}>
            {regebbiTolt ? 'Betöltés…' : 'Régebbi értesítések betöltése'}
          </button>
        </div>
      )}
    </div>
  );
}
