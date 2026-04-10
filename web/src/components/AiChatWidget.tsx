'use client';

// Lebegő AI segéd widget – jobb alsó sarok.
// - Zárt: kék kör "🤖" ikonnal
// - Nyitott: egy kis chatablak, üzenetlistával és bemeneti mezővel
// - Az üzeneteket a /ai/chat végpontra küldi (Gemini)
// - A history localStorage-ben marad meg, ameddig a user nem törli
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

type Message = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'gofuvar_ai_history';

const SUGGESTIONS = [
  'Hogyan adok fel új fuvart?',
  'Mi az a 6 jegyű kód?',
  'Mi a különbség a licit és a fix ár között?',
  'Hogyan működik a lemondás?',
];

export default function AiChatWidget() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // History betöltés
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);

  // History mentés
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Scroll aljára
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: Message = { role: 'user', content: trimmed };
    // FONTOS: a backend a `message`-t külön paraméterként kapja és
    // önmaga adja hozzá a beszélgetéshez, a `history` csak az eddig
    // lezajlott üzenetváltást jelenti. Korábban duplán küldtük: a
    // history-ban is és a message mezőben is, ami összezavarta Gemini-t.
    const historyBeforeSend = messages;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.aiChat(trimmed, historyBeforeSend);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Hiba: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!user) return null; // csak bejelentkezett usernek mutatjuk

  return (
    <>
      {/* Lebegő gomb */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Bezár' : 'AI segéd megnyitása'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: 28,
          boxShadow: '0 6px 20px rgba(30,64,175,0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {open ? '×' : '🤖'}
      </button>

      {/* Chat ablak */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 100,
            right: 24,
            width: 360,
            maxWidth: 'calc(100vw - 48px)',
            height: 500,
            maxHeight: 'calc(100vh - 140px)',
            background: 'var(--surface)',
            borderRadius: 16,
            boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              padding: 16,
              background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>GoFuvar Segéd 🤖</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Kérdezz bármit!</div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 6,
                  fontSize: 11,
                  padding: '3px 8px',
                  cursor: 'pointer',
                }}
              >
                Törlés
              </button>
            )}
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 16,
              background: 'var(--bg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.length === 0 && (
              <>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
                  Szia! Miben segíthetek a GoFuvarral kapcsolatban?
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    style={{
                      textAlign: 'left',
                      padding: 10,
                      borderRadius: 8,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    💡 {s}
                  </button>
                ))}
              </>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: m.role === 'user' ? 'var(--primary)' : '#fff',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  border: m.role === 'assistant' ? '1px solid var(--border)' : undefined,
                  fontSize: 14,
                  lineHeight: 1.4,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--muted)',
                  fontSize: 13,
                }}
              >
                Írom a választ…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            style={{
              padding: 12,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 8,
              background: 'var(--surface)',
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Kérdezz…"
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 14,
                outline: 'none',
              }}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn"
              style={{ padding: '8px 14px', fontSize: 14 }}
            >
              Küldés
            </button>
          </form>
        </div>
      )}
    </>
  );
}
