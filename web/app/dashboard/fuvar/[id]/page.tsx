'use client';

// Egy konkrét fuvar nézete a feladó számára:
// - Élő követés Google Maps-en + Socket.IO szállító piros pötty
// - Licitek listája (ha még bidding)
// - Fotók (pickup / dropoff) — Proof of Delivery 2.0
// - Escrow / Barion állapot
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid, photoUrl } from '@/api';
import { MapPin, Flag, Star, RefreshCw, Hourglass, BadgeCheck, CheckCircle2 } from 'lucide-react';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import { getSocket, joinUserRoom, subscribeJob } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ReviewBox from '@/components/ReviewBox';
import ChatBox from '@/components/ChatBox';
import JobQuestions from '@/components/JobQuestions';
import DisputeButton from '@/components/DisputeButton';
import QrCode from '@/components/QrCode';
import Confetti from '@/components/Confetti';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading, ErrorState } from '@/components/StateView';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik', bidding: 'Ajánlatokat vár', accepted: 'Elfogadva',
  in_progress: 'Folyamatban', delivered: 'Lerakva', completed: 'Lezárva',
  disputed: 'Vitatott', cancelled: 'Lemondva',
};

// Sikertelen kézbesítés esetén történő visszaszállítás — jelvény a licit-soron.
// Így a feladó összehasonlíthatja a szállítókat a visszaszállítási hajlandóság szerint.
function ReturnPolicyBadge({ bid }: { bid: Bid }) {
  if (!bid.return_policy) return null;
  const map = {
    included: { text: '↩️ Visszaszállítás: benne', bg: 'var(--success-light)', color: '#166534' },
    extra_fee: {
      text: `↩️ Visszaszállítás: +${(bid.return_fee_huf ?? 0).toLocaleString('hu-HU')} Ft`,
      bg: 'var(--warning-light)', color: '#92400e',
    },
    no: { text: '⚠️ Nincs visszaszállítás', bg: 'var(--danger-light)', color: '#991b1b' },
  } as const;
  const s = map[bid.return_policy];
  return (
    <span
      className="pill"
      style={{ background: s.bg, color: s.color, fontWeight: 700, fontSize: 11 }}
      title="A szállító nyilatkozata: sikertelen kézbesítés esetén 5 munkanapon belül visszajuttatja-e a csomagot a feladóhoz."
    >
      {s.text}
    </span>
  );
}

const STATUS_PILL: Record<string, string> = {
  pending: 'pill-bidding', bidding: 'pill-bidding', accepted: 'pill-accepted',
  in_progress: 'pill-progress', delivered: 'pill-delivered', completed: 'pill-delivered',
  disputed: 'pill-accepted', cancelled: 'pill-cancelled',
};

