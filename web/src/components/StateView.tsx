'use client';

// =====================================================================
//  Egységes állapot-nézetek: betöltés / skeleton / üres / hiba.
//
//  A launch első heteiben szinte minden user ÜRES listákkal találkozik —
//  az üres állapot dönti el, hogy a platform "halottnak" vagy "korainak"
//  érződik. Ezért az EmptyState nem odavetett szöveg, hanem márkázott
//  invitáció: ikon + útvonal-motívum + konkrét CTA.
//
//  Használat:
//    if (loading) return <ListSkeleton rows={5} />;   // listákhoz
//    if (loading) return <Loading />;                  // részlet-oldalhoz
//    if (error)   return <ErrorState message={error} onRetry={load} />;
//    if (!items.length) return (
//      <EmptyState
//        icon={<Bell size={28} />}
//        title="Még nincs értesítésed"
//        description="Itt jelennek meg a fuvarjaid eseményei."
//        cta={<Link className="btn" href="/dashboard/uj-fuvar">Adj fel egy fuvart</Link>}
//      />
//    );
// =====================================================================

import { ReactNode } from 'react';
import { Truck, AlertTriangle, PackageOpen } from 'lucide-react';

/** Márkázott, középre zárt betöltő — részlet-oldalakra. Listákhoz a
 *  ListSkeleton a jobb választás (ott a tartalom formája is látszik). */
export function Loading({ label = 'Betöltés…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '64px 24px', gap: 16,
      }}
    >
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <div
          style={{
            position: 'absolute', inset: 0,
            border: '4px solid var(--border)',
            borderTopColor: 'var(--primary)',
            borderRadius: '50%',
            animation: 'gofuvar-spin 0.8s linear infinite',
          }}
        />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Truck size={26} color="var(--primary)" aria-hidden />
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-body)' }}>{label}</p>
    </div>
  );
}

/** Lista-betöltő: lüktető kártya-vázak a tényleges tartalom formájában.
 *  Ettől érződik gyorsnak az app a Neon ~1 mp-es cold startja alatt is. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Betöltés…" style={{ marginTop: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="card"
          aria-hidden
          style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}
        >
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: '45%' }} />
            <div className="skeleton" style={{ height: 11, width: '70%' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            <div className="skeleton" style={{ height: 14, width: 72 }} />
            <div className="skeleton" style={{ height: 11, width: 48 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Hibakártya újrapróbálás-gombbal. */
export function ErrorState({
  title = 'Hoppá, valami félrement',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="card"
      role="alert"
      style={{ textAlign: 'center', padding: 32, borderColor: 'var(--danger)' }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: '50%', margin: '0 auto 12px',
        background: 'rgba(220,38,38,0.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <AlertTriangle size={26} color="var(--danger-text)" aria-hidden />
      </div>
      <p style={{ fontWeight: 700, fontSize: 'var(--fs-lead)', margin: '0 0 4px' }}>{title}</p>
      {message && <p className="muted" style={{ margin: '0 0 16px' }}>{message}</p>}
      {onRetry && (
        <button className="btn btn-secondary" type="button" onClick={onRetry}>
          Újrapróbálom
        </button>
      )}
    </div>
  );
}

/** Üres állapot — márkázott invitáció: ikon + A→B motívum + cím + CTA.
 *
 *  - `icon`: lucide ikon-node (pl. <Bell size={28} />) — a tintezett körbe
 *    kerül. Emoji-string is működik (régi hívók), de ÚJ kódban lucide!
 *  - `compact`: szekción belüli, kisebb változat (pl. a Fuvarjaim fülek
 *    rész-listáihoz) — kisebb ikon, szűkebb padding, nincs útvonal-motívum.
 *  - `cta` + `secondaryCta`: gomb-node-ok (pl. <Link className="btn" …>). */
export function EmptyState({
  icon,
  title,
  description,
  cta,
  secondaryCta,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  cta?: ReactNode;
  secondaryCta?: ReactNode;
  compact?: boolean;
}) {
  const iconNode = icon ?? <PackageOpen size={compact ? 22 : 28} aria-hidden />;
  return (
    <div
      className="card"
      style={{
        textAlign: 'center',
        padding: compact ? '24px 20px' : '40px 24px',
        marginTop: 16,
        border: '2px dashed var(--border)',
        background: 'var(--bg)',
        boxShadow: 'none',
      }}
    >
      {/* rgba-tint és nem var(--primary-subtle): a globals.css
          [style*="--primary-subtle"] dark-szabálya !important-tal
          felülírná a belső színeket */}
      <div style={{
        width: compact ? 48 : 64, height: compact ? 48 : 64,
        borderRadius: '50%', margin: '0 auto',
        background: 'rgba(37,99,235,0.10)', color: 'var(--primary-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: compact ? 22 : 30, // emoji-string fallback mérete
      }}>
        {iconNode}
      </div>
      {/* A márka aláírása: mini A→B — kék pont = feladás, zöld = megérkezett */}
      {!compact && (
        <svg aria-hidden width="72" height="10" viewBox="0 0 72 10" fill="none"
          style={{ display: 'block', margin: '10px auto 2px', opacity: 0.75 }}>
          <path d="M6 6 C 24 2, 48 2, 66 5" stroke="var(--primary-light)" strokeWidth="2"
            strokeDasharray="0.5 6" strokeLinecap="round" />
          <circle cx="6" cy="6" r="3" fill="var(--primary)" />
          <circle cx="66" cy="5" r="3" fill="var(--success)" />
        </svg>
      )}
      <p style={{
        fontWeight: 700, fontSize: compact ? 'var(--fs-body)' : 'var(--fs-lead)',
        margin: compact ? '10px 0 2px' : '8px 0 4px',
      }}>{title}</p>
      {description && (
        <p className="muted" style={{
          margin: '0 auto', maxWidth: 420, fontSize: 'var(--fs-body)', lineHeight: 1.55,
        }}>
          {description}
        </p>
      )}
      {(cta || secondaryCta) && (
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap',
          marginTop: compact ? 14 : 20,
        }}>
          {cta}
          {secondaryCta}
        </div>
      )}
    </div>
  );
}
