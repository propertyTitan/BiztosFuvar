'use client';

// Feladói foglalásaim – a route_bookings lista.
// Ez a "Péter lássa, hogy János elfogadta" képernyő: itt jelenik meg minden,
// amit a feladó egy sofőri útvonalon foglalt, és a státusz frissül, ahogy
// a sofőr megerősíti, elutasítja, vagy éppen elindul.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, RouteBooking } from '@/api';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ConfirmDialog from '@/components/ConfirmDialog';
import ReviewBox from '@/components/ReviewBox';
import { ListSkeleton, EmptyState, ErrorState } from '@/components/StateView';
import { CalendarCheck, Calendar, MapPin, Flag, Truck, BadgeCheck, CheckCircle2, Hourglass, KeyRound } from 'lucide-react';

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
  disputed: 'pill-accepted',
};

export default function FoglalasaimOldal() {
  const user = useCurrentUser();
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<RouteBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Melyik foglalás fizetésgombja tölt éppen (egyszerre csak egy lehet).
  const [payingId, setPayingId] = useState<string | null>(null);
  // 45/2014. 29.§ (1) a) nyilatkozat foglalásonként — a fizetés indításának
  // feltétele, a backend a redirect ELŐTT rögzíti (fee_consent_at).
  const [consented, setConsented] = useState<Record<string, boolean>>({});

  async function startPayment(bookingId: string) {
    if (!consented[bookingId]) {
      toast.error('Beleegyezés szükséges', 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.');
      return;
    }
    setPayingId(bookingId);
    try {
      const r = await api.payRouteBooking(bookingId, true);
      if (r.is_stub) {
        router.push(`/fizetes-stub?booking=${bookingId}`);
      } else {
        window.location.href = r.gateway_url;
      }
    } catch (e: any) {
      toast.error('Fizetés indítása sikertelen', e.message);
    } finally {
      setPayingId(null);
    }
  }

  // Lemondás-megerősítő dialógus célpontja (window.confirm/prompt kiváltva)
  const [cancelTarget, setCancelTarget] = useState<RouteBooking | null>(null);

  async function cancelBooking(b: RouteBooking, reason: string) {
    try {
      const res = await api.cancelRouteBooking(b.id, reason);
      const msg =
        res.refund_huf > 0
          ? `Foglalás lemondva. Visszatérítés: ${res.refund_huf.toLocaleString('hu-HU')} Ft${res.cancellation_fee_huf > 0 ? ` (díj: ${res.cancellation_fee_huf.toLocaleString('hu-HU')} Ft)` : ''}.`
          : 'Foglalás lemondva.';
      toast.success('Lemondás kész', msg);
      await load();
    } catch (e: any) {
      toast.error('Lemondás sikertelen', e.message);
    }
  }

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

  // Real-time: amikor egy értesítés érkezik a foglalásokra, újratöltünk.
  // És külön figyelünk a `route-booking:paid` event-re, hogy a sikeres
  // fizetés után azonnal lecserélődjön a gomb a FIZETVE címkére (ne
  // kelljen a felhasználónak manuálisan refresh-elnie).
  useEffect(() => {
    if (!user) return;
    joinUserRoom(user.id);
    const socket = getSocket();
    const onNotif = (n: any) => {
      if (
        n.type === 'booking_confirmed' ||
        n.type === 'booking_rejected' ||
        n.type === 'booking_received' ||
        n.type === 'booking_paid'
      ) {
        load();
      }
    };
    const onPaid = () => load();
    socket.on('notification:new', onNotif);
    socket.on('route-booking:paid', onPaid);
    return () => {
      socket.off('notification:new', onNotif);
      socket.off('route-booking:paid', onPaid);
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
              <p className="muted" style={{ margin: '2px 0' }}><Truck size={13} style={{ verticalAlign: -2 }} /> Sofőr: {b.carrier_name}</p>
            )}
            {b.departure_at && (
              <p className="muted" style={{ margin: '2px 0' }}>
                <Calendar size={13} style={{ verticalAlign: -2 }} /> {new Date(b.departure_at).toLocaleString('hu-HU')}
              </p>
            )}
            <p style={{ margin: '8px 0 2px', fontSize: 14 }}>
              <MapPin size={13} style={{ verticalAlign: -2 }} /> {b.pickup_address}
            </p>
            <p style={{ margin: '2px 0', fontSize: 14 }}>
              <Flag size={13} style={{ verticalAlign: -2 }} /> {b.dropoff_address}
            </p>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Csomag: <strong>{b.package_size}</strong> ({b.length_cm}×{b.width_cm}×{b.height_cm} cm, {b.weight_kg} kg)
            </div>
            {b.notes && (
              <p className="muted" style={{ fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>
                „{b.notes}”
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
                  background: 'var(--primary)',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  letterSpacing: 3,
                  fontWeight: 700,
                }}
                title="Átvételi kód – add át a sofőrnek"
              >
                <KeyRound size={13} style={{ verticalAlign: -2 }} /> {b.delivery_code}
              </div>
            )}

            {/* Ha már FIZETVE: csak egy címke. Különben: Fizetés gomb,
                ami a backend lusta `/pay` végpontját hívja. */}
            {b.status === 'confirmed' && b.paid_at && (
              <div
                style={{
                  marginTop: 10,
                  display: 'inline-block',
                  background: 'var(--success-light)',
                  color: '#166534',
                  padding: '10px 18px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 14,
                  border: '1px solid #86efac',
                }}
                title={`Fizetve: ${new Date(b.paid_at).toLocaleString('hu-HU')}`}
              >
                <BadgeCheck size={14} style={{ verticalAlign: -2 }} /> DÍJ FIZETVE
              </div>
            )}
            {b.status === 'confirmed' && !b.paid_at && (
              <div style={{ marginTop: 10 }}>
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    fontSize: 12,
                    lineHeight: 1.5,
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!consented[b.id]}
                    onChange={(e) => setConsented((c) => ({ ...c, [b.id]: e.target.checked }))}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span>
                    Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása){' '}
                    <strong>azonnali teljesítését</strong>, és tudomásul veszem, hogy a
                    teljesítés után <strong>elállási jogomat elvesztem</strong>{' '}
                    (45/2014. Korm. r. 29. § (1) a)). A díj nem visszatérítendő.
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => startPayment(b.id)}
                  disabled={payingId === b.id || !consented[b.id]}
                  className="btn"
                  style={{
                    marginTop: 8,
                    display: 'inline-block',
                    background: consented[b.id] ? 'var(--success-strong)' : 'var(--muted)',
                    fontSize: 14,
                    border: 'none',
                    cursor: payingId === b.id ? 'wait' : consented[b.id] ? 'pointer' : 'not-allowed',
                    opacity: payingId === b.id || !consented[b.id] ? 0.7 : 1,
                  }}
                >
                  {payingId === b.id ? 'Fizetés indítása…' : 'Kapcsolatfelvételi díj fizetése'}
                </button>
              </div>
            )}

            {/* Lemondás gomb — csak még lemondható állapotban */}
            {['pending', 'confirmed'].includes(b.status) && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCancelTarget(b)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger-text)',
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

        {/* Kézbesítés után: kápé-emlékeztető + a sofőr értékelése */}
        {b.status === 'delivered' && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div
              style={{
                padding: 10,
                background: 'var(--success-light)',
                borderRadius: 8,
                border: '1px solid #86efac',
                fontSize: 13,
                color: '#166534',
                marginBottom: 10,
              }}
            >
              <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> <strong>Kézbesítve</strong>
              {b.delivered_at && ` — ${new Date(b.delivered_at).toLocaleString('hu-HU')}`}.
              Ne feledd: a fuvardíj ({b.price_huf.toLocaleString('hu-HU')} Ft) készpénzben jár a sofőrnek.
            </div>
            <ReviewBox entityKey="booking_id" entityId={b.id} onDone={load} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Foglalásaim</h2>
          <p className="muted" style={{ margin: 0 }}>
            Fix áras foglalások sofőri útvonalakon. Itt látod a sofőr megerősítését,
            az átvételi kódot, és a fuvar állapotát.
          </p>
        </div>
        <Link href="/dashboard/utvonalak" className="btn">
          + Új foglalás útvonalra
        </Link>
      </div>

      {loading && <ListSkeleton rows={3} />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={<CalendarCheck size={28} aria-hidden />}
          title="Még nincs foglalásod"
          description="Nézd meg az útba eső sofőrök fix áras útvonalait, és foglalj helyet a csomagodnak egy kattintással."
          cta={<Link className="btn" href="/dashboard/utvonalak">Fix áras útvonalak</Link>}
        />
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hourglass size={20} /> Sofőri megerősítésre vár ({pending.length})
          </h2>
          {pending.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BadgeCheck size={20} /> Aktív foglalások ({active.length})
          </h2>
          {active.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {rejected.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✗ Elutasítva / törölt ({rejected.length})</h2>
          {rejected.map((b) => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Foglalás lemondása"
        message={cancelTarget?.paid_at
          ? 'Biztosan lemondod a foglalást? A lemondás díjmentes, de a már befizetett kapcsolatfelvételi díj nem visszatérítendő.'
          : 'Biztosan lemondod a foglalást? Még nem történt fizetés, így semmilyen díj nincs.'}
        confirmLabel="Lemondom"
        danger
        fields={[{ key: 'reason', label: 'Indok (opcionális)', type: 'textarea', placeholder: 'pl. Másik megoldást találtam' }]}
        onConfirm={(v) => {
          if (cancelTarget) cancelBooking(cancelTarget, (v.reason || '').trim());
          setCancelTarget(null);
        }}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
