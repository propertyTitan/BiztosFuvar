'use client';

// Lebegő AI segéd widget – jobb alsó sarok.
// - Zárt: 48 px-es kék kör (lucide Sparkles)
// - Nyitott: asztalon kis chatablak, mobilon alsó lap (bottom sheet)
// - Az üzeneteket a /ai/chat végpontra küldi (Gemini)
// - A history fiókonként localStorage-ben marad meg (lib/aiHistory.ts),
//   amíg a user nem törli vagy ki nem jelentkezik
//
// UX-kör A9 (2026-10-08): mobilon a 60 px-es gomb pont a döntéshez szükséges
// adatokat és a beküldő gombokat takarta (a saját /ai-chat oldalán a Küldés
// gombot is). Most: kisebb, a biztonságos sávot figyeli, mobilon csak a hubon
// és a listaoldalakon látszik, és nyitott billentyűzetnél eltűnik. A
// pozícionálás CSS-osztályokban él (globals.css .ai-fab / .ai-panel), mert
// inline stílust a mobil média-lekérdezés nem tudna felülírni.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Lightbulb, Sparkles, X } from 'lucide-react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { useSutiDontesMegvan } from '@/lib/sutiDontes';
import { AI_MESSAGE_MAX_LENGTH, aiErrorText, useAiHistory, type AiMessage } from '@/lib/aiHistory';
import AiMessageContent from './AiMessageContent';

const SUGGESTIONS = [
  'Hogyan adok fel új fuvart?',
  'Mi az a 6 jegyű kód?',
  'Mi a különbség az ajánlatkérés és a fix ár között?',
  'Hogyan működik a lemondás?',
];

/**
 * Ahol a lebegő gomb nem jelenik meg. 2026-10-03 (CIB PR-5): mobilon (390 px)
 * a kártyás fizetés eredményoldalán eltakarta a kártya utolsó bekezdését (a
 * banki adatsor és a „Vissza a fuvarhoz" környékét). 2026-10-08 (UX-kör A9):
 * a teljes oldalas AI-segéden a saját Küldés gombját takarta — ott a lebegő
 * gombnak amúgy sincs értelme.
 */
const REJTETT_UTAK = ['/fizetes/eredmeny', '/ai-chat'];

/**
 * Mobilon (≤768 px) CSAK ezeken látszik: a hub és a listaoldalak. Űrlapokon,
 * fuvar-részletoldalakon, a profilon és a belépésnél takarna — ott a fiókmenü
 * „AI segéd" pontja viszi a teljes oldalas változatra.
 */
export const AI_GOMB_MOBILON_UTAK = [
  '/', '/fuvarjaim', '/sofor/fuvarok', '/ertesitesek', '/hirdeteseim',
  '/sofor/utvonalaim', '/dashboard/utvonalak',
];

export function aiGombMobilonLathato(ut: string | null | undefined): boolean {
  return Boolean(ut) && AI_GOMB_MOBILON_UTAK.includes(ut as string);
}

/** Szövegbeviteli mező (a billentyűzetet nyitja) — a jelölőnégyzet nem az. */
const GEPELO_MEZO = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]), textarea, select, [contenteditable="true"]';

