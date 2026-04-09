'use client';

// Sofőr kezdőoldal: elérhető (licitálható) fuvarok listája.
// - Közelség szerint rendezve, ha a böngésző megadja a geolocation-t.
// - Új fuvar érkezéskor (Socket.IO `jobs:new`) automatikusan frissül a lista.
// - Minden kártya → a fuvar részletes oldalára visz, ahol licitálni lehet.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';

type ListedJob = Job & { distance_to_pickup_km?: number };

export default function SoforFuvarokLista() {
  const me = useCurrentUser();
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  async function load(lat?: number, lng?: number) {
    setLoading(true);
    try {
      const data = await api.listJobs({
        status: 'bidding',
        lat,
        lng,
        radius_km: lat != null ? 500 : undefined,
      });
      setJobs(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Indulás: próbáljuk meg megkérni a böngésző GPS-ét, ha nem megy / nem ad
  // engedélyt, egyszerűen az összes nyitott fuvart betöltjük.
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      load();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(coords);
        load(coords.lat, coords.lng);
      },
      () => load(),
      { timeout: 4000 },
    );
  }, []);

  // Real-time: amikor új fuvar érkezik, rátesszük a listára
  useEffect(() => {
    const socket = getSocket();
    const onNew = (job: Job) => {
      setJobs((prev) => [job as ListedJob, ...prev.filter((j) => j.id !== job.id)]);
    };
    socket.on('jobs:new', onNew);
    return () => {
      socket.off('jobs:new', onNew);
    };
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Elérhető fuvarok</h1>
          <p className="muted" style={{ margin: 0 }}>
            {here
              ? 'Közelség szerint rendezve a jelenlegi pozíciódhoz'
              : 'A helymeghatározás nem érhető el – a teljes nyitott lista látható'}
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => load(here?.lat, here?.lng)}>
          Frissítés
        </button>
      </div>

      {loading && <p style={{ marginTop: 24 }}>Betöltés…</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginTop: 16 }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Be vagy jelentkezve? <a href="/bejelentkezes">Belépés</a>.</p>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0 }}>Jelenleg nincs licitálható fuvar a közelben.</p>
        </div>
      )}

      {jobs.map((j) => {
        const isMine = !!me && j.shipper_id === me.id;
        // Saját poszton csak szerkesztés/megtekintés. A részletek oldal
        // ilyenkor a feladói nézetre visz (dashboard/fuvar/[id]), hogy
        // a licitek listáját és a szerkesztést lássa.
        const href = isMine ? `/dashboard/fuvar/${j.id}` : `/sofor/fuvar/${j.id}`;
        return (
          <Link
            key={j.id}
            href={href}
            className="card"
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              marginTop: 16,
              ...(isMine ? { background: '#fefce8', borderColor: '#facc15' } : {}),
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 0 }}>{j.title}</h3>
                  {isMine && (
                    <span
                      className="pill"
                      style={{
                        background: '#facc15',
                        color: '#713f12',
                        fontWeight: 800,
                        fontSize: 11,
                      }}
                      title="Ezt te adtad fel — nem licitálhatsz rá."
                    >
                      SAJÁT POSZT
                    </span>
                  )}
                </div>
                <p className="muted" style={{ margin: '2px 0' }}>📍 {j.pickup_address}</p>
                <p className="muted" style={{ margin: '2px 0' }}>🏁 {j.dropoff_address}</p>
                <div className="row" style={{ marginTop: 6, gap: 16, fontSize: 13 }}>
                  {j.distance_km != null && <span className="muted">{j.distance_km} km össztáv</span>}
                  {j.distance_to_pickup_km != null && (
                    <span className="muted">📍 {j.distance_to_pickup_km} km tőled</span>
                  )}
                  {j.weight_kg != null && <span className="muted">{j.weight_kg} kg</span>}
                  {j.length_cm && j.width_cm && j.height_cm && (
                    <span className="muted">
                      {j.length_cm}×{j.width_cm}×{j.height_cm} cm
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="price" style={{ fontSize: 18 }}>
                  {j.suggested_price_huf?.toLocaleString('hu-HU')} Ft
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {isMine ? 'saját hirdetés' : 'javasolt ár'}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
