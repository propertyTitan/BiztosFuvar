'use client';

import { greenStats } from '@/lib/green';

type Props = {
  distanceKm: number | null | undefined;
  /** Kompakt mód: egysoros változat (pl. listában). */
  compact?: boolean;
};

/**
 * Zöld jelvény egy fuvarhoz: mennyi CO₂ marad el azzal, hogy egy meglévő
 * úton viszik (nem külön futárautóval). Tájékoztató becslés (lásd lib/green.ts).
 */
export default function GreenBadge({ distanceKm, compact }: Props) {
  if (!distanceKm || distanceKm <= 0) return null;
  const s = greenStats(distanceKm);

  if (compact) {
    return (
      <span style={{ fontSize: 13, color: 'var(--success-text)' }}>
        🌿 ~{s.co2SavedKg} kg CO₂ megspórolva
      </span>
    );
  }

  return (
    <div
      style={{
        background: 'var(--success-light)',
        border: '1px solid var(--success)',
        borderRadius: 10,
        padding: '12px 14px',
        margin: '12px 0',
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--success-text)', marginBottom: 4 }}>
        🌿 Zöld fuvar
      </div>
      <div style={{ color: 'var(--text)' }}>
        Meglévő úton viszed → egy külön futárhoz képest kb.{' '}
        <strong>{s.co2SavedKg} kg CO₂</strong> marad el.
      </div>
    </div>
  );
}
