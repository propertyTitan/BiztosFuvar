'use client';

import { kapcsolatfelvetelDijHuf, DIJ_SZABALY_SZOVEG, ft } from '@/lib/connectionFee';

// Egy konkrét fuvar nézete a feladó számára:
// - Élő követés Google Maps-en + Socket.IO szállító piros pötty
// - Licitek listája (ha még bidding)
// - Fotók (pickup / dropoff) — Proof of Delivery 2.0
// - Fizetési (escrow) állapot
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, Job, Bid, photoUrl } from '@/api';
import {
  MapPin, Flag, Star, RefreshCw, Hourglass, BadgeCheck, CheckCircle2, AlertTriangle, KeyRound,
  Camera, XCircle, ShieldCheck, Undo2, Truck, Scale, Copy,
} from 'lucide-react';
import LiveTrackingMap from '@/components/LiveTrackingMap';
import StatusPill from '@/components/StatusPill';
import { lezarasInfo } from '@/lib/statusz';
import { felvetelIdopont, rovidDatumIdo } from '@/lib/idopont';
import { ujrafeladasPiszkozat } from '@/lib/ujrafeladas';
import { mentPiszkozat, olvasPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';
import TesztFizetesSav from '@/components/TesztFizetesSav';
import SzamlaIgenyJelzes from '@/components/SzamlaIgenyJelzes';
import DijFizetesKartya from '@/components/DijFizetesKartya';
import { getSocket, joinUserRoom, subscribeJob } from '@/lib/socket';
import { useCurrentUser } from '@/lib/auth';
import { useToast } from '@/components/ToastProvider';
import ReviewBox from '@/components/ReviewBox';
import ChatBox from '@/components/ChatBox';
import JobQuestions from '@/components/JobQuestions';
import MapCollapse from '@/components/MapCollapse';
import DeliveryPin from '@/components/DeliveryPin';
import Confetti from '@/components/Confetti';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Loading, ErrorState } from '@/components/StateView';

// Az állapot-jelvény felirata és színe a közös lib/statusz.ts-ből jön
// (2026-10-08, UX-átvizsgálás A12) — a helyi lista kivezetve.

// Sikertelen kézbesítés esetén történő visszaszállítás — jelvény a licit-soron.
// Így a feladó összehasonlíthatja a szállítókat a visszaszállítási hajlandóság szerint.
// 2026-10-08 (Q6): a magyarázat eddig CSAK tooltipben volt — mobilon nem
// működik —, most látható sor a jelvény mellett; emoji helyett lucide ikon.
function ReturnPolicyBadge({ bid }: { bid: Bid }) {
  if (!bid.return_policy) return null;
  const map = {
    included: {
      text: 'Visszaszállítás: benne az árban', tint: 'rgba(22,163,74,0.12)', ikon: <Undo2 size={12} aria-hidden />,
      magyarazat: 'Ha a kézbesítés meghiúsul, 5 munkanapon belül külön díj nélkül visszaviszi hozzád.',
    },
    extra_fee: {
      text: `Visszaszállítás: +${(bid.return_fee_huf ?? 0).toLocaleString('hu-HU')} Ft`,
      tint: 'rgba(217,119,6,0.14)', ikon: <Undo2 size={12} aria-hidden />,
      magyarazat: 'Ha a kézbesítés meghiúsul, ennyiért 5 munkanapon belül visszaviszi hozzád.',
    },
    no: {
      text: 'Nincs visszaszállítás', tint: 'rgba(220,38,38,0.10)', ikon: <AlertTriangle size={12} aria-hidden />,
      magyarazat: 'Ha a kézbesítés meghiúsul, a csomag visszaszállítását nem vállalja.',
    },
  } as const;
  const s = map[bid.return_policy];
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <span
        className="pill"
        style={{ background: s.tint, color: 'var(--text)', fontWeight: 700, fontSize: 11 }}
      >
        {s.ikon} {s.text}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>{s.magyarazat}</span>
    </span>
  );
}

/** A fotó-típusok magyar neve (A20: eddig a „damage"/„document" nyersen látszott). */
const FOTO_TIPUS: Record<string, string> = {
  pickup: 'Felvétel', dropoff: 'Lerakodás', damage: 'Kár', document: 'Dokumentum', listing: 'Hirdetés',
};

