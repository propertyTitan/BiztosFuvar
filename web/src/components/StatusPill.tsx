// =====================================================================
//  StatusPill — a fuvar állapot-jelvénye (2026-10-08, UX-átvizsgálás A12)
//
//  A felirat és a szín a közös `lib/statusz.ts`-ből jön — a hat helyi
//  lista helyett. Színes pont + 12 px-es szöveg; a háttér literál
//  rgba-tint (a `var(--…-light)` hátterekhez a globals.css !important
//  szövegszín-szabályt társít — CLAUDE.md design-szabály), a szöveg
//  `var(--text)`, így világos és sötét témában is olvasható.
// =====================================================================
import type { CSSProperties } from 'react';
import { fuvarStatusz, type StatuszNezet, type StatuszTonus } from '@/lib/statusz';

const TONUS: Record<StatuszTonus, { hatter: string; keret: string; pont: string }> = {
  ajanlat: { hatter: 'rgba(37,99,235,0.10)', keret: 'rgba(37,99,235,0.35)', pont: '#2563eb' },
  teendo: { hatter: 'rgba(217,119,6,0.14)', keret: 'rgba(217,119,6,0.45)', pont: '#d97706' },
  felvetel: { hatter: 'rgba(79,70,229,0.10)', keret: 'rgba(79,70,229,0.35)', pont: '#4f46e5' },
  uton: { hatter: 'rgba(2,132,199,0.10)', keret: 'rgba(2,132,199,0.35)', pont: '#0284c7' },
  kesz: { hatter: 'rgba(22,163,74,0.10)', keret: 'rgba(22,163,74,0.40)', pont: '#16a34a' },
  vita: { hatter: 'rgba(220,38,38,0.10)', keret: 'rgba(220,38,38,0.40)', pont: '#dc2626' },
  lezart: { hatter: 'rgba(107,114,128,0.12)', keret: 'rgba(107,114,128,0.35)', pont: '#6b7280' },
};

type Props = {
  job: { status: string; paid_at?: string | null };
  nezet?: StatuszNezet;
  style?: CSSProperties;
};

export default function StatusPill({ job, nezet = 'felado', style }: Props) {
  const s = fuvarStatusz(job, nezet);
  const t = TONUS[s.tonus];
  return (
    <span
      data-statusz={s.kulcs}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        // 12 px-es sarok: egysoros feliratnál kapszula, a hosszabb szállítói
        // feliratnál (mobilon) tisztán tördelődik, nem lóg ki.
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        background: t.hatter,
        border: `1px solid ${t.keret}`,
        color: 'var(--text)',
        maxWidth: '100%',
        ...style,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: t.pont, flexShrink: 0 }} />
      {s.felirat}
    </span>
  );
}
