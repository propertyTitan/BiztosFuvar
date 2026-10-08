'use client';

import { JARAT_ENGEDELYEZVE } from '@/lib/features';

// "Fuvarjaim" hub — egy helyen a korábban szétszórt négy oldal:
//   Hirdetéseim · Vállalt fuvarok · Licitjeim · Foglalásaim
// A régi útvonalak (/hirdeteseim, /sofor/sajat-fuvarok, /sofor/licitjeim,
// /dashboard/foglalasaim) ide irányítanak át a megfelelő füllel.
//
// UX-review Q17 (2026-10-08): ?tab nélkül a fül az aktív MÓDBÓL jön —
// szállító módban a „Vállalt fuvarok” (eddig a menüből érkező szállító
// minden alkalommal egy üres, feladói „Hirdetéseim” képernyőn landolt), és a
// fülsorrend is a módot követi. Mobilon a túlcsorduló fülsor jobb széle
// elhalványul, jelezve, hogy van még fül.
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Megaphone, Truck, Tag, Package } from 'lucide-react';
import { Loading } from '@/components/StateView';
import { readStoredMode, type AppMode } from '@/lib/auth';
import { fulSorrend, alapFul } from './fulSorrend';
import PostedJobs from '@/components/fuvarjaim/PostedJobs';
import CarryingJobs from '@/components/fuvarjaim/CarryingJobs';
import MyBids from '@/components/fuvarjaim/MyBids';
import Bookings from '@/components/fuvarjaim/Bookings';

const TABS = [
  { key: 'hirdeteseim', label: 'Hirdetéseim', icon: Megaphone, Comp: PostedJobs },
  { key: 'vallalt', label: 'Vállalt fuvarok', icon: Truck, Comp: CarryingJobs },
  { key: 'licitjeim', label: 'Ajánlataim', icon: Tag, Comp: MyBids },
  // A járat-ág kapcsolója (2026-09-11, D1): rejtett funkciónál a fül sem látszik.
  ...(JARAT_ENGEDELYEZVE ? [{ key: 'foglalasaim', label: 'Foglalásaim', icon: Package, Comp: Bookings }] : []),
] as const;

type Ful = (typeof TABS)[number];

// ⚠️ KÜLÖN KOMPONENS: a halványítás állapota (görgetés/átméretezés) itt él,
// így a görgetés NEM rendereli újra a HubContentet és az aktív fül listáját —
// korábban minden görgetési lépés újramountolta a kártyákat (villanás).
function FulSor({ sorrend, aktivKulcs }: { sorrend: readonly Ful[]; aktivKulcs: string | undefined }) {
  // Mobilon a túlcsorduló fülsor jobb szélének halványítása.
  const sorRef = useRef<HTMLDivElement>(null);
  const [vanMegJobbra, setVanMegJobbra] = useState(false);
  const sorrendKulcs = sorrend.map((t) => t.key).join(',');
  useEffect(() => {
    const el = sorRef.current;
    if (!el) return;
    const meres = () => setVanMegJobbra(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    meres();
    el.addEventListener('scroll', meres, { passive: true });
    window.addEventListener('resize', meres);
    return () => { el.removeEventListener('scroll', meres); window.removeEventListener('resize', meres); };
  }, [sorrendKulcs]);

  return (
    <div
      ref={sorRef}
      role="tablist"
      style={{
        display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto',
        // BUG-040: a görgetés maradjon (kis kijelzőn kell), de a
        // scrollbar ne látsszon
        scrollbarWidth: 'none',
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
        ...(vanMegJobbra ? {
          WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 40px), transparent)',
          maskImage: 'linear-gradient(to right, #000 calc(100% - 40px), transparent)',
        } : {}),
      }}
    >
      {sorrend.map((t) => {
        const Icon = t.icon;
        const active = t.key === aktivKulcs;
        return (
          <Link
            key={t.key}
            href={`/fuvarjaim?tab=${t.key}`}
            role="tab"
            aria-selected={active}
            scroll={false}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', whiteSpace: 'nowrap', textDecoration: 'none',
              fontSize: 14, fontWeight: active ? 700 : 500,
              color: active ? 'var(--primary-text)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
              marginBottom: -1, transition: 'all var(--transition)',
            }}
          >
            <Icon size={16} /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}

function HubContent() {
  const sp = useSearchParams();
  const tabParam = sp.get('tab');
  // A mód csak a böngészőben ismert (localStorage) — az első render előtt
  // nem tippelünk, különben a szállító egy pillanatra a feladói fület (és
  // annak lekérését) kapná.
  const [mode, setMode] = useState<AppMode | null | undefined>(undefined);
  useEffect(() => {
    const olvas = () => setMode(readStoredMode());
    olvas();
    window.addEventListener('gofuvar:mode-change', olvas);
    return () => window.removeEventListener('gofuvar:mode-change', olvas);
  }, []);

  const sorrend = fulSorrend(TABS, mode ?? null);
  const activeKey = tabParam || (mode === undefined ? null : alapFul(mode));
  const current = activeKey ? (TABS.find((t) => t.key === activeKey) || TABS[0]) : null;

  const Active = current?.Comp;

  return (
    <div>
      <h1 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Truck size={26} color="var(--primary)" aria-hidden /> Fuvarjaim
      </h1>

      {/* Füllapok — vízszintesen görgethető mobilon */}
      <FulSor sorrend={sorrend} aktivKulcs={current?.key} />

      {Active ? <Active /> : <Loading />}
    </div>
  );
}

export default function FuvarjaimHub() {
  return (
    <Suspense fallback={<Loading />}>
      <HubContent />
    </Suspense>
  );
}
