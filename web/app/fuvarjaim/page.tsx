'use client';

// "Fuvarjaim" hub — egy helyen a korábban szétszórt négy oldal:
//   Hirdetéseim · Vállalt fuvarok · Licitjeim · Foglalásaim
// A régi útvonalak (/hirdeteseim, /sofor/sajat-fuvarok, /sofor/licitjeim,
// /dashboard/foglalasaim) ide irányítanak át a megfelelő füllel.
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Megaphone, Truck, Tag, Package } from 'lucide-react';
import { Loading } from '@/components/StateView';
import PostedJobs from '@/components/fuvarjaim/PostedJobs';
import CarryingJobs from '@/components/fuvarjaim/CarryingJobs';
import MyBids from '@/components/fuvarjaim/MyBids';
import Bookings from '@/components/fuvarjaim/Bookings';

const TABS = [
  { key: 'hirdeteseim', label: 'Hirdetéseim', icon: Megaphone, Comp: PostedJobs },
  { key: 'vallalt', label: 'Vállalt fuvarok', icon: Truck, Comp: CarryingJobs },
  { key: 'licitjeim', label: 'Licitjeim', icon: Tag, Comp: MyBids },
  { key: 'foglalasaim', label: 'Foglalásaim', icon: Package, Comp: Bookings },
] as const;

function HubContent() {
  const sp = useSearchParams();
  const activeKey = sp.get('tab') || 'hirdeteseim';
  const current = TABS.find((t) => t.key === activeKey) || TABS[0];
  const Active = current.Comp;

  return (
    <div>
      <h1 style={{ marginBottom: 12 }}>🚚 Fuvarjaim</h1>

      {/* Füllapok — vízszintesen görgethető mobilon */}
      <div
        role="tablist"
        style={{
          display: 'flex', gap: 4, marginBottom: 20, overflowX: 'auto',
          borderBottom: '1px solid var(--border)', paddingBottom: 0,
        }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === current.key;
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

      <Active />
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
