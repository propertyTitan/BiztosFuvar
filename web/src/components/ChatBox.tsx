'use client';

// Inline chat doboz: üzenetek listája + input.
// Használat:
//   <ChatBox entityKey="job_id" entityId="..." />
//   <ChatBox entityKey="booking_id" entityId="..." />
//
// A beszélgetés a job/booking-hoz tartozik. Az üzenetek valós időben
// frissülnek Socket.IO-n: a chat:job:<id> vagy chat:booking:<id>
// room-ból érkeznek az új üzenetek.
//
// 2026-10-08 (UX-átvizsgálás Q18): a díj előtti kontakt-szabályt eddig CSAK
// az elutasított üzenet hibája mondta ki — most a mező fölött előre ott
// áll (`dijFizetve === false`). A fejléc megnevezi a partnert, az üres
// doboz nem foglal 360 px-et.
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, ShieldCheck } from 'lucide-react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

type Props = {
  entityKey: 'job_id' | 'booking_id';
  entityId: string;
  /** Kivel beszél a néző — a fejléc felirata. Hiányzik → „a fuvarpartnerrel". */
  partner?: 'szallito' | 'felado';
  /** A kapcsolatfelvételi díj állapota. `false` → előre jelezzük a kontakt-szabályt. */
  dijFizetve?: boolean;
};

/** A díj előtti szabály — ugyanaz a mondat, amit a szerver-oldali szűrő is mond. */
export const CHAT_DIJ_ELOTTI_SZABALY = 'A díj megfizetéséig telefonszám, e-mail-cím és link nem küldhető — utána automatikusan megkapjátok egymás elérhetőségét.';

export default function ChatBox({ entityKey, entityId, partner, dijFizetve }: Props) {
  const me = useCurrentUser();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Betöltés
  useEffect(() => {
    api.getMessages({ [entityKey]: entityId })
      .then(setMessages)
      .catch(() => {});
  }, [entityKey, entityId]);

  // Real-time: Socket.IO-ból érkező új üzenetek
  useEffect(() => {
    if (!me) return;
    joinUserRoom(me.id);
    const socket = getSocket();
    const roomKey = entityKey === 'job_id'
      ? `chat:job:${entityId}`
      : `chat:booking:${entityId}`;
    const onMsg = (msg: Message) => {
      setMessages((prev) => {
        // Deduplicate: ha az üzenet id-je már benne van, ne adjuk hozzá
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    socket.on(roomKey, onMsg);
    return () => {
      socket.off(roomKey, onMsg);
    };
  }, [me, entityKey, entityId]);

  // Auto-scroll aljára
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await api.sendMessage({ [entityKey]: entityId, body: text });
      // Lokálisan azonnal hozzáadjuk (a socket is megcsinálja, de így nincs
      // latency — a deduplicate szűrő megvédi a duplikációtól)
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      setInput('');
    } catch (e: any) {
      toast.error('Üzenet nem ment el', e.message);
    } finally {
      setSending(false);
    }
  }

  if (!me) return null;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Fejléc */}
      <div
        style={{
          padding: '10px 16px',
          background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MessageCircle size={16} aria-hidden />
        {partner === 'szallito' ? 'Üzenetek a szállítóval' : partner === 'felado' ? 'Üzenetek a feladóval' : 'Üzenetek a fuvarpartnerrel'}
      </div>

      {/* Üzenetek lista */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          // Üresen alacsony, üzenetekkel legfeljebb 360 px (görgethető).
          minHeight: 120,
          maxHeight: 360,
          overflowY: 'auto',
          padding: 12,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', margin: 'auto 0' }}>
            Még nincs üzenet — kezdd te a beszélgetést.
          </p>
        )}
        {messages.map((m) => {
          const isMine = m.sender_id === me.id;
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isMine ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 12,
                background: isMine ? 'var(--primary)' : 'var(--surface)',
                color: isMine ? '#fff' : 'var(--text)',
                border: isMine ? 'none' : '1px solid var(--border)',
                fontSize: 14,
                lineHeight: 1.4,
              }}
            >
              {!isMine && (
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>
                  {m.sender_name}
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {m.body}
              </div>
              <div
                style={{
                  fontSize: 11,
                  opacity: 0.6,
                  marginTop: 4,
                  textAlign: 'right',
                }}
              >
                {new Date(m.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
      </div>

      {dijFizetve === false && (
        <p
          style={{
            margin: 0, padding: '8px 12px', fontSize: 12, lineHeight: 1.5,
            borderTop: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)',
            display: 'flex', gap: 6, alignItems: 'flex-start',
          }}
        >
          <ShieldCheck size={14} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{CHAT_DIJ_ELOTTI_SZABALY}</span>
        </p>
      )}

      {/* Input */}
      <form noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{
          display: 'flex',
          gap: 8,
          padding: 10,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Írj üzenetet…"
          // GF-021: a placeholder eltűnik gépeléskor — a képernyőolvasónak
          // tartós, programozott név kell.
          aria-label="Üzenet szövege"
          disabled={sending}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="btn"
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          {/* GF-FT-05 (Manus): a gomb eddig nem mutatta, hogy dolgozik — a
              felhasználó azt hihette, elveszett az üzenet, és újraküldte.
              Hibánál a beírt szöveg megmarad, az újraküldés egy kattintás. */}
          {sending ? 'Küldés…' : 'Küldés'}
        </button>
      </form>
    </div>
  );
}
