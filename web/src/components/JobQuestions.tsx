'use client';

// Publikus Q&A blokk a fuvar oldalon (mint a Vatera vagy az eBay).
//
// - Bárki láthatja a kérdéseket és válaszokat
// - Bejelentkezett user kérdezhet (kivéve a fuvar feladója)
// - A fuvar feladója válaszolhat
// - Telefonszám / email = backend-en blokkolt + ITT helyben is figyelmeztetjük
//   a usert mielőtt elküldené (jobb UX)
// - Csak nyitott (pending/bidding) fuvarokra lehet új kérdés

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useToast } from './ToastProvider';

type Question = {
  id: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  asker_name: string;
  asker_id: string;
  answerer_name: string | null;
};

type Props = {
  jobId: string;
  jobStatus: string;
  shipperId: string;
  currentUserId?: string;
};

// Frontend-szintű telefonszám / email-előszűrés. A backend
// (utils/contactGuard.js) ugyanezt validálja végül — ez csak UX.
function detectContactLeak(text: string): string | null {
  const stripped = text.replace(/[\s\-./()_]/g, '');
  if (/\d{9,}/.test(stripped)) {
    return 'Telefonszám nem írható le. A fuvar elfogadása után a platform belüli chat-funkciót használhatjátok.';
  }
  if (/(\+36|0036|06)\d{6,}/i.test(stripped)) {
    return 'Telefonszám nem írható le. A fuvar elfogadása után a platform belüli chat-funkciót használhatjátok.';
  }
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) {
    return 'E-mail cím nem írható le. A platform-on belüli chat-funkciót használd.';
  }
  return null;
}

const OPEN_STATUSES = ['pending', 'bidding'];

