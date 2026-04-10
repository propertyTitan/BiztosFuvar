'use client';

// Sofőr kezdőoldal: elérhető (licitálható) fuvarok listája.
// - Közelség szerint rendezve, ha a böngésző megadja a geolocation-t.
// - Új fuvar érkezéskor (Socket.IO `jobs:new`) automatikusan frissül a lista.
// - Minden kártya → a fuvar részletes oldalára visz, ahol licitálni lehet.
// - Lista / térkép toggle: a user eldöntheti melyik nézetben böngészik.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import JobBrowseMap from '@/components/JobBrowseMap';
import { useTranslation, formatPrice } from '@/lib/i18n';

type ListedJob = Job & { distance_to_pickup_km?: number };
type ViewMode = 'list' | 'map';

export default function SoforFuvarokLista() {
  const me = useCurrentUser();
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  // Szűrők
  const [filterMinPrice, setFilterMinPrice] = useState('');
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  const [filterMaxWeight, setFilterMaxWeight] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  async function load(lat?: number, lng?: number) {
    setLoading(true);
    try {
      const data = await api.listJobs({
        status: 'bidding',
        lat,
        lng,
        radius_km: lat != null ? 500 : undefined,
        min_price: filterMinPrice ? Number(filterMinPrice) : undefined,
        max_price: filterMaxPrice ? Number(filterMaxPrice) : undefined,
        max_weight_kg: filterMaxWeight ? Number(filterMaxWeight) : undefined,
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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('jobs.title')}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {here
              ? 'Közelség szerint rendezve a jelenlegi pozíciódhoz'
              : 'A helymeghatározás nem érhető el – a teljes nyitott lista látható'}
          </p>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Link
            href="/feladas/uj"
            className="btn"
            style={{
              background: 'var(--success)',
              fontSize: 13,
              padding: '8px 16px',
              textDecoration: 'none',
            }}
          >
            ➕ Új hirdetés feladása
          </Link>
          {/* Nézet váltó: lista ↔ térkép */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--bg)',
              borderRadius: 999,
              padding: 3,
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => setView('list')}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: 'none',
                background: view === 'list' ? '#fff' : 'transparent',
                fontWeight: view === 'list' ? 700 : 500,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--text)',
                boxShadow: view === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              📋 Lista
            </button>
            <button
              type="button"
              onClick={() => setView('map')}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                border: 'none',
                background: view === 'map' ? '#fff' : 'transparent',
                fontWeight: view === 'map' ? 700 : 500,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--text)',
                boxShadow: view === 'map' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              🗺️ Térkép
            </button>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => load(here?.lat, here?.lng)}>
            Frissítés
          </button>
        </div>
      </div>

      {/* Szűrő sáv */}
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            padding: 0,
          }}
        >
          🔍 {showFilters ? 'Szűrők elrejtése' : 'Szűrők mutatása'}
        </button>
        {showFilters && (
          <div className="card" style={{ marginTop: 8, padding: 16 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 12 }}>Min ár (Ft)</label>
                <input
                  className="input"
                  type="number"
                  value={filterMinPrice}
                  onChange={(e) => setFilterMinPrice(e.target.value)}
                  placeholder="pl. 10000"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Max ár (Ft)</label>
                <input
                  className="input"
                  type="number"
                  value={filterMaxPrice}
                  onChange={(e) => setFilterMaxPrice(e.target.value)}
                  placeholder="pl. 100000"
                  style={{ width: 120 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Max súly (kg)</label>
                <input
                  className="input"
                  type="number"
                  value={filterMaxWeight}
                  onChange={(e) => setFilterMaxWeight(e.target.value)}
                  placeholder="pl. 50"
                  style={{ width: 100 }}
                />
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => load(here?.lat, here?.lng)}
                style={{ fontSize: 13, padding: '8px 16px' }}
              >
                Szűrés
              </button>
              {(filterMinPrice || filterMaxPrice || filterMaxWeight) && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setFilterMinPrice('');
                    setFilterMaxPrice('');
                    setFilterMaxWeight('');
                    setTimeout(() => load(here?.lat, here?.lng), 50);
                  }}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  Szűrők törlése
                </button>
              )}
            </div>
          </div>
        )}
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

      {/* Térképes nézet: minden fuvar felvételi + lerakodási markerrel
          és egy halvány szaggatott vonallal. A saját posztok sárga
          markerrel jelennek meg. */}
      {!loading && !error && jobs.length > 0 && view === 'map' && (
        <div style={{ marginTop: 16 }}>
          <JobBrowseMap jobs={jobs} currentUserId={me?.id || null} />
          <p className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            🟢 Felvétel · 🔴 Lerakodás · 🟡 Saját poszt · Kattints bármelyik markerre a részletekhez.
          </p>
        </div>
      )}

      {view === 'list' && jobs.map((j) => {
        const isMine = !!me && j.shipper_id === me.id;
        // Saját poszton csak szerkesztés/megtekintés. A részletek oldal
        // ilyenkor a feladói nézetre visz (dashboard/fuvar/[id]), hogy
        // a licitek listáját és a szerkesztést lássa.
        const href = isMine ? `/dashboard/fuvar/${j.id}` : `/sofor/fuvar/${j.id}`;
        return (
          <Link
            key={j.id}
            href={href}
            className={`card${isMine ? ' own-post-card' : ''}`}
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
