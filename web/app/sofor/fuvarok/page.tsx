'use client';

// Sofőr kezdőoldal: elérhető (licitálható) fuvarok listája.
// - Közelség szerint rendezve, ha a böngésző megadja a geolocation-t.
// - Új fuvar érkezéskor (Socket.IO `jobs:new`) automatikusan frissül a lista.
// - Minden kártya → a fuvar részletes oldalára visz, ahol licitálni lehet.
// - Lista / térkép toggle: a user eldöntheti melyik nézetben böngészik.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Job } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { Loading } from '@/components/StateView';
import { getSocket } from '@/lib/socket';
import JobBrowseMap from '@/components/JobBrowseMap';
import { useTranslation, formatPrice } from '@/lib/i18n';

type ListedJob = Job & { distance_to_pickup_km?: number };
type ViewMode = 'list' | 'map';

export default function SoforFuvarokLista() {
  const me = useCurrentUser();
  const router = useRouter();
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
  // Éppen melyik instant fuvart próbáljuk elvállalni (race-prevent UI)
  const [acceptingInstantId, setAcceptingInstantId] = useState<string | null>(null);

  async function acceptInstant(jobId: string) {
    if (acceptingInstantId) return;
    setAcceptingInstantId(jobId);
    try {
      const res = await api.acceptInstantJob(jobId);
      // Siker → vigyük a fuvar részletek oldalra, ahol a feladó fizethet
      // (a sofőr szempontjából: várakozás kifizetésre).
      router.push(`/sofor/fuvar/${res.job_id}`);
    } catch (err: any) {
      setError(err.message);
      // Frissítsük a listát: nagy eséllyel valaki megelőzött, így az
      // instant fuvar eltűnik a listáról a következő load-kor.
      load(here?.lat, here?.lng);
    } finally {
      setAcceptingInstantId(null);
    }
  }

  // A `filters` felülbírálással a "Szűrők törlése" azonnal üres szűrőkkel
  // tud lekérdezni — a state-ből olvasás ott stale closure-t adna (a régi
  // értékekkel kérdezne le, hiába nullázzuk előtte a state-et).
  async function load(lat?: number, lng?: number, filters?: { min: string; max: string; weight: string }) {
    setLoading(true);
    try {
      const min = filters ? filters.min : filterMinPrice;
      const max = filters ? filters.max : filterMaxPrice;
      const weight = filters ? filters.weight : filterMaxWeight;
      const data = await api.listJobs({
        status: 'bidding',
        lat,
        lng,
        radius_km: lat != null ? 500 : undefined,
        min_price: min ? Number(min) : undefined,
        max_price: max ? Number(max) : undefined,
        max_weight_kg: weight ? Number(weight) : undefined,
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

  // Real-time: amikor új fuvar érkezik, rátesszük a listára.
  // Azonnali fuvar esetén is külön event jön (`jobs:new-instant`), amit a
  // globális `jobs:new` mellett a szerver is kiad — így figyeljük is.
  // Ha egy instant fuvart valaki elkapott (`jobs:instant-taken`), azonnal
  // eltüntetjük a listából, hogy a UI ne maradjon "kínálati" állapotban.
  useEffect(() => {
    const socket = getSocket();
    const onNew = (job: Job) => {
      setJobs((prev) => [job as ListedJob, ...prev.filter((j) => j.id !== job.id)]);
    };
    const onInstantTaken = (payload: { job_id: string }) => {
      setJobs((prev) => prev.filter((j) => j.id !== payload.job_id));
    };
    socket.on('jobs:new', onNew);
    socket.on('jobs:instant-taken', onInstantTaken);
    return () => {
      socket.off('jobs:new', onNew);
      socket.off('jobs:instant-taken', onInstantTaken);
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
            href="/sofor/ertesitok"
            className="btn btn-ghost"
            style={{ fontSize: 13, padding: '8px 16px', textDecoration: 'none' }}
            title="Értesítést kérek az ilyen fuvarokról"
          >
            🔔 Értesíts, ha van ilyen fuvar
          </Link>
          <Link
            href="/dashboard/uj-fuvar"
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
                background: view === 'list' ? 'var(--surface)' : 'transparent',
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
                background: view === 'map' ? 'var(--surface)' : 'transparent',
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
                    load(here?.lat, here?.lng, { min: '', max: '', weight: '' });
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

      {loading && <Loading />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginTop: 16 }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Be vagy jelentkezve? <a href="/bejelentkezes">Belépés</a>.</p>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40 }}>🚛</div>
          <p style={{ margin: '8px 0 4px', fontWeight: 700 }}>Jelenleg nincs licitálható fuvar a közelben.</p>
          <p className="muted" style={{ margin: '0 0 16px' }}>
            Hirdess fix áras útvonalat — a feladók rád találnak, és üresjárat nélkül fuvarozhatsz.
          </p>
          <Link className="btn" href="/sofor/uj-utvonal">➕ Új útvonal meghirdetése</Link>
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
        // IDEIGLENESEN KIKAPCSOLVA — 100+ sofőr után visszakapcsolni:
        // const isInstant = !!j.is_instant;
        const isInstant = false;
        // Saját poszton csak szerkesztés/megtekintés. A részletek oldal
        // ilyenkor a feladói nézetre visz (dashboard/fuvar/[id]), hogy
        // a licitek listáját és a szerkesztést lássa.
        const href = isMine ? `/dashboard/fuvar/${j.id}` : `/sofor/fuvar/${j.id}`;

        // Stílus prioritás: instant felülírja az own-post sárgát, mert
        // az "azonnali" elvállalás időérzékeny — ott a figyelmet maximumra
        // pörgetjük.
        const cardStyle: React.CSSProperties = {
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          marginTop: 16,
          ...(isMine ? { background: '#fefce8', borderColor: '#facc15' } : {}),
          ...(isInstant && !isMine
            ? {
                background: '#FFF8E1',
                borderColor: '#FB8C00',
                borderWidth: 2,
                boxShadow: '0 0 0 3px rgba(251,140,0,0.15)',
              }
            : {}),
        };

        return (
          <Link
            key={j.id}
            href={href}
            className={`card${isMine ? ' own-post-card' : ''}`}
            style={cardStyle}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h3 style={{ marginTop: 0, marginBottom: 0 }}>{j.title}</h3>
                  {isInstant && (
                    <span
                      className="pill"
                      style={{
                        background: '#FB8C00',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 11,
                        letterSpacing: 0.5,
                      }}
                      title="Azonnali fuvar: első elfogadó nyer, nincs licitálás."
                    >
                      ⚡ AZONNALI
                    </span>
                  )}
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
                      SAJÁT HIRDETÉS
                    </span>
                  )}
                  {j.shipper_account_type === 'company' && j.shipper_company_verified === 'verified' && (
                    <span className="pill" style={{
                      background: 'var(--success-light)', color: '#166534', fontWeight: 800, fontSize: 11,
                    }}>
                      Ellenőrzött cég
                    </span>
                  )}
                  {(j as any).source_store && (
                    <span
                      className="pill"
                      style={{ background: '#e0e7ff', color: '#3730a3', fontWeight: 800, fontSize: 11 }}
                      title={`Bolti átvétel: ${(j as any).source_store} — tiszta, csomagolt áru, ismert átvételi pont.`}
                    >
                      🛍️ {(j as any).source_store}
                    </span>
                  )}
                </div>
                {(j as any).source_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(j as any).source_image_url}
                    alt="A hozandó termék"
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      margin: '6px 0',
                      background: 'var(--bg)',
                    }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
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
                {isInstant && !isMine && j.instant_expires_at && (
                  <p
                    style={{
                      fontSize: 12,
                      marginTop: 6,
                      color: '#E65100',
                      fontWeight: 600,
                    }}
                  >
                    Lejár: {new Date(j.instant_expires_at).toLocaleTimeString('hu-HU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
                {/* Bepakolás infó */}
                {((j as any).pickup_needs_carrying || (j as any).dropoff_needs_carrying) && (
                  <p style={{ fontSize: 12, marginTop: 6, color: '#FB8C00', fontWeight: 600 }}>
                    📦 Cipelés:
                    {(j as any).pickup_needs_carrying && ` Felvétel ${(j as any).pickup_floor === 0 ? 'földszint' : `${(j as any).pickup_floor}. em.`}${(j as any).pickup_floor > 0 && !(j as any).pickup_has_elevator ? ' (nincs lift!)' : ''}`}
                    {(j as any).pickup_needs_carrying && (j as any).dropoff_needs_carrying && ' ·'}
                    {(j as any).dropoff_needs_carrying && ` Lerakás ${(j as any).dropoff_floor === 0 ? 'földszint' : `${(j as any).dropoff_floor}. em.`}${(j as any).dropoff_floor > 0 && !(j as any).dropoff_has_elevator ? ' (nincs lift!)' : ''}`}
                  </p>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                {isInstant && !isMine && (
                  <button
                    type="button"
                    onClick={(e) => {
                      // Link beágyazás miatt meg kell akadályozni a navigációt,
                      // hogy csak az elvállalás fusson le.
                      e.preventDefault();
                      e.stopPropagation();
                      acceptInstant(j.id);
                    }}
                    disabled={acceptingInstantId != null}
                    style={{
                      marginTop: 8,
                      background: '#FB8C00',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: 6,
                      fontWeight: 700,
                      cursor: acceptingInstantId ? 'wait' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {acceptingInstantId === j.id ? 'Elvállalás…' : '⚡ Elvállalom!'}
                  </button>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
