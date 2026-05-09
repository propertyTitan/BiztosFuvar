'use client';

// =====================================================================
//  Sofőr bevétel & teljesítmény dashboard.
//  Szép grafikonok, havi trend, top útvonalak, statisztikák.
// =====================================================================

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

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

  useEffect(() => {
    if (!me) return;
    api.driverStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [me?.id]);

  if (!me) return <p>Bejelentkezés szükséges.</p>;
  if (loading) return <p className="muted">Betöltés…</p>;
  if (!stats) return <p>Nem sikerült betölteni.</p>;

  const { totals, monthly, top_routes, recent_jobs, profile } = stats;
  const maxMonthlyNet = Math.max(...monthly.map((m) => m.net), 1);

  return (
    <div>
      <h1>📊 Sofőr Dashboard</h1>
      <p className="muted">A te teljesítményed számokban.</p>

      {/* Fő statisztikák */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12, marginTop: 16,
      }}>
        <StatCard icon="🚛" value={totals.total_deliveries} label="Befejezett fuvar" />
        <StatCard icon="💰" value={`${fmt(totals.total_net_earnings)} Ft`} label="Nettó bevétel (össz)" />
        <StatCard icon="📊" value={`${fmt(totals.avg_price)} Ft`} label="Átlag fuvardíj" />
        <StatCard icon="🛣️" value={`${Number(totals.total_km).toFixed(0)} km`} label="Össztávolság" />
        <StatCard icon="⭐" value={profile.rating_avg || '—'} label={`Értékelés (${profile.rating_count})`} />
        <StatCard icon={levelIcon(profile.level)} value={profile.level_name || `Szint ${profile.level || 1}`} label="Jelenlegi szint" />
      </div>

      {/* Havi trend grafikon */}
      {monthly.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0, marginBottom: 16 }}>Havi bevétel trend</h2>
          <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 160 }}>
            {monthly.map((m) => {
              const height = Math.max(4, (m.net / maxMonthlyNet) * 140);
              return (
                <div key={m.month} style={{ flex: 1, textAlign: 'center' }}>
                  <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
                    {fmt(m.net)} Ft
                  </div>
                  <div
                    style={{
                      height,
                      background: 'linear-gradient(180deg, #4ECDC4, #2E7D32)',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.5s ease',
                    }}
                    title={`${m.month}: ${m.deliveries} fuvar, ${fmt(m.net)} Ft nettó`}
                  />
                  <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
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
              <span>
                <strong>{r.pickup_city?.trim()}</strong> → <strong>{r.dropoff_city?.trim()}</strong>
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
              <strong style={{ color: '#2E7D32' }}>{fmt(j.accepted_price_huf)} Ft</strong>
            </div>
          ))}
        </div>
      )}

      {totals.total_deliveries === 0 && (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚀</div>
          <h2>Még nincs befejezett fuvarod</h2>
          <p className="muted">
            Vállalj el egy fuvart, és itt fogod látni a statisztikáidat!
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 16 }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function levelIcon(level: number): string {
  const icons = ['🌱', '🚗', '🚛', '⭐', '💎', '🏆', '👑', '🌟', '🔥', '🚀'];
  return icons[Math.min((level || 1) - 1, icons.length - 1)];
}
