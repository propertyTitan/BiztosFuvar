'use client';

// =====================================================================
//  Publikus fuvar-követés — a címzett böngészőjében.
//  Nem kell bejelentkezés, nem kell app. Egy link és kész.
//
//  URL: /nyomon-kovetes/<tracking_token>
//  Mutatja: állapot, sofőr neve, GPS pozíció, ETA, átvételi kód, QR kód.
// =====================================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import QrCode from '@/components/QrCode';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  pending:     { label: 'Sofőrt keresünk',        color: '#6B7280', icon: '🔍' },
  bidding:     { label: 'Sofőrt keresünk',        color: '#6B7280', icon: '🔍' },
  accepted:    { label: 'Sofőr elfogadta',        color: '#2563EB', icon: '✅' },
  in_progress: { label: 'Csomag úton van!',       color: '#16A34A', icon: '🚛' },
  delivered:   { label: 'Csomag megérkezett!',    color: '#16A34A', icon: '🎉' },
  completed:   { label: 'Fuvar lezárva',          color: '#6B7280', icon: '✅' },
  cancelled:   { label: 'Fuvar lemondva',         color: '#DC2626', icon: '❌' },
};

type TrackingData = {
  id: string;
  title: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  delivery_code: string;
  delivered_at: string | null;
  recipient_name: string | null;
  carrier: { name: string; vehicle: string; phone: string; rating: number } | null;
  last_position: { lat: number; lng: number; speed_kmh: number; recorded_at: string } | null;
};

export default function PublicTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackingData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch(`${BASE_URL}/tracking/${token}`);
      if (!res.ok) throw new Error('Fuvar nem található');
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Auto-refresh minden 30 másodpercben
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [token]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
      <p>Betöltés…</p>
    </div>
  );

  if (error || !data) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
      <h1>Fuvar nem található</h1>
      <p className="muted">A link érvénytelen vagy a fuvar már törölve lett.</p>
    </div>
  );

  const s = STATUS_LABELS[data.status] || STATUS_LABELS.pending;
  const eta = data.last_position?.speed_kmh && data.last_position.speed_kmh > 5
    ? '~számítás…'
    : null;

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: '20px 16px' }}>
      {/* Fejléc */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          🚛 GoFuvar — Csomagkövetés
        </div>
        {data.recipient_name && (
          <p className="muted" style={{ margin: 0 }}>
            Szia {data.recipient_name}! A csomagod állapota:
          </p>
        )}
      </div>

      {/* Állapot badge */}
      <div
        style={{
          textAlign: 'center',
          padding: '16px 20px',
          borderRadius: 12,
          background: `${s.color}15`,
          border: `2px solid ${s.color}`,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 36 }}>{s.icon}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: s.color, marginTop: 4 }}>
          {s.label}
        </div>
      </div>

      {/* Fuvar adatok */}
      <div style={{
        padding: 16, borderRadius: 10,
        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
        marginBottom: 16,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{data.title}</div>
        <div style={{ fontSize: 13 }}>📍 {data.pickup_address}</div>
        <div style={{ fontSize: 13 }}>🏁 {data.dropoff_address}</div>
      </div>

      {/* Sofőr infó */}
      {data.carrier && (
        <div style={{
          padding: 16, borderRadius: 10,
          background: 'rgba(46,125,50,0.08)', border: '1px solid rgba(46,125,50,0.3)',
          marginBottom: 16,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🚗 Sofőr: {data.carrier.name}</div>
          {data.carrier.vehicle && (
            <div className="muted" style={{ fontSize: 13 }}>Jármű: {data.carrier.vehicle}</div>
          )}
          {data.carrier.phone && (
            <div style={{ marginTop: 8 }}>
              📞 <a href={`tel:${data.carrier.phone}`} style={{ fontWeight: 700, fontSize: 16 }}>
                {data.carrier.phone}
              </a>
            </div>
          )}
          {data.carrier.rating > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              ⭐ {Number(data.carrier.rating).toFixed(1)} értékelés
            </div>
          )}
        </div>
      )}

      {/* GPS pozíció */}
      {data.last_position && ['in_progress', 'accepted'].includes(data.status) && (
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
          marginBottom: 16, fontSize: 13,
        }}>
          📍 Utolsó pozíció: {new Date(data.last_position.recorded_at).toLocaleTimeString('hu-HU')}
          {data.last_position.speed_kmh ? ` · ${Math.round(data.last_position.speed_kmh)} km/h` : ''}
        </div>
      )}

      {/* Átvételi kód + QR */}
      {data.delivery_code && !['cancelled', 'completed'].includes(data.status) && (
        <div
          style={{
            padding: 24,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            color: '#fff',
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase', marginBottom: 12 }}>
            🔐 Átvételi kód — mutasd meg a sofőrnek
          </div>
          <QrCode jobId={data.id} deliveryCode={data.delivery_code} size={180} />
        </div>
      )}

      {/* Kézbesítve */}
      {data.status === 'delivered' && (
        <div style={{
          padding: 20, borderRadius: 12,
          background: '#dcfce7', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#166534', marginTop: 8 }}>
            Csomag sikeresen átvéve!
          </div>
          {data.delivered_at && (
            <div style={{ fontSize: 13, color: '#166534', marginTop: 4 }}>
              {new Date(data.delivered_at).toLocaleString('hu-HU')}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, opacity: 0.5 }}>
        🚛 GoFuvar — Bizalom. Fotó. Kód. Letét.
      </div>
    </div>
  );
}
