'use client';

// =====================================================================
//  Szállító bevétel & teljesítmény dashboard.
//  Szép grafikonok, havi trend, top útvonalak, statisztikák.
// =====================================================================

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { Loading, ErrorState, EmptyState } from '@/components/StateView';
import type { ReactNode } from 'react';
import {
  BarChart3, Truck, Banknote, Calculator, Route as RouteIcon, Star, Award, ArrowRight, Rocket,
} from 'lucide-react';

type Stats = {
  totals: {
    total_deliveries: number;
    total_gross_earnings: number;
    total_net_earnings: number;
    avg_price: number;
    total_km: number;
  };
  monthly: Array<{ month: string; deliveries: number; gross: number; net: number }>;
  top_routes: Array<{ pickup_city: string; dropoff_city: string; count: number; avg_price: number }>;
  recent_jobs: Array<{ id: string; title: string; accepted_price_huf: number; distance_km: number; delivered_at: string }>;
  profile: { rating_avg: number; rating_count: number; trust_score: number; level: number; level_name: string };
};

const fmt = (n: number) => n.toLocaleString('hu-HU');

export default function SoforDashboard() {
  const me = useCurrentUser();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api.driverStats()
      .then(setStats)
      .catch((e) => setError(e.message || 'Nem sikerült betölteni.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!me) return;
    load();
  }, [me?.id]);

  if (!me) return <Loading />;
  if (loading) return <Loading />;
  if (error || !stats) return <ErrorState message={error || 'Nem sikerült betölteni a statisztikákat.'} onRetry={load} />;

  const { totals, monthly, top_routes, recent_jobs, profile } = stats;
  const maxMonthlyNet = Math.max(...monthly.map((m) => m.net), 1);

  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BarChart3 size={26} color="var(--primary)" aria-hidden /> Statisztikám
      </h1>
      <p className="muted">A teljesített fuvarjaid számokban.</p>

      {/* Fő statisztikák */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12, marginTop: 16,
      }}>
        <StatCard icon={<Truck size={22} aria-hidden />} value={totals.total_deliveries} label="Befejezett fuvar" />
        {/* UX-review A28 (2026-10-08): nem „Összes bevétel" — a fuvardíjat a
            felek egymás közt rendezik, a kifizetést a platform nem látja; ez a
            feladókkal MEGÁLLAPODOTT díjak összege. „Nettó" sincs: a fuvardíj
            100%-a a szállítóé, a platform semmit nem von le belőle. */}
        <StatCard
          icon={<Banknote size={22} aria-hidden />}
          value={`${fmt(totals.total_net_earnings)} Ft`}
          label="Megállapodott fuvardíjak"
          sub="a feladókkal megállapodott díjak összege"
        />
        <StatCard icon={<Calculator size={22} aria-hidden />} value={`${fmt(totals.avg_price)} Ft`} label="Átlag fuvardíj" />
        <StatCard icon={<RouteIcon size={22} aria-hidden />} value={`${Number(totals.total_km).toFixed(0)} km`} label="Össztávolság" />
        <StatCard icon={<Star size={22} aria-hidden />} value={profile.rating_avg || '—'} label={`Értékelés (${profile.rating_count})`} />
        <StatCard icon={<Award size={22} aria-hidden />} value={profile.level_name || `Szint ${profile.level || 1}`} label="Jelenlegi szint" />
      </div>

      {/* Havi trend grafikon */}
      {monthly.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>Megállapodott fuvardíjak havonta</h2>
          {/* BUG-036: kevés adatnál az oszlop ne nyúljon teljes szélességre
              (egy hónapnyi adattal töröttnek nézett ki) — max 96px/oszlop */}
          <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 160, justifyContent: monthly.length < 4 ? 'flex-start' : 'stretch' }}>
            {monthly.map((m) => {
              const height = Math.max(4, (m.net / maxMonthlyNet) * 140);
              return (
                <div key={m.month} style={{ flex: 1, maxWidth: 96, textAlign: 'center' }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                    {fmt(m.net)} Ft
                  </div>
                  <div
                    style={{
                      height,
                      background: 'linear-gradient(180deg, var(--primary-light), var(--primary))',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.5s ease',
                    }}
                    title={`${m.month}: ${m.deliveries} fuvar, ${fmt(m.net)} Ft megállapodott fuvardíj`}
                  />
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {m.month.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top útvonalak */}
      {top_routes.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Top útvonalak</h2>
          {top_routes.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: i < top_routes.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <strong>{r.pickup_city?.trim()}</strong>
                <ArrowRight size={14} aria-label="→" />
                <strong>{r.dropoff_city?.trim()}</strong>
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {r.count}× · átl. {fmt(r.avg_price)} Ft
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Legutóbbi fuvarok */}
      {recent_jobs.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Legutóbbi fuvarok</h2>
          {recent_jobs.map((j) => (
            <div
              key={j.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <strong>{j.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {j.distance_km} km · {new Date(j.delivered_at).toLocaleDateString('hu-HU')}
                </div>
              </div>
              <strong style={{ color: 'var(--success-text)' }}>{fmt(j.accepted_price_huf)} Ft</strong>
            </div>
          ))}
        </div>
      )}

      {totals.total_deliveries === 0 && (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            icon={<Rocket size={28} aria-hidden />}
            title="Még nincs befejezett fuvarod"
            description="Vállalj el egy fuvart, és itt fogod látni a statisztikáidat."
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label, sub }: { icon: ReactNode; value: string | number; label: string; sub?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 16 }}>
      <div style={{ marginBottom: 4, color: 'var(--primary)', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{label}</div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
