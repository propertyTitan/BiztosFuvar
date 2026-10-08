'use client';

import { Leaf } from 'lucide-react';
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

  // UX-review Q14 (2026-10-08): a listában egy még el sem vállalt fuvarról
  // MÚLT időben („megspórolva”) állt — feltételes mód kell: ha úgyis arra mész.
  if (compact) {
    return (
      <span style={{ fontSize: 13, color: 'var(--success-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Leaf size={13} aria-hidden /> ha úgyis arra mész: kb. {s.co2SavedKg} kg CO₂ spórolható
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
      <div style={{ fontWeight: 700, color: 'var(--success-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Leaf size={16} aria-hidden /> Zöld fuvar
      </div>
      <div style={{ color: 'var(--text)' }}>
        Ha meglévő úton viszed, egy külön futárhoz képest kb.{' '}
        <strong>{s.co2SavedKg} kg CO₂</strong> marad el.
      </div>
    </div>
  );
}
