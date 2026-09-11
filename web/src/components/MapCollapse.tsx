'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Map as MapIcon, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Térkép-burkoló, ami MOBILON összecsukva indul (2026-09-11, teljes audit
 * B2 — Manus GF-020: a részlet-oldalak 3000–5000 px hosszúak voltak, a fő
 * CTA több képernyőnyire; a térkép a legnagyobb blokk, és a legritkábban
 * kell azonnal). Asztali nézetben változatlanul nyitva, gomb nélkül.
 * A tartalom csak nyitva mountolódik (a Google Maps rejtett konténerben
 * rosszul inicializál).
 */
export default function MapCollapse({ children, title = 'Térkép' }: { children: ReactNode; title?: string }) {
  const [mobil, setMobil] = useState(false);
  const [nyitva, setNyitva] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const alkalmaz = () => { setMobil(mq.matches); setNyitva(!mq.matches); };
    alkalmaz();
    mq.addEventListener('change', alkalmaz);
    return () => mq.removeEventListener('change', alkalmaz);
  }, []);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
      {mobil && (
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={nyitva}
          aria-controls="map-collapse-body"
          onClick={() => setNyitva((v) => !v)}
          style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, padding: '12px 16px' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <MapIcon size={16} /> {nyitva ? `${title} elrejtése` : `${title} megjelenítése`}
          </span>
          {nyitva ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      {nyitva && <div id="map-collapse-body">{children}</div>}
    </div>
  );
}
