'use client';

// Feladói foglalásaim – a route_bookings lista.
// Ez a "Péter lássa, hogy János elfogadta" képernyő: itt jelenik meg minden,
// amit a feladó egy sofőri útvonalon foglalt, és a státusz frissül, ahogy
// a sofőr megerősíti, elutasítja, vagy éppen elindul.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, RouteBooking } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Sofőri megerősítésre vár',
  confirmed: 'Elfogadva – fizess Barionnal',
  rejected: 'Sofőr elutasította',
  in_progress: 'Úton',
  delivered: 'Átadva',
  cancelled: 'Törölve',
  disputed: 'Vitatott',
};

const STATUS_PILL: Record<string, string> = {
  pending: 'pill-bidding',
  confirmed: 'pill-delivered',
  rejected: 'pill-cancelled',
  in_progress: 'pill-progress',
  delivered: 'pill-delivered',
  cancelled: 'pill-cancelled',
};

export default function FoglalasaimOldal() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<RouteBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.myRouteBookings();
      setRows(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: amikor egy értesítés érkezik a foglalásokra, újratöltünk
  useEffect(() => {
    if (!user) return;
    joinUserRoom(user.id);
    const socket = getSocket();
    const onNotif = (n: any) => {
      if (
        n.type === 'booking_confirmed' ||
        n.type === 'booking_rejected' ||
        n.type === 'booking_received'
      ) {
        load();
      }
    };
    socket.on('notification:new', onNotif);
    return () => {
      socket.off('notification:new', onNotif);
    };
  }, [user, load]);

  const pending = rows.filter((r) => r.status === 'pending');
  const active = rows.filter((r) =>
    ['confirmed', 'in_progress', 'delivered'].includes(r.status),
  );
  const rejected = rows.filter((r) => ['rejected', 'cancelled'].includes(r.status));

  function BookingCard({ b }: { b: RouteBooking }) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>
              {b.route_title || 'Sofőri útvonal'}
            </h3>
            {b.carrier_name && (
              <p className="muted" style={{ margin: '2px 0' }}>🚛 Sofőr: {b.carrier_name}</p>
            )}
            {b.departure_at && (
              <p className="muted" style={{ margin: '2px 0' }}>
                🗓 {new Date(b.departure_at).toLocaleString('hu-HU')}
              </p>
            )}
            <p style={{ margin: '8px 0 2px', fontSize: 14 }}>
              📍 {b.pickup_address}
            </p>
            <p style={{ margin: '2px 0', fontSize: 14 }}>
              🏁 {b.dropoff_address}
            </p>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Csomag: <strong>{b.package_size}</strong> ({b.length_cm}×{b.width_cm}×{b.height_cm} cm, {b.weight_kg} kg)
            </div>
            {b.notes && (
              <p className="muted" style={{ fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>
                „{b.notes}"
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`pill ${STATUS_PILL[b.status]}`}>
              {STATUS_LABEL[b.status]}
            </span>
            <div className="price" style={{ marginTop: 8, fontSize: 18 }}>
              {b.price_huf.toLocaleString('hu-HU')} Ft
            </div>
            {b.delivery_code && ['confirmed', 'in_progress'].includes(b.status) && (
              <div
                style={{
                  marginTop: 8,
                  background: '#1e40af',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  letterSpacing: 3,
                  fontWeight: 700,
                }}
                title="Átvételi kód – add át a sofőrnek"
              >
                🔐 {b.delivery_code}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Foglalásaim</h1>
          <p className="muted" style={{ margin: 0 }}>
            Fix áras foglalások sofőri útvonalakon. Itt látod a sofőr megerősítését,
            az átvételi kódot, és a fuvar állapotát.
          </p>
        </div>
        <Link href="/dashboard/utvonalak" className="btn">
          + Új foglalás útvonalra
        </Link>
      </div>

      {loading && <p>Betöltés…</p>}
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="card">
          <p className="muted">
            Még nincs foglalásod. Nézd meg az{' '}
            <Link href="/dashboard/utvonalak">Útba eső sofőrök</Link> listát!
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>⏳ Sofőri megerősítésre vár ({pending.length})</h2>
          {pending.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✅ Aktív foglalások ({active.length})</h2>
          {active.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {rejected.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✗ Elutasítva / törölt ({rejected.length})</h2>
          {rejected.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}
    </div>
  );
}
