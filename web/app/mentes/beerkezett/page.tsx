'use client';

// =====================================================================
//  Mentős: beérkezett mentés kérések a közelben.
//
//  A mentős-sofőr itt látja az aktív kéréseket, elvállalja a
//  legközelebbit, és kezeli a mentés folyamatát.
// =====================================================================

import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';

const ISSUE_LABELS: Record<string, string> = {
  breakdown: '🔧 Lerobbanás',
  flat_tire: '🛞 Defekt',
  accident: '💥 Baleset',
  ditch: '🏔️ Elakadás',
  battery: '🔋 Akkumulátor',
  lockout: '🔑 Bezárt kulcs',
  fuel: '⛽ Üzemanyag',
  other: '❓ Egyéb',
};

const VEHICLE_LABELS: Record<string, string> = {
  car: '🚗 Személyautó',
  van: '🚐 Kisbusz',
  truck: '🚛 Teherautó',
  motorcycle: '🏍️ Motor',
};

type TowRequest = {
  id: string;
  requester_id: string;
  requester_name?: string;
  requester_phone?: string;
  lat: number;
  lng: number;
  address?: string;
  issue_type: string;
  issue_description?: string;
  vehicle_type: string;
  vehicle_plate?: string;
  status: string;
  distance_km?: number;
  created_at: string;
  expires_at?: string;
};

export default function MentesBeerkezett() {
  const me = useCurrentUser();
  const [requests, setRequests] = useState<TowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await api.towingIncoming();
      setRequests(data);
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

  useEffect(() => {
    const socket = getSocket();
    const onNew = () => load();
    const onTaken = (data: { tow_id: string }) => {
      setRequests((prev) => prev.filter((r) => r.id !== data.tow_id));
    };
    socket.on('towing:new', onNew);
    socket.on('towing:taken', onTaken);
    socket.on('towing:cancelled', onTaken);
    return () => {
      socket.off('towing:new', onNew);
      socket.off('towing:taken', onTaken);
      socket.off('towing:cancelled', onTaken);
    };
  }, []);

  async function accept(towId: string) {
    setAcceptingId(towId);
    try {
      await api.acceptTowing(towId, priceInput ? Number(priceInput) : undefined);
      setRequests((prev) => prev.filter((r) => r.id !== towId));
    } catch (err: any) {
      setError(err.message);
      load();
    } finally {
      setAcceptingId(null);
      setPriceInput('');
    }
  }

  if (!me) return <p>Bejelentkezés szükséges.</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1>🚨 Beérkezett mentés kérések</h1>
        <button className="btn btn-secondary" onClick={load}>Frissítés</button>
      </div>
      <p className="muted">
        Valós időben frissül — ha valaki mentést kér a közelben, azonnal megjelenik.
        Az első elfogadó nyer.
      </p>

      {loading && <p className="muted">Betöltés…</p>}
      {error && <p style={{ color: '#EF4444' }}>{error}</p>}

      {!loading && requests.length === 0 && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ margin: 0 }}>Jelenleg nincs mentés kérés a közelben.</p>
        </div>
      )}

      {requests.map((r) => (
        <div
          key={r.id}
          className="card"
          style={{
            marginTop: 16,
            borderLeft: `4px solid ${r.issue_type === 'accident' ? '#DC2626' : '#FB8C00'}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>
                  {ISSUE_LABELS[r.issue_type] || r.issue_type}
                </h3>
                <span className="muted" style={{ fontSize: 13 }}>
                  {VEHICLE_LABELS[r.vehicle_type] || r.vehicle_type}
                </span>
              </div>
              {r.requester_name && (
                <p style={{ margin: '6px 0 2px', fontWeight: 600 }}>{r.requester_name}</p>
              )}
              {r.requester_phone && (
                <p style={{ margin: '2px 0' }}>
                  📞 <a href={`tel:${r.requester_phone}`}>{r.requester_phone}</a>
                </p>
              )}
              {r.address && <p className="muted" style={{ margin: '2px 0' }}>📍 {r.address}</p>}
              {r.vehicle_plate && <p className="muted" style={{ margin: '2px 0' }}>🔢 {r.vehicle_plate}</p>}
              {r.issue_description && (
                <p className="muted" style={{ margin: '6px 0', fontStyle: 'italic' }}>
                  „{r.issue_description}"
                </p>
              )}
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <span className="muted">
                  {new Date(r.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {r.expires_at && (
                  <span className="muted" style={{ marginLeft: 12 }}>
                    Lejár: {new Date(r.expires_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {r.distance_km != null && (
                <div style={{
                  fontSize: 20, fontWeight: 800,
                  color: r.distance_km <= 10 ? '#2E7D32' : r.distance_km <= 20 ? '#FB8C00' : '#EF4444',
                }}>
                  {r.distance_km} km
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <input
                  className="input"
                  type="number"
                  placeholder="Becsült ár (Ft)"
                  value={acceptingId === r.id ? priceInput : ''}
                  onChange={(e) => setPriceInput(e.target.value)}
                  style={{ width: 130, fontSize: 13, marginBottom: 6 }}
                  onFocus={() => setAcceptingId(r.id)}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() => accept(r.id)}
                  disabled={acceptingId != null && acceptingId !== r.id}
                  style={{
                    width: '100%',
                    background: '#DC2626',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {acceptingId === r.id ? 'Elfogadás…' : '🚗 Elvállalom!'}
                </button>
              </div>
              {r.lat && r.lng && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, marginTop: 4, display: 'inline-block' }}
                >
                  🗺️ Navigáció
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
