'use client';

// Shipper Dashboard – Apukám kérése.
// - Saját aktív fuvarok listája státusszal és árakkal.
// - Térkép placeholder (Google Maps kulcs hiányában grid).
// - Új fuvar gomb.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job } from '@/api';
import DashboardOverviewMap from '@/components/DashboardOverviewMap';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Licitálható',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const STATUS_PILL: Record<string, string> = {
  bidding: 'pill-bidding',
  accepted: 'pill-accepted',
  in_progress: 'pill-progress',
  delivered: 'pill-delivered',
  completed: 'pill-delivered',
  cancelled: 'pill-cancelled',
};

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.myJobs()
      .then(setJobs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Irányítópult</h1>
        <a className="btn" href="/dashboard/uj-fuvar">+ Új fuvar feladása</a>
      </div>

      {/* Aktív fuvarok élő térképe (Google Maps + Socket.IO élő követés) */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <DashboardOverviewMap jobs={jobs} />
      </div>

      <h2>Fuvaraim ({jobs.length})</h2>
      {loading && <p>Betöltés...</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.</p>
        </div>
      )}
      {!loading && !error && jobs.length === 0 && (
        <div className="card">
          <p className="muted">Még nincs feladott fuvarod. <a href="/dashboard/uj-fuvar">Adj fel egyet most!</a></p>
        </div>
      )}

      {jobs.map((j) => (
        <Link key={j.id} href={`/dashboard/fuvar/${j.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginTop: 0 }}>{j.title}</h3>
              <p className="muted">📍 {j.pickup_address}</p>
              <p className="muted">🏁 {j.dropoff_address}</p>
              <div className="row">
                <span className="muted">{j.distance_km} km</span>
                <span className="price">
                  {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
                </span>
              </div>
            </div>
            <div>
              <span className={`pill ${STATUS_PILL[j.status] || 'pill-bidding'}`}>
                {STATUS_LABEL[j.status] || j.status}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
