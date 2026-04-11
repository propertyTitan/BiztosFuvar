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
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid, photoUrl } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import { getSocket, joinUserRoom } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';
import ReviewBox from '@/components/ReviewBox';
import ChatBox from '@/components/ChatBox';

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
  const toast = useToast();

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

  // `job:paid` realtime event — ha a feladó kifizette a fuvart, a sofőr
  // azonnal lássa a FIZETVE címkét, ne kelljen manuálisan refreshelni.
  useEffect(() => {
    if (!me) return;
    joinUserRoom(me.id);
    const socket = getSocket();
    const onPaid = (p: any) => {
      if (!p || p.job_id === id) load();
    };
    socket.on('job:paid', onPaid);
    return () => {
      socket.off('job:paid', onPaid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, id]);

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
      toast.success('Licit elküldve', `${amount.toLocaleString('hu-HU')} Ft`);
      setBidAmount('');
      setBidEta('');
      setBidMessage('');
      await load();
    } catch (err: any) {
      toast.error('Licit hiba', err.message);
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
  const iAmTheShipper = me?.id === job.shipper_id;
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className="pill pill-progress">{STATUS_LABEL[job.status] || job.status}</span>
          {/* Fizetés állapot — csak accepted+ státuszoknál érdekes.
              A sofőr ebből látja, hogy a feladó már kifizette-e vagy sem. */}
          {['accepted', 'in_progress', 'delivered'].includes(job.status) && (
            job.paid_at ? (
              <span
                className="pill"
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  border: '1px solid #86efac',
                  fontWeight: 700,
                }}
                title={`Fizetve: ${new Date(job.paid_at).toLocaleString('hu-HU')}`}
              >
                ✅ FIZETVE
              </span>
            ) : (
              <span
                className="pill"
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                }}
              >
                ⏳ Fizetésre vár
              </span>
            )
          )}
        </div>
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
                href={photoUrl(p.url)}
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
                  src={photoUrl(p.url)}
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

      {/* Saját poszt figyelmeztetés — ha a user a saját fuvarát nézi
          a sofőr oldalról, ne hagyjuk licitálni. A feladói nézetet a
          dashboard/fuvar/[id] oldalon találja. */}
      {iAmTheShipper && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: '#fefce8',
            borderColor: '#facc15',
          }}
        >
          <h2 style={{ marginTop: 0 }}>📣 Ez a te saját hirdetésed</h2>
          <p style={{ marginBottom: 8 }}>
            A saját fuvaradra nem licitálhatsz. A licitek kezeléséhez nyisd meg a feladói nézetet.
          </p>
          <Link className="btn" href={`/dashboard/fuvar/${job.id}`}>
            Feladói nézet →
          </Link>
        </div>
      )}

      {/* Licit feladás vagy meglévő licit állapota */}
      {!iAmTheShipper && (job.status === 'pending' || job.status === 'bidding') && !myBid && (
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
        <div className="card" style={{ marginTop: 16, background: 'var(--surface)' }}>
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
            A fuvart a <strong>GoFuvar mobilalkalmazásban</strong> kell elindítani és lezárni.
            A felvételi és lerakodási fotókhoz, valamint az élő GPS követéshez a telefonod kamera
            és helymeghatározás szolgáltatása szükséges, ami <strong>csak a mobilból érhető el</strong>.
            <br />
            Nyisd meg a GoFuvar appot a telefonodon, és lépj be a „Saját fuvaraim" menüpontba.
          </p>
        </div>
      )}

      {/* Chat */}
      {['accepted', 'in_progress', 'delivered', 'completed'].includes(job.status) && job.carrier_id && (
        <div style={{ marginTop: 16 }}>
          <ChatBox entityKey="job_id" entityId={id} />
        </div>
      )}

      {/* Értékelés — delivered / completed állapotban */}
      {['delivered', 'completed'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>⭐ Értékeld a feladót</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Hogyan ment a kommunikáció? Megvolt a csomag? Kattints a csillagokra.
          </p>
          <ReviewBox entityKey="job_id" entityId={id} onDone={() => load()} />
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
