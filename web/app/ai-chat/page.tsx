'use client';

// Teljes oldalas AI segéd — a fejléc menü és a HomeHub "AI segéd" linkje
// ide navigál. A lebegő AiChatWidget továbbra is elérhető; mindkettő
// ugyanazt a /ai/chat végpontot és ugyanazt a FIÓKHOZ kötött előzményt
// (lib/aiHistory.ts) használja, így a beszélgetés a kettő közt szinkronban marad.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { AI_MESSAGE_MAX_LENGTH, aiErrorText, useAiHistory, type AiMessage } from '@/lib/aiHistory';
import AiMessageContent from '@/components/AiMessageContent';
import { Lightbulb } from 'lucide-react';

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
  // Audit P1 R1-7 (2026-09-28): eddig fiókfüggetlen localStorage-kulcsba
  // írt, amit a kijelentkezés nem törölt — a következő fiók az
  // előző teljes beszélgetését kapta. Mostantól fiókhoz kötött, és
  // fiókváltáskor (újratöltés nélkül is) az új fiók kulcsáról töltődik.
  const { messages, update, clear, isOwner } = useAiHistory(me?.id);
  const [input, setInput] = useState('');
  const [hiba, setHiba] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);
  // Belépés-kapu (2026-09-11, C2): a redirect EFFEKTBEN, nem render közben
  // (React: render alatti navigáció figyelmeztetés + dupla push).
  useEffect(() => { if (mounted && !me) router.push('/bejelentkezes'); }, [mounted, me, router]);

  // Fiókváltáskor a be nem küldött szöveg és a hibajelzés sem marad a mezőben.
  useEffect(() => { setInput(''); setHiba(null); }, [me?.id]);

  // Scroll aljára
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || !me) return;
    // A kérdező fiók: a késve érkező válasz csak az ő előzményébe kerülhet.
    const owner = me.id;
    const userMsg: AiMessage = { role: 'user', content: trimmed };
    const historyBeforeSend = messages;
    update(owner, (prev) => [...prev, userMsg]);
    setInput('');
    setHiba(null);
    setLoading(true);
    try {
      const res = await api.aiChat(trimmed, historyBeforeSend);
      update(owner, (prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (e: any) {
      if (e?.code === 'AI_MESSAGE_TOO_LONG') {
        // Az elutasított kérdés ne maradjon az előzményben (minden további
        // kérés újraküldené); visszakerül a mezőbe, hogy le lehessen rövidíteni.
        update(owner, (prev) => (prev[prev.length - 1]?.content === trimmed ? prev.slice(0, -1) : prev));
        if (isOwner(owner)) { setInput(trimmed); setHiba(aiErrorText(e)); }
      } else {
        update(owner, (prev) => [...prev, { role: 'assistant', content: aiErrorText(e) }]);
      }
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    clear();
  }

  if (!mounted) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
        Betöltés…
      </div>
    );
  }
  if (!me) return null;

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
        <h1 style={{ margin: 0 }}>GoFuvar Segéd</h1>
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
                  <Lightbulb size={14} aria-hidden style={{ verticalAlign: -2 }} /> {s}
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
                fontSize: 16,
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

        {hiba && (
          <div
            id="ai-oldal-hiba"
            role="alert"
            style={{ padding: '8px 12px', fontSize: 14, color: 'var(--danger)', borderTop: '1px solid var(--border)' }}
          >
            {hiba}
          </div>
        )}
        <form noValidate
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
            onChange={(e) => { setInput(e.target.value); setHiba(null); }}
            maxLength={AI_MESSAGE_MAX_LENGTH}
            aria-invalid={hiba ? true : undefined}
            aria-describedby={hiba ? 'ai-oldal-hiba' : undefined}
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
