'use client';

// Szállító oldali fuvar részletek.
// - Térkép a felvétel/lerakodás pontokkal és (ha van) élő szállító pötty.
// - Csomag adatai (méret, súly, távolság).
// - Hirdetési fotók (a feladó által feltöltött képek).
// - Licit feladás: ár + opcionális érkezési idő + üzenet.
// - Ha a szállító már licitált, látja a licitjét és annak állapotát.
// - Ha a fuvar már az övé (accepted/in_progress), a CarrierTripPanel
//   intézi a végrehajtást a weben: felvétel-fotó → in_progress,
//   kézbesítés-fotó + 6 jegyű kód → delivered.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid, photoUrl } from '@/api';
import { MapPin, Flag, Star, RefreshCw, Hourglass, BadgeCheck, Banknote, Package, Phone } from 'lucide-react';
import { useCurrentUser } from '@/lib/auth';
import { aktivSajatAjanlat, lezarultSajatAjanlat } from '@/lib/ajanlat';
import { optionalPhoneError } from '@/lib/formValidation';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import MapCollapse from '@/components/MapCollapse';
import { idoablakSzoveg } from '@/lib/idoablak';
import FieldError, { redBorder } from '@/components/FieldError';
import SzamlaIgenyJelzes from '@/components/SzamlaIgenyJelzes';
import {
  sanitizeNumericInput, parseNumericInput, moneyFieldError, intFieldError,
} from '@/lib/formValidation';
import { getSocket, joinUserRoom, subscribeJob } from '@/lib/socket';
import { useToast } from '@/components/ToastProvider';
import ReviewBox from '@/components/ReviewBox';
import GreenBadge from '@/components/GreenBadge';
import ChatBox from '@/components/ChatBox';
import JobQuestions from '@/components/JobQuestions';
import DisputeButton from '@/components/DisputeButton';
import CarrierTripPanel from '@/components/CarrierTripPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading, ErrorState } from '@/components/StateView';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Elérhető',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const STATUS_PILL: Record<string, string> = {
  pending: 'pill-bidding', bidding: 'pill-bidding', accepted: 'pill-accepted',
  in_progress: 'pill-progress', delivered: 'pill-delivered', completed: 'pill-delivered',
  disputed: 'pill-accepted', cancelled: 'pill-cancelled',
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
  const [feeInfoDismissed, setFeeInfoDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('gofuvar_fee_info_dismissed') === '1';
  });
  const [bidEta, setBidEta] = useState('');
  const [bidMessage, setBidMessage] = useState('');
  // Sikertelen kézbesítés: visszaszállítási nyilatkozat (kötelező)
  const [returnPolicy, setReturnPolicy] = useState<'included' | 'extra_fee' | 'no' | ''>('');
  const [returnFee, setReturnFee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [acceptingCounter, setAcceptingCounter] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

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
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // `job:paid` realtime event — ha a feladó kifizette a fuvart, a szállító
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

  // Fuvar-szoba események: ha a feladó ellenajánlatot küld vagy elfogadnak,
  // azonnal frissítsünk (ne kelljen manuálisan újratölteni az alku közben).
  useEffect(() => {
    const unsub = subscribeJob(id, {
      onReconnect: () => load(),
      onPickedUp: () => load(),
      onDelivered: () => load(),
      onCountered: () => load(),
      onAccepted: () => load(),
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Mezőszintű hibajelzés — a fuvarfeladással AZONOS megjelenítés (tesztelői
  // kérés, 2026-08-15): piros keret + a mező alatt konkrét magyarázat.
  // Eddig csak egy eltűnő toast volt, ami nem mondta meg, MELYIK mező rossz.
  const [probaltMenteni, setProbaltMenteni] = useState(false);
  const dijHiba = moneyFieldError(parseNumericInput(bidAmount), { label: 'Ajánlott fuvardíj' });
  const etaHiba = bidEta.trim() === ''
    ? null
    : intFieldError(parseNumericInput(bidEta), { label: 'Érkezés a felvételre', min: 1, max: 10080 });
  const mutat = (h: string | null) => (probaltMenteni ? h : null);

  const [lassuKuldes, setLassuKuldes] = useState(false);
  // (D3, 2026-09-13) PHONE_REQUIRED: a telefonszám a formon belül kérhető be —
  // a profil-kitérő az űrlap tartalmát (üzenet, nyilatkozat) elvitte volna.
  const [telefonHiany, setTelefonHiany] = useState(false);
  const [telefon, setTelefon] = useState('');

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    setProbaltMenteni(true);
    const amount = parseInt(bidAmount, 10);
    if (dijHiba || etaHiba) {
      toast.error('Nézd át az űrlapot', 'A hibás mezők pirosan keretezve, alattuk a magyarázat.');
      return;
    }
    if (!returnPolicy) {
      toast.error('Hiányzó nyilatkozat', 'Nyilatkozz a sikertelen kézbesítés esetén történő visszaszállításról.');
      return;
    }
    let returnFeeNum: number | undefined;
    if (returnPolicy === 'extra_fee') {
      returnFeeNum = parseInt(returnFee, 10);
      if (!returnFeeNum || returnFeeNum <= 0) {
        toast.error('Hiányzó visszaszállítási díj', 'Add meg a visszaszállítás külön díját (Ft).');
        return;
      }
    }
    if (telefonHiany) {
      const hiba = telefon.trim() ? optionalPhoneError(telefon) : 'Add meg a telefonszámod — szállítóként kötelező.';
      if (hiba) { toast.error('Telefonszám szükséges', hiba); return; }
    }
    setSubmitting(true);
    // GF-003 UX (Manus 3. futás): lassú szervernél (cold start, 15+ mp) a
    // generikus „Küldés…" azt sugallta, elakadt — 8 mp után jelezzük, hogy
    // a kérés még él, csak a szerver lassú.
    const lassuTimer = setTimeout(() => setLassuKuldes(true), 8000);
    try {
      if (telefonHiany) {
        await api.updateMyProfile({ phone: telefon.trim() });
        setTelefonHiany(false);
      }
      await api.placeBid(id, {
        amount_huf: amount,
        eta_minutes: bidEta ? parseInt(bidEta, 10) : undefined,
        message: bidMessage || undefined,
        return_policy: returnPolicy,
        return_fee_huf: returnFeeNum,
      });
      toast.success('Ajánlat elküldve', `${amount.toLocaleString('hu-HU')} Ft`);
      setBidAmount('');
      setBidEta('');
      setBidMessage('');
      setReturnPolicy('');
      setReturnFee('');
      await load();
    } catch (err: any) {
      // GF-003 (Manus-regresszió, 2026-08-30): lassú szervernél a kliens
      // időkerete lejárhat, MIKÖZBEN a szerver az ajánlatot már rögzítette
      // (a bids-en UNIQUE (job_id, carrier_id) — duplikátum NEM jöhet létre,
      // de a felhasználó HAMIS hibát látott, és az újrapróbálás zavaros 409-et
      // adott). Időtúllépésnél ezért visszakérdezünk: beérkezett-e közben?
      const idotullepes = /nem válaszolt időben/i.test(err.message || '');
      if (idotullepes) {
        try {
          const enyem = (await api.myBids()).find(
            (b: any) => b.job_id === id && b.bid_status === 'pending',
          );
          if (enyem) {
            toast.success('Az ajánlatod beérkezett', 'A szerver lassan válaszolt, de az ajánlat rögzült — nem kell újraküldeni.');
            setBidAmount(''); setBidEta(''); setBidMessage(''); setReturnPolicy(''); setReturnFee('');
            await load();
            return;
          }
        } catch { /* ha a visszakérdezés is elhal, marad az eredeti hibaüzenet */ }
      }
      if (err?.code === 'PHONE_REQUIRED') {
        setTelefonHiany(true);
        toast.error('Telefonszám szükséges', 'Szállítóként kötelező a telefonszám — a feladó a díj után ezen ér el. Add meg lent, és küldd újra az ajánlatot.');
        return;
      }
      toast.error('Ajánlatküldési hiba', err.message);
    } finally {
      clearTimeout(lassuTimer);
      setLassuKuldes(false);
      setSubmitting(false);
    }
  }

  async function acceptShipperCounter(bidId: string) {
    setAcceptingCounter(true);
    try {
      await api.acceptCounter(bidId);
      toast.success('Megállapodás!', 'Elfogadtad a feladó ellenajánlatát. A feladó most fizet, utána indulhatsz.');
      await load();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    } finally {
      setAcceptingCounter(false);
    }
  }

  async function submitCounterBack(bidId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Hibás összeg', 'Adj meg egy pozitív összeget (Ft).');
      return;
    }
    try {
      await api.counterBid(bidId, Math.round(amount));
      toast.success('Ellenajánlat elküldve', 'A feladó értesítést kap róla.');
      await load();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!job) return <Loading />;

  const iAmTheCarrier = me?.id === job.carrier_id;
  const iAmTheShipper = me?.id === job.shipper_id;
  // (D3, 2026-09-13) Csak az ÉLŐ (pending/accepted) saját ajánlat tiltja az
  // űrlapot — a visszavont / elutasított mellett újra lehet ajánlatot tenni.
  const myBid = aktivSajatAjanlat(bids, me?.id);
  const lezarultAjanlat = lezarultSajatAjanlat(bids, me?.id);
  const kartyaAjanlat = myBid || lezarultAjanlat;
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
            <MapPin size={13} style={{ verticalAlign: -2 }} /> {job.pickup_address}
            {' → '}
            <Flag size={13} style={{ verticalAlign: -2 }} /> {job.dropoff_address}
          </p>
          {idoablakSzoveg(job.pickup_window_start, job.pickup_window_end) && (
            <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>
              🕒 Felvételi időablak: <strong>{idoablakSzoveg(job.pickup_window_start, job.pickup_window_end)}</strong>
            </p>
          )}
          {(job as any).recipient_name && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              <strong>Címzett:</strong> {(job as any).recipient_name}
              {(job as any).recipient_phone && (
                <> · <a href={`tel:${(job as any).recipient_phone}`} style={{ fontWeight: 700 }}>
                  <Phone size={12} style={{ verticalAlign: -1 }} /> {(job as any).recipient_phone}
                </a></>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={`pill ${STATUS_PILL[job.status] || 'pill-progress'}`}>{STATUS_LABEL[job.status] || job.status}</span>
          {/* Fizetés állapot — csak accepted+ státuszoknál érdekes.
              A szállító ebből látja, hogy a feladó már kifizette-e vagy sem. */}
          {iAmTheCarrier && ['accepted', 'in_progress', 'delivered'].includes(job.status) && (
            job.paid_at ? (
              <span
                className="pill"
                style={{
                  background: 'var(--success-light)',
                  color: '#166534',
                  border: '1px solid #86efac',
                  fontWeight: 700,
                }}
                title={`Díj fizetve: ${new Date(job.paid_at).toLocaleString('hu-HU')}`}
              >
                <BadgeCheck size={13} style={{ verticalAlign: -2 }} /> DÍJ FIZETVE — <Banknote size={13} style={{ verticalAlign: -2 }} /> fuvardíj közvetlenül a feladótól
              </span>
            ) : (
              <span
                className="pill"
                style={{
                  background: 'var(--warning-light)',
                  color: '#92400e',
                  border: '1px solid #fde68a',
                }}
                title="A feladó még nem fizette meg a kapcsolatfelvételi díjat — addig a munka nem kezdhető el."
              >
                <Hourglass size={13} style={{ verticalAlign: -2 }} /> Fizetésre vár
              </span>
            )
          )}
        </div>
      </div>

      {/* A FELADÓ ELÉRHETŐSÉGE — a kapcsolatfelvételi díj megfizetése után */}
      {job.paid_at && job.contact && (
        <div
          className="card"
          style={{
            marginTop: 16,
            background: 'var(--success-light)',
            border: '1px solid #86efac',
          }}
        >
          <div style={{ fontSize: 12, color: '#166534', fontWeight: 700, marginBottom: 6 }}>
            📞 A FELADÓ ELÉRHETŐSÉGE
          </div>
          <div style={{ fontWeight: 700 }}>{job.contact.name || 'Feladó'}</div>
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
            A fuvardíjat ({(job.accepted_price_huf ?? 0).toLocaleString('hu-HU')} Ft)
            <strong> közvetlenül a feladótól</strong> kapod — készpénzben vagy átutalással, ahogy megegyeztek; a GoFuvar nem von le belőle semmit.
          </div>
        </div>
      )}

      {/* Térkép — mobilon összecsukva (B2, GF-020) */}
      <MapCollapse>
        <LiveTrackingMap job={job} />
      </MapCollapse>

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

      {/* "Hozasd el" termékkép — a hirdetés előnézete, hogy a szállító lássa
          MIT kell elhoznia. Hotlink a bolt CDN-jéről → törött kép esetén
          az egész kártyát elrejtjük. */}
      {job.source_image_url && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>
            🛍️ A termék{job.source_store ? ` (${job.source_store})` : ''}
          </h2>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            A feladó hirdetés-linkjének előnézeti képe — tájékoztató jellegű.
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={job.source_image_url}
            alt="A hozandó termék előnézete"
            style={{
              maxWidth: '100%',
              maxHeight: 320,
              borderRadius: 8,
              border: '1px solid var(--border)',
              objectFit: 'contain',
              background: 'var(--bg)',
            }}
            onError={(e) => {
              const card = (e.currentTarget as HTMLImageElement).closest('.card') as HTMLElement | null;
              if (card) card.style.display = 'none';
            }}
          />
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
        </div>

        {/* A feladó számlát kér a fuvardíjról — ezt AJÁNLATTÉTEL ELŐTT kell
            látnia a szállítónak (magánszemély nem tud számlát adni). */}
        <SzamlaIgenyJelzes kert={(job as any).invoice_requested} nezet="szallito" />

        <div className="grid-2">
          {job.suggested_price_huf != null && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Javasolt fuvardíj</div>
              <strong className="price">{job.suggested_price_huf.toLocaleString('hu-HU')} Ft</strong>
            </div>
          )}
        </div>
        <GreenBadge distanceKm={job.distance_km} />
        {job.description && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Leírás a feladótól</div>
            <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{job.description}</div>
          </div>
        )}
      </div>

      {/* Bepakolás / cipelés infó — a szállítónak fontos látnia */}
      {((job as any).pickup_needs_carrying || (job as any).dropoff_needs_carrying) && (
        <div className="card" style={{
          marginTop: 12,
          borderLeft: '4px solid #FB8C00',
          background: 'rgba(251,140,0,0.08)',
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={16} /> Bepakolás / cipelés
          </h3>
          {(job as any).pickup_needs_carrying && (
            <div style={{ marginBottom: 6, fontSize: 14 }}>
              <strong>Felvételi hely:</strong> Bepakolás szükséges
              {' — '}
              {(job as any).pickup_floor == null ? 'emelet nincs megadva' : (job as any).pickup_floor === 0 ? 'Földszint' : `${(job as any).pickup_floor}. emelet`}
              {(job as any).pickup_floor > 0 && (
                (job as any).pickup_has_elevator
                  ? <span style={{ color: 'var(--success-text)', fontWeight: 700 }}> (lift van ✓)</span>
                  : <span style={{ color: 'var(--danger-text)', fontWeight: 700 }}> (NINCS lift! ⚠️)</span>
              )}
            </div>
          )}
          {(job as any).dropoff_needs_carrying && (
            <div style={{ fontSize: 14 }}>
              <strong>Lerakodási hely:</strong> Felvinni szükséges
              {' — '}
              {(job as any).dropoff_floor == null ? 'emelet nincs megadva' : (job as any).dropoff_floor === 0 ? 'Földszint' : `${(job as any).dropoff_floor}. emelet`}
              {(job as any).dropoff_floor > 0 && (
                (job as any).dropoff_has_elevator
                  ? <span style={{ color: 'var(--success-text)', fontWeight: 700 }}> (lift van ✓)</span>
                  : <span style={{ color: 'var(--danger-text)', fontWeight: 700 }}> (NINCS lift! ⚠️)</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Csomag deklarált értéke — ha megadta a feladó */}
      {(job as any).declared_value_huf && (
        <div className="card" style={{ marginTop: 12, fontSize: 14 }}>
          💰 <strong>Csomag deklarált értéke:</strong> {(job as any).declared_value_huf.toLocaleString('hu-HU')} Ft
        </div>
      )}

      {/* Saját poszt figyelmeztetés — ha a user a saját fuvarát nézi
          a szállító oldalról, ne hagyjuk licitálni. A feladói nézetet a
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
            A saját fuvaradra nem tehetsz ajánlatot. Az ajánlatok kezeléséhez nyisd meg a feladói nézetet.
          </p>
          <Link className="btn" href={`/dashboard/fuvar/${job.id}`}>
            Feladói nézet →
          </Link>
        </div>
      )}

      {/* Licit feladás vagy meglévő licit állapota */}
      {!iAmTheShipper && (job.status === 'pending' || job.status === 'bidding') && !myBid && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>{lezarultAjanlat ? 'Új ajánlat' : 'Ajánlattétel'}</h2>
          {lezarultAjanlat && (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              A korábbi ajánlatod {lezarultAjanlat.status === 'withdrawn' ? 'visszavontad' : 'lezárult'} — jobb feltételekkel újra ajánlatot tehetsz.
            </p>
          )}

          {/* Díj figyelmeztetés — egyszer megmutatjuk, utána "ne jelenjen meg többet" */}
          {!feeInfoDismissed && (
            <div
              style={{
                padding: 14,
                marginBottom: 16,
                borderRadius: 8,
                background: 'rgba(251,191,36,0.12)',
                border: '1px solid rgba(251,191,36,0.5)',
              }}
            >
              <strong style={{ fontSize: 14 }}>💰 Fontos az ajánlattétel előtt!</strong>
              <p style={{ fontSize: 13, margin: '8px 0 0', lineHeight: 1.5 }}>
                Az általad megadott összeg <strong>100%-ban a tiéd</strong>, és{' '}
                <strong>közvetlenül a feladótól</strong> kapod (készpénzben vagy átutalással, ahogy megegyeztek) — a GoFuvar semmit
                nem von le belőle. (A platform kapcsolatfelvételi díját a feladó
                fizeti.)
              </p>
              <p style={{ fontSize: 13, margin: '6px 0 0', lineHeight: 1.5 }}>
                Példa: ha 10.000 Ft-ot adsz meg → te <strong>10.000 Ft</strong>-ot kapsz, levonás nélkül.
              </p>
              <label
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  cursor: 'pointer',
                  marginTop: 12,
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      localStorage.setItem('gofuvar_fee_info_dismissed', '1');
                      setFeeInfoDismissed(true);
                    }
                  }}
                  style={{ width: 16, height: 16 }}
                />
                Megértettem, ne jelenjen meg többet
              </label>
            </div>
          )}

          <form noValidate onSubmit={submitBid}>
            <div className="grid-2">
              <div>
                <label htmlFor="ajanlat-dij">Ajánlott fuvardíj (Ft)</label>
                {/* `sanitizeNumericInput`: a mínuszjel BE SEM ÍRHATÓ. */}
                <input
                  id="ajanlat-dij"
                  className="input"
                  type="number"
                  min={1}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(sanitizeNumericInput(e.target.value))}
                  placeholder="pl. 58000"
                  title="Ennyiért vállalod a fuvart. Az összeget közvetlenül a feladótól kapod, levonás nélkül."
                  required
                  style={mutat(dijHiba) ? redBorder : undefined}
                />
                <FieldError>{mutat(dijHiba)}</FieldError>
              </div>
              <div>
                <label htmlFor="ajanlat-eta">Érkezés a felvételre (perc)</label>
                <input
                  id="ajanlat-eta"
                  className="input"
                  type="number"
                  min={1}
                  value={bidEta}
                  onChange={(e) => setBidEta(sanitizeNumericInput(e.target.value))}
                  placeholder="opcionális"
                  title="Hány perc múlva tudsz a felvételi címen lenni? Üresen hagyható."
                  style={mutat(etaHiba) ? redBorder : undefined}
                />
                <FieldError>{mutat(etaHiba)}</FieldError>
              </div>
            </div>
            {/* Élő kifizetés-előnézet — kápé, levonás nélkül */}
            {bidAmount && parseInt(bidAmount, 10) > 0 && (() => {
              const total = parseInt(bidAmount, 10);
              return (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'rgba(46,125,50,0.1)',
                    border: '1px solid rgba(46,125,50,0.3)',
                    fontSize: 13,
                    marginTop: 8,
                    marginBottom: 8,
                  }}
                >
                  Te kapsz: <strong style={{ color: 'var(--success-text)', fontSize: 16 }}>{total.toLocaleString('hu-HU')} Ft</strong>
                  {' '}— közvetlenül a feladótól, levonás nélkül
                </div>
              );
            })()}

            <label>Üzenet a feladónak</label>
            <textarea
              className="input"
              rows={2}
              value={bidMessage}
              onChange={(e) => setBidMessage(e.target.value)}
              placeholder="pl. Van rakodómunkás is"
            />

            {/* Sikertelen kézbesítés — visszaszállítási nyilatkozat (kötelező) */}
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 8,
                background: 'rgba(59,130,246,0.07)',
                border: '1px solid rgba(59,130,246,0.35)',
              }}
            >
              <strong style={{ fontSize: 14 }}>↩️ Sikertelen kézbesítés esetén</strong>
              <p style={{ fontSize: 13, margin: '6px 0 12px', lineHeight: 1.5, color: 'var(--muted)' }}>
                Ha a címzett <strong>nem veszi át</strong> a csomagot, vállalod-e, hogy
                <strong> 5 munkanapon belül visszajuttatod a feladóhoz?</strong>
              </p>
              {([
                { v: 'included', label: 'Igen, benne van az ajánlatomban' },
                { v: 'extra_fee', label: 'Igen, külön díj ellenében' },
                { v: 'no', label: 'Nem' },
              ] as const).map((opt) => (
                <label
                  key={opt.v}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    padding: '8px 10px', borderRadius: 6, marginBottom: 6, fontSize: 14,
                    border: '1px solid ' + (returnPolicy === opt.v ? 'var(--accent, var(--primary-light))' : 'var(--border)'),
                    background: returnPolicy === opt.v ? 'rgba(59,130,246,0.10)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="return_policy"
                    checked={returnPolicy === opt.v}
                    onChange={() => setReturnPolicy(opt.v)}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                  {opt.label}
                </label>
              ))}
              {returnPolicy === 'extra_fee' && (
                <div style={{ marginTop: 8 }}>
                  <label>Visszaszállítás külön díja (Ft)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={returnFee}
                    onChange={(e) => setReturnFee(sanitizeNumericInput(e.target.value))}
                    placeholder="pl. 3000"
                    title="Ennyiért viszed vissza a csomagot, ha a címzett nem veszi át."
                  />
                </div>
              )}
            </div>

            {telefonHiany && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid var(--warning, #f59e0b)' }}>
                <label htmlFor="ajanlat-telefon" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Telefonszámod (szállítóként kötelező)
                </label>
                <input
                  id="ajanlat-telefon"
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+36 30 123 4567"
                  value={telefon}
                  onChange={(e) => setTelefon(e.target.value)}
                  aria-invalid={!!(telefon.trim() && optionalPhoneError(telefon))}
                />
                <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                  A feladó a kapcsolatfelvételi díj után ezen ér el. Mentjük a profilodba, és az ajánlat ezzel együtt megy el.
                </p>
              </div>
            )}
            <button className="btn" type="submit" disabled={submitting} style={{ marginTop: 16 }}>
              {submitting
                ? (lassuKuldes ? 'A kérés még feldolgozás alatt — a szerver lassan válaszol…' : 'Küldés…')
                : telefonHiany ? 'Telefonszám mentése és ajánlat elküldése' : 'Ajánlat elküldése'}
            </button>
          </form>
        </div>
      )}

      {kartyaAjanlat && (
        <div className="card" style={{ marginTop: 16, background: 'var(--surface)' }}>
          <h2 style={{ marginTop: 0 }}>{myBid ? 'A te ajánlatod' : 'Korábbi ajánlatod'}</h2>
          {/* BUG-037: elfogadás után a MEGÁLLAPODOTT ár számít — ellenajánlatos
              alku után az eredeti licit-összeg tévesen többet ígért. */}
          {(() => {
            const agreed = kartyaAjanlat.status === 'accepted' && iAmTheCarrier && job.accepted_price_huf != null
              ? job.accepted_price_huf
              : (kartyaAjanlat.counter_amount_huf ?? kartyaAjanlat.amount_huf);
            return (
              <p>
                <strong className="price">{agreed.toLocaleString('hu-HU')} Ft</strong>
                {agreed !== kartyaAjanlat.amount_huf && (
                  <span className="muted" style={{ textDecoration: 'line-through', marginLeft: 8, fontSize: 13 }}>
                    {kartyaAjanlat.amount_huf.toLocaleString('hu-HU')} Ft
                  </span>
                )}
                {agreed !== kartyaAjanlat.amount_huf && (
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>(alku utáni ár)</span>
                )}
                {kartyaAjanlat.eta_minutes && <span className="muted"> · érkezés ~{kartyaAjanlat.eta_minutes} perc</span>}
              </p>
            );
          })()}
          <span className={`pill pill-${kartyaAjanlat.status === 'accepted' ? 'delivered' : 'bidding'}`}>
            {kartyaAjanlat.status === 'pending' && 'Várakozik elfogadásra'}
            {kartyaAjanlat.status === 'accepted' && 'Elfogadva 🎉'}
            {kartyaAjanlat.status === 'rejected' && 'Elutasítva'}
            {kartyaAjanlat.status === 'withdrawn' && 'Visszavonva'}
          </span>
          {kartyaAjanlat.message && (
            <p className="muted" style={{ marginTop: 8 }}>
              „{kartyaAjanlat.message}”
            </p>
          )}
          {kartyaAjanlat.return_policy && (
            <p style={{ marginTop: 8, fontSize: 13 }}>
              ↩️ Sikertelen kézbesítés esetén:{' '}
              <strong>
                {kartyaAjanlat.return_policy === 'included' && 'visszaszállítás benne van az ajánlatban'}
                {kartyaAjanlat.return_policy === 'extra_fee' && `visszaszállítás külön díjért (${(kartyaAjanlat.return_fee_huf ?? 0).toLocaleString('hu-HU')} Ft)`}
                {kartyaAjanlat.return_policy === 'no' && 'nem vállaltad a visszaszállítást'}
              </strong>
            </p>
          )}

          {/* Ellenajánlat-állapot + alku-akciók (csak amíg a licit nyitott) */}
          {kartyaAjanlat.status === 'pending' && kartyaAjanlat.counter_amount_huf != null && kartyaAjanlat.counter_by === 'shipper' && (
            <div className="callout callout-info" style={{ marginTop: 12, padding: 14 }}>
              <div style={{ fontSize: 14 }}>
                <RefreshCw size={13} style={{ verticalAlign: -2 }} /> A feladó ellenajánlata: <strong>{kartyaAjanlat.counter_amount_huf.toLocaleString('hu-HU')} Ft</strong>
                {' '}(a te ajánlatod {kartyaAjanlat.amount_huf.toLocaleString('hu-HU')} Ft volt)
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-success"
                  type="button"
                  disabled={acceptingCounter}
                  onClick={() => acceptShipperCounter(kartyaAjanlat.id)}
                >
                  {acceptingCounter ? 'Elfogadás…' : `Elfogadom (${kartyaAjanlat.counter_amount_huf.toLocaleString('hu-HU')} Ft)`}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setCounterOpen(true)} disabled={acceptingCounter}>
                  Ellenajánlat
                </button>
              </div>
            </div>
          )}
          {kartyaAjanlat.status === 'pending' && kartyaAjanlat.counter_amount_huf != null && kartyaAjanlat.counter_by === 'carrier' && (
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              <Hourglass size={13} style={{ verticalAlign: -2 }} /> Elküldted az ellenajánlatod ({kartyaAjanlat.counter_amount_huf.toLocaleString('hu-HU')} Ft) — a feladó válaszára vár.
            </p>
          )}
        </div>
      )}

      {/* Ellenajánlat visszaküldése a feladónak */}
      <ConfirmDialog
        open={counterOpen}
        title="Ellenajánlat küldése"
        message={myBid?.counter_amount_huf != null
          ? `A feladó ${myBid.counter_amount_huf.toLocaleString('hu-HU')} Ft-ot ajánlott. Add meg, mennyit kérsz — a feladó elfogadhatja vagy visszadobhat.`
          : ''}
        confirmLabel="Ellenajánlat elküldése"
        fields={[{ key: 'amount', label: 'Ellenajánlatod (Ft)', type: 'number', required: true, placeholder: 'pl. 18000' }]}
        onConfirm={(v) => {
          if (myBid) submitCounterBack(myBid.id, Number(v.amount));
          setCounterOpen(false);
        }}
        onClose={() => setCounterOpen(false)}
      />

      {/* A fuvar végrehajtása a weben: felvétel-fotó → in_progress,
          kézbesítés-fotó + 6 jegyű kód → delivered. */}
      {iAmTheCarrier && (['accepted', 'in_progress'].includes(job.status)
        || (job.status === 'disputed' && ['accepted', 'in_progress'].includes(job.status_before_dispute || ''))) && (
        <CarrierTripPanel jobId={id} status={job.status} statusBeforeDispute={job.status_before_dispute} paid={!!job.paid_at} onDone={load} />
      )}

      {/* Chat */}
      {['accepted', 'in_progress', 'delivered', 'completed', 'disputed'].includes(job.status) && job.carrier_id && (
        <div style={{ marginTop: 16 }}>
          <ChatBox entityKey="job_id" entityId={id} />
        </div>
      )}

      {/* Értékelés — delivered / completed állapotban */}
      {/* A 'disputed' is — lásd a feladói oldal azonos kommentjét. */}
      {(['delivered', 'completed'].includes(job.status)
        || (job.status === 'disputed' && (job as any).delivered_at)) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Star size={20} color="var(--warning)" fill="var(--warning)" /> Értékeld a feladót
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Hogyan ment a kommunikáció? Megvolt a csomag? Kattints a csillagokra.
          </p>
          <ReviewBox entityKey="job_id" entityId={id} onDone={() => load()} />
        </div>
      )}

      {/* Vita-nyitás gomb — csak in_progress/delivered/completed státuszban */}
      <DisputeButton jobId={id} status={job.status} paid={!!job.paid_at} />

      {/* Publikus Q&A — szállítóként itt kérdezhetek a feladótól */}
      <JobQuestions
        jobId={id}
        jobStatus={job.status}
        shipperId={job.shipper_id}
        currentUserId={me?.id}
      />

      {/* Összes beérkezett licit (referencia) */}
      {(job.status === 'pending' || job.status === 'bidding') && bids.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Eddigi ajánlatok ({bids.length})</h2>
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
                {b.carrier_id === me?.id ? 'Te' : 'Másik szállító'}
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
