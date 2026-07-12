'use client';

// Sofőr: saját útvonalak listája.
// - Nyitott (publikált), piszkozat, befejezett, törölt kategóriákra bontva
// - Minden kártya mellett státusz-akciók: publikálás, lezárás, törlés
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CarrierRoute } from '@/api';
import { useToast } from '@/components/ToastProvider';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { Route as RouteIcon } from 'lucide-react';

const STATUS_LABEL: Record<CarrierRoute['status'], string> = {
  draft: 'Piszkozat',
  open: 'Publikálva',
  full: 'Betelt',
  in_progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
};

const STATUS_PILL: Record<CarrierRoute['status'], string> = {
  draft: 'pill-bidding',
  open: 'pill-delivered',
  full: 'pill-accepted',
  in_progress: 'pill-progress',
  completed: 'pill-delivered',
  cancelled: 'pill-cancelled',
};

export default function UtvonalaimOldal() {
  const toast = useToast();
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CarrierRoute | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.myCarrierRoutes();
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

  async function changeStatus(r: CarrierRoute, status: 'open' | 'full' | 'cancelled') {
    try {
      await api.setCarrierRouteStatus(r.id, status);
      await load();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  const byStatus = {
    open: routes.filter((r) => r.status === 'open'),
    draft: routes.filter((r) => r.status === 'draft'),
    inProgress: routes.filter((r) => r.status === 'in_progress' || r.status === 'full'),
    past: routes.filter((r) => r.status === 'completed' || r.status === 'cancelled'),
  };

  function RouteCard({ r }: { r: CarrierRoute }) {
    const first = r.waypoints[0]?.name || '?';
    const last = r.waypoints[r.waypoints.length - 1]?.name || '?';
    const stops = r.waypoints.length > 2 ? ` · ${r.waypoints.length - 2} megálló` : '';
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0 }}>
              <Link href={`/sofor/utvonal/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {r.title}
              </Link>
            </h3>
            <p className="muted" style={{ margin: '4px 0' }}>
              📍 {first} → {last}{stops}
            </p>
            <p className="muted" style={{ margin: '4px 0' }}>
              🗓 {new Date(r.departure_at).toLocaleString('hu-HU')}
            </p>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              {r.prices.map((p) => (
                <span
                  key={p.size}
                  style={{
                    background: 'var(--surface)',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <strong>{p.size}</strong> {p.price_huf.toLocaleString('hu-HU')} Ft
                </span>
              ))}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(r.status === 'draft' || r.status === 'open') && (
                <Link
                  href={`/sofor/uj-utvonal?edit=${r.id}`}
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
                >
                  ✏️ Szerkesztés
                </Link>
              )}
              {r.status === 'draft' && (
                <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => changeStatus(r, 'open')}>
                  Publikálás
                </button>
              )}
              {r.status === 'open' && (
                <>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => changeStatus(r, 'full')}
                  >
                    Lezárás (nincs több hely)
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '4px 10px', borderColor: 'var(--danger)', color: 'var(--danger-text)' }}
                    onClick={() => setCancelTarget(r)}
                  >
                    Törlés
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Útvonalaim</h1>
        <Link className="btn" href="/sofor/uj-utvonal">
          + Új útvonal hirdetése
        </Link>
      </div>
      <p className="muted">
        Itt láthatod a hirdetett útvonalaidat, a beérkezett foglalásokat, és be
        tudod állítani az állapotukat.
      </p>

      {loading && <ListSkeleton rows={3} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
        </div>
      )}

      {!loading && !error && routes.length === 0 && (
        <EmptyState
          icon={<RouteIcon size={28} aria-hidden />}
          title="Hirdesd meg az első útvonalad"
          description="Ha úgyis mész valahová, hirdesd meg az utad fix áron — a feladók helyet foglalnak a csomagjuknak, te pedig megkeresed az üzemanyagod árát."
          cta={<Link className="btn" href="/sofor/uj-utvonal">Új útvonal hirdetése</Link>}
        />
      )}

      {byStatus.open.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>🟢 Publikálva ({byStatus.open.length})</h2>
          {byStatus.open.map((r) => <RouteCard key={r.id} r={r} />)}
        </>
      )}

      {byStatus.draft.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>📝 Piszkozat ({byStatus.draft.length})</h2>
          {byStatus.draft.map((r) => <RouteCard key={r.id} r={r} />)}
        </>
      )}

      {byStatus.inProgress.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>🚛 Úton / betelt ({byStatus.inProgress.length})</h2>
          {byStatus.inProgress.map((r) => <RouteCard key={r.id} r={r} />)}
        </>
      )}

      {byStatus.past.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Korábbi ({byStatus.past.length})</h2>
          {byStatus.past.map((r) => <RouteCard key={r.id} r={r} />)}
        </>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Útvonal törlése"
        message="Biztosan törlöd ezt a meghirdetett útvonalat? A már elfogadott foglalások lemondásra kerülnek."
        confirmLabel="Törlöm"
        danger
        onConfirm={() => {
          if (cancelTarget) changeStatus(cancelTarget, 'cancelled');
          setCancelTarget(null);
        }}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
