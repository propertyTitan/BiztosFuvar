'use client';

// Inline chat doboz: üzenetek listája + input.
// Használat:
//   <ChatBox entityKey="job_id" entityId="..." />
//   <ChatBox entityKey="booking_id" entityId="..." />
//
// A beszélgetés a job/booking-hoz tartozik. Az üzenetek valós időben
// frissülnek Socket.IO-n: a chat:job:<id> vagy chat:booking:<id>
// room-ból érkeznek az új üzenetek.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket, joinUserRoom } from '@/lib/socket';

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
};

export default function ChatBox({ entityKey, entityId }: Props) {
  const me = useCurrentUser();
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
      alert('Hiba: ' + e.message);
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
        height: 360,
      }}
    >
      {/* Fejléc */}
      <div
        style={{
          padding: '10px 16px',
          background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        💬 Chat a fuvarpartnerrel
      </div>

      {/* Üzenetek lista */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
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
            Még nincs üzenet. Írj először!
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
              {m.body}
              <div
                style={{
                  fontSize: 10,
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

      {/* Input */}
      <form
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
          Küldés
        </button>
      </form>
    </div>
  );
}
