'use client';

// Lebegő AI segéd widget – jobb alsó sarok.
// - Zárt: kék kör "🤖" ikonnal
// - Nyitott: egy kis chatablak, üzenetlistával és bemeneti mezővel
// - Az üzeneteket a /ai/chat végpontra küldi (Gemini)
// - A history localStorage-ben marad meg, ameddig a user nem törli
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import AiMessageContent from './AiMessageContent';

type Message = { role: 'user' | 'assistant'; content: string };

// Felhasználónként külön kulcs: fiókváltásnál ne az előző user beszélgetése
// jelenjen meg (és ne az menjen kontextusként a Geminihez).
const STORAGE_KEY_BASE = 'gofuvar_ai_history';
const storageKey = (userId?: string | null) =>
  userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_BASE;

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
  // Csak a localStorage-ből való betöltés UTÁN mentünk — különben a kezdeti
  // üres [] felülírná a korábbi beszélgetést (ezért "felejtett" a bot reload után).
  const loadedRef = useRef(false);
  // Amíg a süti-banner (alul, teljes szélességben, z-index 9999) látszik, az
  // ELTAKARJA a lebegő chat-gombot (z-index 1000) — a kattintás a bannerre
  // megy, ezért tűnt úgy, hogy "a gomb nem reagál". Amíg nincs süti-döntés,
  // a chatet elrejtjük; a döntés után (event vagy localStorage) megjelenik.
  const [consentPending, setConsentPending] = useState(true);

  // History betöltés — fiókváltáskor (user.id változás) újratöltünk.
  // Egyszeri migráció: a régi, közös kulcson tárolt beszélgetést átvisszük
  // a user-specifikus kulcsra, hogy a frissítés után ne "tűnjön el".
  useEffect(() => {
    loadedRef.current = false;
    try {
      const key = storageKey(user?.id);
      let raw = localStorage.getItem(key);
      if (!raw && user?.id) {
        const legacy = localStorage.getItem(STORAGE_KEY_BASE);
        if (legacy) {
          localStorage.setItem(key, legacy);
          localStorage.removeItem(STORAGE_KEY_BASE);
          raw = legacy;
        }
      }
      setMessages(raw ? JSON.parse(raw) : []);
    } catch {
      setMessages([]);
    }
    loadedRef.current = true;
  }, [user?.id]);

  // Süti-döntés állapota — ha már döntött a user, a chat azonnal látszhat.
  useEffect(() => {
    try {
      if (localStorage.getItem('gofuvar_cookie_consent')) setConsentPending(false);
    } catch {
      setConsentPending(false);
    }
    function onConsent() {
      setConsentPending(false);
    }
    window.addEventListener('gofuvar:cookie-consent', onConsent);
    return () => window.removeEventListener('gofuvar:cookie-consent', onConsent);
  }, []);

  // History mentés (csak betöltés után)
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(storageKey(user?.id), JSON.stringify(messages));
    } catch {}
  }, [messages, user?.id]);

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
    localStorage.removeItem(storageKey(user?.id));
  }

  if (!user) return null; // csak bejelentkezett usernek mutatjuk
  // Amíg a süti-banner takarja az alsó sávot, ne mutassunk lebegő gombot —
  // különben a banner alatt egy nem-kattintható "szellem" gomb látszana.
  if (consentPending) return null;

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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Bezárás"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
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
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: m.role === 'user' ? 'var(--primary)' : 'var(--surface)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  border: m.role === 'assistant' ? '1px solid var(--border)' : undefined,
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                }}
              >
                {m.role === 'assistant' ? (
                  <AiMessageContent content={m.content} onNavigate={() => setOpen(false)} />
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
