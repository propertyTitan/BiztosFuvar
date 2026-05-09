'use client';

// =====================================================================
//  Útba eső fuvarok — egy konkrét útvonalhoz tartozó passzoló fuvarok.
//
//  A sofőr megy A → B → C, és a rendszer kilistázza azokat a feladott
//  fuvarokat, amelyek pickup-ja és dropoff-ja az út mentén van.
//  A sofőr innen átkattinthat a fuvar részleteire és licitálhat.
// =====================================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, Job } from '@/api';
import { useCurrentUser } from '@/lib/auth';

type AlongJob = Job & {
  along_pickup_wp_name: string;
  along_dropoff_wp_name: string;
  along_pickup_detour_km: number;
  along_dropoff_detour_km: number;
  along_detour_km: number;
  shipper_name?: string;
};

export default function UtbaEsoPage() {
  const me = useCurrentUser();
  const params = useParams();
  const routeId = params.id as string;

  const [jobs, setJobs] = useState<AlongJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me || !routeId) return;
    setLoading(true);
    api.alongJobs(routeId)
      .then((res) => setJobs(res.jobs as AlongJob[]))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [me?.id, routeId]);

  if (!me) return <p>Bejelentkezés szükséges.</p>;

  return (
    <div>
      <h1>🚗 Útba eső fuvarok</h1>
      <p className="muted">
        Az útvonalad mentén feladott fuvarok — minimális kitérővel felveheted
        őket. Minél kisebb a kitérő, annál jobban megéri.
      </p>

      <Link
        href={`/sofor/utvonal/${routeId}`}
        className="btn ghost"
        style={{ textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}
      >
        ← Vissza az útvonalhoz
      </Link>

      {loading && <p className="muted">Keresés…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && jobs.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>
            Jelenleg nincs útba eső fuvar az útvonalad mentén. Nézd meg később
            — amint valaki felad egy passzoló fuvart, itt megjelenik.
          </p>
        </div>
      )}

      {jobs.map((j) => (
        <Link
          key={j.id}
          href={`/sofor/fuvar/${j.id}`}
          className="card"
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            marginTop: 12,
            borderLeft: `4px solid ${detourColor(j.along_detour_km)}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{j.title}</h3>
                {j.is_instant && (
                  <span style={{
                    background: '#FB8C00', color: '#fff', padding: '2px 8px',
                    borderRadius: 12, fontSize: 11, fontWeight: 700,
                  }}>
                    ⚡ AZONNALI
                  </span>
                )}
              </div>
              <p className="muted" style={{ margin: '4px 0 2px' }}>📍 {j.pickup_address}</p>
              <p className="muted" style={{ margin: '2px 0' }}>🏁 {j.dropoff_address}</p>

              <div style={{
                marginTop: 8, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.05)', fontSize: 13,
                display: 'inline-flex', gap: 16,
              }}>
                <span>
                  Felvétel: <strong>{j.along_pickup_wp_name}</strong> közelében
                  ({j.along_pickup_detour_km} km kitérő)
                </span>
                <span>
                  Lerakás: <strong>{j.along_dropoff_wp_name}</strong> közelében
                  ({j.along_dropoff_detour_km} km kitérő)
                </span>
              </div>

              <div style={{ marginTop: 6, fontSize: 13 }}>
                {j.weight_kg != null && <span className="muted">{j.weight_kg} kg</span>}
                {j.distance_km != null && <span className="muted" style={{ marginLeft: 12 }}>{j.distance_km} km össztáv</span>}
              </div>

              {j.pickup_needs_carrying && (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  📦 Bepakolás szükséges ({j.pickup_floor === 0 ? 'földszint' : `${j.pickup_floor}. emelet`}
                  {j.pickup_floor > 0 && (j.pickup_has_elevator ? ', lift van' : ', NINCS lift')})
                </p>
              )}
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {j.suggested_price_huf?.toLocaleString('hu-HU')} Ft
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {j.is_instant ? 'fix ár' : 'javasolt ár'}
              </div>
              <div style={{
                marginTop: 8, padding: '4px 10px', borderRadius: 12,
                background: detourColor(j.along_detour_km), color: '#fff',
                fontSize: 12, fontWeight: 700,
              }}>
                +{j.along_detour_km} km kitérő
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function detourColor(km: number): string {
  if (km <= 5) return '#2E7D32';
  if (km <= 15) return '#F9A825';
  return '#E65100';
}
