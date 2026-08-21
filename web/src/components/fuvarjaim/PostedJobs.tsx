'use client';

// Saját feladott hirdetéseim — EGYESÍTETT oldal:
//   - Licites fuvarok, amiket én adtam fel (api.myJobs('posted'))
//   - Fix áras útvonal-hirdetéseim (api.myCarrierRoutes())
// Mindkettő egy oldalon, külön szekciókban, státuszok szerint.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job, CarrierRoute } from '@/api';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { FileText, Hourglass, Route as RouteIcon, MapPin, Flag, Calendar } from 'lucide-react';

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Ajánlatokat vár',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const ROUTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Piszkozat',
  open: 'Publikálva',
  full: 'Betelt',
  in_progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
};

export default function SajatHirdeteseim() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.myJobs('posted'), api.myCarrierRoutes()])
      .then(([j, r]) => {
        setJobs(j);
        setRoutes(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Elfogadott, de még ki nem fizetett fuvarok — ezekre vár teendő.
  const fizetesreVar = jobs.filter(
    (j) => j.status === 'accepted' && !(j as any).paid_at,
  );

  // ⚠️ SZEKCIONÁLÁS (2026-08-16, tesztelői észrevétel): eddig MINDEN feladott
  // fuvar egyetlen listában állt — a kézbesített és a lemondott is a
  // teljesítendők közt. A szállítói oldal (CarryingJobs) már régóta
  // szekcionál; a feladói nem. Megint a fél-oldalon megépült minta.
  const aktivJobok = jobs.filter(
    (j) => !['delivered', 'completed', 'cancelled', 'expired'].includes(j.status),
  );
  const teljesitett = jobs.filter((j) => ['delivered', 'completed'].includes(j.status));
  const lemondott = jobs.filter((j) => ['cancelled', 'expired'].includes(j.status));

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Saját hirdetéseim</h2>
          <p className="muted" style={{ margin: 0 }}>
            Minden, amit TE adtál fel — feladott fuvarok és induló járatok egy helyen.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" href="/dashboard/uj-fuvar">+ Új fuvar</Link>
          <Link className="btn btn-secondary" href="/sofor/uj-utvonal">+ Új fix áras</Link>
        </div>
      </div>

      {/* ── FIZETÉSRE VÁR ────────────────────────────────────────────────
          Tesztelői kérés (2026-08-15): „egy fizetésre vár rész, ahol
          felsorolja a kapcsolatfelvételi díj fizetésére váró fuvarokat."

          SZÁNDÉKOSAN A LISTA TETEJÉN, és csak akkor jelenik meg, ha van ilyen
          fuvar. Ez TEENDŐ, nem böngészési kategória: egy külön fülön el
          lehetne mellette menni, itt viszont szembejön. Ha nincs mit fizetni,
          nyoma sincs — nem zajos.

          A platform EGYETLEN bevétele ezen a lépcsőn akad el a leggyakrabban. */}
      {!loading && fizetesreVar.length > 0 && (
        <div
          className="card"
          style={{
            marginTop: 16,
            borderColor: 'var(--warning, #d97706)',
            background: 'rgba(217,119,6,0.08)',
          }}
        >
          <h3 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hourglass size={18} />
            Fizetésre vár ({fizetesreVar.length})
          </h3>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
            Ezekre megegyeztetek a szállítóval. A kapcsolatfelvételi díj megfizetése
            után kapjátok meg egymás elérhetőségét, és indulhat a fuvar.
          </p>
          {fizetesreVar.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/fuvar/${j.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                marginBottom: 8,
                borderRadius: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {j.title}
                </strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  Megegyezett fuvardíj: {(j.accepted_price_huf ?? 0).toLocaleString('hu-HU')} Ft
                </span>
              </div>
              <span className="btn" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                Fizetés
              </span>
            </Link>
          ))}
        </div>
      )}

      {loading && <ListSkeleton rows={3} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
        </div>
      )}

      {/* Feladott fuvarok */}
      {/* ⚠️ A számláló az ÖSSZES fuvart mutatja (2026-08-21, Manus-teszt):
          a csak-aktív számlálás miatt egy lezárt fuvarú feladó „Feladott
          fuvarjaim (0)"-t látott, és joggal hitte, hogy a fuvarja ELTŰNT —
          miközben lentebb, az Előzmények közt ott volt. A cím ne mondjon
          mást, mint a valóság. */}
      <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FileText size={20} /> Feladott fuvarjaim ({jobs.length})
      </h2>
      {!loading && jobs.length > 0 && aktivJobok.length === 0 && (
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Most nincs aktív fuvarod — a lezártakat lentebb, az <strong>Előzmények</strong> között találod.
        </p>
      )}
      {!loading && jobs.length === 0 && (
        <EmptyState
          compact
          icon={<FileText size={22} aria-hidden />}
          title="Még nincs feladott fuvarod"
          description="Add fel az elsőt — a szállítók ajánlatot tesznek rá, és te választasz közülük."
          cta={<Link className="btn" href="/dashboard/uj-fuvar">Fuvar feladása</Link>}
        />
      )}
      {aktivJobok.map((j) => (
        <Link
          key={j.id}
          href={`/dashboard/fuvar/${j.id}`}
          className="card"
          style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
        >
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginTop: 0 }}>{j.title}</h3>
              <p className="muted" style={{ margin: '2px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {j.pickup_address}</p>
              <p className="muted" style={{ margin: '2px 0' }}><Flag size={13} style={{ verticalAlign: -2 }} /> {j.dropoff_address}</p>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {j.distance_km != null && `${j.distance_km} km`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="pill pill-bidding">{JOB_STATUS_LABEL[j.status] || j.status}</span>
              <div className="price" style={{ marginTop: 6 }}>
                {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
              </div>
            </div>
          </div>
        </Link>
      ))}

      {/* Előzmények — közös fejléc a lezárt szekcióknak, hogy a listának
          látható, megnevezett helye legyen (Manus-teszt, 2026-08-21). */}
      {(teljesitett.length > 0 || lemondott.length > 0) && (
        <h2 style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          Előzmények
        </h2>
      )}
      {teljesitett.length > 0 && (
        <>
          <h3 style={{ marginTop: 16, fontSize: 16 }}>✓ Teljesített ({teljesitett.length})</h3>
          {teljesitett.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/fuvar/${j.id}`}
              className="card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 12, textDecoration: 'none', color: 'inherit', marginTop: 8,
                padding: '10px 14px', opacity: 0.85,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.title}
              </span>
              <span className="pill pill-delivered" style={{ flexShrink: 0 }}>
                {JOB_STATUS_LABEL[j.status] || j.status}
              </span>
            </Link>
          ))}
        </>
      )}

      {/* Lemondott fuvarok — szintén külön, halványan. */}
      {lemondott.length > 0 && (
        <>
          <h3 style={{ marginTop: 16, fontSize: 16 }}>Lemondott ({lemondott.length})</h3>
          {lemondott.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/fuvar/${j.id}`}
              className="card"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 12, textDecoration: 'none', color: 'inherit', marginTop: 8,
                padding: '10px 14px', opacity: 0.65,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.title}
              </span>
              <span className="pill pill-cancelled" style={{ flexShrink: 0 }}>
                {JOB_STATUS_LABEL[j.status] || j.status}
              </span>
            </Link>
          ))}
        </>
      )}

      {/* Fix áras útvonalak */}
      <h2 style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RouteIcon size={20} /> Járataim ({routes.length})
      </h2>
      {!loading && routes.length === 0 && (
        <EmptyState
          compact
          icon={<RouteIcon size={22} aria-hidden />}
          title="Még nincs hirdetett járatod"
          description="Ha úgyis mész valahová, hirdesd meg járatként, fix áron — a feladók helyet foglalnak a csomagjuknak."
          cta={<Link className="btn btn-secondary" href="/sofor/uj-utvonal">Járat hirdetése</Link>}
        />
      )}
      {routes.map((r) => {
        const first = r.waypoints[0]?.name || '?';
        const last = r.waypoints[r.waypoints.length - 1]?.name || '?';
        return (
          <Link
            key={r.id}
            href={`/sofor/utvonal/${r.id}`}
            className="card"
            style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 0 }}>{r.title}</h3>
                <p className="muted" style={{ margin: '2px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {first} → {last}</p>
                <p className="muted" style={{ margin: '2px 0' }}>
                  <Calendar size={13} style={{ verticalAlign: -2 }} /> {new Date(r.departure_at).toLocaleString('hu-HU')}
                </p>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  {r.prices.map((p) => (
                    <span
                      key={p.size}
                      style={{ background: 'var(--surface)', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}
                    >
                      <strong>{p.size}</strong> {p.price_huf.toLocaleString('hu-HU')} Ft
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="pill pill-delivered">{ROUTE_STATUS_LABEL[r.status] || r.status}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
