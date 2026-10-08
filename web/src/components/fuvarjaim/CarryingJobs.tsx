'use client';

// Fuvaraim: minden olyan fuvar, amit a user SZÁLLÍTÓKÉNT teljesít
// (licites fuvar, amire licitált és elfogadták, vagy fix áras foglalás,
// amit megerősített).
// A backend most már as=assigned paraméterrel szűr carrier_id-ra.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Job } from '@/api';
import { ListSkeleton, EmptyState } from '@/components/StateView';
import { Truck, MapPin, Flag, ArrowRight, CircleCheck } from 'lucide-react';
import { kovetkezoLepes } from '@/lib/kovetkezoLepes';
import StatusPill from '@/components/StatusPill';

// KÖVETKEZŐ LÉPÉS (2026-09-11, teljes audit B2): a vállalt fuvarok listája
// minden aktív fuvarnál megmondja, mi jön, és a sorrend is a tennivaló
// szerint alakul (úton lévő elöl, fizetésre váró hátul). A logika 2026-10-08
// óta KÖZÖS a főoldallal (lib/kovetkezoLepes) — a kettő nem csúszhat szét.

// ⚠️ MODUL-SZINTEN (nem a lista-komponensen belül): a belül definiált
// komponens minden szülő-renderkor ÚJ típus, így az összes kártya
// újramountolt, és a fade-in animáció újra lefutott (pl. a Fuvarjaim
// fülsorának görgetésekor — látható villanás).
function JobCard({ j }: { j: Job }) {
  return (
    <Link
      href={`/sofor/fuvar/${j.id}`}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'start' }}>
        {/* ⚠️ A bal oszlop ALAPSZÉLESSÉGE 220 px (nem flex:1 = 0-s alap): a
            hosszú szállítói állapot-felirat („Elfogadva — a feladó
            díjfizetésére vár”) mellett mobilon a cím eddig ~45 px-re szűkült,
            és a .card overflow-wrap:anywhere szabálya BETŰNKÉNT törte. Így a
            .row flex-wrap-je keskeny kijelzőn a jelvényt a cím alá teszi. */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h3 style={{ marginTop: 0 }}>{j.title}</h3>
          <p className="muted" style={{ margin: '2px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {j.pickup_address}</p>
          <p className="muted" style={{ margin: '2px 0' }}><Flag size={13} style={{ verticalAlign: -2 }} /> {j.dropoff_address}</p>
          {kovetkezoLepes(j).szoveg && (
            <p style={{
              margin: '8px 0 0', fontSize: 13, display: 'flex', gap: 6, alignItems: 'flex-start',
              color: kovetkezoLepes(j).sulyos ? 'var(--primary-text)' : 'var(--muted)', fontWeight: kovetkezoLepes(j).sulyos ? 700 : 400,
            }}>
              <ArrowRight size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden /> <span>Következő: {kovetkezoLepes(j).szoveg}</span>
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', marginLeft: 'auto', maxWidth: '100%' }}>
          {/* UX A11: közös állapot-jelvény, szállítói nézet (lib/statusz). */}
          <StatusPill job={j} nezet="szallito" />
          <div className="price" style={{ marginTop: 6 }}>
            {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function SoforSajatFuvarok() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myJobs('assigned')
      .then(setJobs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Csoportosítjuk állapot szerint, hogy könnyebb legyen átlátni
  const active = jobs
    .filter((j) => ['accepted', 'in_progress', 'disputed'].includes(j.status))
    .sort((a, b) => kovetkezoLepes(a).sorrend - kovetkezoLepes(b).sorrend);
  const done = jobs.filter((j) => ['delivered', 'completed'].includes(j.status));
  const other = jobs.filter((j) => !['accepted', 'in_progress', 'disputed', 'delivered', 'completed'].includes(j.status));

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Saját fuvaraim</h2>

      {loading && <ListSkeleton rows={3} />}
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>Hiba:</strong> {error}
          <p className="muted">Lépj be a <a href="/bejelentkezes">bejelentkezés</a> oldalon.</p>
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <EmptyState
          icon={<Truck size={28} aria-hidden />}
          title="Még nincs vállalt fuvarod"
          description="Tegyél ajánlatot egy fuvarra, ami útba esik — ha a feladó elfogad, itt vezeted végig a felvételtől a kód-lezárásig."
          cta={<Link className="btn" href="/sofor/fuvarok">Elérhető fuvarok</Link>}
        />
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={20} /> Aktív fuvarok ({active.length})
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            A felvételt és a lezárást a fuvar megnyitása után itt, a böngészőben végzed el (fotó + átvételi kód).
          </p>
          {active.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}><CircleCheck size={18} aria-hidden style={{ verticalAlign: -3 }} /> Teljesített fuvarok ({done.length})</h2>
          {done.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}

      {other.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Egyéb ({other.length})</h2>
          {other.map((j) => (
            <JobCard key={j.id} j={j} />
          ))}
        </>
      )}
    </div>
  );
}
