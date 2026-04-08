'use client';

// Sofőr "Licitjeim" oldal.
// - Összes licit, amit valaha leadott, a kapcsolódó fuvar adataival együtt.
// - Csoportosítva: Elfogadott (nyertes) / Várakozik / Elutasított vagy régi.
// - Koppintás a kártyára → vissza a fuvar részletes oldalára.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/api';
import { useCurrentUser } from '@/lib/auth';

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

export default function SoforLicitjeim() {
  const me = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myBids()
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Csoportosítás a sofőrnek érthető szempontok szerint
  const accepted = rows.filter((r) => r.bid_status === 'accepted');
  const pending = rows.filter((r) => r.bid_status === 'pending');
  const lost = rows.filter((r) => r.bid_status === 'rejected' || r.bid_status === 'withdrawn');

  function Row({ r }: { r: Row }) {
    // Nyertes-e: ha ez a licit elfogadott, vagy ha a fuvar carrier_id-ja én vagyok
    const iAmCarrier = r.job_carrier_id === me?.id;
    return (
      <Link
        href={`/sofor/fuvar/${r.job_id}`}
        className="card"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>{r.job_title}</h3>
            <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>
              📍 {r.pickup_address}
            </p>
            <p className="muted" style={{ margin: '2px 0', fontSize: 13 }}>
              🏁 {r.dropoff_address}
            </p>
            {r.message && (
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 13, fontStyle: 'italic' }}>
                „{r.message}"
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`pill ${BID_STATUS_PILL[r.bid_status]}`}>
              {BID_STATUS_LABEL[r.bid_status]}
            </span>
            <div className="price" style={{ marginTop: 8, fontSize: 18 }}>
              {r.amount_huf.toLocaleString('hu-HU')} Ft
            </div>
            {r.eta_minutes && (
              <div className="muted" style={{ fontSize: 12 }}>
                érkezés ~{r.eta_minutes} perc
              </div>
            )}
            {iAmCarrier && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>
                🎉 Tiéd a fuvar
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div>
      <h1>Licitjeim</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Itt láthatod, milyen ajánlatokat adtál és azokat elfogadták-e.
      </p>

      {loading && <p>Betöltés…</p>}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">
            Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.
          </p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card">
          <p className="muted">
            Még nem adtál le licitet. Nézegess az{' '}
            <a href="/sofor/fuvarok">Elérhető fuvarok</a> között, és tegyél egy ajánlatot!
          </p>
        </div>
      )}

      {accepted.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✅ Elfogadva ({accepted.length})</h2>
          {accepted.map((r) => (
            <Row key={r.bid_id} r={r} />
          ))}
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>⏳ Várakozik ({pending.length})</h2>
          {pending.map((r) => (
            <Row key={r.bid_id} r={r} />
          ))}
        </>
      )}

      {lost.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>✗ Nem nyert ({lost.length})</h2>
          {lost.map((r) => (
            <Row key={r.bid_id} r={r} />
          ))}
        </>
      )}
    </div>
  );
}
