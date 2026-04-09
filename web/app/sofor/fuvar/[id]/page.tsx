'use client';

// Sofőr oldali fuvar részletek.
// - Térkép a felvétel/lerakodás pontokkal és (ha van) élő sofőr pötty.
// - Csomag adatai (méret, súly, távolság).
// - Hirdetési fotók (a feladó által feltöltött képek).
// - Licit feladás: ár + opcionális érkezési idő + üzenet.
// - Ha a sofőr már licitált, látja a licitjét és annak állapotát.
// - Ha a fuvar már az övé (in_progress), figyelmezteti, hogy a lezárás
//   CSAK a mobilalkalmazásban lehetséges (GPS + fotó miatt).
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import LiveTrackingMap from '@/components/LiveTrackingMap';

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

export default function SoforFuvarReszletek() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useCurrentUser();

  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [bidAmount, setBidAmount] = useState('');
  const [bidEta, setBidEta] = useState('');
  const [bidMessage, setBidMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [j, b, p] = await Promise.all([
        api.getJob(id),
        api.listBids(id),
        api.listPhotos(id),
      ]);
      setJob(j);
      setBids(b);
      setPhotos(p);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseInt(bidAmount, 10);
    if (!amount || amount <= 0) {
      alert('Érvényes összeget adj meg.');
      return;
    }
    setSubmitting(true);
    try {
      await api.placeBid(id, {
        amount_huf: amount,
        eta_minutes: bidEta ? parseInt(bidEta, 10) : undefined,
        message: bidMessage || undefined,
      });
      setBidAmount('');
      setBidEta('');
      setBidMessage('');
      await load();
    } catch (err: any) {
      alert('Licit hiba: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error)
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        Hiba: {error}
      </div>
    );
  if (!job) return <p>Betöltés…</p>;

  const iAmTheCarrier = me?.id === job.carrier_id;
  const myBid = bids.find((b) => b.carrier_id === me?.id);
  const listingPhotos = photos.filter((p) => p.kind === 'listing');

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

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{job.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            📍 {job.pickup_address} → 🏁 {job.dropoff_address}
          </p>
        </div>
        <span className="pill pill-progress">{STATUS_LABEL[job.status] || job.status}</span>
      </div>

      {/* Térkép */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
        <LiveTrackingMap job={job} />
      </div>

      {/* Hirdetési fotók */}
      {listingPhotos.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Fotók a csomagról</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 8,
            }}
          >
            {listingPhotos.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  aspectRatio: '1 / 1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                }}
              >
                <img
                  src={p.url}
                  alt="Fuvar fotó"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Csomag adatai */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Csomag adatai</h2>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          {job.length_cm && job.width_cm && job.height_cm && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Méret (h × sz × m)</div>
              <strong>
                {job.length_cm} × {job.width_cm} × {job.height_cm} cm
              </strong>
            </div>
          )}
          {job.volume_m3 != null && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Térfogat</div>
              <strong>{job.volume_m3} m³</strong>
            </div>
          )}
          {job.weight_kg != null && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Súly</div>
              <strong>{job.weight_kg} kg</strong>
            </div>
          )}
          {job.distance_km != null && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Távolság</div>
              <strong>{job.distance_km} km</strong>
            </div>
          )}
          {job.suggested_price_huf != null && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Javasolt fuvardíj</div>
              <strong className="price">{job.suggested_price_huf.toLocaleString('hu-HU')} Ft</strong>
            </div>
          )}
        </div>
        {job.description && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Leírás a feladótól</div>
            <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{job.description}</div>
          </div>
        )}
      </div>

      {/* Licit feladás vagy meglévő licit állapota */}
      {(job.status === 'pending' || job.status === 'bidding') && !myBid && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Licit feladása</h2>
          <form onSubmit={submitBid}>
            <div className="grid-2">
              <div>
                <label>Ajánlott fuvardíj (Ft)</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder="pl. 58000"
                  required
                />
              </div>
              <div>
                <label>Érkezés a felvételre (perc)</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={bidEta}
                  onChange={(e) => setBidEta(e.target.value)}
                  placeholder="opcionális"
                />
              </div>
            </div>
            <label>Üzenet a feladónak</label>
            <textarea
              className="input"
              rows={2}
              value={bidMessage}
              onChange={(e) => setBidMessage(e.target.value)}
              placeholder="pl. Van rakodómunkás is"
            />
            <button className="btn" type="submit" disabled={submitting} style={{ marginTop: 16 }}>
              {submitting ? 'Küldés…' : 'Licit elküldése'}
            </button>
          </form>
        </div>
      )}

      {myBid && (
        <div className="card" style={{ marginTop: 16, background: '#eff6ff' }}>
          <h2 style={{ marginTop: 0 }}>A te licitelt</h2>
          <p>
            <strong className="price">{myBid.amount_huf.toLocaleString('hu-HU')} Ft</strong>
            {myBid.eta_minutes && <span className="muted"> · érkezés ~{myBid.eta_minutes} perc</span>}
          </p>
          <span className={`pill pill-${myBid.status === 'accepted' ? 'delivered' : 'bidding'}`}>
            {myBid.status === 'pending' && 'Várakozik elfogadásra'}
            {myBid.status === 'accepted' && 'Elfogadva 🎉'}
            {myBid.status === 'rejected' && 'Elutasítva'}
            {myBid.status === 'withdrawn' && 'Visszavonva'}
          </span>
          {myBid.message && (
            <p className="muted" style={{ marginTop: 8 }}>
              „{myBid.message}"
            </p>
          )}
        </div>
      )}

      {/* Ha a fuvar már a sofőré, figyelmeztetés, hogy a lezárás csak mobilon */}
      {iAmTheCarrier && (job.status === 'accepted' || job.status === 'in_progress') && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: '#fef3c7',
            borderColor: '#f59e0b',
          }}
        >
          <h2 style={{ marginTop: 0 }}>📱 Folytasd a mobilalkalmazásban</h2>
          <p style={{ marginBottom: 0 }}>
            A fuvart a <strong>BiztosFuvar mobilalkalmazásban</strong> kell elindítani és lezárni.
            A felvételi és lerakodási fotókhoz, valamint az élő GPS követéshez a telefonod kamera
            és helymeghatározás szolgáltatása szükséges, ami <strong>csak a mobilból érhető el</strong>.
            <br />
            Nyisd meg a BiztosFuvar appot a telefonodon, és lépj be a „Saját fuvaraim" menüpontba.
          </p>
        </div>
      )}

      {/* Összes beérkezett licit (referencia) */}
      {(job.status === 'pending' || job.status === 'bidding') && bids.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Eddigi licitek ({bids.length})</h2>
          {bids.map((b) => (
            <div
              key={b.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span className="muted">
                {b.carrier_id === me?.id ? 'Te' : 'Másik sofőr'}
                {b.eta_minutes && ` · ~${b.eta_minutes} perc`}
              </span>
              <strong>{b.amount_huf.toLocaleString('hu-HU')} Ft</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
