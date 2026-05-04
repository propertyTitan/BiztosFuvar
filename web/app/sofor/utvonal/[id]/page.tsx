'use client';

// Sofőr: egy konkrét útvonal részletei + beérkezett foglalások.
// - Az útvonal adatai (waypoints, árak, státusz)
// - Szerkesztés + publikálás gombok a tulajdonosnak (draft/open)
// - Foglalások listája: feladó, csomag méret + pontos méretek, ár, gombok
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, CarrierRoute, RouteBooking } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { useCurrentUser } from '@/lib/auth';
import { getSocket, joinUserRoom } from '@/lib/socket';

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
  const toast = useToast();
  const user = useCurrentUser();
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

  // Real-time: ha a feladó kifizet egy foglalást, a sofőr ezen az
  // oldalon AZONNAL lássa a "FIZETVE" címkét.
  useEffect(() => {
    if (!user) return;
    joinUserRoom(user.id);
    const socket = getSocket();
    const onPaid = () => load();
    socket.on('route-booking:paid', onPaid);
    return () => {
      socket.off('route-booking:paid', onPaid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  async function confirmBooking(bookingId: string) {
    try {
      await api.confirmRouteBooking(bookingId);
      toast.success('Foglalás elfogadva', 'A feladó most tudja kifizetni');
      await load();
    } catch (err: any) {
      toast.error('Hiba a foglalás elfogadásakor', err.message);
    }
  }

  async function rejectBooking(bookingId: string) {
    if (!confirm('Biztosan elutasítod?')) return;
    try {
      await api.rejectRouteBooking(bookingId);
      toast.info('Foglalás elutasítva');
      await load();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  async function cancelBooking(b: RouteBooking) {
    const wasPaid = !!b.paid_at;
    const warning = wasPaid
      ? 'Biztosan lemondod ezt a már elfogadott foglalást? A teljes fuvardíj visszajár a feladónak (sofőr lemondás → 100% refund).'
      : 'Biztosan lemondod ezt a foglalást?';
    if (!window.confirm(warning)) return;
    const reason = window.prompt('Indok (opcionális):') || '';
    try {
      await api.cancelRouteBooking(b.id, reason);
      toast.info('Foglalás lemondva', 'A feladó visszakapja a teljes fuvardíjat.');
      await load();
    } catch (e: any) {
      toast.error('Lemondás sikertelen', e.message);
    }
  }

  async function publishRoute() {
    try {
      await api.setCarrierRouteStatus(id, 'open');
      await load();
    } catch (err: any) {
      alert('Hiba: ' + err.message);
    }
  }

  async function closeRoute() {
    if (!confirm('Lezárod az útvonalat (nem fogad további foglalást)?')) return;
    try {
      await api.setCarrierRouteStatus(id, 'full');
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
            {/* Fizetés állapot – csak confirmed+ státuszoknál érdekes. */}
            {['confirmed', 'in_progress', 'delivered'].includes(b.status) && (
              <div style={{ marginTop: 6 }}>
                {b.paid_at ? (
                  <span
                    className="pill"
                    style={{
                      background: '#dcfce7',
                      color: '#166534',
                      border: '1px solid #86efac',
                      fontWeight: 700,
                    }}
                    title={`Fizetve: ${new Date(b.paid_at).toLocaleString('hu-HU')}`}
                  >
                    ✅ FIZETVE
                  </span>
                ) : (
                  <span
                    className="pill"
                    style={{
                      background: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #fde68a',
                    }}
                  >
                    ⏳ Fizetésre vár
                  </span>
                )}
              </div>
            )}
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
            {/* Lemondás — már elfogadott foglalásra is, sofőri 100% refund */}
            {b.status === 'confirmed' && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => cancelBooking(b)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    padding: '4px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  ❌ Lemondás
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

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{route.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            🗓 {new Date(route.departure_at).toLocaleString('hu-HU')}
          </p>
          <span
            className={`pill ${route.status === 'open' ? 'pill-delivered' : route.status === 'draft' ? 'pill-bidding' : 'pill-accepted'}`}
            style={{ marginTop: 8, display: 'inline-block' }}
          >
            {route.status === 'draft'
              ? 'Piszkozat'
              : route.status === 'open'
              ? 'Publikálva'
              : route.status === 'full'
              ? 'Betelt'
              : route.status}
          </span>
        </div>

        {/* Szerkesztés + publikálás / lezárás gombok — csak a tulajdonos látja
            draft / open státuszban. A backend tulajdonos-ellenőrzés elbírál. */}
        {(route.status === 'draft' || route.status === 'open') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <Link
              href={`/sofor/uj-utvonal?edit=${route.id}`}
              className="btn btn-secondary"
              style={{ textDecoration: 'none', textAlign: 'center' }}
            >
              ✏️ Szerkesztés
            </Link>
            {route.status === 'draft' && (
              <button
                type="button"
                className="btn"
                onClick={publishRoute}
                style={{ background: '#16a34a' }}
              >
                🚀 Publikálás most
              </button>
            )}
            {route.status === 'open' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeRoute}
              >
                Lezárás (betelt)
              </button>
            )}
            <Link
              href={`/sofor/utvonal/${route.id}/utba-eso`}
              className="btn"
              style={{
                textDecoration: 'none',
                textAlign: 'center',
                background: '#2E7D32',
              }}
            >
              🚗 Útba eső fuvarok
            </Link>
          </div>
        )}
      </div>

      {/* Útvonal megállói */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Útvonal</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {route.waypoints.map((w, i) => (
            <div
              key={i}
              className="on-light"
              style={{
                background: i === 0 ? '#dcfce7' : i === route.waypoints.length - 1 ? '#fee2e2' : '#dbeafe',
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 14,
                border: `1px solid ${i === 0 ? '#86efac' : i === route.waypoints.length - 1 ? '#fca5a5' : '#93c5fd'}`,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7, color: '#475569' }}>
                {i === 0 ? 'INDULÁS · ' : i === route.waypoints.length - 1 ? 'CÉL · ' : `${i}. · `}
              </span>
              <strong style={{ color: '#0f172a' }}>{w.name}</strong>
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
