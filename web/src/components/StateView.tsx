'use client';

// =====================================================================
//  Egységes állapot-nézetek: betöltés / üres / hiba.
//  Eddig minden oldal külön <p>Betöltés…</p>-t és nyers "Hiba: {error}"
//  kártyát rajzolt — ez egy helyen, márkázottan, dark-mode-biztosan.
//
//  Használat:
//    if (loading) return <Loading />;
//    if (error)   return <ErrorState message={error} onRetry={load} />;
//    if (!items.length) return <EmptyState icon="🔔" title="Nincs még…" cta={...} />;
// =====================================================================

import { ReactNode } from 'react';

/** Márkázott, középre zárt betöltő — guruló GoFuvar teherautóval. */
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
          alignItems: 'center', justifyContent: 'center', fontSize: 26,
        }}>🚛</div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{label}</p>
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
      <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
      <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{title}</p>
      {message && <p className="muted" style={{ margin: '0 0 16px' }}>{message}</p>}
      {onRetry && (
        <button className="btn btn-secondary" type="button" onClick={onRetry}>
          Újrapróbálom
        </button>
      )}
    </div>
  );
}

/** Üres állapot — ikon + cím + leírás + opcionális CTA. */
export function EmptyState({
  icon = '📭',
  title,
  description,
  cta,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 44, marginBottom: 8 }}>{icon}</div>
      <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 4px' }}>{title}</p>
      {description && (
        <p className="muted" style={{ margin: '0 0 16px', maxWidth: 420, marginInline: 'auto' }}>
          {description}
        </p>
      )}
      {cta}
    </div>
  );
}