export default function JobQuestions({ jobId, jobStatus, shipperId, currentUserId }: Props) {
  const toast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Per-kérdéses válasz-szöveg (a shipper válaszolhat a saját fuvarjához)
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answerWarnings, setAnswerWarnings] = useState<Record<string, string | null>>({});
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const isShipper = !!currentUserId && currentUserId === shipperId;
  const canAsk = !!currentUserId && !isShipper && OPEN_STATUSES.includes(jobStatus);

  useEffect(() => {
    api.listJobQuestions(jobId)
      .then(setQuestions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

  function onQuestionChange(v: string) {
    setNewQuestion(v);
    setWarning(detectContactLeak(v));
  }

  async function submitQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim() || newQuestion.length < 5) {
      toast.error('Túl rövid', 'A kérdés minimum 5 karakter legyen.');
      return;
    }
    const leak = detectContactLeak(newQuestion);
    if (leak) {
      toast.error('Telefonszám nem írható', leak);
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.askJobQuestion(jobId, newQuestion.trim());
      // Refresh full list (egyszerűbb mint az új userName-t kitalálni)
      const list = await api.listJobQuestions(jobId);
      setQuestions(list);
      setNewQuestion('');
      setWarning(null);
      toast.success('Kérdés elküldve', 'A feladó értesítést kap róla.');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function onAnswerChange(qid: string, v: string) {
    setAnswerDrafts((d) => ({ ...d, [qid]: v }));
    setAnswerWarnings((w) => ({ ...w, [qid]: detectContactLeak(v) }));
  }

  async function submitAnswer(qid: string) {
    const text = (answerDrafts[qid] || '').trim();
    if (!text) return;
    const leak = detectContactLeak(text);
    if (leak) {
      toast.error('Telefonszám nem írható', leak);
      return;
    }
    setAnsweringId(qid);
    try {
      await api.answerJobQuestion(qid, text);
      const list = await api.listJobQuestions(jobId);
      setQuestions(list);
      setAnswerDrafts((d) => { const c = { ...d }; delete c[qid]; return c; });
      setAnswerWarnings((w) => { const c = { ...w }; delete c[qid]; return c; });
      toast.success('Válasz elküldve', 'A kérdező értesítést kap.');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setAnsweringId(null);
    }
  }

  if (loading) return null;

  // Ha nincs kérdés és nem is tudna feltenni (pl. saját fuvar, vagy zárt)
  if (questions.length === 0 && !canAsk) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>❓ Kérdések és válaszok</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        A feltett kérdésekre adott válaszok publikusak — mindenki látja, így nem kell
        ugyanazt 15-ször kérdezni.
        {canAsk && ' A fuvar elfogadása előtt nem írható telefonszám vagy e-mail cím — az ott-on belüli kommunikáció a fuvar megkezdése után indul.'}
      </p>

      {/* Kérdés-feltevő űrlap (nem a shipper, nyitott fuvar) */}
      {canAsk && (
        <form onSubmit={submitQuestion} style={{ marginTop: 12, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <textarea
            value={newQuestion}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="Pl. Be tudjátok pakolni az 5. emeletre? Van lift?"
            maxLength={500}
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              fontSize: 14,
              border: `1px solid ${warning ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              resize: 'vertical',
            }}
          />
          {warning && (
            <p style={{ color: 'var(--danger-text)', fontSize: 13, margin: '6px 0 0' }}>
              ⚠️ {warning}
            </p>
          )}
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginTop: 4,
              color: newQuestion.length > 0 && newQuestion.length < 5 ? 'var(--danger)' : undefined,
            }}
          >
            {newQuestion.length} / 500 · legalább 5 karakter
          </div>
          <button
            type="submit"
            className="btn"
            disabled={submitting || !newQuestion.trim() || newQuestion.length < 5 || !!warning}
            style={{ marginTop: 8 }}
          >
            {submitting ? 'Küldés…' : 'Kérdés feltétele'}
          </button>
        </form>
      )}

      {/* Kérdések listája */}
      {questions.length === 0 ? (
        <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>Még nincs kérdés. Legyél te az első!</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {questions.map((q) => (
            <div key={q.id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              {/* Kérdés */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>❓ {q.asker_name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(q.created_at).toLocaleDateString('hu-HU')}
                </span>
              </div>
              <p style={{ margin: '4px 0 8px', fontSize: 14, lineHeight: 1.5 }}>{q.question}</p>

              {/* Válasz */}
              {q.answer ? (
                <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--success-text)' }}>
                      ✅ {q.answerer_name || 'Feladó'} válaszolt
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {q.answered_at && new Date(q.answered_at).toLocaleDateString('hu-HU')}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{q.answer}</p>
                </div>
              ) : (
                <>
                  <p className="muted" style={{ fontSize: 13, margin: '4px 0' }}>Még nincs válasz</p>
                  {/* Csak a feladó tudja válaszolni */}
                  {isShipper && (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={answerDrafts[q.id] || ''}
                        onChange={(e) => onAnswerChange(q.id, e.target.value)}
                        placeholder="Válaszolj nyíltan — mindenki látja, így segítesz a többi sofőrnek is."
                        maxLength={1000}
                        rows={2}
                        style={{
                          width: '100%',
                          padding: 8,
                          fontSize: 13,
                          border: `1px solid ${answerWarnings[q.id] ? 'var(--danger)' : 'var(--border)'}`,
                          borderRadius: 6,
                          background: 'var(--bg)',
                          color: 'var(--text)',
                          resize: 'vertical',
                        }}
                      />
                      {answerWarnings[q.id] && (
                        <p style={{ color: 'var(--danger-text)', fontSize: 12, margin: '4px 0 0' }}>
                          ⚠️ {answerWarnings[q.id]}
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => submitAnswer(q.id)}
                        disabled={
                          answeringId === q.id ||
                          !answerDrafts[q.id]?.trim() ||
                          !!answerWarnings[q.id]
                        }
                        style={{ marginTop: 6, padding: '6px 12px', fontSize: 13 }}
                      >
                        {answeringId === q.id ? 'Küldés…' : 'Válasz küldése'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
