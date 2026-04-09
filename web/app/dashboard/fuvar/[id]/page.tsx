'use client';

// Egy konkrét fuvar nézete a feladó számára:
// - Élő követés Google Maps-en + Socket.IO sofőr piros pötty
// - Licitek listája (ha még bidding)
// - Fotók (pickup / dropoff) — Proof of Delivery 2.0
// - Escrow / Barion állapot
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid } from '@/api';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import { getSocket, joinUserRoom, subscribeJob } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik', bidding: 'Licitálható', accepted: 'Elfogadva',
  in_progress: 'Folyamatban', delivered: 'Lerakva', completed: 'Lezárva',
  disputed: 'Vitatott', cancelled: 'Lemondva',
};

export default function FuvarReszletek() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [escrow, setEscrow] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  async function startPayment() {
    setPaying(true);
    try {
      const r = await api.payJob(id);
      if (r.is_stub) {
        router.push(`/fizetes-stub?job=${id}`);
      } else {
        window.location.href = r.gateway_url;
      }
    } catch (e: any) {
      toast.error('Fizetés indítása sikertelen', e.message);
    } finally {
      setPaying(false);
    }
  }

  async function loadAll() {
    try {
      const [j, b, p, e] = await Promise.all([
        api.getJob(id),
        api.listBids(id),
        api.listPhotos(id),
        api.jobEscrow(id),
      ]);
      setJob(j); setBids(b); setPhotos(p); setEscrow(e);
    } catch (err: any) { setError(err.message); }
  }

  useEffect(() => { loadAll(); }, [id]);

  // Real-time: ha érkezik új fotó vagy státuszváltás, frissítünk
  useEffect(() => {
    const unsub = subscribeJob(id, {
      onPickedUp: () => loadAll(),
      onDelivered: () => loadAll(),
      onAccepted: () => loadAll(),
    });
    return unsub;
  }, [id]);

  // Külön: `job:paid` user-szoba event, hogy a sikeres fizetés után
  // a gomb helyén azonnal megjelenjen a FIZETVE címke refresh nélkül.
  useEffect(() => {
    if (!user) return;
    joinUserRoom(user.id);
    const socket = getSocket();
    const onPaid = (p: any) => {
      if (!p || p.job_id === id) loadAll();
    };
    socket.on('job:paid', onPaid);
    return () => {
      socket.off('job:paid', onPaid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  async function acceptBid(bidId: string) {
    try {
      await api.acceptBid(bidId);
      toast.success('Licit elfogadva', 'Most már kifizetheted a fuvart.');
      await loadAll();
    } catch (err: any) {
      toast.error('Hiba a licit elfogadásakor', err.message);
    }
  }

  if (error) return <div className="card" style={{ borderColor: 'var(--danger)' }}>Hiba: {error}</div>;
  if (!job) return <p>Betöltés…</p>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{job.title}</h1>
          <p className="muted" style={{ margin: 0 }}>📍 {job.pickup_address} → 🏁 {job.dropoff_address}</p>
        </div>
        <span className="pill pill-progress">{STATUS_LABEL[job.status] || job.status}</span>
      </div>

      {/* Élő követés */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
        <LiveTrackingMap job={job} />
      </div>

      {/* Átvételi kód – csak a feladó látja, a sofőrnek nincs benne a válaszban */}
      {job.delivery_code && !['delivered', 'completed', 'cancelled'].includes(job.status) && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            color: '#fff',
            border: 'none',
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase', marginBottom: 8 }}>
            🔐 Átvételi kód
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: '0.15em',
              fontFamily: 'monospace',
              textAlign: 'center',
              padding: '12px 0',
            }}
          >
            {job.delivery_code}
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Add át ezt a 6 jegyű kódot a sofőrnek, amikor átveszi tőled (vagy a címzettől) a csomagot.
            A sofőr ezzel tudja lezárni a fuvart. A kódot senki más nem látja.
          </div>
        </div>
      )}

      {/* Hirdetési fotók (amit a feladó töltött fel) */}
      {photos.some((p) => p.kind === 'listing') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Fotók a csomagról</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 8,
            }}
          >
            {photos
              .filter((p) => p.kind === 'listing')
              .map((p) => (
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
      {(job.length_cm || job.width_cm || job.height_cm || job.weight_kg || job.distance_km) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Csomag adatai</h2>
          <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
            {job.length_cm && job.width_cm && job.height_cm && (
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Méret (h × sz × m)</div>
                <strong>{job.length_cm} × {job.width_cm} × {job.height_cm} cm</strong>
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
          </div>
          {job.description && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Leírás</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 15, lineHeight: 1.5 }}>
                {job.description}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* Bizonyíték-fotók: pickup/dropoff/damage/document (a sofőrtől) */}
        <div className="card">
          <h2>Bizonyíték-fotók (sofőr)</h2>
          {photos.filter((p) => p.kind !== 'listing').length === 0 && (
            <p className="muted">Még nincs pickup/dropoff fotó feltöltve.</p>
          )}
          {photos
            .filter((p) => p.kind !== 'listing')
            .map((p) => (
              <div key={p.id} style={{ marginBottom: 12 }}>
                <strong>
                  {p.kind === 'pickup' ? 'Felvétel' : p.kind === 'dropoff' ? 'Lerakodás' : p.kind}
                </strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(p.taken_at).toLocaleString('hu-HU')}
                  {p.gps_lat && ` · ${p.gps_lat.toFixed(5)}, ${p.gps_lng?.toFixed(5)}`}
                  {p.ai_has_cargo != null &&
                    ` · AI: ${p.ai_has_cargo ? '✓ áru azonosítva' : '✗ nem található áru'}`}
                </div>
                {p.url && (
                  <img
                    src={p.url}
                    alt={p.kind}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      marginTop: 8,
                      maxHeight: 240,
                      objectFit: 'cover',
                    }}
                  />
                )}
              </div>
            ))}
        </div>

        {/* Letét + fizetés */}
        <div className="card">
          <h2>Letét (Barion)</h2>
          {job.status !== 'accepted' && !escrow && (
            <p className="muted">Nincs letét — még nincs elfogadott licit.</p>
          )}
          {(job.status === 'accepted' || escrow) && (
            <>
              <p>
                Összeg:{' '}
                <strong>
                  {(job.accepted_price_huf ?? escrow?.amount_huf ?? 0).toLocaleString('hu-HU')} Ft
                </strong>
              </p>
              {escrow?.carrier_share_huf && (
                <>
                  <p className="muted">Sofőri rész (90%): {escrow.carrier_share_huf.toLocaleString('hu-HU')} Ft</p>
                  <p className="muted">Platform jutalék (10%): {escrow.platform_share_huf?.toLocaleString('hu-HU')} Ft</p>
                </>
              )}

              {/* Fizetés állapot: FIZETVE címke, vagy Fizetés gomb.
                  A /pay endpoint lusta (ha nincs még reservation, most
                  hozza létre), úgyhogy a gomb akkor is működik, ha az
                  escrow még nem jött létre az accept során. */}
              {job.paid_at ? (
                <div
                  style={{
                    marginTop: 12,
                    display: 'inline-block',
                    background: '#dcfce7',
                    color: '#166534',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 14,
                    border: '1px solid #86efac',
                  }}
                  title={`Fizetve: ${new Date(job.paid_at).toLocaleString('hu-HU')}`}
                >
                  ✅ FIZETVE
                </div>
              ) : job.status === 'accepted' ? (
                <button
                  type="button"
                  onClick={startPayment}
                  disabled={paying}
                  className="btn"
                  style={{
                    marginTop: 12,
                    background: '#16a34a',
                    border: 'none',
                    cursor: paying ? 'wait' : 'pointer',
                    opacity: paying ? 0.7 : 1,
                  }}
                >
                  {paying ? 'Fizetés indítása…' : '💳 Fizetés Barionnal'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Licitek */}
      {(job.status === 'pending' || job.status === 'bidding') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Beérkezett licitek ({bids.length})</h2>
          {bids.length === 0 && <p className="muted">Még nincs licit. A sofőrök hamarosan ajánlatot tesznek.</p>}
          {bids.map((b) => (
            <div key={b.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <div>
                <strong className="price">{b.amount_huf.toLocaleString('hu-HU')} Ft</strong>
                {b.eta_minutes && <span className="muted"> · érkezés ~{b.eta_minutes} perc</span>}
                {b.message && <p className="muted" style={{ margin: '4px 0 0' }}>{b.message}</p>}
              </div>
              <button className="btn" onClick={() => acceptBid(b.id)}>Elfogadom</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
