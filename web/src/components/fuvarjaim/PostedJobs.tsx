'use client';

// Saját feladott hirdetéseim — EGYESÍTETT oldal:
//   - Licites fuvarok, amiket én adtam fel (api.myJobs('posted'))
//   - Fix áras útvonal-hirdetéseim (api.myCarrierRoutes())
// Mindkettő egy oldalon, külön szekciókban, státuszok szerint.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job, CarrierRoute } from '@/api';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { FileText, Route as RouteIcon, MapPin, Flag, Calendar } from 'lucide-react';

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Ajánlatokat vár',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const ROUTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Piszkozat',
  open: 'Publikálva',
  full: 'Betelt',
  in_progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
};

export default function SajatHirdeteseim() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.myJobs('posted'), api.myCarrierRoutes()])
      .then(([j, r]) => {
        setJobs(j);
        setRoutes(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Saját hirdetéseim</h2>
          <p className="muted" style={{ margin: 0 }}>
            Minden, amit TE adtál fel — feladott fuvarok és fix áras útvonalak egy helyen.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" href="/dashboard/uj-fuvar">+ Új fuvar</Link>
          <Link className="btn btn-secondary" href="/sofor/uj-utvonal">+ Új fix áras</Link>
        </div>
      </div>

      {loading && <ListSkeleton rows={3} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
        </div>
      )}

      {/* Feladott fuvarok */}
      <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={20} /> Feladott fuvarjaim ({jobs.length})
      </h2>
      {!loading && jobs.length === 0 && (
        <EmptyState
          compact
          icon={<FileText size={22} aria-hidden />}
          title="Még nincs feladott fuvarod"
          description="Add fel az elsőt — a sofőrök ajánlatot tesznek rá, és te választasz közülük."
          cta={<Link className="btn" href="/dashboard/uj-fuvar">Fuvar feladása</Link>}
        />
      )}
      {jobs.map((j) => (
        <Link
          key={j.id}
          href={`/dashboard/fuvar/${j.id}`}
          className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
        >
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginTop: 0 }}>{j.title}</h3>
              <p className="muted" style={{ margin: '2px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {j.pickup_address}</p>
              <p className="muted" style={{ margin: '2px 0' }}><Flag size={13} style={{ verticalAlign: -2 }} /> {j.dropoff_address}</p>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {j.distance_km != null && `${j.distance_km} km`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="pill pill-bidding">{JOB_STATUS_LABEL[j.status] || j.status}</span>
              <div className="price" style={{ marginTop: 6 }}>
                {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
              </div>
            </div>
          </div>
        </Link>
      ))}

      {/* Fix áras útvonalak */}
      <h2 style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RouteIcon size={20} /> Fix áras útvonalaim ({routes.length})
      </h2>
      {!loading && routes.length === 0 && (
        <EmptyState
          compact
          icon={<RouteIcon size={22} aria-hidden />}
          title="Még nincs hirdetett útvonalad"
          description="Ha úgyis mész valahová, hirdesd meg fix áron — a feladók helyet foglalnak a csomagjuknak."
          cta={<Link className="btn btn-secondary" href="/sofor/uj-utvonal">Útvonal hirdetése</Link>}
        />
      )}
      {routes.map((r) => {
        const first = r.waypoints[0]?.name || '?';
        const last = r.waypoints[r.waypoints.length - 1]?.name || '?';
        return (
          <Link
            key={r.id}
            href={`/sofor/utvonal/${r.id}`}
            className="card"
            style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 0 }}>{r.title}</h3>
                <p className="muted" style={{ margin: '2px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {first} → {last}</p>
                <p className="muted" style={{ margin: '2px 0' }}>
                  <Calendar size={13} style={{ verticalAlign: -2 }} /> {new Date(r.departure_at).toLocaleString('hu-HU')}
                </p>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {r.prices.map((p) => (
                    <span
                      key={p.size}
                      style={{ background: 'var(--surface)', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}
                    >
                      <strong>{p.size}</strong> {p.price_huf.toLocaleString('hu-HU')} Ft
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="pill pill-delivered">{ROUTE_STATUS_LABEL[r.status] || r.status}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
