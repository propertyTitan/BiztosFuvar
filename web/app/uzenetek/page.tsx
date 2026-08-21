'use client';

// Üzenetek a GoFuvartól — a felhasználó szála a GoFuvar csapatával.
//
// Szabály (2026-08-08, user-döntés): a felhasználó MAGÁTÓL nem írhat a
// csapatnak — a válasz-mező csak akkor jelenik meg, ha kapott már
// KÖZVETLEN üzenetet (can_reply). A körüzenet nem nyit csatornát.
// Új üzenet élőben érkezik az `admin-dm:new` socket-eventen.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import {ListSkeleton, EmptyState, Loading } from '@/components/StateView';
import { Inbox, Megaphone, Send } from 'lucide-react';

type AdminMessage = {
  id: string;
  sender: 'admin' | 'user';
  kind: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export default function UzenetekOldal() {
  const user = useCurrentUser();
  const toast = useToast();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [canReply, setCanReply] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Első rendernél a user még null (localStorage-ből töltődik) — várjuk meg.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const data = await api.myAdminMessages();
        if (!alive) return;
        setMessages(data.messages);
        setCanReply(data.can_reply);
        // A megnyitás olvasottra állította az üzeneteket → a harang frissüljön
        window.dispatchEvent(new Event('gofuvar:notifications-read'));
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    joinUserRoom(user.id);
    const socket = getSocket();
    const onNew = (msg: AdminMessage & { user_id?: string }) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.kind === 'direct') setCanReply(true);
    };
    socket.on('admin-dm:new', onNew);
    return () => { alive = false; socket.off('admin-dm:new', onNew); };
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await api.replyAdminMessage(body);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft('');
    } catch (e: any) {
      toast.error('Nem sikerült elküldeni', e.message);
    } finally {
      setSending(false);
    }
  }

  if (!mounted) return <Loading />;
  if (!user) return <p>Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Üzenetek a GoFuvartól</h1>
      <p className="muted" style={{ marginTop: 4 }}>
        Itt találod a GoFuvar csapatának üzeneteit és közleményeit.
      </p>

      {loading && <ListSkeleton rows={4} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>
      )}

      {!loading && !error && messages.length === 0 && (
        <EmptyState
          icon={<Inbox size={28} aria-hidden />}
          title="Nincs üzeneted"
          description="Ha a GoFuvar csapata üzenetet vagy közleményt küld neked, itt fogod megtalálni."
        />
      )}

      {messages.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m) => {
              const sajat = m.sender === 'user';
              return (
                <div key={m.id} style={{
                  alignSelf: sajat ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: sajat ? 'var(--primary)' : 'var(--surface-hover)',
                  color: sajat ? '#fff' : 'var(--text)',
                  borderRadius: 12,
                  padding: '10px 14px',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sajat ? 'Te' : (
                      m.kind === 'broadcast'
                        ? <><Megaphone size={12} aria-hidden /> GoFuvar közlemény</>
                        : 'GoFuvar csapat'
                    )}
                    <span style={{ fontWeight: 400, opacity: 0.75 }}>
                      {new Date(m.created_at).toLocaleString('hu-HU')}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {m.body}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {canReply ? (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <label htmlFor="admin-reply" style={{ fontSize: 12, fontWeight: 700 }}>Válaszod</label>
              <textarea
                id="admin-reply"
                className="input"
                rows={3}
                maxLength={5000}
                placeholder="Írd meg a válaszod a GoFuvar csapatának…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn" disabled={sending || !draft.trim()} onClick={send}>
                  <Send size={14} aria-hidden /> {sending ? 'Küldés…' : 'Küldés'}
                </button>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
              Erre a beszélgetésre nem lehet válaszolni. Ha kérdésed van, írj nekünk:{' '}
              <a href="mailto:info@gofuvar.hu">info@gofuvar.hu</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
