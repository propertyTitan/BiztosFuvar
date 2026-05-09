'use client';

// =====================================================================
//  Sofőr – Visszafuvar ajánlások.
//
//  A sofőrnek minden aktív (elvállalt, még nem kézbesített) A → B
//  fuvarjához listázzuk azokat a feladott fuvarokat, amelyek:
//     - pickup-ja B közelében van,
//     - dropoff-ja A közelében van.
//
//  Így a sofőr nem üresen megy vissza — plusz fuvart vállal ugyanarra a
//  kilométerre. A backend `backhaul_score` alapján (0-100) rendezi a
//  jelölteket.
// =====================================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, BackhaulGroup } from '@/api';
import { useCurrentUser } from '@/lib/auth';

export default function VisszafuvarPage() {
  const me = useCurrentUser();
  const [groups, setGroups] = useState<BackhaulGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { groups } = await api.backhaulSuggestions();
      setGroups(groups);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) return;
    load();
  }, [me?.id]);

  if (!me) return <p>Bejelentkezés szükséges.</p>;

  return (
    <div>
      <h1>🔄 Visszafuvar ajánlások</h1>
      <p className="muted">
        A rendszer az aktív fuvaraid útvonalához keres olyan feladott fuvarokat,
        amelyek a visszaúton passzolnak — így nem üresen jössz haza. Minél
        magasabb a <strong>match pontszám</strong> (0–100), annál pontosabb az
        egyezés.
      </p>

      {loading && <p className="muted">Betöltés…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && groups.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p>
            Jelenleg nincs visszafuvar-ajánlás. Ez kétféle oknál fogva lehet:
          </p>
          <ul>
            <li>Nincs aktív, még le nem zárt fuvarod (amihez visszaút kéne).</li>
            <li>
              Van aktív fuvarod, de a rendszer nem talált olyan feladott fuvart,
              ami a visszaútadhoz illeszkedik (±30 km). Nézd meg pár óra múlva.
            </li>
          </ul>
          <Link className="btn ghost" href="/sofor/sajat-fuvarok">
            Aktív fuvaraim megtekintése
          </Link>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.trip_id} className="card" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <strong>Aktív fuvarod: {g.trip_title}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {g.trip_pickup_address} → {g.trip_dropoff_address}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {g.candidates.map((c) => (
              <Link
                key={c.id}
                href={`/sofor/fuvar/${c.id}`}
                className="card"
                style={{
                  padding: 12,
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  display: 'block',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <strong>{c.title}</strong>
                  <span
                    style={{
                      background: matchColor(c.backhaul_score),
                      color: '#fff',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {c.backhaul_score}%
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                  <div>🟢 {c.pickup_address}</div>
                  <div>🔴 {c.dropoff_address}</div>
                  <div style={{ marginTop: 6 }}>
                    Eltérés: <strong>{c.backhaul_pickup_from_dest_km} km</strong> pickup
                    , <strong>{c.backhaul_drop_from_origin_km} km</strong> dropoff
                  </div>
                  {c.suggested_price_huf && (
                    <div style={{ marginTop: 6, color: 'var(--text)' }}>
                      💰 javasolt ár:{' '}
                      <strong>{c.suggested_price_huf.toLocaleString('hu-HU')} Ft</strong>
                    </div>
                  )}
                  {c.is_instant && (
                    <div style={{ marginTop: 4, color: '#E65100', fontWeight: 600 }}>
                      ⚡ Azonnali fuvar — első elfogadó nyer!
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// Vizuális visszajelzés a score-hoz: 80+ zöld, 50+ sárga, alatta narancs.
function matchColor(score: number): string {
  if (score >= 80) return '#2E7D32';
  if (score >= 50) return '#F9A825';
  return '#E65100';
}
