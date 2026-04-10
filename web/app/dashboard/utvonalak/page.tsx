'use client';

// Feladó: sofőri útvonalak böngészése.
// - Szöveges város szűrés (pl. "Kecskemét" → minden olyan útvonal, aminek
//   a waypoints tömbjében szerepel ez a város)
// - Kártyák: útvonal, indulás, méret-árak
// - Koppintás → részletek + foglalás oldal
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CarrierRoute } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import RouteBrowseMap from '@/components/RouteBrowseMap';

type ViewMode = 'list' | 'map';

export default function FeladoiUtvonalBongeszo() {
  const me = useCurrentUser();
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  async function load(filterCity?: string) {
    setLoading(true);
    try {
      const data = await api.listCarrierRoutes({
        city: filterCity || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      });
      setRoutes(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onFilter(e: React.FormEvent) {
    e.preventDefault();
    load(city);
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Útba eső sofőrök</h1>
          <p className="muted" style={{ margin: 0 }}>
            Sofőrök által meghirdetett útvonalak. Foglalj helyet a csomagod
            számára az útjukon, fix áron — nincs licitálás.
          </p>
        </div>
        {/* Nézet váltó: lista ↔ térkép */}
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--bg)',
            borderRadius: 999,
            padding: 3,
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={() => setView('list')}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: 'none',
              background: view === 'list' ? '#fff' : 'transparent',
              fontWeight: view === 'list' ? 700 : 500,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text)',
              boxShadow: view === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            📋 Lista
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: 'none',
              background: view === 'map' ? '#fff' : 'transparent',
              fontWeight: view === 'map' ? 700 : 500,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text)',
              boxShadow: view === 'map' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🗺️ Térkép
          </button>
        </div>
      </div>

      <form className="card" onSubmit={onFilter} style={{ marginTop: 16 }}>
        <label>Szűrés</label>
        <div className="row" style={{ alignItems: 'end', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 12 }}>Város</label>
            <input
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="pl. Kecskemét"
            />
          </div>
          <div>
            <label style={{ fontSize: 12 }}>Ettől</label>
            <input
              className="input"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ width: 150 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12 }}>Eddig</label>
            <input
              className="input"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ width: 150 }}
            />
          </div>
          <button className="btn" type="submit">Keresés</button>
          {(city || fromDate || toDate) && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setCity('');
                setFromDate('');
                setToDate('');
                setTimeout(() => load(), 50);
              }}
            >
              Törlés
            </button>
          )}
        </div>
      </form>

      {loading && <p style={{ marginTop: 16 }}>Betöltés…</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginTop: 16 }}>
          <strong>Hiba:</strong> {error}
        </div>
      )}

      {!loading && !error && routes.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted">
            Jelenleg nincs olyan nyitott útvonal, ami{city ? ` a(z) „${city}" várost érinti` : ' elérhető lenne'}.
          </p>
        </div>
      )}

      {/* Térképes nézet: minden útvonalhoz zöld start + piros cél marker,
          és egy halvány szaggatott vonal a teljes waypoint láncon. */}
      {!loading && !error && routes.length > 0 && view === 'map' && (
        <div style={{ marginTop: 16 }}>
          <RouteBrowseMap routes={routes} currentUserId={me?.id || null} />
          <p className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            🟢 Indulás · 🔴 Cél · 🟡 Saját poszt · Kattints bármelyik markerre a részletekhez.
          </p>
        </div>
      )}

      {view === 'list' && routes.map((r) => {
        const first = r.waypoints[0]?.name || '?';
        const last = r.waypoints[r.waypoints.length - 1]?.name || '?';
        const stops = r.waypoints.slice(1, -1);
        const isMine = !!me && r.carrier_id === me.id;
        // A saját posztot a sofőri részletek oldalra visszük (ott van
        // szerkesztés/publikálás), a többit a feladói foglalás oldalra.
        const href = isMine ? `/sofor/utvonal/${r.id}` : `/dashboard/utvonal/${r.id}`;
        return (
          <Link
            key={r.id}
            href={href}
            className={`card${isMine ? ' own-post-card' : ''}`}
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              marginTop: 16,
              ...(isMine ? { background: '#fefce8', borderColor: '#facc15' } : {}),
            }}
          >
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>{r.title}</h3>
              {isMine && (
                <span
                  className="pill"
                  style={{
                    background: '#facc15',
                    color: '#713f12',
                    fontWeight: 800,
                    fontSize: 11,
                  }}
                  title="Ezt te hirdetted — nem foglalhatsz rá helyet."
                >
                  SAJÁT POSZT
                </span>
              )}
            </div>
            <p className="muted" style={{ margin: '4px 0' }}>
              📍 <strong>{first}</strong>
              {stops.length > 0 && (
                <> → {stops.map((w) => w.name).join(' → ')}</>
              )}
              {' → '}<strong>{last}</strong>
            </p>
            <p className="muted" style={{ margin: '4px 0' }}>
              🗓 {new Date(r.departure_at).toLocaleString('hu-HU')}
            </p>
            {r.vehicle_description && (
              <p className="muted" style={{ margin: '4px 0', fontSize: 13 }}>
                🚛 {r.vehicle_description}
              </p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              {r.prices.map((p) => (
                <span
                  key={p.size}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 13,
                  }}
                >
                  <strong>{p.size}</strong> {p.price_huf.toLocaleString('hu-HU')} Ft
                </span>
              ))}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
