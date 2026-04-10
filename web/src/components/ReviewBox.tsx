'use client';

// Inline értékelő doboz: 5 csillag + szöveges megjegyzés + Küldés gomb.
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';

type Props = {
  entityKey: 'job_id' | 'booking_id';
  entityId: string;
  onDone?: () => void;
};

export default function ReviewBox({ entityKey, entityId, onDone }: Props) {
  const toast = useToast();
  const [existingReviews, setExistingReviews] = useState<any[]>([]);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.getReviews({ [entityKey]: entityId })
      .then(setExistingReviews)
      .catch(() => {});
  }, [entityKey, entityId]);

  const alreadyReviewed = existingReviews.some(
    (r) => r.reviewer_id === (typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('gofuvar_user') || '{}')?.id : null),
  );

  async function submit() {
    if (!stars) return;
    setSubmitting(true);
    try {
      await api.submitReview({
        [entityKey]: entityId,
        stars,
        comment: comment.trim() || undefined,
      });
      toast.success('Értékelés elküldve', stars + ' csillag');
      setSubmitted(true);
      onDone?.();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !submitted && !alreadyReviewed;

  function renderStars(count: number, max: number) {
    const filled = Math.min(Math.max(count || 0, 0), max);
    const empty = max - filled;
    return String.fromCodePoint(0x2605).repeat(filled) + String.fromCodePoint(0x2606).repeat(empty);
  }

  return (
    <div>
      {/* Meglévő értékelések */}
      {existingReviews.length > 0 && (
        <div style={{ marginBottom: showForm ? 16 : 0 }}>
          {existingReviews.map((r) => (
            <div
              key={r.id}
              style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 14, color: '#f59e0b' }}>
                {renderStars(r.stars || r.rating, 5)}
              </span>
              <strong style={{ fontSize: 13 }}>{r.reviewer_name}</strong>
              {r.comment && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {r.comment}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {submitted && (
        <p style={{ color: '#16a34a', fontWeight: 600, fontSize: 14 }}>
          Köszönjük az értékelésed!
        </p>
      )}

      {alreadyReviewed && !submitted && (
        <p className="muted" style={{ fontSize: 13 }}>
          Már értékelted ezt a fuvart.
        </p>
      )}

      {showForm && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setStars(n)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 32,
                  padding: 0,
                  color: n <= (hover || stars) ? '#f59e0b' : '#d1d5db',
                  transition: 'transform 0.1s ease',
                  transform: n <= (hover || stars) ? 'scale(1.15)' : 'scale(1)',
                }}
              >
                {String.fromCodePoint(0x2605)}
              </button>
            ))}
            {stars > 0 && (
              <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--muted)', alignSelf: 'center' }}>
                {stars === 1 ? 'Gyenge' : stars === 2 ? 'Elfogadható' : stars === 3 ? 'Átlagos' : stars === 4 ? 'Jó' : 'Kiváló'}
              </span>
            )}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Opcionális megjegyzés…"
            className="input"
            rows={2}
            style={{ marginBottom: 12, fontSize: 14 }}
          />

          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={!stars || submitting}
            style={{
              opacity: stars ? 1 : 0.5,
              background: '#f59e0b',
              border: 'none',
            }}
          >
            {submitting ? 'Küldés…' : (stars ? stars + ' csillag — Értékelés küldése' : 'Válassz csillagot')}
          </button>
        </div>
      )}
    </div>
  );
}