export default function FuvarReszletek() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [counterTarget, setCounterTarget] = useState<Bid | null>(null);
  const [paying, setPaying] = useState(false);
  // 45/2014. 29.§ (1) a) nyilatkozat — a fizetés indításának feltétele,
  // a backend a redirect ELŐTT rögzíti (fee_consent_at).
  const [feeConsent, setFeeConsent] = useState(false);
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
  // Élőben (Socket.IO) érkezett ajánlatok id-i: belépő animáció + „ÚJ"
  // jelvény, ami ~10 mp után magától elhalványul. A timereket unmountkor
  // takarítjuk.
  const [freshBids, setFreshBids] = useState<Record<string, boolean>>({});
  const freshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  async function startPayment() {
    if (!feeConsent) {
      toast.error('Beleegyezés szükséges', 'A fizetéshez pipáld ki az azonnali teljesítésre vonatkozó nyilatkozatot.');
      return;
    }
    setPaying(true);
    try {
      const r = await api.payJob(id, feeConsent);
      if (r.paid_via_voucher) {
        // Ingyen feladás kupon fedezte a díjat — nincs Barion-fizetés.
        toast.success('Ingyen feladás! 🎉', 'A kuponod fedezte a kapcsolatfelvételi díjat — a kapcsolat megnyílt.');
        router.refresh();
      } else if (r.is_stub) {
        router.push(`/fizetes-stub?job=${id}`);
      } else if (r.gateway_url) {
        window.location.href = r.gateway_url;
      }
    } catch (e: any) {
      toast.error('Fizetés indítása sikertelen', e.message);
    } finally {
      setPaying(false);
    }
  }

  // Dialógus-állapotok (window.confirm/prompt kiváltva)
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  // A konfetti csak akkor szóljon, ha a kézbesítés MOST történt — nem minden
  // oldalbetöltésnél, ha a fuvar már korábban 'delivered' lett.
  const initialStatusRef = useRef<string | null>(null);

  async function cancelJob(reason: string) {
    if (!job) return;
    try {
      const res = await api.cancelJob(id, reason);
      const msg = res.fee_kept
        ? 'Fuvar lemondva. A kapcsolatfelvételi díj nem visszatérítendő (a kontakt-átadás már teljesült).'
        : 'Fuvar lemondva.';
      toast.success('Lemondás kész', msg);
      await loadAll();
    } catch (e: any) {
      toast.error('Lemondás sikertelen', e.message);
    }
  }

  async function reopenJob(reason: string) {
    if (!job) return;
    try {
      await api.reopenJob(id, reason);
      toast.success('Fuvar újranyitva', 'A korábbi ajánlatok újra elérhetők — díjmentesen választhatsz másik szállítót.');
      await loadAll();
    } catch (e: any) {
      toast.error('Szállító-csere sikertelen', e.message);
    }
  }

  async function loadAll() {
    try {
      const [j, b, p] = await Promise.all([
        api.getJob(id),
        api.listBids(id),
        api.listPhotos(id),
      ]);
      setJob(j); setBids(b); setPhotos(p);
      if (initialStatusRef.current === null) initialStatusRef.current = j.status;
    } catch (err: any) { setError(err.message); }
  }

  useEffect(() => { loadAll(); }, [id]);

  // Real-time: ha érkezik új fotó vagy státuszváltás, frissítünk
  useEffect(() => {
    const unsub = subscribeJob(id, {
      onPickedUp: () => loadAll(),
      onDelivered: () => loadAll(),
      onAccepted: () => loadAll(),
      onCountered: () => loadAll(),
      // Új ajánlat élőben: frissítés + a sor „megérkezik" (bid-arrive
      // animáció + ÚJ jelvény, 10 mp múlva kifakul)
      onNewBid: (b: any) => {
        loadAll();
        if (!b?.id) return;
        setFreshBids((prev) => ({ ...prev, [b.id]: true }));
        freshTimersRef.current.push(setTimeout(() => {
          setFreshBids((prev) => {
            const next = { ...prev };
            delete next[b.id];
            return next;
          });
        }, 10000));
      },
    });
    return () => {
      unsub();
      freshTimersRef.current.forEach(clearTimeout);
      freshTimersRef.current = [];
    };
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
    if (acceptingBidId) return;
    setAcceptingBidId(bidId);
    try {
      await api.acceptBid(bidId);
      toast.success('Ajánlat elfogadva', 'Fizesd meg a kapcsolatfelvételi díjat — utána megkapod a szállító elérhetőségét, a fuvardíjat pedig készpénzben adod át neki.');
      await loadAll();
    } catch (err: any) {
      toast.error('Hiba az ajánlat elfogadásakor', err.message);
    } finally {
      setAcceptingBidId(null);
    }
  }

  async function submitCounter(bidId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Hibás összeg', 'Adj meg egy pozitív összeget (Ft).');
      return;
    }
    try {
      await api.counterBid(bidId, Math.round(amount));
      toast.success('Ellenajánlat elküldve', 'A szállító értesítést kap róla.');
      await loadAll();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  if (error) return <ErrorState message={error} onRetry={loadAll} />;
  if (!job) return <Loading />;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{job.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <MapPin size={13} style={{ verticalAlign: -2 }} /> {job.pickup_address}
            {' → '}
            <Flag size={13} style={{ verticalAlign: -2 }} /> {job.dropoff_address}
          </p>
        </div>
        <span className={`pill ${STATUS_PILL[job.status] || 'pill-progress'}`}>{STATUS_LABEL[job.status] || job.status}</span>
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
            ⚠️ Ezt a kódot <strong>CSAK</strong> akkor add meg a szállítónak, ha a címzett
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
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
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
            Mutasd meg a szállítónak a QR kódot vagy diktáld a 6 jegyű kódot.
          </div>
        </div>
      )}

      {/* Figyelmeztetés ha vészhelyzeti kóddal zárult */}
      {job.status === 'delivered' && (job as any).closed_by_code_type === 'sender_emergency' && (
        <div className="card" style={{
          marginTop: 16, background: 'var(--warning-light)', borderColor: 'var(--warning)',
          color: '#92400e', borderLeft: '4px solid var(--warning)',
        }}>
          ⚠️ <strong>Ez a fuvar a feladó vészhelyzeti kódjával zárult le</strong> — a címzett
          nem volt elérhető. Vita esetén ez az információ rendelkezésre áll.
        </div>
      )}

      {/* Confetti ha a fuvar éppen most lett lezárva */}
      <Confetti active={job.status === 'delivered' && !['delivered', 'completed'].includes(initialStatusRef.current || '')} />

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
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 16, lineHeight: 1.5 }}>
                {job.description}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* Bizonyíték-fotók: pickup/dropoff/damage/document (a szállítótől) */}
        <div className="card">
          <h2>Bizonyíték-fotók (szállító)</h2>
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

        {/* Kapcsolatfelvételi díj + fizetés */}
        <div className="card">
          <h2>Fizetés</h2>
          {job.status !== 'accepted' && !job.paid_at && (
            <p className="muted">Még nincs elfogadott ajánlat — elfogadás után itt fizeted a kapcsolatfelvételi díjat.</p>
          )}
          {(job.status === 'accepted' || job.paid_at) && (
            <>
              <p style={{ marginBottom: 4 }}>
                Fuvardíj (készpénzben a szállítónak):{' '}
                <strong>
                  {(job.accepted_price_huf ?? 0).toLocaleString('hu-HU')} Ft
                </strong>
              </p>
              <p style={{ marginTop: 0 }}>
                Kapcsolatfelvételi díj{' '}
                <span className="muted" style={{ fontSize: 12 }}>(bevezető ár)</span>:{' '}
                <strong>
                  {(job.connection_fee_huf ?? 0).toLocaleString('hu-HU')} Ft
                </strong>
              </p>

              {/* Fizetés állapot: FIZETVE címke, vagy Fizetés gomb.
                  A /pay endpoint lusta (ha nincs még fizetés-sor, most
                  hozza létre), úgyhogy a gomb akkor is működik, ha az
                  nem jött létre az accept során. */}
              {job.paid_at ? (
                <div
                  style={{
                    marginTop: 12,
                    display: 'inline-block',
                    background: 'var(--success-light)',
                    color: '#166534',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 14,
                    border: '1px solid #86efac',
                  }}
                  title={`Fizetve: ${new Date(job.paid_at).toLocaleString('hu-HU')}`}
                >
                  <BadgeCheck size={14} style={{ verticalAlign: -2 }} /> DÍJ FIZETVE
                </div>
              ) : job.status === 'accepted' ? (
                <>
                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      fontSize: 13,
                      lineHeight: 1.5,
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      marginTop: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={feeConsent}
                      onChange={(e) => setFeeConsent(e.target.checked)}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                    <span>
                      Kérem a szolgáltatás (kapcsolatfelvételi adatok átadása){' '}
                      <strong>azonnali teljesítését</strong>, és tudomásul veszem,
                      hogy a teljesítés után <strong>elállási jogomat elvesztem</strong>{' '}
                      (45/2014. Korm. rendelet 29. § (1) a)). A díj nem
                      visszatérítendő; ha a fuvar a szállító hibájából hiúsul meg,
                      díjmentesen választhatok másik szállítót ugyanerre a fuvarra.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={startPayment}
                    disabled={paying || !feeConsent}
                    className="btn"
                    style={{
                      marginTop: 12,
                      background: feeConsent ? 'var(--success-strong)' : 'var(--muted)',
                      border: 'none',
                      cursor: paying ? 'wait' : feeConsent ? 'pointer' : 'not-allowed',
                      opacity: paying || !feeConsent ? 0.7 : 1,
                    }}
                  >
                    {paying ? 'Fizetés indítása…' : `Díj fizetése (${(job.connection_fee_huf ?? 0).toLocaleString('hu-HU')} Ft)`}
                  </button>
                  <p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                    A díj ellenében azonnal megkapod a szállító telefonszámát, és
                    elindul a fuvar-folyamat (SMS a címzettnek, átvételi kód,
                    fotó-bizonyíték). A fuvardíjat készpénzben adod át a szállítónak.
                  </p>
                </>
              ) : null}

              {/* KONTAKT — ezt vetted meg a díjjal */}
              {job.paid_at && job.contact && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 14,
                    background: 'var(--success-light)',
                    borderRadius: 10,
                    border: '1px solid #86efac',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#166534', fontWeight: 700, marginBottom: 6 }}>
                    📞 A SZÁLLÍTÓ ELÉRHETŐSÉGE
                  </div>
                  <div style={{ fontWeight: 700 }}>{job.contact.name || 'Szállító'}</div>
                  {job.contact.phone && (
                    <div style={{ marginTop: 4 }}>
                      <a href={`tel:${job.contact.phone}`} style={{ fontWeight: 700, fontSize: 18 }}>
                        {job.contact.phone}
                      </a>
                    </div>
                  )}
                  {job.contact.email && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{job.contact.email}</div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    💵 Ne feledd: a fuvardíjat ({(job.accepted_price_huf ?? 0).toLocaleString('hu-HU')} Ft)
                    készpénzben fizeted a szállítónak.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Szállító-csere — ha a szállító nem elérhető, díjmentes újraválasztás */}
          {job.status === 'accepted' && user?.id === job.shipper_id && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowReopenDialog(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '6px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <RefreshCw size={12} style={{ verticalAlign: -2 }} /> Másik szállítót választok
              </button>
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Ha a szállító nem elérhető vagy visszalépett: a korábbi ajánlatok újra
                elérhetővé válnak, és díjmentesen választhatsz — a befizetett díj erre
                a fuvarra érvényes marad.
              </p>
            </div>
          )}

          {/* Lemondás gomb — bárhol elérhető, ha a fuvar még lemondható */}
          {!['in_progress', 'delivered', 'completed', 'cancelled'].includes(job.status) && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowCancelDialog(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger-text)',
                  padding: '6px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Fuvar lemondása
              </button>
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                A lemondás díjmentes. {job.paid_at ? 'A már befizetett kapcsolatfelvételi díj nem visszatérítendő és másik fuvarra nem vihető át.' : 'Pénzmozgás még nem történt.'}
              </p>
            </div>
          )}

          {/* Lemondott állapot info */}
          {job.status === 'cancelled' && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--danger-light)',
                borderRadius: 8,
                border: '1px solid #fca5a5',
                fontSize: 13,
              }}
            >
              <strong>❌ Ez a fuvar le lett mondva.</strong>
            </div>
          )}
        </div>
      </div>

      {/* Vita indítása — in_progress vagy delivered státuszban,
          ha valami baj van a csomaggal / szállítással / szállítóval. */}
      {['in_progress', 'delivered'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16, background: '#fefce8', borderColor: 'var(--warning)' }}>
          <h2 style={{ marginTop: 0 }}>Probléma van a fuvarral?</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ha a csomagod sérült, nem érkezett meg, vagy egyéb gond van — indíts egy vitás esetet,
            és az admin felülvizsgálja a helyzetet.
          </p>
          <button
            type="button"
            className="btn"
            style={{ background: '#d97706', border: 'none' }}
            onClick={() => setShowDisputeDialog(true)}
          >
            ⚖️ Vitás esetet nyitok
          </button>
        </div>
      )}

      {job.status === 'disputed' && (
        <div className="card" style={{ marginTop: 16, background: 'var(--warning-light)', borderColor: 'var(--warning)' }}>
          <h2 style={{ marginTop: 0 }}>⚖️ Vitás eset folyamatban</h2>
          <p className="muted">
            Erre a fuvarra vita van nyitva. Az admin felülvizsgálja a helyzetet, és döntést hoz.
            Az értesítések között követheted az állapotot.
          </p>
        </div>
      )}

      {/* Vita-nyitás gomb — csak in_progress/delivered/completed státuszban */}
      <DisputeButton jobId={id} status={job.status} />

      {/* Publikus Q&A — bárki kérdezhet, csak a feladó válaszolhat */}
      <JobQuestions
        jobId={id}
        jobStatus={job.status}
        shipperId={job.shipper_id}
        currentUserId={user?.id}
      />

      {/* Chat — az elfogadott licittől kezdve a feladó és a szállító
          üzenhetnek egymásnak, telefonszám-csere nélkül. */}
      {['accepted', 'in_progress', 'delivered', 'completed'].includes(job.status) && job.carrier_id && (
        <div style={{ marginTop: 16 }}>
          <ChatBox entityKey="job_id" entityId={id} />
        </div>
      )}

      {/* Értékelés — delivered / completed állapotban */}
      {['delivered', 'completed'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Star size={20} color="var(--warning)" fill="var(--warning)" /> Értékeld a szállítót
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Hogyan teljesített a szállító? Kattints a csillagokra és írd meg a véleményed.
          </p>
          <ReviewBox entityKey="job_id" entityId={id} onDone={loadAll} />
        </div>
      )}

      {/* Licitek */}
      {(job.status === 'pending' || job.status === 'bidding') && (
        <div className="card" style={{ marginTop: 16 }}>
          {job.paid_at && (
            <div
              style={{
                padding: 12,
                background: 'var(--success-light)',
                borderRadius: 8,
                border: '1px solid #86efac',
                fontSize: 13,
                marginBottom: 12,
                color: '#166534',
              }}
            >
              <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> <strong>Díjmentes újraválasztás:</strong> a kapcsolatfelvételi díjat
              már befizetted erre a fuvarra — az új szállító kiválasztása után nem kell
              újra fizetned, azonnal megkapod az elérhetőségét.
            </div>
          )}
          {/* Csak az aktív (pending) licitek választhatók — újranyitás után a
              leváltott szállító elutasított licitje nem fogadható el újra. */}
          <h2>Beérkezett ajánlatok ({bids.filter((b) => b.status === 'pending').length})</h2>
          {bids.filter((b) => b.status === 'pending').length === 0 && (
            <p className="muted">Még nincs ajánlat. A szállítók hamarosan ajánlatot tesznek.</p>
          )}
          {bids.filter((b) => b.status === 'pending').map((b) => (
            <div
              key={b.id}
              className={freshBids[b.id] ? 'bid-arrive' : undefined}
              style={{
                borderBottom: '1px solid var(--border)', padding: '16px 8px',
                // Friss (élőben érkezett) ajánlat: finom kék tint, ami a
                // jelvénnyel együtt fakul ki (transition mindig rajta van)
                background: freshBids[b.id] ? 'rgba(37,99,235,0.07)' : 'transparent',
                borderRadius: 12,
                transition: 'background 0.8s ease',
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href={`/profil/${b.carrier_id}`} className="row" style={{ gap: 12, alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
                  {/* Szállító avatar + info — kattintható profil */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--primary), var(--primary-light))',
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
                    <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {b.carrier_name || 'Szállító'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>→ profil</span>
                      {freshBids[b.id] && (
                        <span style={{
                          background: 'var(--primary)', color: '#fff',
                          fontSize: 'var(--fs-caption)', fontWeight: 800, letterSpacing: 0.4,
                          borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase',
                        }}>Új</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {(b.rating_avg ?? 0) > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
                          <Star size={12} color="var(--warning)" fill="var(--warning)" style={{ verticalAlign: -2 }} /> {Number(b.rating_avg).toFixed(1)}
                          {(b.rating_count ?? 0) > 0 && <span className="muted"> ({b.rating_count})</span>}
                        </span>
                      )}
                      {b.eta_minutes && <span className="muted" style={{ fontSize: 12 }}>~{b.eta_minutes} perc</span>}
                    </div>
                  </div>
                </Link>
                <div style={{ textAlign: 'right' }}>
                  {b.counter_amount_huf != null ? (
                    <>
                      <div className="muted" style={{ fontSize: 12, textDecoration: 'line-through' }}>
                        {b.amount_huf.toLocaleString('hu-HU')} Ft
                      </div>
                      <strong className="price" style={{ fontSize: 18 }}>{b.counter_amount_huf.toLocaleString('hu-HU')} Ft</strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {b.counter_by === 'shipper' ? 'ellenajánlatod' : <><RefreshCw size={11} style={{ verticalAlign: -1 }} /> a szállító ellenajánlata</>}
                      </div>
                    </>
                  ) : (
                    <strong className="price" style={{ fontSize: 18 }}>{b.amount_huf.toLocaleString('hu-HU')} Ft</strong>
                  )}
                </div>
              </div>
              {b.message && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13, paddingLeft: 52 }}>„{b.message}”</p>}
              <div style={{ paddingLeft: 52, marginTop: 8 }}>
                <ReturnPolicyBadge bid={b} />
              </div>
              {b.counter_by === 'shipper' && b.counter_amount_huf != null ? (
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                  <Hourglass size={13} style={{ verticalAlign: -2 }} /> Elküldted az ellenajánlatod ({b.counter_amount_huf.toLocaleString('hu-HU')} Ft) — a szállító válaszára vár.
                </p>
              ) : (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => acceptBid(b.id)}
                    disabled={acceptingBidId !== null}
                  >
                    {acceptingBidId === b.id
                      ? 'Elfogadás…'
                      : `Elfogadom${b.counter_by === 'carrier' && b.counter_amount_huf != null ? ` (${b.counter_amount_huf.toLocaleString('hu-HU')} Ft)` : ''}`}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setCounterTarget(b)}
                    disabled={acceptingBidId !== null}
                  >
                    Ellenajánlat
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lemondás-megerősítő dialógus */}
      <ConfirmDialog
        open={showCancelDialog}
        title="Fuvar lemondása"
        message={job.paid_at
          ? 'Biztosan lemondod a fuvart? A lemondás díjmentes, de a már befizetett kapcsolatfelvételi díj nem visszatérítendő és másik fuvarra nem vihető át. Ha csak a szállítóval van gond, válaszd inkább a "Másik szállítót választok" lehetőséget — az ingyenes.'
          : 'Biztosan lemondod a fuvart? Még nem történt fizetés, így semmilyen díj nincs.'}
        confirmLabel="Lemondom"
        danger
        fields={[{ key: 'reason', label: 'Indok (opcionális)', type: 'textarea', placeholder: 'pl. Már nem aktuális' }]}
        onConfirm={(v) => {
          setShowCancelDialog(false);
          cancelJob((v.reason || '').trim());
        }}
        onClose={() => setShowCancelDialog(false)}
      />

      {/* Szállító-csere dialógus */}
      <ConfirmDialog
        open={showReopenDialog}
        title="Másik szállítót választok"
        message="A fuvar újra ajánlatokat fogad: a korábbi ajánlatok újra elérhetők, és újak is érkezhetnek. A befizetett kapcsolatfelvételi díj erre a fuvarra érvényes marad — az új szállító kiválasztása díjmentes. A jelenlegi szállító értesítést kap."
        confirmLabel="Újranyitom"
        fields={[{ key: 'reason', label: 'Indok (opcionális)', type: 'textarea', placeholder: 'pl. A szállító nem veszi fel a telefont' }]}
        onConfirm={(v) => {
          setShowReopenDialog(false);
          reopenJob((v.reason || '').trim());
        }}
        onClose={() => setShowReopenDialog(false)}
      />

      {/* Vita-nyitó dialógus */}
      <ConfirmDialog
        open={showDisputeDialog}
        title="⚖️ Vitás eset megnyitása"
        message="Írd le röviden, mi a probléma a fuvarral — az admin ennek alapján vizsgálja ki az esetet, és értesítést kapsz a döntésről."
        confirmLabel="Vita megnyitása"
        fields={[{ key: 'desc', label: 'A probléma leírása', type: 'textarea', required: true, placeholder: 'pl. A csomag sérülten érkezett meg' }]}
        onConfirm={async (v) => {
          setShowDisputeDialog(false);
          try {
            await api.openDispute({ job_id: id, description: v.desc.trim() });
            toast.info('Vitás eset megnyitva', 'Az admin hamarosan felülvizsgálja.');
            loadAll();
          } catch (e: any) {
            toast.error('Hiba', e.message);
          }
        }}
        onClose={() => setShowDisputeDialog(false)}
      />

      {/* Ellenajánlat a szállító licitjére */}
      <ConfirmDialog
        open={!!counterTarget}
        title="Ellenajánlat küldése"
        message={counterTarget
          ? `A szállító ajánlata ${(counterTarget.counter_amount_huf ?? counterTarget.amount_huf).toLocaleString('hu-HU')} Ft. Add meg, mennyit ajánlasz — a szállító elfogadhatja vagy visszadobhat.`
          : ''}
        confirmLabel="Ellenajánlat elküldése"
        fields={[{ key: 'amount', label: 'Ellenajánlatod (Ft)', type: 'number', required: true, placeholder: 'pl. 15000' }]}
        onConfirm={(v) => {
          if (counterTarget) submitCounter(counterTarget.id, Number(v.amount));
          setCounterTarget(null);
        }}
        onClose={() => setCounterTarget(null)}
      />
    </div>
  );
}
