'use client';

// Inline értékelő doboz: 5 csillag + szöveges megjegyzés + Küldés gomb.
//
// 2026-10-08 (UX-átvizsgálás A17): mobilon a csillagok és a név egy sorba
// szorultak (2+2+1 csillag, „Kovác / s Anna"), a borostyán gomb fehér
// szövege olvashatatlan volt (2,15:1), értékelés után is „Értékeld…" maradt
// a cím, és nem derült ki, kié a látott vélemény. Most:
//   - minden tétel címkét kap: „Rólad — <név>" / „Tőled";
//   - két soros elrendezés (csillag + címke, alatta a szöveg), tördelhető;
//   - a cím a hívótól jön (`cim`), értékelés után „Az értékelésetek";
//   - a küldés gomb a sima elsődleges .btn;
//   - nyitott vitánál egy figyelmeztető sor.
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { useCurrentUser } from '@/lib/auth';

type Props = {
  entityKey: 'job_id' | 'booking_id';
  entityId: string;
  onDone?: () => void;
  /** A doboz címe értékelés ELŐTT (pl. „Értékeld a szállítót"). Utána: „Az értékelésetek". */
  cim?: string;
  /** Rövid kérdés a csillagok fölött (a néző szerepéhez illő). */
  kerdes?: string;
  /** Nyitott vita az ügyleten — az értékelést érdemes a lezárás után megírni. */
  vitaNyitott?: boolean;
};

const CSILLAG = String.fromCodePoint(0x2605);
const URES_CSILLAG = String.fromCodePoint(0x2606);

function csillagok(count: number, max: number) {
  const filled = Math.min(Math.max(count || 0, 0), max);
  return CSILLAG.repeat(filled) + URES_CSILLAG.repeat(max - filled);
}

export default function ReviewBox({ entityKey, entityId, onDone, cim, kerdes, vitaNyitott }: Props) {
  const toast = useToast();
  const me = useCurrentUser();
  const [existingReviews, setExistingReviews] = useState<any[]>([]);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function betolt() {
    return api.getReviews({ [entityKey]: entityId })
      .then(setExistingReviews)
      .catch(() => {});
  }

  useEffect(() => {
    betolt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, entityId]);

  const alreadyReviewed = !!me && existingReviews.some((r) => r.reviewer_id === me.id);

  async function submit() {
    if (submitting) return;
    if (!stars) {
      toast.error('Hiányzó értékelés', 'Válassz legalább egy csillagot az elküldéshez.');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitReview({
        [entityKey]: entityId,
        stars,
        comment: comment.trim() || undefined,
      });
      toast.success('Értékelés elküldve', stars + ' csillag');
      setSubmitted(true);
      betolt();
      onDone?.();
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !submitted && !alreadyReviewed;
  const kesz = submitted || alreadyReviewed;

  return (
    <div>
      {cim && (
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Star size={20} color="var(--warning)" fill="var(--warning)" aria-hidden />
          {kesz ? 'Az értékelésetek' : cim}
        </h2>
      )}
      {showForm && kerdes && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{kerdes}</p>
      )}
      {showForm && vitaNyitott && (
        <p className="callout callout-info" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Az értékelést a vita lezárása után érdemes megírni.
        </p>
      )}

      {/* Meglévő értékelések — címkével: kié, kiről */}
      {existingReviews.length > 0 && (
        <div style={{ marginBottom: showForm ? 16 : 0 }}>
          {existingReviews.map((r) => {
            const rolam = !!me && r.reviewee_id === me.id;
            const tolem = !!me && r.reviewer_id === me.id;
            const cimke = tolem ? 'Tőled' : rolam ? `Rólad — ${r.reviewer_name || 'Törölt felhasználó'}` : (r.reviewer_name || 'Értékelés');
            return (
              <div
                key={r.id}
                style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', minWidth: 0 }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
                  <span
                    aria-label={`${r.stars || r.rating} csillag az 5-ből`}
                    role="img"
                    style={{ fontSize: 14, color: 'var(--warning)', whiteSpace: 'nowrap', letterSpacing: 1 }}
                  >
                    {csillagok(r.stars || r.rating, 5)}
                  </span>
                  <strong style={{ fontSize: 13, minWidth: 0, overflowWrap: 'break-word' }}>{cimke}</strong>
                </div>
                {r.comment && (
                  <p className="muted" style={{ fontSize: 13, margin: '4px 0 0', overflowWrap: 'break-word' }}>
                    {r.comment}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {submitted && (
        <p style={{ color: 'var(--success-text)', fontWeight: 600, fontSize: 14 }}>
          Köszönjük az értékelésed!
        </p>
      )}

      {showForm && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setStars(n)}
                  aria-label={`${n} csillag`}
                  aria-pressed={stars === n}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 32,
                    lineHeight: 1,
                    padding: 0,
                    color: n <= (hover || stars) ? 'var(--warning)' : '#d1d5db',
                    transition: 'transform 0.1s ease',
                    transform: n <= (hover || stars) ? 'scale(1.15)' : 'scale(1)',
                  }}
                >
                  {CSILLAG}
                </button>
              ))}
            </div>
            {stars > 0 && (
              <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--muted)' }}>
                {stars === 1 ? 'Gyenge' : stars === 2 ? 'Elfogadható' : stars === 3 ? 'Átlagos' : stars === 4 ? 'Jó' : 'Kiváló'}
              </span>
            )}
          </div>

          <textarea
            aria-label="Értékelés szövege (opcionális)"
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
            disabled={submitting}
            style={{ opacity: stars ? 1 : 0.7, whiteSpace: 'normal' }}
          >
            {submitting ? 'Küldés…' : (stars ? stars + ' csillag — Értékelés küldése' : 'Válassz csillagot')}
          </button>
        </div>
      )}
    </div>
  );
}
