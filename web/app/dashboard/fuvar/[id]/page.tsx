'use client';

// Egy konkrét fuvar nézete a feladó számára:
// - Élő követés Google Maps-en + Socket.IO sofőr piros pötty
// - Licitek listája (ha még bidding)
// - Fotók (pickup / dropoff) — Proof of Delivery 2.0
// - Escrow / Barion állapot
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid, photoUrl } from '@/api';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import { getSocket, joinUserRoom, subscribeJob } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ReviewBox from '@/components/ReviewBox';
import ChatBox from '@/components/ChatBox';
import QrCode from '@/components/QrCode';
import Confetti from '@/components/Confetti';

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

  async function cancelJob() {
    if (!job) return;
    const wasPaid = !!job.paid_at;
    const warning = wasPaid
      ? 'Biztosan lemondod a fuvart? A 10% lemondási díjat (max 1000 Ft) levonjuk a Barion visszatérítésből, a maradék néhány napon belül visszakerül a kártyádra.'
      : 'Biztosan lemondod a fuvart? Még nem történt fizetés, így díj sincs.';
    if (!window.confirm(warning)) return;
    const reason = window.prompt('Indok (opcionális):') || '';
    try {
      const res = await api.cancelJob(id, reason);
      const msg =
        res.refund_huf > 0
          ? `Fuvar lemondva. Visszatérítés: ${res.refund_huf.toLocaleString('hu-HU')} Ft${res.cancellation_fee_huf > 0 ? ` (díj: ${res.cancellation_fee_huf.toLocaleString('hu-HU')} Ft)` : ''}.`
          : 'Fuvar lemondva.';
      toast.success('Lemondás kész', msg);
      await loadAll();
    } catch (e: any) {
      toast.error('Lemondás sikertelen', e.message);
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

      {/* Vészhelyzeti kód — a feladó látja (a címzett kód SMS-ben megy) */}
      {(job as any).sender_delivery_code && !['delivered', 'completed', 'cancelled'].includes(job.status) && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)',
            color: '#fff',
            border: 'none',
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase', marginBottom: 8 }}>
            🆘 Vészhelyzeti kód (csak ha a címzett nem elérhető!)
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '0.15em',
              fontFamily: 'monospace',
              textAlign: 'center',
              padding: '12px 0',
            }}
          >
            {(job as any).sender_delivery_code}
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 8, lineHeight: 1.5 }}>
            ⚠️ Ezt a kódot <strong>CSAK</strong> akkor add meg a sofőrnek, ha a címzett
            nem elérhető és te engedélyezed a lerakást. A rendszer logolja, hogy
            ez a vészhelyzeti kóddal zárult le.
          </div>
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.15)', fontSize: 12,
          }}>
            📱 A címzett az átvételi kódot SMS-ben és emailben kapta meg.
            A QR kódot a tracking linken látja.
          </div>
        </div>
      )}

      {/* Ha NINCS címzett megadva — a feladó saját maga veszi át, a normál kód jelenik meg */}
      {job.delivery_code && !(job as any).sender_delivery_code && !['delivered', 'completed', 'cancelled'].includes(job.status) && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            color: '#fff',
            border: 'none',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase', marginBottom: 16 }}>
            🔐 Átvételi kód & QR
          </div>
          <QrCode jobId={job.id} deliveryCode={job.delivery_code} size={200} />
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 16 }}>
            Mutasd meg a sofőrnek a QR kódot vagy diktáld a 6 jegyű kódot.
          </div>
        </div>
      )}

      {/* Figyelmeztetés ha vészhelyzeti kóddal zárult */}
      {job.status === 'delivered' && (job as any).closed_by_code_type === 'sender_emergency' && (
        <div className="card" style={{
          marginTop: 16, background: '#fef3c7', borderColor: '#f59e0b',
          color: '#92400e', borderLeft: '4px solid #f59e0b',
        }}>
          ⚠️ <strong>Ez a fuvar a feladó vészhelyzeti kódjával zárult le</strong> — a címzett
          nem volt elérhető. Vita esetén ez az információ rendelkezésre áll.
        </div>
      )}

      {/* Confetti ha a fuvar éppen most lett lezárva */}
      <Confetti active={job.status === 'delivered'} />

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
                    src={photoUrl(p.url)}
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

          {/* Lemondás gomb — bárhol elérhető, ha a fuvar még lemondható */}
          {!['in_progress', 'delivered', 'completed', 'cancelled'].includes(job.status) && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={cancelJob}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  padding: '6px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ❌ Fuvar lemondása
              </button>
              {job.paid_at && (
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Lemondási díj: 10% (max 1000 Ft) — a maradék automatikusan visszajár.
                </p>
              )}
            </div>
          )}

          {/* Lemondott állapot info */}
          {job.status === 'cancelled' && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#fee2e2',
                borderRadius: 8,
                border: '1px solid #fca5a5',
                fontSize: 13,
              }}
            >
              <strong>❌ Ez a fuvar le lett mondva.</strong>
              {(job as any).refund_huf > 0 && (
                <div style={{ marginTop: 4 }}>
                  Visszatérítve: {(job as any).refund_huf.toLocaleString('hu-HU')} Ft
                  {(job as any).cancellation_fee_huf > 0 &&
                    ` (díj: ${(job as any).cancellation_fee_huf.toLocaleString('hu-HU')} Ft)`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Vita indítása — in_progress vagy delivered státuszban,
          ha valami baj van a csomaggal / szállítással / sofőrrel. */}
      {['in_progress', 'delivered'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16, background: '#fefce8', borderColor: '#f59e0b' }}>
          <h2 style={{ marginTop: 0 }}>Probléma van a fuvarral?</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ha a csomagod sérült, nem érkezett meg, vagy egyéb gond van — indíts egy vitás esetet,
            és az admin felülvizsgálja a helyzetet.
          </p>
          <button
            type="button"
            className="btn"
            style={{ background: '#d97706', border: 'none' }}
            onClick={async () => {
              const desc = window.prompt('Írd le mi a probléma (kötelező):');
              if (!desc || !desc.trim()) return;
              try {
                await api.openDispute({ job_id: id, description: desc });
                toast.info('Vitás eset megnyitva', 'Az admin hamarosan felülvizsgálja.');
                loadAll();
              } catch (e: any) {
                toast.error('Hiba', e.message);
              }
            }}
          >
            ⚖️ Vitás esetet nyitok
          </button>
        </div>
      )}

      {job.status === 'disputed' && (
        <div className="card" style={{ marginTop: 16, background: '#fef3c7', borderColor: '#f59e0b' }}>
          <h2 style={{ marginTop: 0 }}>⚖️ Vitás eset folyamatban</h2>
          <p className="muted">
            Erre a fuvarra vita van nyitva. Az admin felülvizsgálja a helyzetet, és döntést hoz.
            Az értesítések között követheted az állapotot.
          </p>
        </div>
      )}

      {/* Chat — az elfogadott licittől kezdve a feladó és a sofőr
          üzenhetnek egymásnak, telefonszám-csere nélkül. */}
      {['accepted', 'in_progress', 'delivered', 'completed'].includes(job.status) && job.carrier_id && (
        <div style={{ marginTop: 16 }}>
          <ChatBox entityKey="job_id" entityId={id} />
        </div>
      )}

      {/* Értékelés — delivered / completed állapotban */}
      {['delivered', 'completed'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>⭐ Értékeld a sofőrt</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Hogyan teljesített a sofőr? Kattints a csillagokra és írd meg a véleményed.
          </p>
          <ReviewBox entityKey="job_id" entityId={id} onDone={loadAll} />
        </div>
      )}

      {/* Licitek */}
      {(job.status === 'pending' || job.status === 'bidding') && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Beérkezett licitek ({bids.length})</h2>
          {bids.length === 0 && <p className="muted">Még nincs licit. A sofőrök hamarosan ajánlatot tesznek.</p>}
          {bids.map((b) => (
            <div key={b.id} style={{ borderBottom: '1px solid var(--border)', padding: '16px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href={`/profil/${b.carrier_id}`} className="row" style={{ gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
                  {/* Sofőr avatar + info — kattintható profil */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 16,
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {(b.carrier_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{b.carrier_name || 'Sofőr'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>→ profil</span></div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {b.rating_avg > 0 && (
                        <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                          ⭐ {Number(b.rating_avg).toFixed(1)}
                          {b.rating_count > 0 && <span className="muted"> ({b.rating_count})</span>}
                        </span>
                      )}
                      {b.eta_minutes && <span className="muted" style={{ fontSize: 12 }}>~{b.eta_minutes} perc</span>}
                    </div>
                  </div>
                </Link>
                <div style={{ textAlign: 'right' }}>
                  <strong className="price" style={{ fontSize: 18 }}>{b.amount_huf.toLocaleString('hu-HU')} Ft</strong>
                </div>
              </div>
              {b.message && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13, paddingLeft: 52 }}>„{b.message}"</p>}
              <button className="btn" onClick={() => acceptBid(b.id)}>Elfogadom</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