/** Másodlagos művelet (szállító-csere, lemondás): szöveges gomb, nem a fő gomb mása. */
const MASODLAGOS_GOMB: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 0',
  color: 'var(--text-secondary)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
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
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
  // Élőben (Socket.IO) érkezett ajánlatok id-i: belépő animáció + „ÚJ"
  // jelvény, ami ~10 mp után magától elhalványul. A timereket unmountkor
  // takarítjuk.
  const [freshBids, setFreshBids] = useState<Record<string, boolean>>({});
  const freshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // A díjfizetés (consent, kupon, stub, CIB-átirányítás, hibakódok) a közös
  // DijFizetesKartya komponensben él (CIB PR-3) — az eredményoldal is azt
  // használja újrapróbához, így a két felület nem csúszhat szét.

  // Dialógus-állapotok (window.confirm/prompt kiváltva)
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  // „Újra feladom" (A21): ha már van félbehagyott feladás, előbb rákérdezünk.
  const [showUjraDialog, setShowUjraDialog] = useState(false);
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
      toast.success('Fuvar újranyitva', job.paid_at
        ? 'A korábbi ajánlatok újra elérhetők — díjmentesen választhatsz másik szállítót.'
        : 'A korábbi ajánlatok újra elérhetők — választhatsz másik szállítót.');
      await loadAll();
    } catch (e: any) {
      toast.error('Szállító-csere sikertelen', e.message);
    }
  }

  // „Újra feladom" (2026-10-08, A21): a lemondott fuvar adataiból a
  // fuvarfeladás MEGLÉVŐ piszkozatát töltjük, és az űrlapra lépünk — az
  // űrlap betöltéskor visszaállítja. Egy félbehagyott feladást nem írunk
  // felül szó nélkül.
  function ujraFeladom(felulir = false) {
    if (!job || !user) return;
    const kulcs = piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, user.id);
    if (!felulir && olvasPiszkozat(kulcs)) { setShowUjraDialog(true); return; }
    if (!mentPiszkozat(kulcs, ujrafeladasPiszkozat(job))) {
      toast.error('Nem sikerült előkészíteni', 'A böngésző nem engedi az űrlap-piszkozat mentését — add fel kézzel az új fuvart.');
      return;
    }
    router.push('/dashboard/uj-fuvar');
  }

  async function loadAll() {
    try {
      const [j, b, p] = await Promise.all([
        api.getJob(id),
        api.listBids(id),
        api.listPhotos(id),
      ]);
      setJob(j); setBids(b); setPhotos(p);
      setError(null);
      if (initialStatusRef.current === null) initialStatusRef.current = j.status;
    } catch (err: any) { setError(err.message); }
  }

  useEffect(() => { loadAll(); }, [id]);

  // Real-time: ha érkezik új fotó vagy státuszváltás, frissítünk
  useEffect(() => {
    const unsub = subscribeJob(id, {
      onReconnect: () => loadAll(),
      onUpdated: () => loadAll(),
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

  async function acceptBid(bid: Bid) {
    if (acceptingBidId) return;
    setAcceptingBidId(bid.id);
    try {
      await api.acceptBid(bid);
      toast.success('Ajánlat elfogadva', 'Fizesd meg a kapcsolatfelvételi díjat — utána megkapod a szállító elérhetőségét, a fuvardíjat pedig közvetlenül neki fizeted (készpénzben vagy átutalással, ahogy megegyeztek).');
      await loadAll();
    } catch (err: any) {
      toast.error('Hiba az ajánlat elfogadásakor', err.message);
      if (['OFFER_CHANGED', 'JOB_TERMS_CHANGED'].includes(err.code)) await loadAll();
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

  const bizonyitekFotok = photos.filter((p) => p.kind !== 'listing');
  const fuggoAjanlatok = bids.filter((b) => b.status === 'pending');
  // A díj a választásnál dől el (2026-09-10): ha minden függő ajánlat ugyanabba
  // a sávba esik, EGYSZER mondjuk ki a lista tetején; eltérésnél a kártyán is
  // ott áll az a díj, ami eltér a legolcsóbbtól (Q6).
  const ajanlatDijak = fuggoAjanlatok.map((b) => kapcsolatfelvetelDijHuf(b.counter_amount_huf ?? b.amount_huf));
  const egyforma = ajanlatDijak.length > 0 && ajanlatDijak.every((d) => d === ajanlatDijak[0]);
  const legkisebbDij = ajanlatDijak.length ? Math.min(...ajanlatDijak) : 0;

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
        <StatusPill job={job} />
      </div>

      {/* Élő követés — mobilon összecsukva (B2, GF-020). A feladói nézetben
          alacsonyabb térkép (A17): a lap legnagyobb eleme ne a térkép legyen. */}
      <MapCollapse title="Térkép és élő követés">
        <LiveTrackingMap job={job} magassag="280px" />
      </MapCollapse>

      {/* Átvételi kód a feladónak.
          KÉT ESET, és korábban csak az egyikre volt jó szöveg:
          (1) MÁS veszi át → ez egy VÉSZHELYZETI kód: csak akkor adható a
              szállítónak, ha a címzett nem elérhető. A backend elfogadja, és
              naplózza, hogy ezzel zárult (photos.js: 'sender_emergency').
          (2) A FELADÓ veszi át (nincs címzett megadva) → ez egyszerűen AZ
              átvételi kódja, semmi vészhelyzet. A „Nem én veszem át"
              checkbox bevezetése óta ez az ALAPESET.
          Korábban a (2) esetben is a riasztó piros „🆘 Vészhelyzeti kód"
          kártya jelent meg azzal a szöveggel, hogy „a címzett SMS-ben
          megkapta" — pedig nincs is címzett. A normál kódot mutató ág pedig
          halott kód volt: a scrub a feladótól MINDIG elveszi a címzett
          `delivery_code`-ját, a `sender_delivery_code` viszont mindig
          létezik, így a feltétele sosem teljesült. */}
      {/* ⚠️ CSAK elfogadás után (2026-08-21, Manus-teszt): a kód eddig már
          az AJÁNLATVÁRÓ állapotban is látszott — ott még szállító sincs,
          a kódnak semmi szerepe, csak zavart keltett. A kód akkor kell,
          amikor a kézbesítés valóban közeleg. */}
      {/* ⚠️ CSAK a díj kifizetése után (GF-010, user-döntés 2026-08-30):
          a backend-scrub fizetés előtt már ki sem adja a kódot — ez a
          feltétel a védelem UI-tükre (a felvétel úgyis paid_at mögött van,
          a kódnak előtte semmi szerepe). */}
      {(job as any).sender_delivery_code && job.paid_at
        && ['accepted', 'in_progress'].includes(job.status === 'disputed' ? (job.status_before_dispute || '') : job.status) && (() => {
        const vanCimzett = Boolean(job.recipient_name || job.recipient_phone);
        const kod = (job as any).sender_delivery_code as string;
        return (
          <div
            className="card"
            style={{
              marginTop: 16,
              background: vanCimzett
                ? 'linear-gradient(135deg, #92400e 0%, #b45309 100%)'
                : 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
              color: '#fff',
              border: 'none',
              textAlign: vanCimzett ? undefined : 'center',
            }}
          >
            <div
              style={{
                fontSize: 12, opacity: 0.9, textTransform: 'uppercase', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
                justifyContent: vanCimzett ? 'flex-start' : 'center',
              }}
            >
              {vanCimzett ? <AlertTriangle size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}
              {vanCimzett
                ? 'Vészhelyzeti kód (csak ha a címzett nem elérhető!)'
                : 'Átvételi kódod'}
            </div>

            {vanCimzett ? (
              <div
                style={{
                  fontSize: 36, fontWeight: 800, letterSpacing: '0.15em',
                  fontFamily: 'monospace', textAlign: 'center', padding: '12px 0',
                }}
              >
                {kod}
              </div>
            ) : (
              <DeliveryPin code={kod} />
            )}

            {/* A szöveg az állapotot követi (2026-10-08, UX-átvizsgálás A2):
                a címzett az SMS-t a FELVÉTELKOR kapja (1 db SMS-modell), nem a
                díj kifizetésekor — eddig a felvétel előtt is azt írtuk, hogy
                „megkapta". És mindkét esetben kimondjuk: a kódot csak
                átadáskor szabad megadni — a felvételkor kiadott kóddal a
                szállító kézbesítés nélkül lezárhatná a fuvart. */}
            {vanCimzett ? (
              <>
                <div style={{ fontSize: 13, opacity: 0.95, marginTop: 8, lineHeight: 1.5 }}>
                  Ezt a kódot <strong>CSAK</strong> akkor add meg a szállítónak, ha a címzett
                  nem elérhető, és te engedélyezed a lerakást — a rendszer rögzíti, hogy a
                  fuvar a vészhelyzeti kóddal zárult.
                </div>
                <div style={{
                  marginTop: 12, padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.15)', fontSize: 12, lineHeight: 1.5,
                }}>
                  {(job.status === 'disputed' ? job.status_before_dispute : job.status) === 'in_progress'
                    ? `A címzett a saját átvételi kódját a felvételkor megkapta SMS-ben${job.recipient_email ? ' és e-mailben' : ''}.`
                    : `A címzett a saját átvételi kódját a felvételkor kapja meg SMS-ben${job.recipient_email ? ' és e-mailben' : ''}.`}
                  {' '}Csak az átadáskor kell megadnia a szállítónak.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, opacity: 0.95, marginTop: 16, lineHeight: 1.5 }}>
                Te veszed át a csomagot. Ezt az átvételi kódot csak akkor mondd meg a
                szállítónak, amikor a csomag már nálad van — a felvételkor ne.
              </div>
            )}
          </div>
        );
      })()}

      {/* A lezárás módja (2026-10-08, UX-átvizsgálás A1): a vészhelyzeti
          figyelmeztetés CSAK külön címzettnél jár — címzett nélkül (ez az
          alapeset) a feladó saját kódja AZ átvételi kód, és eddig minden
          ilyen sikeres kézbesítésen hamis „vészhelyzeti" sáv állt. */}
      {(() => {
        const info = lezarasInfo(job);
        if (!info) return null;
        if (info.tipus === 'veszhelyzeti') {
          return (
            <div
              className="card"
              role="note"
              style={{
                marginTop: 16, background: 'rgba(217,119,6,0.10)', borderColor: 'rgba(217,119,6,0.5)',
                borderLeft: '4px solid #d97706', color: 'var(--text)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={18} aria-hidden style={{ flexShrink: 0, color: '#b45309', marginTop: 2 }} />
              <span>
                <strong>Ez a fuvar a te vészhelyzeti kódoddal zárult le</strong>, nem a címzett
                átvételi kódjával. Vita esetén ez az információ rendelkezésre áll.
              </span>
            </div>
          );
        }
        const mikor = rovidDatumIdo(job.delivered_at);
        return (
          <p
            data-testid="kezbesites-lezaras"
            style={{
              marginTop: 16, marginBottom: 0, display: 'flex', gap: 8, alignItems: 'center',
              color: 'var(--success-text)', fontWeight: 600, fontSize: 14,
            }}
          >
            <CheckCircle2 size={16} aria-hidden style={{ flexShrink: 0 }} />
            <span>
              Kézbesítve{mikor ? `: ${mikor}` : ''}
              {info.kodja === 'sajat' ? ' — az átvételi kódoddal lezárva.'
                : info.kodja === 'cimzett' ? ' — a címzett átvételi kódjával lezárva.' : '.'}
            </span>
          </p>
        );
      })()}

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
                <strong>{Number(job.volume_m3).toLocaleString('hu-HU', { maximumFractionDigits: 2 })} m³</strong>
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

      {/* ── KAPCSOLATFELVÉTELI DÍJ — a lap fő eleme (2026-10-08, UX-átvizsgálás Q8) ──
          Ez az egyetlen bevételi pont: a díj legyen azonnal leolvasható (32 px),
          a kártya nevezze meg, KINEK a megállapodásáról van szó, a fizetés gombja
          legyen a fő gomb, a másodlagos műveletek (szállító-csere, lemondás) pedig
          egy elválasztó alatt, szövegként. A díj előtti „Fizetés" kártya és a
          mellette álló üres bizonyíték-kártya eddig egyforma súllyal állt. */}
      <div className="card" style={{ marginTop: 16 }} data-testid="kapcsolatfelveteli-dij-kartya">
        <h2
          style={{
            margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: 0.6,
            textTransform: 'uppercase', color: 'var(--text-secondary)',
          }}
        >
          Kapcsolatfelvételi díj · bevezető ár
        </h2>

        {job.status === 'cancelled' ? (
          // Lemondott fuvar (A21): eddig egyszerre állt itt, hogy „elfogadás után
          // itt fizeted a díjat", és hogy „le lett mondva".
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
              <XCircle size={20} aria-hidden style={{ flexShrink: 0, color: 'var(--danger-text)', marginTop: 1 }} />
              <div>
                <strong>Lemondva{job.cancelled_at ? `: ${rovidDatumIdo(job.cancelled_at)}` : ''}.</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                  {!job.paid_at
                    ? 'Díjat nem fizettél, pénzmozgás nem történt.'
                    : (job.connection_fee_huf ?? 0) === 0
                      ? 'A kapcsolatfelvételt az ajánlói jutalmad fedezte — másik fuvarra nem vihető át.'
                      : 'A befizetett kapcsolatfelvételi díj nem jár vissza, és másik fuvarra nem vihető át (ÁSZF 4.1).'}
                </p>
              </div>
            </div>
            {user?.id === job.shipper_id && (
              <div style={{ marginTop: 14 }}>
                <button type="button" className="btn btn-secondary" onClick={() => ujraFeladom()}>
                  <Copy size={14} aria-hidden /> Újra feladom
                </button>
                <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                  Az új feladás űrlapját ennek a fuvarnak az adataival töltjük ki — az időpontot
                  és az árat a feladás előtt módosíthatod.
                </p>
              </div>
            )}
          </>
        ) : !(job.status === 'accepted' || job.paid_at) ? (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Még nincs elfogadott ajánlat — elfogadás után itt fizeted a kapcsolatfelvételi díjat ({DIJ_SZABALY_SZOVEG}).
          </p>
        ) : (
          <>
            {/* Csak akkor jelenik meg, ha a szerver TESZT-ÜZEMBEN fut
                (ALLOW_STUB_PAYMENTS) — lásd a komponens fejlécét. */}
            <TesztFizetesSav />
            <div
              style={{
                fontSize: 32, fontWeight: 800, lineHeight: 1.2, marginTop: 6,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
              }}
            >
              {ft(job.connection_fee_huf ?? 0)} Ft
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              Fuvardíj: <strong>{ft(job.accepted_price_huf ?? 0)} Ft</strong> — közvetlenül a szállítónak,
              készpénzben vagy átutalással, ahogy megegyeztek.
            </p>

            {/* A kiválasztott szállító (Q8): a kártya megmondja, kinek a
                kapcsolatát nyitja meg a díj. */}
            {!job.paid_at && (() => {
              const valasztott = bids.find((b) => b.status === 'accepted' && b.carrier_id === job.carrier_id);
              if (!valasztott) return null;
              return (
                <div
                  style={{
                    marginTop: 14, padding: 12, borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--surface)',
                  }}
                >
                  <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Kiválasztott szállító</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div
                      aria-hidden
                      style={{
                        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                        background: 'linear-gradient(135deg, var(--primary), var(--primary-light))',
                        color: '#fff', fontWeight: 800, fontSize: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {(valasztott.carrier_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/profil/${valasztott.carrier_id}`} style={{ fontWeight: 700 }}>
                        {valasztott.carrier_name || 'Szállító'}
                      </Link>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        {(valasztott.rating_count ?? 0) > 0 ? (
                          <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                            <Star size={12} color="var(--warning)" fill="var(--warning)" style={{ verticalAlign: -2 }} />{' '}
                            {Number(valasztott.rating_avg).toFixed(1)} <span className="muted">({valasztott.rating_count})</span>
                          </span>
                        ) : (
                          <span className="muted">Új szállító — még nincs értékelése</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {valasztott.message && (
                    <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>„{valasztott.message}”</p>
                  )}
                </div>
              );
            })()}

            {/* Fizetés állapot: FIZETVE címke, vagy Fizetés gomb.
                A /pay endpoint lusta (ha nincs még fizetés-sor, most
                hozza létre), úgyhogy a gomb akkor is működik, ha az
                nem jött létre az accept során. */}
            {job.paid_at ? (
              <div
                style={{
                  marginTop: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(22,163,74,0.12)',
                  color: 'var(--success-text)',
                  padding: '10px 18px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 14,
                  border: '1px solid rgba(22,163,74,0.45)',
                }}
                title={`Fizetve: ${new Date(job.paid_at).toLocaleString('hu-HU')}`}
              >
                <BadgeCheck size={14} aria-hidden /> DÍJ FIZETVE
              </div>
            ) : job.status === 'accepted' ? (
              // A consent-label (FeeConsentLabel, 2026-08-18: a tesztelőnél
              // a szöveg betűnként tört) és a teljes fizetés-indítás a közös
              // kártyában. CIB-módban a banki kötelező blokk is itt jelenik meg.
              <DijFizetesKartya
                jobId={id}
                feeHuf={job.connection_fee_huf}
                onFrissites={loadAll}
                zaroMondat={
                  <>
                    ha a fuvar a szállító hibájából hiúsul meg, díjmentesen
                    választhatok másik szállítót ugyanerre a fuvarra.
                  </>
                }
              />
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
                  Ne feledd: a fuvardíjat ({(job.accepted_price_huf ?? 0).toLocaleString('hu-HU')} Ft)
                  közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek.
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Másodlagos műveletek — elválasztó alatt, szövegként (Q8) ── */}
        {/* Szerkesztés (2026-09-11, B3): amíg nincs elfogadott ajánlat, a cím,
            a leírás és az ajánlott ár javítható — nem kell lemondani + újrafeladni. */}
        {['bidding', 'pending'].includes(job.status) && (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowEditDialog(true)} style={{ fontSize: 12 }}>
              ✏️ Hirdetés szerkesztése
            </button>
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Cím, leírás és ajánlott ár — a függő ajánlattevők értesítést kapnak a változásról.
            </p>
          </div>
        )}

        {/* Szállító-csere — ha a szállító nem elérhető, díjmentes újraválasztás */}
        {job.status === 'accepted' && user?.id === job.shipper_id && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setShowReopenDialog(true)} style={MASODLAGOS_GOMB}>
              <RefreshCw size={13} aria-hidden style={{ verticalAlign: -2 }} /> Másik szállítót választok
            </button>
            {/* 2026-10-04 (CIB PR-5, végső kör): fizetetlen fuvaron eddig is
                „a befizetett díj érvényes marad" állt — a szöveg a paid_at-hez igazodik. */}
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {job.paid_at ? (
                <>
                  Ha a szállító nem elérhető vagy visszalépett: a korábbi ajánlatok újra
                  elérhetővé válnak, és díjmentesen választhatsz — a befizetett díj erre
                  a fuvarra érvényes marad.
                </>
              ) : (
                <>
                  Ha a szállító nem elérhető vagy visszalépett: a korábbi ajánlatok újra
                  elérhetővé válnak, és másik szállítót választhatsz. A kapcsolatfelvételi
                  díjat az új szállító kiválasztása után fizeted.
                </>
              )}
            </p>
          </div>
        )}

        {/* Lemondás — ha a fuvar még lemondható.
            ⚠️ A 'disputed' IS kizárt (2026-08-21, Manus-teszt): a szerver
            már tiltotta (409), de a gomb látszott — vitatott állapotban a
            lemondás azt sugallta volna, hogy ki lehet lépni a vita alól. */}
        {!['in_progress', 'delivered', 'completed', 'cancelled', 'disputed'].includes(job.status) && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setShowCancelDialog(true)}
              style={{ ...MASODLAGOS_GOMB, color: 'var(--danger-text)' }}
            >
              Fuvar lemondása
            </button>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              A lemondás díjmentes. {job.paid_at ? 'A már befizetett kapcsolatfelvételi díj nem visszatérítendő és másik fuvarra nem vihető át.' : 'Pénzmozgás még nem történt.'}
            </p>
          </div>
        )}
      </div>

      {/* Visszaigazolás: a feladó látja, hogy a számla-kérése átment, és
          hogy azt a SZÁLLÍTÓ teljesíti, nem a platform.
          ⚠️ SZÁNDÉKOSAN A FIZETÉSI KÁRTYÁN KÍVÜL: a fuvardíj számlájáról
          szól, nem a kapcsolatfelvételi díjról. A kártyán belül úgy tűnne,
          mintha a platform díjáról lenne szó. */}
      <div style={{ marginTop: 16 }}>
        <SzamlaIgenyJelzes kert={(job as any).invoice_requested} nezet="felado" />
      </div>

      {/* Bizonyíték-fotók (a szállítótól). Üresen egysoros helykitöltő
          (Q8/A20): a felvétel előtt az ugyanakkora, üres kártya a díj-kártya
          mellett elvitte a figyelmet; ajánlatváró és lemondott fuvaron el sem
          jelenik meg. */}
      {bizonyitekFotok.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Bizonyíték-fotók (szállító)</h2>
          {bizonyitekFotok.map((p) => (
            <div key={p.id} style={{ marginBottom: 12 }}>
              <strong>{FOTO_TIPUS[p.kind] || 'Fotó'}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {new Date(p.taken_at).toLocaleString('hu-HU')}
                {p.gps_lat && ` · ${p.gps_lat.toFixed(5)}, ${p.gps_lng?.toFixed(5)}`}
              </div>
              {p.url && (
                <img
                  src={photoUrl(p.url)}
                  alt={`${FOTO_TIPUS[p.kind] || 'Bizonyíték'} fotó`}
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
      ) : !['pending', 'bidding', 'cancelled'].includes(job.status) ? (
        <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Camera size={14} aria-hidden style={{ flexShrink: 0 }} />
          Még nincs felvételi vagy lerakodási fotó. A szállító a felvételkor fotózza le a csomagot.
        </p>
      ) : null}

      {/* Vita folyamatban — TARTÓS jelzés (2026-08-21, Manus-teszt: a vita
          megnyitása után csak egy pár másodperces toast szólt; aki azt
          elmulasztotta, nem tudta, létrejött-e a vita). */}
      {job.status === 'disputed' && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--warning, #d97706)', background: 'rgba(217,119,6,0.08)' }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Scale size={20} aria-hidden /> Vita folyamatban
          </h2>
          {/* 2026-10-08 (A13): a határidő az ÁSZF 7. pontjából — eddig a
              kártya nem mondta meg, meddig kell várni. */}
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            A vitát megkaptuk. Az ügyfélszolgálat átnézi a fotókat és az üzeneteket, és
            legkésőbb 14 munkanapon belül írásban jelentkezik. A fuvar fotói a vita
            idejére bizonyítékként zárolva vannak. A vita lezárásáig a fuvar nem
            mondható le.
          </p>
        </div>
      )}

      {/* Vita indítása — in_progress vagy delivered státuszban,
          ha valami baj van a csomaggal / szállítással / szállítóval. */}
      {['in_progress', 'delivered', 'completed'].includes(job.status) && (
        <div className="card" style={{ marginTop: 16, background: '#fefce8', borderColor: 'var(--warning)' }}>
          <h2 style={{ marginTop: 0 }}>Probléma van a fuvarral?</h2>
          {/* Átfogalmazva (2026-08-16, tesztelői kérés). A régi szöveg rögtön
              a vitával kezdte — az új előbb az egyeztetésre terel (a legtöbb
              gond ott megoldódik), és megmondja, mi történik a vita után. */}
          <p className="muted" style={{ marginBottom: 12 }}>
            Előbb mindig a szállítóval egyeztess — a legtöbb kérdés (késés,
            időpont-csúszás) a beszélgetésben megoldódik. Ha a csomag sérült,
            elveszett, vagy nem tudtok megegyezni, nyiss vitás esetet: ilyenkor
            az ügyfélszolgálat átnézi a fotókat és az előzményeket, és
            közvetít a megoldásban. A fuvar fotói a vita idejére zárolásra
            kerülnek, bizonyítékként.
          </p>
          <button
            type="button"
            className="btn"
            style={{ background: '#d97706', border: 'none' }}
            onClick={() => setShowDisputeDialog(true)}
          >
            <Scale size={16} aria-hidden /> Vitás esetet nyitok
          </button>
        </div>
      )}

      {/* Vita: EGY út (2026-09-11, teljes audit B2) — a fenti „Probléma van a
          fuvarral?" kártya + dialógus. A korábbi második gomb (DisputeButton)
          és a második „folyamatban" doboz összevonva. Őr: vita-ui.test.ts. */}

      {/* Publikus Q&A — bárki kérdezhet, csak a feladó válaszolhat */}
      <JobQuestions
        jobId={id}
        jobStatus={job.status}
        shipperId={job.shipper_id}
        currentUserId={user?.id}
      />

      {/* Chat — az elfogadott licittől kezdve a feladó és a szállító
          üzenhetnek egymásnak, telefonszám-csere nélkül. */}
      {['accepted', 'in_progress', 'delivered', 'completed', 'disputed'].includes(job.status) && job.carrier_id && (
        <div style={{ marginTop: 16 }}>
          <ChatBox entityKey="job_id" entityId={id} partner="szallito" dijFizetve={Boolean(job.paid_at)} />
        </div>
      )}

      {/* Értékelés — delivered / completed állapotban */}
      {/* A 'disputed' is szerepel (2026-08-21, Manus-teszt): a kézbesítés
          utáni vita elrejtette az értékelést — pedig az élmény pont ilyenkor
          a legfontosabb visszajelzés. A vita és az értékelés két külön
          csatorna. */}
      {(['delivered', 'completed'].includes(job.status)
        || (job.status === 'disputed' && (job as any).delivered_at)) && (
        <div className="card" style={{ marginTop: 16 }}>
          <ReviewBox
            entityKey="job_id"
            entityId={id}
            onDone={loadAll}
            cim="Értékeld a szállítót"
            kerdes="Hogyan teljesített a szállító? Kattints a csillagokra, és írd meg a véleményed."
            vitaNyitott={job.status === 'disputed'}
          />
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
          <h2>Beérkezett ajánlatok ({fuggoAjanlatok.length})</h2>
          {fuggoAjanlatok.length === 0 && (
            <p className="muted">Még nincs ajánlat. A szállítók hamarosan ajánlatot tesznek.</p>
          )}
          {fuggoAjanlatok.length > 0 && (
            // (Q6) Igaz állítás: ajánlatot csak igazolt személyazonosságú
            // szállító tehet (POST /jobs/:id/bids — requireDriverKYC).
            <div style={{ display: 'grid', gap: 4, margin: '0 0 8px', fontSize: 13 }}>
              <p style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                <ShieldCheck size={15} aria-hidden style={{ color: 'var(--success-text)', flexShrink: 0 }} />
                Minden ajánlattevő igazolta a személyazonosságát.
              </p>
              {!job.paid_at && (
                <p className="muted" style={{ margin: 0 }}>
                  {egyforma
                    ? <>Bármelyiket választod: <strong>{ft(ajanlatDijak[0])} Ft</strong> kapcsolatfelvételi díj (bevezető ár, nem visszatérítendő).</>
                    : <>Kapcsolatfelvételi díj: {DIJ_SZABALY_SZOVEG}.</>}
                </p>
              )}
            </div>
          )}
          {fuggoAjanlatok.map((b) => (
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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(b.rating_count ?? 0) > 0 && (b.rating_avg ?? 0) > 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
                          <Star size={12} color="var(--warning)" fill="var(--warning)" style={{ verticalAlign: -2 }} /> {Number(b.rating_avg).toFixed(1)}
                          <span className="muted"> ({b.rating_count})</span>
                        </span>
                      ) : (
                        <span
                          className="pill"
                          style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(37,99,235,0.10)', color: 'var(--text)' }}
                        >
                          Új szállító
                        </span>
                      )}
                      {b.carrier_account_type === 'company' && b.carrier_company_name && (
                        <span className="muted" style={{ fontSize: 12 }}>{b.carrier_company_name}</span>
                      )}
                      {b.carrier_vehicle && (
                        <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Truck size={12} aria-hidden /> {b.carrier_vehicle}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const f = felvetelIdopont(b.created_at, b.eta_minutes);
                      if (!f) return null;
                      return (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          Várható felvétel: {f.abszolut}{f.relativ ? ` (${f.relativ})` : ''}
                        </div>
                      );
                    })()}
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
              {/* A díj az ajánlat-kártyán (2026-09-10): a sáv a VÁLASZTÁSNÁL dől el —
                  a 45 000 és az 55 000 Ft-os ajánlat kétszeres díjat jelent, ezt
                  a feladónak a döntés előtt kell látnia, nem elfogadás után. */}
              {!job.paid_at && !egyforma && kapcsolatfelvetelDijHuf(b.counter_amount_huf ?? b.amount_huf) !== legkisebbDij && (
                <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 52 }}>
                  Ennél az ajánlatnál a kapcsolatfelvételi díj:{' '}
                  <strong>{ft(kapcsolatfelvetelDijHuf(b.counter_amount_huf ?? b.amount_huf))} Ft</strong>
                </p>
              )}
              {b.needs_reconfirmation ? (
                <p className="callout callout-info" role="status" style={{ marginTop: 8 }}>
                  A szállító megerősítésére vár. A jelenlegi fuvaradatokra újra meg kell erősítenie az ajánlatát; utána elfogadhatod.
                </p>
              ) : b.counter_by === 'shipper' && b.counter_amount_huf != null ? (
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                  <Hourglass size={13} style={{ verticalAlign: -2 }} /> Elküldted az ellenajánlatod ({b.counter_amount_huf.toLocaleString('hu-HU')} Ft) — a szállító válaszára vár.
                </p>
              ) : (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => acceptBid(b)}
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
        message={job.paid_at
          ? 'A fuvar újra ajánlatokat fogad: a korábbi ajánlatok újra elérhetők, és újak is érkezhetnek. A befizetett kapcsolatfelvételi díj erre a fuvarra érvényes marad — az új szállító kiválasztása díjmentes. A jelenlegi szállító értesítést kap.'
          : 'A fuvar újra ajánlatokat fogad: a korábbi ajánlatok újra elérhetők, és újak is érkezhetnek. A kapcsolatfelvételi díjat még nem fizetted be — az új szállító kiválasztása után fizeted. A jelenlegi szállító értesítést kap.'}
        confirmLabel="Újranyitom"
        fields={[{ key: 'reason', label: 'Indok (opcionális)', type: 'textarea', placeholder: 'pl. A szállító nem veszi fel a telefont' }]}
        onConfirm={(v) => {
          setShowReopenDialog(false);
          reopenJob((v.reason || '').trim());
        }}
        onClose={() => setShowReopenDialog(false)}
      />

      {/* Hirdetés szerkesztése (B3) */}
      <ConfirmDialog
        open={showEditDialog}
        title="✏️ Hirdetés szerkesztése"
        message="Javítsd a címet, a leírást vagy az ajánlott árat. A felvételi/lerakodási cím nem módosítható — arra tették az ajánlatokat; ha az változik, adj fel új fuvart."
        confirmLabel="Mentés"
        fields={[
          { key: 'title', label: 'Cím', type: 'text', placeholder: 'pl. Kanapé Budapestről Szegedre' },
          { key: 'description', label: 'Leírás', type: 'textarea', placeholder: 'pl. 2 doboz + egy összecsukott asztal' },
          { key: 'price', label: 'Ajánlott ár (Ft)', type: 'number', placeholder: 'pl. 15000' },
        ]}
        // (D3, 2026-09-13) ELŐTÖLTVE a jelenlegi értékekkel: csak az ár
        // javításához eddig a címet is újra be kellett gépelni, a leírást nem
        // lehetett törölni. Csak a VÁLTOZÁS megy a PATCH-be.
        initialValues={{
          title: job.title || '',
          description: job.description || '',
          price: job.suggested_price_huf != null ? String(job.suggested_price_huf) : '',
        }}
        onConfirm={async (v) => {
          const adat: Record<string, unknown> = {};
          const ujCim = (v.title ?? '').trim();
          if (ujCim !== (job.title || '')) {
            if (!ujCim) { toast.error('A cím nem lehet üres', 'Adj a hirdetésnek rövid, beszédes címet.'); return; }
            adat.title = ujCim;
          }
          const ujLeiras = (v.description ?? '').trim();
          if (ujLeiras !== (job.description || '')) adat.description = ujLeiras || null;
          const ujAr = (v.price ?? '').trim();
          if (ujAr !== '' && Number(ujAr) !== Number(job.suggested_price_huf)) adat.suggested_price_huf = Number(ujAr);
          setShowEditDialog(false);
          if (Object.keys(adat).length === 0) { toast.info('Nincs változás', 'Egyik mezőt sem módosítottad.'); return; }
          try {
            await api.updateJob(id, adat);
            toast.success('Hirdetés frissítve', 'A függő ajánlattevők értesítést kaptak.');
            loadAll();
          } catch (e: any) {
            toast.error('Nem sikerült menteni', e.message);
          }
        }}
        onClose={() => setShowEditDialog(false)}
      />

      {/* Vita-nyitó dialógus */}
      <ConfirmDialog
        open={showDisputeDialog}
        title="⚖️ Vitás eset megnyitása"
        message="Írd le röviden, mi a probléma a fuvarral. Az ügyfélszolgálat a leírásod, a felvételi és lerakodási fotók és az üzenetek alapján vizsgálja ki az esetet, és legkésőbb 14 munkanapon belül írásban jelentkezik."
        confirmLabel="Vita megnyitása"
        fields={[{ key: 'desc', label: 'A probléma leírása', type: 'textarea', required: true, placeholder: 'pl. A csomag sérülten érkezett meg' }]}
        onConfirm={async (v) => {
          setShowDisputeDialog(false);
          try {
            await api.openDispute({ job_id: id, description: v.desc.trim() });
            toast.info('Vitás eset megnyitva', 'Az ügyfélszolgálat legkésőbb 14 munkanapon belül írásban jelentkezik.');
            loadAll();
          } catch (e: any) {
            toast.error('Hiba', e.message);
          }
        }}
        onClose={() => setShowDisputeDialog(false)}
      />

      {/* „Újra feladom" — van már félbehagyott feladás (A21) */}
      <ConfirmDialog
        open={showUjraDialog}
        title="Félbehagyott feladásod van"
        message="Egy korábban elkezdett fuvarfeladás piszkozata már el van mentve. Ha folytatod, azt ennek a lemondott fuvarnak az adataira cseréljük."
        confirmLabel="Lecserélem és folytatom"
        onConfirm={() => { setShowUjraDialog(false); ujraFeladom(true); }}
        onClose={() => setShowUjraDialog(false)}
      />

      {/* Ellenajánlat a szállító licitjére */}
      <ConfirmDialog
        open={!!counterTarget}
        title="Ellenajánlat küldése"
        message={counterTarget
          ? `A szállító ajánlata ${(counterTarget.counter_amount_huf ?? counterTarget.amount_huf).toLocaleString('hu-HU')} Ft. Add meg, mennyit ajánlasz — a szállító elfogadhatja vagy visszadobhat.`
          : ''}
        confirmLabel="Ellenajánlat elküldése"
        fields={[{
          key: 'amount', label: 'Ellenajánlatod (Ft)', type: 'number', required: true,
          placeholder: counterTarget ? `pl. ${ft(counterTarget.counter_amount_huf ?? counterTarget.amount_huf)}` : '',
        }]}
        onConfirm={(v) => {
          if (counterTarget) submitCounter(counterTarget.id, Number(v.amount));
          setCounterTarget(null);
        }}
        onClose={() => setCounterTarget(null)}
      />
    </div>
  );
}
