'use client';

// Szállító "Ajánlataim" oldal.
// - Összes ajánlat, amit valaha leadott, a kapcsolódó fuvar adataival együtt.
// - Csoportosítva: Elfogadott (nyertes) / Várakozik / Elutasított vagy régi.
// - Koppintás a kártyára → vissza a fuvar részletes oldalára.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { Tag, MapPin, Flag, BadgeCheck, Hourglass, Undo2 } from 'lucide-react';
import StatusPill from '@/components/StatusPill';

type Row = Awaited<ReturnType<typeof api.myBids>>[number];

const BID_STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik elfogadásra',
  accepted: 'Elfogadva',
  rejected: 'Elutasítva',
  withdrawn: 'Visszavonva',
};

const BID_STATUS_PILL: Record<string, string> = {
  pending: 'pill-bidding',
  accepted: 'pill-delivered',
  rejected: 'pill-cancelled',
  withdrawn: 'pill-cancelled',
};

const jobLezart = (r: Row) => ['cancelled', 'expired'].includes(r.job_status);

// ⚠️ MODUL-SZINTEN (nem a lista-komponensen belül): a belül definiált
// komponens minden szülő-renderkor ÚJ típus, így minden kártya újramountolt,
// és a fade-in animáció újra lefutott (látható villanás a Fuvarjaim fülsorának
// görgetésekor).
function AjanlatSor({ r, meId, onVisszavon }: {
  r: Row;
  meId: string | undefined;
  onVisszavon: (r: Row) => void;
}) {
  // A kijelölt szállító (az enyém a fuvar) — nem lemondott fuvaron.
  const enyem = r.job_carrier_id === meId && !jobLezart(r);
  return (
    <Link
      href={`/sofor/fuvar/${r.job_id}`}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
        {/* ⚠️ A bal oszlop ALAPSZÉLESSÉGE 220 px (nem flex:1 = 0-s alap):
            mobilon a hosszú állapot-felirat mellett a cím eddig ~60 px-re
            szűkült és betűnként tört; így a .row flex-wrap-je a jobb oszlopot
            keskeny kijelzőn a cím alá teszi. */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>{r.job_title}</h3>
          <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>
            <MapPin size={13} style={{ verticalAlign: -2 }} /> {r.pickup_address}
          </p>
          <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>
            <Flag size={13} style={{ verticalAlign: -2 }} /> {r.dropoff_address}
          </p>
          {r.needs_reconfirmation && r.bid_status === 'pending' && (
            <p style={{ margin: '8px 0', fontSize: 13 }}>Nézd át a fuvar jelenlegi adatait, és erősítsd meg az ajánlatodat.</p>
          )}
          {r.message && (
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13, fontStyle: 'italic' }}>
              „{r.message}”
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', marginLeft: 'auto', maxWidth: '100%' }}>
          {/* 2026-10-08 (UX A12): a kijelölt szállító a FUVAR állapotát látja
              a közös jelvénnyel (lib/statusz, szállítói nézet) — fizetetlen:
              „…a feladó díjfizetésére vár”, fizetett: „Indulhat a fuvar”,
              úton: „Úton”, vita: „Vita folyamatban”. Eddig egy saját felirat
              MINDEN fizetett állapotra „Indulhat a fuvar”-t mondott (úton
              lévőre és vitásra is), az ajánlat „Elfogadva” jelvénye mellett. */}
          {enyem ? (
            <StatusPill
              job={{ status: r.job_status, paid_at: r.job_fee_paid ? 'fizetve' : null }}
              nezet="szallito"
            />
          ) : (
            <span className={`pill ${BID_STATUS_PILL[r.bid_status]}`}>
              {r.needs_reconfirmation && r.bid_status === 'pending' ? 'Megerősítésedre vár' : BID_STATUS_LABEL[r.bid_status]}
            </span>
          )}
          <div className="price" style={{ marginTop: 8, fontSize: 18 }}>
            {r.amount_huf.toLocaleString('hu-HU')} Ft
          </div>
          {r.eta_minutes && (
            <div className="muted" style={{ fontSize: 12 }}>
              érkezés a felvételre: ~{r.eta_minutes} perc
            </div>
          )}
          {r.bid_status === 'pending' && !jobLezart(r) && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 8, fontSize: 12, padding: '4px 10px' }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onVisszavon(r); }}
              aria-label="Ajánlat visszavonása"
            >
              <Undo2 size={13} /> Visszavonom
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function SoforLicitjeim() {
  const me = useCurrentUser();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Visszavonás (2026-09-11, teljes audit A4/B1): a függő ajánlat
  // visszavonható — eddig nem volt kiút, a feladó egy már nem aktuális
  // ajánlatot is elfogadhatott.
  const [visszavonando, setVisszavonando] = useState<Row | null>(null);
  const [visszavonas, setVisszavonas] = useState(false);

  async function visszavon() {
    if (!visszavonando) return;
    setVisszavonas(true);
    try {
      await api.withdrawBid(visszavonando.bid_id);
      setRows((r) => r.map((x) => (x.bid_id === visszavonando.bid_id ? { ...x, bid_status: 'withdrawn' as const } : x)));
      toast.success('Ajánlat visszavonva', 'A feladó értesítést kapott. Jobb árral bármikor újra ajánlatot tehetsz.');
      setVisszavonando(null);
    } catch (e: any) {
      toast.error('Nem sikerült visszavonni', e?.message || 'Próbáld újra.');
    } finally {
      setVisszavonas(false);
    }
  }

  useEffect(() => {
    api
      .myBids()
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Csoportosítás a szállítónak érthető szempontok szerint.
  //
  // ⚠️ A LEMONDOTT HIRDETÉS KÜLÖN KOSÁR (2026-08-16, tesztelői észrevétel).
  // Eddig CSAK a bid_status számított: egy 'pending' ajánlat, aminek a
  // FUVARJÁT időközben lemondták, örökre az „Elfogadásra várakozik" alatt
  // ült — a szállító hiába várt egy hirdetésre, ami már nem létezik.
  const cancelled = rows.filter((r) => r.bid_status !== 'accepted' && jobLezart(r));
  // ⚠️ A LEZÁRT fuvar nem marad itt (2026-08-20, tesztelői észrevétel): az
  // elfogadott ajánlat fuvarja a kézbesítés után a „Vállalt fuvarok →
  // Teljesített" alatt él — ha itt is örökre listáznánk, ugyanaz a fuvar
  // KÉT fülön szerepelne. Az „Elfogadva" a still-aktív munkákat mutatja.
  const accepted = rows.filter(
    (r) => r.bid_status === 'accepted'
      && !['delivered', 'completed', 'cancelled', 'expired'].includes((r as any).job_status),
  );
  const pending = rows.filter((r) => r.bid_status === 'pending' && !jobLezart(r));
  const lost = rows.filter(
    (r) => (r.bid_status === 'rejected' || r.bid_status === 'withdrawn') && !jobLezart(r),
  );

  return (
    <div>
      <ConfirmDialog
        open={!!visszavonando}
        title="Visszavonod az ajánlatot?"
        message={visszavonando ? `A(z) „${visszavonando.job_title}” fuvarra tett ${visszavonando.amount_huf.toLocaleString('hu-HU')} Ft-os ajánlatod lezárul, a feladó értesítést kap. Később jobb árral újra ajánlatot tehetsz.` : ''}
        confirmLabel={visszavonas ? 'Visszavonás…' : 'Visszavonom'}
        onConfirm={visszavon}
        onClose={() => setVisszavonando(null)}
      />
      <h2 style={{ marginTop: 0 }}>Ajánlataim</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Itt láthatod, milyen ajánlatokat adtál és azokat elfogadták-e.
      </p>

      {loading && <ListSkeleton rows={3} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">
            Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.
          </p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={<Tag size={28} aria-hidden />}
          title="Még nem tettél ajánlatot"
          description="Böngéssz az elérhető fuvarok között, és tegyél ajánlatot arra, ami útba esik — a fuvardíj 100%-a a tiéd, levonás nélkül."
          cta={<Link className="btn" href="/sofor/fuvarok">Elérhető fuvarok</Link>}
        />
      )}

      {accepted.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BadgeCheck size={20} /> Elfogadva ({accepted.length})
          </h2>
          {accepted.map((r) => (
            <AjanlatSor key={r.bid_id} r={r} meId={me?.id} onVisszavon={setVisszavonando} />
          ))}
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hourglass size={20} /> Várakozik ({pending.length})
          </h2>
          {pending.map((r) => (
            <AjanlatSor key={r.bid_id} r={r} meId={me?.id} onVisszavon={setVisszavonando} />
          ))}
        </>
      )}

      {lost.length > 0 && (
        <>
          {/* Átfogalmazva (2026-08-16, tesztelői kérés): a „Nem nyert" úgy
              hangzott, mintha a szállító veszített volna valamit. Ez nem
              verseny-eredmény, csak annyi: ezúttal másik ajánlatot fogadtak
              el — és elutasított ajánlat után újra lehet próbálkozni. */}
          <h2 style={{ marginTop: 24 }}>Lezárult ajánlatok ({lost.length})</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Ezekre a fuvarokra másik ajánlatot fogadtak el, vagy visszavontad
            a sajátodat. Ha a hirdetés újra nyitott, tehetsz új ajánlatot.
          </p>
          {lost.map((r) => (
            <AjanlatSor key={r.bid_id} r={r} meId={me?.id} onVisszavon={setVisszavonando} />
          ))}
        </>
      )}

      {cancelled.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>A hirdetést visszavonták ({cancelled.length})</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Ezeket a fuvarokat a feladó időközben lemondta — az ajánlatod ezzel
            lezárult, teendőd nincs.
          </p>
          {cancelled.map((r) => (
            <AjanlatSor key={r.bid_id} r={r} meId={me?.id} onVisszavon={setVisszavonando} />
          ))}
        </>
      )}
    </div>
  );
}
