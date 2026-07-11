'use client';

// Teljes oldalas AI segéd — a fejléc menü és a HomeHub "AI segéd" linkje
// ide navigál. A lebegő AiChatWidget továbbra is elérhető; mindkettő
// ugyanazt a /ai/chat végpontot és ugyanazt a localStorage history-t
// használja, így a beszélgetés a kettő közt szinkronban marad.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import AiMessageContent from '@/components/AiMessageContent';

type Message = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'gofuvar_ai_history';

const SUGGESTIONS = [
  'Hogyan adok fel új fuvart?',
  'Mi az a 6 jegyű kód?',
  'Mi a különbség az ajánlatkérés és a fix ár között?',
  'Hogyan működik a lemondás?',
];

export default function AiChatPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Csak betöltés után mentünk, nehogy a kezdeti üres [] kitörölje a historyt.
  const loadedRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  // History betöltés
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
    loadedRef.current = true;
  }, []);

  // History mentés (csak betöltés után)
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Scroll aljára
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: Message = { role: 'user', content: trimmed };
    const historyBeforeSend = messages;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.aiChat(trimmed, historyBeforeSend);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Hiba: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  if (!mounted) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
        Betöltés…
      </div>
    );
  }
  if (!me) {
    router.push('/bejelentkezes');
    return null;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>GoFuvar Segéd 🤖</h1>
        {messages.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={clearHistory}>
            Beszélgetés törlése
          </button>
        )}
      </div>

      <div
        className="card"
        style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '64vh' }}
      >
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <>
              <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
                Szia! Miben segíthetek a GoFuvarral kapcsolatban?
              </div>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 8,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 14,
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
                padding: '10px 14px',
                borderRadius: 14,
                background: m.role === 'user' ? 'var(--primary)' : 'var(--surface)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'assistant' ? '1px solid var(--border)' : undefined,
                fontSize: 15,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.role === 'assistant' ? (
                <AiMessageContent content={m.content} />
              ) : (
                m.content
              )}
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
                fontSize: 14,
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
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Kérdezz bármit…"
            className="input"
            style={{ flex: 1, marginTop: 0 }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="btn"
            style={{ padding: '8px 18px' }}
          >
            Küldés
          </button>
        </form>
      </div>
    </div>
  );
}
