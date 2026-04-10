'use client';

// Inline értékelő doboz: 5 csillag + szöveges megjegyzés + Küldés gomb.
// Használat: <ReviewBox entityKey="job_id" entityId="..." onDone={reload} />
//         vagy entityKey="booking_id"
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

  // Ha a user már értékelt, mutatjuk a meglévő értékeléseket
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
      toast.success('Értékelés elküldve', `${stars} csillag`);
      setSubmitted(true);
      onDone?.();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted || alreadyReviewed) {
    return (
      <div>
        {existingReviews.length > 0 && (
          <div>
            {existingReviews.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ fontSize: 14, color: '#f59e0b' }}>
                  {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13 }}>{r.reviewer_name}</strong>
                  {r.comment && (
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                      „{r.comment}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {submitted && (
          <p style={{ color: '#16a34a', fontWeight: 600, fontSize: 14, marginTop: 8 }}>
            ✓ Köszönjük az értékelésed!
          </p>
        )}
        {alreadyReviewed && !submitted && (
          <p className="muted" style={{ fontSize: 13 }}>
            Már értékelted ezt a fuvart.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Csillagok */}
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
            title={`${n} csillag`}
          >
            ★
          </button>
        ))}
        {stars > 0 && (
          <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--muted)', alignSelf: 'center' }}>
            {stars === 1 && 'Gyenge'}
            {stars === 2 && 'Elfogadható'}
            {stars === 3 && 'Átlagos'}
            {stars === 4 && 'Jó'}
            {stars === 5 && 'Kiváló'}
          </span>
        )}
      </div>

      {/* Megjegyzés */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Opcionális megjegyzés… (pl. „Gyors, precíz, ajánlom!")"
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
        {submitting ? 'Küldés…' : `${stars ? stars + ' csillag' : 'Válassz csillagot'} — Értékelés küldése`}
      </button>

      {/* Meglévő értékelések */}
      {existingReviews.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Korábbi értékelések:</div>
          {existingReviews.map((r) => (
            <div
              key={r.id}
              style={{
                padding: '6px 0',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, color: '#f59e0b' }}>
                {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
              </span>
              <strong style={{ fontSize: 12 }}>{r.reviewer_name}</strong>
              {r.comment && (
                <span className="muted" style={{ fontSize: 12 }}>
                  — „{r.comment}"
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
