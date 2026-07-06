'use client';

import { greenStats } from '@/lib/green';

type Props = {
  distanceKm: number | null | undefined;
  /** A fuvardíj (Ft) — ha megvan, kiírjuk, hogy fedezi az üzemanyagot. */
  priceHuf?: number | null;
  /** Kompakt mód: egysoros változat (pl. listában). */
  compact?: boolean;
};

/**
 * Zöld / üzemanyag jelvény egy fuvarhoz: mennyi CO₂-t spórol (meglévő úton
 * viszik), és — ha van fuvardíj — hogy a díj bőven fedezi az út üzemanyagát.
 * Tájékoztató becslés (lásd lib/green.ts), nem ígéret.
 */
export default function GreenBadge({ distanceKm, priceHuf, compact }: Props) {
  if (!distanceKm || distanceKm <= 0) return null;
  const s = greenStats(distanceKm, priceHuf);
  const coversFuel = s.coversFuel != null && s.coversFuel >= 1;

  if (compact) {
    return (
      <span className="muted" style={{ fontSize: 12.5, color: '#15803d' }}>
        🌿 ~{s.co2SavedKg} kg CO₂ megspórolva
        {coversFuel ? ` · üzemanyag megkeresve` : ''}
      </span>
    );
  }

  return (
    <div
      style={{
        background: 'var(--success-bg, #f0fdf4)',
        border: '1px solid #16a34a',
        borderRadius: 10,
        padding: '12px 14px',
        margin: '12px 0',
        fontSize: 13.5,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 4 }}>
        🌿 Zöld fuvar
      </div>
      <div style={{ color: 'var(--text)' }}>
        Meglévő úton viszed → egy külön futárhoz képest kb.{' '}
        <strong>{s.co2SavedKg} kg CO₂</strong> marad el.
      </div>
      <div style={{ color: 'var(--text)', marginTop: 2 }}>
        ⛽ Az út üzemanyaga kb. <strong>{s.fuelCostHuf.toLocaleString('hu-HU')} Ft</strong> (~{s.fuelLiters} l)
        {coversFuel ? ' — a fuvardíjból bőven megkeresed.' : '.'}
      </div>
    </div>
  );
}
