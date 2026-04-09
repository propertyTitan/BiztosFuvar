'use client';

// Fuvaraim: minden olyan fuvar, amit a user SOFŐRKÉNT teljesít
// (licites fuvar, amire licitált és elfogadták, vagy fix áras foglalás,
// amit megerősített).
// A backend most már as=assigned paraméterrel szűr carrier_id-ra.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job } from '@/api';

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
  accepted: 'pill-accepted',
  in_progress: 'pill-progress',
  delivered: 'pill-delivered',
  completed: 'pill-delivered',
  cancelled: 'pill-cancelled',
};

export default function SoforSajatFuvarok() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myJobs('assigned')
      .then(setJobs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Csoportosítjuk állapot szerint, hogy könnyebb legyen átlátni
  const active = jobs.filter((j) => ['accepted', 'in_progress'].includes(j.status));
  const done = jobs.filter((j) => ['delivered', 'completed'].includes(j.status));
  const other = jobs.filter((j) => !['accepted', 'in_progress', 'delivered', 'completed'].includes(j.status));

  function JobCard({ j }: { j: Job }) {
    return (
      <Link
        href={`/sofor/fuvar/${j.id}`}
        className="card"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0 }}>{j.title}</h3>
            <p className="muted" style={{ margin: '2px 0' }}>📍 {j.pickup_address}</p>
            <p className="muted" style={{ margin: '2px 0' }}>🏁 {j.dropoff_address}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`pill ${STATUS_PILL[j.status] || 'pill-bidding'}`}>
              {STATUS_LABEL[j.status] || j.status}
            </span>
            <div className="price" style={{ marginTop: 6 }}>
              {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div>
      <h1>Saját fuvaraim</h1>

      {loading && <p>Betöltés…</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.</p>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="card">
          <p className="muted">
            Még nincs aktív fuvarod. Licitálj néhány fuvarra az{' '}
            <a href="/sofor/fuvarok">Elérhető fuvarok</a> oldalon!
          </p>
        </div>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>🚚 Aktív fuvarok ({active.length})</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            A felvételt és a lezárást a mobilalkalmazásban kell elvégezned (GPS + fotó).
          </p>
          {active.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✓ Teljesített fuvarok ({done.length})</h2>
          {done.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}

      {other.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Egyéb ({other.length})</h2>
          {other.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}
    </div>
  );
}