export default function AiChatWidget() {
  const user = useCurrentUser();
  const ut = usePathname();
  const [open, setOpen] = useState(false);
  // Fiókhoz kötött előzmény (audit P1 R1-7, 2026-09-28): a régi globális
  // kulcsot többé nem „migráljuk" — az egy korábbi fiók beszélgetése volt.
  const { messages, update, clear, isOwner } = useAiHistory(user?.id);
  const [input, setInput] = useState('');
  const [hiba, setHiba] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Amíg a süti-banner (alul, teljes szélességben, z-index 9999) látszik, az
  // ELTAKARJA a lebegő chat-gombot (z-index 1000) — a kattintás a bannerre
  // megy, ezért tűnt úgy, hogy "a gomb nem reagál". Amíg nincs süti-döntés,
  // a chatet elrejtjük; a döntés után (event vagy localStorage) megjelenik.
  const sutiDontes = useSutiDontesMegvan();
  // Nyitott billentyűzet (mobil): egy szövegmező kapott fókuszt a widgeten
  // KÍVÜL — ilyenkor a gomb a beküldő gombokat takarná.
  const [gepeles, setGepeles] = useState(false);

  // Fiókváltáskor a be nem küldött szöveg és a hibajelzés sem marad a mezőben.
  useEffect(() => { setInput(''); setHiba(null); }, [user?.id]);

  useEffect(() => {
    const be = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.matches?.(GEPELO_MEZO) && !el.closest('.ai-panel')) setGepeles(true);
    };
    const ki = () => setGepeles(false);
    document.addEventListener('focusin', be);
    document.addEventListener('focusout', ki);
    return () => {
      document.removeEventListener('focusin', be);
      document.removeEventListener('focusout', ki);
    };
  }, []);

  // Scroll aljára
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || !user) return;
    // A kérdező fiók: a késve érkező válasz csak az ő előzményébe kerülhet.
    const owner = user.id;
    const userMsg: AiMessage = { role: 'user', content: trimmed };
    // FONTOS: a backend a `message`-t külön paraméterként kapja és
    // önmaga adja hozzá a beszélgetéshez, a `history` csak az eddig
    // lezajlott üzenetváltást jelenti. Korábban duplán küldtük: a
    // history-ban is és a message mezőben is, ami összezavarta Gemini-t.
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

  if (!user) return null; // csak bejelentkezett usernek mutatjuk
  if (ut && REJTETT_UTAK.some((r) => ut === r || ut.startsWith(`${r}/`))) return null;
  // Amíg a süti-banner takarja az alsó sávot, ne mutassunk lebegő gombot —
  // különben a banner alatt egy nem-kattintható "szellem" gomb látszana.
  if (!sutiDontes) return null;

  // Mobilon rejtett: nem hub/lista oldal, nyitott billentyűzet, vagy nyitott
  // alsó lap (annak saját bezáró gombja van). Asztalon mindig látszik.
  const mobilonRejtett = open || gepeles || !aiGombMobilonLathato(ut);

  return (
    <>
      {/* Lebegő gomb */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Bezár' : 'AI segéd megnyitása'}
        aria-expanded={open}
        aria-controls={open ? 'ai-seged-panel' : undefined}
        className={`ai-fab${mobilonRejtett ? ' ai-fab--mobil-rejtett' : ''}`}
      >
        {open ? <X size={22} aria-hidden /> : <Sparkles size={22} aria-hidden />}
      </button>

      {/* Chat ablak — asztalon kis ablak, mobilon alsó lap (globals.css) */}
      {open && (
        <div id="ai-seged-panel" className="ai-panel" role="dialog" aria-label="GoFuvar Segéd">
          <div
            style={{
              padding: 16,
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} aria-hidden /> GoFuvar Segéd
              </div>
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
                  width: 32,
                  height: 32,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                <X size={18} aria-hidden />
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Lightbulb size={16} color="var(--warning)" aria-hidden style={{ flexShrink: 0 }} /> {s}
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

          {hiba && (
            <div
              id="ai-widget-hiba"
              role="alert"
              style={{ padding: '8px 12px', fontSize: 12, color: 'var(--danger-text)', borderTop: '1px solid var(--border)' }}
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
              background: 'var(--surface)',
            }}
          >
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setHiba(null); }}
              maxLength={AI_MESSAGE_MAX_LENGTH}
              aria-invalid={hiba ? true : undefined}
              aria-describedby={hiba ? 'ai-widget-hiba' : undefined}
              placeholder="Kérdezz…"
              aria-label="Kérdés az AI-segédnek"
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                marginTop: 0,
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
