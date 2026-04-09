'use client';

// Sofőr: egy konkrét útvonal részletei + beérkezett foglalások.
// - Az útvonal adatai (waypoints, árak, státusz)
// - Foglalások listája: feladó, csomag méret + pontos méretek, ár, gombok
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, CarrierRoute, RouteBooking } from '@/api';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  confirmed: 'Elfogadva',
  rejected: 'Elutasítva',
  in_progress: 'Úton',
  delivered: 'Lerakva',
  cancelled: 'Törölve',
  disputed: 'Vitatott',
};

export default function UtvonalReszletek() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [route, setRoute] = useState<CarrierRoute | null>(null);
  const [bookings, setBookings] = useState<RouteBooking[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [r, b] = await Promise.all([
        api.getCarrierRoute(id),
        api.listRouteBookings(id),
      ]);
      setRoute(r);
      setBookings(b);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function confirmBooking(bookingId: string) {
    try {
      const res = await api.confirmRouteBooking(bookingId);
      if (res.barion?.gateway_url) {
        window.open(res.barion.gateway_url, '_blank');
      }
      await load();
    } catch (err: any) {
      alert('Hiba: ' + err.message);
    }
  }

  async function rejectBooking(bookingId: string) {
    if (!confirm('Biztosan elutasítod?')) return;
    try {
      await api.rejectRouteBooking(bookingId);
      await load();
    } catch (err: any) {
      alert('Hiba: ' + err.message);
    }
  }

  if (error) return <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>;
  if (!route) return <p>Betöltés…</p>;

  const pending = bookings.filter((b) => b.status === 'pending');
  const confirmed = bookings.filter((b) => b.status !== 'pending' && b.status !== 'rejected');
  const rejected = bookings.filter((b) => b.status === 'rejected');

  function BookingCard({ b }: { b: RouteBooking }) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <strong>{b.shipper_name || 'Feladó'}</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {b.package_size} méret · {b.length_cm}×{b.width_cm}×{b.height_cm} cm · {b.weight_kg} kg
            </div>
            <p style={{ margin: '6px 0' }}>📍 {b.pickup_address}</p>
            <p style={{ margin: '6px 0' }}>🏁 {b.dropoff_address}</p>
            {b.notes && (
              <p className="muted" style={{ fontStyle: 'italic', marginTop: 6 }}>„{b.notes}"</p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="price" style={{ fontSize: 18 }}>
              {b.price_huf.toLocaleString('hu-HU')} Ft
            </div>
            <span className="pill pill-bidding" style={{ marginTop: 6 }}>
              {STATUS_LABEL[b.status]}
            </span>
            {b.status === 'pending' && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn" style={{ fontSize: 13, padding: '6px 14px' }} onClick={() => confirmBooking(b.id)}>
                  Elfogadom
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  onClick={() => rejectBooking(b.id)}
                >
                  Elutasítom
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => router.back()}
        style={{ marginBottom: 16 }}
      >
        ← Vissza
      </button>

      <h1>{route.title}</h1>
      <p className="muted">
        🗓 {new Date(route.departure_at).toLocaleString('hu-HU')}
      </p>

      {/* Útvonal megállói */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Útvonal</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {route.waypoints.map((w, i) => (
            <div
              key={i}
              style={{
                background: i === 0 ? '#dcfce7' : i === route.waypoints.length - 1 ? '#fee2e2' : '#dbeafe',
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 14,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {i === 0 ? 'INDULÁS · ' : i === route.waypoints.length - 1 ? 'CÉL · ' : `${i}. · `}
              </span>
              <strong>{w.name}</strong>
            </div>
          ))}
        </div>
        {route.vehicle_description && (
          <p className="muted" style={{ marginTop: 12 }}>
            🚛 {route.vehicle_description}
          </p>
        )}
        {route.description && (
          <p style={{ marginTop: 8, color: 'var(--text)', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {route.description}
          </p>
        )}
      </div>

      {/* Árak */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Árak méret szerint</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {route.prices.map((p) => (
            <div key={p.size} className="card" style={{ margin: 0, padding: 12, minWidth: 120 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{p.size}</div>
              <div className="price" style={{ marginTop: 4 }}>
                {p.price_huf.toLocaleString('hu-HU')} Ft
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Foglalások */}
      <h2 style={{ marginTop: 24 }}>Foglalások ({bookings.length})</h2>

      {pending.length > 0 && (
        <>
          <h3 style={{ color: 'var(--primary)' }}>⏳ Válaszra vár ({pending.length})</h3>
          {pending.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>✅ Elfogadva / folyamatban ({confirmed.length})</h3>
          {confirmed.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {rejected.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>✗ Elutasítva ({rejected.length})</h3>
          {rejected.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {bookings.length === 0 && (
        <div className="card">
          <p className="muted">Még nincs foglalás erre az útvonalra.</p>
        </div>
      )}
    </div>
  );
}
